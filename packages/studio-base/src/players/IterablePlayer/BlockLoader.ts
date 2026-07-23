// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { simplify } from "intervals-fn";
import * as _ from "lodash-es";

import { Condvar } from "@foxglove/den/async";
import { filterMap } from "@foxglove/den/collection";
import Log from "@foxglove/log";
import {
  Time,
  add,
  clampTime,
  fromNanoSec,
  subtract as subtractTimes,
  toNanoSec,
} from "@foxglove/rostime";
import { Immutable, MessageEvent } from "@foxglove/studio";
import { IteratorCursor } from "@foxglove/studio-base/players/IterablePlayer/IteratorCursor";
import PlayerProblemManager from "@foxglove/studio-base/players/PlayerProblemManager";
import { MessageBlock, Progress, TopicSelection } from "@foxglove/studio-base/players/types";

import { IDeserializedIterableSource, MessageIteratorArgs } from "./IIterableSource";

const log = Log.getLogger(__filename);

export const MEMORY_INFO_PRELOADED_MSGS = "Preloaded messages";

/**
 * Max continuous time loaded in a single BlockLoader span. Caps forward expansion so
 * playhead-priority loading is not defeated by a single request from focus→EOF (REI-125).
 * After each span completes, the next nearest incomplete neighborhood is chosen.
 *
 * Only applied when playhead focus is enabled — without focus the cap just fragments one
 * contiguous preload into many smaller range requests that contend with video reads.
 */
export const BLOCK_LOAD_MAX_SPAN_DURATION_NS = 10_000_000_000; // 10 seconds

/**
 * Playhead-priority block loading is **off by default** (REI-125 review).
 *
 * Loading blocks outward from the playhead only pays off if block consumers can ingest blocks out
 * of order, and today none can:
 *   - `Plot/builders/BlockTopicCursor` stops at the first gap and returns nothing until block 0
 *     arrives — which, under outward-from-focus fill, is the *last* block loaded.
 *   - `StateTransitionsCoordinator` keeps a single ascending cursor per series.
 *
 * Enabling focus also fragments preload into many short spans (measured 1 → 8 range requests on
 * the Astribot S1 layout), contending with the video seek range reads on the same origin.
 *
 * Re-enable via the `playheadFocusEnabled` constructor option once consumers merge blocks by
 * timestamp rather than by ascending cursor. See docs/rei-125-perf-report.md.
 */
export const BLOCK_LOADER_PLAYHEAD_FOCUS_DEFAULT = false;

type BlockLoaderArgs = {
  cacheSizeBytes: number;
  source: IDeserializedIterableSource;
  start: Time;
  end: Time;
  maxBlocks: number;
  minBlockDurationNs: number;
  problemManager: PlayerProblemManager;
  /** See {@link BLOCK_LOADER_PLAYHEAD_FOCUS_DEFAULT}. Defaults to off. */
  playheadFocusEnabled?: boolean;
};

type CacheBlock = MessageBlock & {
  needTopics: Immutable<TopicSelection>;
};

type Blocks = (CacheBlock | undefined)[];

type LoadArgs = {
  progress: (progress: Progress) => void;
};

/**
 * BlockLoader manages loading blocks from a source. Blocks are fixed time span containers for messages.
 */
export class BlockLoader {
  #source: IDeserializedIterableSource;
  #blocks: Blocks = [];
  #start: Time;
  #end: Time;
  #blockDurationNanos: number;
  #topics: TopicSelection = new Map();
  #maxCacheSize: number = 0;
  #problemManager: PlayerProblemManager;
  #stopped: boolean = false;
  #activeChangeCondvar: Condvar = new Condvar();
  #abortController: AbortController;
  #progressCallback?: (progress: Progress) => void;
  /** Playhead focus used to prioritize which incomplete blocks load first (REI-125). */
  #focusTime?: Time;
  #focusBlockId: number = 0;
  readonly #playheadFocusEnabled: boolean;

  public constructor(args: BlockLoaderArgs) {
    this.#source = args.source;
    this.#start = args.start;
    this.#end = args.end;
    this.#maxCacheSize = args.cacheSizeBytes;
    this.#problemManager = args.problemManager;
    this.#playheadFocusEnabled = args.playheadFocusEnabled ?? BLOCK_LOADER_PLAYHEAD_FOCUS_DEFAULT;
    this.#abortController = new AbortController();

    const totalNs = Number(toNanoSec(subtractTimes(this.#end, this.#start))) + 1; // +1 since times are inclusive.
    if (totalNs > Number.MAX_SAFE_INTEGER * 0.9) {
      throw new Error("Time range is too long to be supported");
    }

    this.#blockDurationNanos = Math.ceil(
      Math.max(args.minBlockDurationNs, totalNs / args.maxBlocks),
    );

    const blockCount = Math.ceil(totalNs / this.#blockDurationNanos);

    log.debug(`Block count: ${blockCount}`);
    this.#blocks = Array.from({ length: blockCount });
  }

  /**
   * Hint the playhead time so incomplete blocks near the current view load first.
   *
   * When `abortInFlight` is true (seeks), an in-progress span is cancelled so the next
   * load picks a span near the new playhead. Continuous playback should omit abort to
   * avoid thrashing preload as the playhead crosses block boundaries.
   */
  public setFocusTime(time: Time | undefined, options?: { abortInFlight?: boolean }): void {
    if (!this.#playheadFocusEnabled) {
      // Focus is opt-in; leaving #focusTime undefined keeps the sequential left-to-right scan
      // that every block consumer currently requires. See BLOCK_LOADER_PLAYHEAD_FOCUS_DEFAULT.
      return;
    }
    if (time == undefined) {
      if (this.#focusTime == undefined) {
        return;
      }
      this.#focusTime = undefined;
      this.#focusBlockId = 0;
      return;
    }

    const nextBlockId = this.#timeToBlockId(time);
    const focusBlockChanged = nextBlockId !== this.#focusBlockId || this.#focusTime == undefined;
    this.#focusTime = time;
    this.#focusBlockId = nextBlockId;

    if (!focusBlockChanged || options?.abortInFlight !== true) {
      return;
    }

    // Abort the in-flight span; #load returns "aborted" and startLoading loops without wait.
    this.#abortController.abort();
    this.#activeChangeCondvar.notifyAll();
  }

  public setTopics(topics: TopicSelection): void {
    if (_.isEqual(topics, this.#topics)) {
      return;
    }

    this.#abortController.abort();
    this.#activeChangeCondvar.notifyAll();
    log.debug(`Preloaded topics: ${Array.from(topics.keys()).join(", ")}`);

    // Update all the blocks with any missing topics
    for (const block of this.#blocks) {
      if (!block) {
        continue;
      }

      const blockTopics = Object.keys(block.messagesByTopic);
      const needTopics = new Map(topics);
      for (const topic of blockTopics) {
        // We need the topic unless the subscription is identical to the subscription for this
        // topic at the time blocks were loaded.
        if (_.isEqual(this.#topics.get(topic), topics.get(topic))) {
          needTopics.delete(topic);
        }
      }
      block.needTopics = needTopics;
    }

    this.#topics = topics;

    this.#removeUnusedBlockTopics();
    this.#progressCallback?.(this.#calculateProgress(topics, this.#cacheSize()));
  }

  /**
   * Remove topics that are no longer requested to be preloaded or topics that will be re-loaded
   * from blocks to free up space
   */
  #removeUnusedBlockTopics(): number {
    const topics = this.#topics;
    let totalBytesRemoved = 0;
    for (let i = 0; i < this.#blocks.length; i++) {
      const block = this.#blocks[i];
      if (block) {
        let blockBytesRemoved = 0;
        const newMessagesByTopic: Record<string, MessageEvent[]> = {
          ...block.messagesByTopic,
        };
        const blockTopics = Object.keys(newMessagesByTopic);
        for (const topic of blockTopics) {
          // remove topics that are no longer requested to be preloaded and topics that will
          // be re-loaded (due to different subscription parameters)
          const messages = newMessagesByTopic[topic];
          if ((!topics.has(topic) || block.needTopics.has(topic)) && messages) {
            for (const msg of messages) {
              blockBytesRemoved += msg.sizeInBytes;
            }
            delete newMessagesByTopic[topic];
          }
        }
        if (blockBytesRemoved > 0) {
          this.#blocks[i] = {
            ...block,
            messagesByTopic: newMessagesByTopic,
            sizeInBytes: block.sizeInBytes - blockBytesRemoved,
          };
          totalBytesRemoved += blockBytesRemoved;
        }
      }
    }
    return totalBytesRemoved;
  }

  public async stopLoading(): Promise<void> {
    log.debug("Stop loading blocks");
    this.#stopped = true;
    this.#abortController.abort();
    this.#activeChangeCondvar.notifyAll();
    this.#progressCallback = undefined;
  }

  public async startLoading(args: LoadArgs): Promise<void> {
    log.debug("Start loading process");
    this.#stopped = false;

    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (!this.#stopped) {
        this.#abortController = new AbortController();

        const topics = this.#topics;

        const loadResult = await this.#load({ progress: args.progress });

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.#stopped) {
          break;
        }

        // Aborted (seek focus) or topics changed: immediately pick the next span.
        if (loadResult === "aborted" || loadResult === "topics-changed") {
          continue;
        }

        // Wait for topics to possibly change.
        if (this.#topics === topics) {
          await this.#activeChangeCondvar.wait();
        }
      }
    } finally {
      this.#progressCallback = undefined;
    }
  }

  async #load(args: {
    progress: LoadArgs["progress"];
  }): Promise<"done" | "aborted" | "topics-changed"> {
    this.#progressCallback = args.progress;
    const topics = new Map(this.#topics);

    // Ignore changing the blocks if the topic list is empty
    if (topics.size === 0) {
      args.progress(this.#calculateProgress(topics, this.#cacheSize()));
      return "done";
    }

    if (this.#blocks.length === 0) {
      return "done";
    }

    log.debug("loading blocks", { topics, focusBlockId: this.#focusBlockId });

    const { progress } = args;
    let totalBlockSizeBytes = this.#cacheSize();

    // Load incomplete spans until none remain. Prefer spans near the playhead so seek/deep-link
    // views get preloaded StateTransitions/Plot history before distant blocks (REI-125).
    for (;;) {
      const blockId = this.#nextIncompleteBlockId(topics);
      if (blockId == undefined) {
        break;
      }

      // Topics we will fetch for this range
      const existingBlock = this.#blocks[blockId];
      const topicsToFetch: Immutable<TopicSelection> = existingBlock?.needTopics ?? topics;

      // Expand a continuous span forward only. When playhead focus is enabled the span is capped
      // in duration so a focus near mid-bag does not pull the entire remaining timeline in one
      // request; with focus off we keep the original single contiguous span, because splitting it
      // only multiplies range requests that contend with video seek reads (REI-125 review).
      const startBlockId = blockId;
      const maxEndBlockId = this.#playheadFocusEnabled
        ? Math.min(
            this.#blocks.length - 1,
            startBlockId +
              Math.max(1, Math.ceil(BLOCK_LOAD_MAX_SPAN_DURATION_NS / this.#blockDurationNanos)) -
              1,
          )
        : this.#blocks.length - 1;
      let endBlockId = blockId;
      for (let endIdx = blockId + 1; endIdx <= maxEndBlockId; ++endIdx) {
        // if needtopics is undefined cause there's no block, then needTopics is all topics
        const needTopics = this.#blocks[endIdx]?.needTopics ?? topics;

        // The topics we need to fetch no longer match the topics we need so we stop the range
        if (!_.isEqual(topicsToFetch, needTopics)) {
          break;
        }

        endBlockId = endIdx;
      }

      // Compute the cursor start/end time from the range of blocks we need to load
      const cursorStartTime = this.#blockIdToStartTime(startBlockId);
      const cursorEndTime = clampTime(this.#blockIdToEndTime(endBlockId), this.#start, this.#end);

      const iteratorArgs: Immutable<MessageIteratorArgs> = {
        topics: topicsToFetch,
        start: cursorStartTime,
        end: cursorEndTime,
        consumptionType: "full",
      };

      // If the source provides a message cursor we use its message cursor, otherwise we make one
      // using the source's message iterator.
      const cursor =
        this.#source.getMessageCursor?.({ ...iteratorArgs, abort: this.#abortController.signal }) ??
        new IteratorCursor(
          this.#source.messageIterator({
            ...iteratorArgs,
            abortSignal: this.#abortController.signal,
          }),
          this.#abortController.signal,
        );

      log.debug("Loading range", { startBlockId, endBlockId, focusBlockId: this.#focusBlockId });
      // Loop through the blocks corresponding to the range of our cursor
      for (let currentBlockId = startBlockId; currentBlockId <= endBlockId; ++currentBlockId) {
        // Until time is the end time of the current block, we want all the messages from the cursor
        // until (inclusive) of the end of of the block
        const untilTime = clampTime(this.#blockIdToEndTime(currentBlockId), this.#start, this.#end);

        const results = await cursor.readUntil(untilTime);
        // No results means cursor aborted or eof
        if (!results) {
          await cursor.end();
          return this.#abortController.signal.aborted ? "aborted" : "done";
        }

        // While we were waiting for cursor data the topics we need to be loading may have changed.
        // Check whether the topics are changed and abort this loading instance because the results
        // may no longer be valid for the data we should be loading.
        if (!_.isEqual(topics, this.#topics)) {
          await cursor.end();
          return "topics-changed";
        }

        const messagesByTopic: Record<string, MessageEvent[]> = {};

        // Set all topics to empty arrays. Since our cursor requested all the topicsToFetch we either will
        // have message on the topic or we don't have message on the topic. Either way the topic entry
        // starts as an empty array.
        for (const topic of topicsToFetch.keys()) {
          messagesByTopic[topic] = [];
        }

        let sizeInBytes = 0;
        for (const iterResult of results) {
          if (iterResult.type === "problem") {
            this.#problemManager.addProblem(
              `connid-${iterResult.connectionId}`,
              iterResult.problem,
            );
            continue;
          }

          if (iterResult.type !== "message-event") {
            continue;
          }

          const msgTopic = iterResult.msgEvent.topic;
          const arr = messagesByTopic[msgTopic];

          // Because we initialized all the topicsToFetch earlier we expect to have an array for each message
          // topic in our results. If we don't, thats a problem.
          const problemKey = `unexpected-topic-${msgTopic}`;
          if (!arr) {
            this.#problemManager.addProblem(problemKey, {
              severity: "error",
              message: `Received a message on an unexpected topic: ${msgTopic}.`,
            });

            continue;
          }
          this.#problemManager.removeProblem(problemKey);

          const messageSizeInBytes = iterResult.msgEvent.sizeInBytes;
          totalBlockSizeBytes += messageSizeInBytes;
          arr.push(iterResult.msgEvent);

          sizeInBytes += messageSizeInBytes;

          if (totalBlockSizeBytes < this.#maxCacheSize) {
            this.#problemManager.removeProblem("cache-full");
            continue;
          }
          // cache over capacity, try removing unused topics
          const removedSize = this.#removeUnusedBlockTopics();
          totalBlockSizeBytes -= removedSize;
          if (totalBlockSizeBytes > this.#maxCacheSize) {
            this.#problemManager.addProblem("cache-full", {
              severity: "error",
              message: `Cache is full. Preloading for topics [${Array.from(
                topicsToFetch.keys(),
              ).join(", ")}] has stopped on block ${currentBlockId + 1}/${this.#blocks.length}.`,
              tip: "Try reducing the number of topics that require preloading at a given time (e.g. in plots), or try to reduce the time range of the file.",
            });
            // We need to emit progress here so the player will emit a new state
            // containing the problem.
            progress(this.#calculateProgress(topics, totalBlockSizeBytes));
            await cursor.end();
            return "done";
          }
        }

        const existingBlock = this.#blocks[currentBlockId];

        // Calculate size of messages in the existing block that will be overridden.
        // These have to be taken into account when calculating the size of the new block.
        let overridenBlockMessagesSize = 0;
        for (const topic of Object.keys(messagesByTopic)) {
          const messages = existingBlock?.messagesByTopic[topic];
          if (messages) {
            overridenBlockMessagesSize += messages.reduce((acc, msg) => acc + msg.sizeInBytes, 0);
          }
        }
        const newBlockSizeInBytes =
          (existingBlock?.sizeInBytes ?? 0) - overridenBlockMessagesSize + sizeInBytes;

        this.#blocks[currentBlockId] = {
          needTopics: new Map(),
          messagesByTopic: {
            ...existingBlock?.messagesByTopic,
            // Any new topics override the same previous topic
            ...messagesByTopic,
          },
          sizeInBytes: newBlockSizeInBytes,
        };

        // Subtract the size of overridden messages from the the total size of all blocks.
        // (The size of new messages is already added above).
        totalBlockSizeBytes -= overridenBlockMessagesSize;

        progress(this.#calculateProgress(topics, totalBlockSizeBytes));
      }

      await cursor.end();
    }

    return "done";
  }

  /**
   * Next incomplete block closest to the focus playhead (ties prefer the focus/right side).
   * Falls back to left-to-right scan when no focus is set.
   */
  #nextIncompleteBlockId(_topics: TopicSelection): number | undefined {
    const needsLoad = (blockId: number): boolean => {
      const block = this.#blocks[blockId];
      // Missing block or non-empty needTopics ⇒ still needs work (matches prior loop condition).
      if (!block) {
        return true;
      }
      return block.needTopics.size !== 0;
    };

    if (this.#focusTime == undefined) {
      for (let blockId = 0; blockId < this.#blocks.length; ++blockId) {
        if (needsLoad(blockId)) {
          return blockId;
        }
      }
      return undefined;
    }

    const focus = this.#focusBlockId;
    const n = this.#blocks.length;
    for (let distance = 0; distance < n; ++distance) {
      const right = focus + distance;
      if (right < n && needsLoad(right)) {
        return right;
      }
      if (distance === 0) {
        continue;
      }
      const left = focus - distance;
      if (left >= 0 && needsLoad(left)) {
        return left;
      }
    }
    return undefined;
  }

  #timeToBlockId(time: Time): number {
    const totalNs = Number(toNanoSec(subtractTimes(time, this.#start)));
    if (!Number.isFinite(totalNs) || totalNs <= 0) {
      return 0;
    }
    const id = Math.floor(totalNs / this.#blockDurationNanos);
    return Math.max(0, Math.min(this.#blocks.length - 1, id));
  }

  #calculateProgress(topics: TopicSelection, currentCacheSize: number): Progress {
    const fullyLoadedFractionRanges = simplify(
      filterMap(this.#blocks, (thisBlock, blockIndex) => {
        if (!thisBlock) {
          return;
        }

        for (const topic of topics.keys()) {
          if (!thisBlock.messagesByTopic[topic]) {
            return;
          }
        }

        return {
          start: blockIndex,
          end: blockIndex + 1,
        };
      }),
    );

    return {
      fullyLoadedFractionRanges: fullyLoadedFractionRanges.map((range) => ({
        // Convert block ranges into fractions.
        start: range.start / this.#blocks.length,
        end: range.end / this.#blocks.length,
      })),
      messageCache: {
        blocks: this.#blocks.slice(),
        startTime: this.#start,
      },
      memoryInfo: {
        [MEMORY_INFO_PRELOADED_MSGS]: currentCacheSize,
      },
    };
  }

  #cacheSize(): number {
    return this.#blocks.reduce((prev, block) => {
      if (!block) {
        return prev;
      }

      return prev + block.sizeInBytes;
    }, 0);
  }

  #blockIdToStartTime(id: number): Time {
    return add(this.#start, fromNanoSec(BigInt(id) * BigInt(this.#blockDurationNanos)));
  }

  // The end time of a block is the start time of the next block minus 1 nanosecond
  #blockIdToEndTime(id: number): Time {
    return add(this.#start, fromNanoSec(BigInt(id + 1) * BigInt(this.#blockDurationNanos) - 1n));
  }
}
