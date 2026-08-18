// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EventEmitter from "eventemitter3";
import * as _ from "lodash-es";

import { debouncePromise } from "@foxglove/den/async";
import {
  parseMessagePath,
  MessagePath,
  MessagePathStructureItemMessage,
} from "@foxglove/message-path";
import { toSec, subtract as subtractTime } from "@foxglove/rostime";
import { Immutable, Time, MessageEvent } from "@foxglove/studio";
import { messagePathStructures } from "@foxglove/studio-base/components/MessagePathSyntax/messagePathsForDatatype";
import {
  fillInGlobalVariablesInPath,
  getMessagePathDataItems,
} from "@foxglove/studio-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { GlobalVariables } from "@foxglove/studio-base/hooks/useGlobalVariables";
import { MessageBlock, PlayerState, Topic } from "@foxglove/studio-base/players/types";
import { Bounds, Bounds1D } from "@foxglove/studio-base/types/Bounds";
import { enumValuesByDatatypeAndField } from "@foxglove/studio-base/util/enums";
import { getTimestampForMessageEvent } from "@foxglove/studio-base/util/time";

import {
  HoverElement,
  InteractionEvent,
  Scale,
  UpdateAction,
} from "./StateTransitionsChartRenderer";
import {
  IStateTransitionsDatasetBuilder,
  StateTransitionsDatasetBuilder,
} from "./StateTransitionsDatasetBuilder";
import {
  PackedStateTransitionDataset,
  StateDatum,
  StateTransitionsDatasetAction,
  packStateDatums,
} from "./StateTransitionsDatasetBuilderImpl";
import { StateTransitionsRenderer } from "./StateTransitionsRenderer";
import { Viewport } from "./downsampleStates";
import { PathState } from "./settings";
import { StateTransitionConfig, StateTransitionPath, Datum } from "./types";

type EventTypes = {
  /** X scale changed. */
  xScaleChanged(scale: Scale | undefined): void;

  /** User interacted with the chart (zoom/pan). */
  timeseriesBounds(bounds: Immutable<Bounds1D>): void;

  /** Rendering updated the viewport. `canReset` is true if the viewport can be reset. */
  viewportChange(canReset: boolean): void;

  /** Path state changed (for settings panel). */
  pathStateChanged(pathState: PathState[]): void;
};

type SeriesItem = {
  configIndex: number;
  path: StateTransitionPath;
  parsed: MessagePath;
};

function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

/**
 * StateTransitionsCoordinator interfaces commands and updates between the datasets and the chart renderer.
 */
export class StateTransitionsCoordinator extends EventEmitter<EventTypes> {
  #renderer: StateTransitionsRenderer;
  #datasetBuilder: IStateTransitionsDatasetBuilder;

  #configBounds: { x: Partial<Bounds1D>; y: Partial<Bounds1D> } = {
    x: {},
    y: {},
  };

  #globalBounds?: Immutable<Partial<Bounds1D>>;
  #datasetRange?: Bounds1D;
  #interactionBounds?: Bounds;
  #followRange?: number;
  #currentSeconds?: number;

  #updateAction: UpdateAction = { type: "update" };

  #latestXScale?: Scale;
  #destroyed = false;

  #queueDispatchRender = debouncePromise(async () => {
    try {
      await this.#dispatchRender();
    } catch (error) {
      this.#reportAsyncError(error);
    }
  });
  #queueDispatchDatasets = debouncePromise(async () => {
    try {
      await this.#dispatchDatasets();
    } catch (error) {
      this.#reportAsyncError(error);
    }
  });

  // Throttle buildAndUpdateDatasets to avoid excessive computation on frequent playerState updates
  // Using 100ms throttle with trailing edge to ensure final state is always rendered
  #throttledBuildAndUpdateDatasets = _.throttle(
    () => {
      void this.#buildAndUpdateDatasetsImpl().catch((error: unknown) => {
        this.#reportAsyncError(error);
      });
    },
    100,
    { leading: true, trailing: true },
  );

  #pendingDatasets?: PackedStateTransitionDataset[];
  #datasetRequestGeneration = 0;

  // Viewport for downsampling
  #viewport: Viewport = {
    width: 0,
    height: 0,
    bounds: { x: { min: 0, max: 1 }, y: { min: 0, max: 1 } },
  };

  // Config and series management
  #config?: Immutable<StateTransitionConfig>;
  #series: SeriesItem[] = [];
  #showPoints = false;

  // Data tracking
  #lastSeekTime = NaN;

  // Replay history supplied by subscribeMessageRange must not be duplicated by block/current
  // ingestion. The generation rejects batches that finish after a source or subscription change.
  #rangeTopics = new Set<string>();
  #historySourceId?: string;
  #rangeSessionId?: number;
  #rangeHistoryGeneration = 0;
  #isLiveSource = false;

  // Block cursors for tracking processed blocks per series
  #blockCursors = new Map<string, number>();
  #latestBlocks?: Immutable<(MessageBlock | undefined)[]>;

  // Block reference tracking for detecting data source changes (like BlockTopicCursor)
  #firstBlockRefs = new Map<string, Immutable<MessageEvent[]> | undefined>();
  #lastBlockRefs = new Map<string, Immutable<MessageEvent[]> | undefined>();

  // Track which series have detected array input (invalid for StateTransitions)
  #seriesIsArray = new Map<string, boolean>();

  // Cached decoding helpers for enum constant names
  #topicsByName?: Record<string, Topic> = {};
  #structures?: Record<string, MessagePathStructureItemMessage>;
  #enumValues?: ReturnType<typeof enumValuesByDatatypeAndField>;
  #handleDatasetError?: (error: unknown) => void;
  #asyncErrorReported = false;

  public constructor(
    renderer: StateTransitionsRenderer,
    datasetBuilder: IStateTransitionsDatasetBuilder = new StateTransitionsDatasetBuilder(),
    options: { handleDatasetError?: (error: unknown) => void } = {},
  ) {
    super();
    this.#renderer = renderer;
    this.#datasetBuilder = datasetBuilder;
    this.#handleDatasetError = options.handleDatasetError;
  }

  /** Stop the coordinator from sending any future updates to the renderer. */
  public destroy(): void {
    this.#destroyed = true;
    this.#datasetRequestGeneration++;
    this.#rangeHistoryGeneration++;
    this.#throttledBuildAndUpdateDatasets.cancel();
    this.#datasetBuilder.destroy();
  }

  public isDestroyed(): boolean {
    return this.#destroyed;
  }

  /**
   * Handle config changes.
   */
  public handleConfig(
    config: Immutable<StateTransitionConfig>,
    globalVariables: GlobalVariables,
  ): void {
    if (this.isDestroyed()) {
      return;
    }

    const prevConfig = this.#config;
    this.#config = config;

    const showPointsChanged = this.#showPoints !== (config.showPoints === true);
    this.#showPoints = config.showPoints === true;
    this.#followRange =
      config.xAxisRange != undefined && Number.isFinite(config.xAxisRange) && config.xAxisRange > 0
        ? config.xAxisRange
        : undefined;

    // Parse and store series
    const newSeries: SeriesItem[] = [];
    for (let i = 0; i < config.paths.length; i++) {
      const path = config.paths[i]!;
      if (path.enabled === false) {
        continue;
      }
      const parsed = parseMessagePath(path.value);
      if (!parsed) {
        continue;
      }

      const filledParsed = fillInGlobalVariablesInPath(parsed, globalVariables);
      newSeries.push({
        configIndex: i,
        path,
        parsed: filledParsed,
      });
    }

    // Check if series changed (need to reset all data)
    const seriesChanged =
      this.#series.length !== newSeries.length ||
      this.#series.some((s, i) => {
        const nextSeries = newSeries[i];
        return (
          s.path.value !== nextSeries?.path.value ||
          s.path.timestampMethod !== nextSeries.path.timestampMethod ||
          !_.isEqual(s.parsed, nextSeries.parsed)
        );
      });

    if (seriesChanged) {
      this.#invalidateViewportDatasets();
      this.#blockCursors.clear();
      this.#seriesIsArray.clear();
      this.#firstBlockRefs.clear();
      this.#lastBlockRefs.clear();
      this.#latestBlocks = undefined; // Force reprocessing of blocks
    }

    this.#series = newSeries;
    const datasetActions: StateTransitionsDatasetAction[] = [];
    if (seriesChanged) {
      datasetActions.push({ type: "reset" });
    }
    datasetActions.push({
      type: "set-series",
      series: newSeries.map((series) => ({
        key: this.#cursorKey(series),
        configIndex: series.configIndex,
        enabled: series.path.enabled !== false,
        label: series.path.label ?? series.path.value,
        timestampMethod: series.path.timestampMethod,
        y: this.#getYForSeries(series.configIndex),
      })),
    });
    this.#datasetBuilder.applyActions(datasetActions);

    // Update config bounds
    const xMin = config.xAxisMinValue ?? 0;
    const xMax = config.xAxisMaxValue;

    this.#configBounds = {
      x: { min: xMin, max: xMax },
      y: {},
    };

    // Datasets are viewport-sliced, so any config change that moves the slice window (axis
    // bounds, follow range) or changes the render representation (Show Points) must rebuild
    // them from canonical data. A render dispatch alone would keep the old narrow slice on
    // screen until the next player emit — invisible on live sources, stale on paused ones.
    const axisBoundsChanged =
      prevConfig != undefined &&
      (prevConfig.xAxisMinValue !== config.xAxisMinValue ||
        prevConfig.xAxisMaxValue !== config.xAxisMaxValue ||
        prevConfig.xAxisRange !== config.xAxisRange);
    const seriesPresentationChanged =
      prevConfig != undefined &&
      config.paths.some(
        (path, index) =>
          path.label !== prevConfig.paths[index]?.label ||
          path.enabled !== prevConfig.paths[index]?.enabled,
      );
    if (!seriesChanged && (showPointsChanged || axisBoundsChanged || seriesPresentationChanged)) {
      this.#buildAndUpdateDatasets();
    }

    // Emit pathStateChanged for all config.paths (including unparseable ones)
    // This ensures settings panel reflects all paths immediately
    const pathState: PathState[] = config.paths.map((path, index) => {
      const series = newSeries.find((s) => s.configIndex === index);
      const cursorKey = series ? `${series.configIndex}:${series.parsed.topicName}` : "";
      return {
        path,
        isArray: this.#seriesIsArray.get(cursorKey) ?? false,
      };
    });

    this.emit("pathStateChanged", pathState);

    this.#queueDispatchRender();
  }

  /**
   * Handle player state updates.
   */
  public handlePlayerState(state: Immutable<PlayerState>): void {
    if (this.isDestroyed()) {
      return;
    }

    const activeData = state.activeData;
    if (!activeData) {
      return;
    }

    const { messages, lastSeekTime, currentTime, startTime, endTime, topics, datatypes } =
      activeData;
    this.#topicsByName = Object.fromEntries(topics.map((topic) => [topic.name, topic]));
    this.#structures = messagePathStructures(datatypes);
    this.#enumValues = enumValuesByDatatypeAndField(datatypes);

    // console.log("this.#enumValues", this.#enumValues);

    // Calculate current time since start for follow mode
    this.#currentSeconds = toSec(subtractTime(currentTime, startTime));

    // Calculate data range
    const endTimeSinceStart = toSec(subtractTime(endTime, startTime));
    this.#datasetRange = { min: 0, max: endTimeSinceStart };

    // Reset only streaming data on seek (keep preloaded block data intact)
    if (lastSeekTime !== this.#lastSeekTime) {
      this.#lastSeekTime = lastSeekTime;
      this.#invalidateViewportDatasets();
      // Only clear streaming data; preloaded/range history remains available in the worker.
      this.#datasetBuilder.applyActions([{ type: "reset-current" }]);
    }

    // Process blocks (preloaded data)
    const blocks = state.progress.messageCache?.blocks;
    if (!this.#isLiveSource && blocks && blocks !== this.#latestBlocks) {
      this.#latestBlocks = blocks;
      this.#processBlocks(startTime, blocks);
    }

    // Process current messages (streaming data)
    this.#processMessages(startTime, messages);

    // Build and update datasets
    this.#buildAndUpdateDatasets();

    this.#queueDispatchRender();
  }

  /**
   * Select the canonical history source for each topic. Replay topics with a range subscription
   * use range batches; unsupported replay topics retain the block fallback. Live sources use only
   * the bounded current stream.
   */
  public configureHistorySources(args: {
    sourceId: string;
    rangeTopics: ReadonlySet<string>;
    isLive: boolean;
    rangeSessionId?: number;
  }): number {
    const nextRangeTopics = new Set(args.rangeTopics);
    const unchanged =
      this.#historySourceId === args.sourceId &&
      this.#isLiveSource === args.isLive &&
      this.#rangeSessionId === args.rangeSessionId &&
      setsEqual(this.#rangeTopics, nextRangeTopics);
    if (unchanged) {
      return this.#rangeHistoryGeneration;
    }

    this.#historySourceId = args.sourceId;
    this.#rangeSessionId = args.rangeSessionId;
    this.#isLiveSource = args.isLive;
    this.#rangeTopics = nextRangeTopics;
    this.#rangeHistoryGeneration++;
    this.#invalidateViewportDatasets();

    this.#blockCursors.clear();
    this.#firstBlockRefs.clear();
    this.#lastBlockRefs.clear();
    this.#latestBlocks = undefined;
    this.#datasetBuilder.applyActions(
      this.#series.map((series) => ({
        type: "reset-series" as const,
        key: this.#cursorKey(series),
      })),
    );
    this.#buildAndUpdateDatasets();
    return this.#rangeHistoryGeneration;
  }

  /** Invalidate a subscription epoch before its asynchronous iterators finish unwinding. */
  public invalidateRangeHistory(generation: number): void {
    if (generation !== this.#rangeHistoryGeneration) {
      return;
    }
    this.#rangeHistoryGeneration++;
    this.#invalidateViewportDatasets();
  }

  /** Reset one topic before a replacement range iterator replays from its beginning. */
  public async resetRangeTopic(args: { topic: string; generation: number }): Promise<void> {
    if (
      this.#destroyed ||
      args.generation !== this.#rangeHistoryGeneration ||
      !this.#rangeTopics.has(args.topic)
    ) {
      return;
    }

    const actions = this.#series
      .filter((series) => series.parsed.topicName === args.topic)
      .map((series) => ({
        type: "reset-series" as const,
        key: this.#cursorKey(series),
      }));
    this.#invalidateViewportDatasets();
    if (actions.length > 0) {
      await this.#datasetBuilder.applyActionsAndFlush(actions);
    }
    if (this.isDestroyed() || args.generation !== this.#rangeHistoryGeneration) {
      return;
    }
    this.#buildAndUpdateDatasets();
    this.#queueDispatchRender();
  }

  /**
   * Release one failed range topic back to block/current ingestion. Clears any partially replayed
   * range data and re-arms the topic's block cursors so the full-preload fallback repopulates it.
   * Returns false when the release no longer applies to the current range generation.
   */
  public async releaseRangeTopic(args: { topic: string; generation: number }): Promise<boolean> {
    if (
      this.#destroyed ||
      args.generation !== this.#rangeHistoryGeneration ||
      !this.#rangeTopics.delete(args.topic)
    ) {
      return false;
    }

    const seriesForTopic = this.#series.filter((series) => series.parsed.topicName === args.topic);
    for (const series of seriesForTopic) {
      const cursorKey = this.#cursorKey(series);
      this.#blockCursors.delete(cursorKey);
      this.#firstBlockRefs.delete(cursorKey);
      this.#lastBlockRefs.delete(cursorKey);
    }
    // Force block reprocessing on the next player state so the released lane repopulates even if
    // the cached blocks reference has not changed.
    this.#latestBlocks = undefined;
    this.#invalidateViewportDatasets();
    const actions = seriesForTopic.map((series) => ({
      type: "reset-series" as const,
      key: this.#cursorKey(series),
    }));
    if (actions.length > 0) {
      await this.#datasetBuilder.applyActionsAndFlush(actions);
    }
    if (this.isDestroyed() || args.generation !== this.#rangeHistoryGeneration) {
      return false;
    }
    this.#buildAndUpdateDatasets();
    this.#queueDispatchRender();
    return true;
  }

  /** Decode one range batch and wait until the Dataset Worker owns it before requesting more. */
  public async handleRangeBatch(args: {
    topic: string;
    messages: readonly Immutable<MessageEvent>[];
    startTime: Time;
    generation: number;
  }): Promise<void> {
    if (
      this.#destroyed ||
      args.generation !== this.#rangeHistoryGeneration ||
      !this.#rangeTopics.has(args.topic)
    ) {
      return;
    }

    const actions: StateTransitionsDatasetAction[] = [];
    for (const series of this.#series) {
      if (series.parsed.topicName !== args.topic) {
        continue;
      }
      const datums: StateDatum[] = [];
      for (const message of args.messages) {
        const datum = this.#messageEventToDatum(message, series, args.startTime);
        if (datum != undefined) {
          datums.push(datum);
        }
      }
      if (datums.length > 0) {
        actions.push({
          type: "append-full",
          key: this.#cursorKey(series),
          batch: packStateDatums(datums),
        });
      }
    }

    if (actions.length > 0) {
      await this.#datasetBuilder.applyActionsAndFlush(actions);
    }
    if (this.isDestroyed() || args.generation !== this.#rangeHistoryGeneration) {
      return;
    }
    this.#buildAndUpdateDatasets();
    this.#queueDispatchRender();
  }

  /**
   * Process preloaded blocks incrementally.
   * Blocks are processed from where the cursor left off to avoid reprocessing.
   */
  #processBlocks(startTime: Time, blocks: Immutable<(MessageBlock | undefined)[]>): void {
    const actions: StateTransitionsDatasetAction[] = [];
    for (const series of this.#series) {
      const topicName = series.parsed.topicName;
      if (this.#rangeTopics.has(topicName)) {
        continue;
      }
      const cursorKey = this.#cursorKey(series);

      // Check if blocks have been reset (new data source, different blocks array)
      // Uses reference comparison similar to BlockTopicCursor.nextWillReset()
      const needsReset = this.#checkBlocksNeedReset(cursorKey, topicName, blocks);

      if (needsReset) {
        this.#invalidateViewportDatasets();
        this.#blockCursors.set(cursorKey, 0);
        actions.push({ type: "reset-series", key: cursorKey });
        // Update first block reference on reset
        this.#firstBlockRefs.set(cursorKey, blocks[0]?.messagesByTopic[topicName]);
      }

      let cursor = this.#blockCursors.get(cursorKey) ?? 0;

      for (let blockIdx = cursor; blockIdx < blocks.length; blockIdx++) {
        const messagesForTopic = blocks[blockIdx]?.messagesByTopic[topicName];
        if (messagesForTopic == undefined) {
          // Gap: stop here instead of skipping ahead. Advancing the cursor past an unloaded block
          // would permanently drop its history once it loads *behind* the cursor, leaving a silent
          // hole in the plot. Matches Plot's BlockTopicCursor semantics.
          break;
        }

        const datums: StateDatum[] = [];
        for (const msgEvent of messagesForTopic) {
          const datum = this.#messageEventToDatum(msgEvent, series, startTime);
          if (datum) {
            datums.push(datum);
          }
        }
        if (datums.length > 0) {
          actions.push({
            type: "append-full",
            key: cursorKey,
            batch: packStateDatums(datums),
          });
        }

        // Update last block reference after processing each block
        this.#lastBlockRefs.set(cursorKey, messagesForTopic);
        cursor = blockIdx + 1;
      }

      this.#blockCursors.set(cursorKey, cursor);
      // Record blocks[0] every pass, not only on reset. Leaving it unset made the *second* pass
      // always see "first block changed" and wipe + reprocess the whole series once.
      this.#firstBlockRefs.set(cursorKey, blocks[0]?.messagesByTopic[topicName]);
    }
    this.#datasetBuilder.applyActions(actions);
  }

  /**
   * Check if blocks need to be reset (e.g., new data source loaded).
   * Uses reference comparison similar to BlockTopicCursor.nextWillReset().
   */
  #checkBlocksNeedReset(
    cursorKey: string,
    topicName: string,
    blocks: Immutable<(MessageBlock | undefined)[]>,
  ): boolean {
    const firstBlockRef = blocks[0]?.messagesByTopic[topicName];
    const storedFirstBlockRef = this.#firstBlockRefs.get(cursorKey);

    const cursor = this.#blockCursors.get(cursorKey) ?? 0;
    const lastIdx = Math.max(0, cursor - 1);
    const lastBlockRef = blocks[lastIdx]?.messagesByTopic[topicName];
    const storedLastBlockRef = this.#lastBlockRefs.get(cursorKey);

    return firstBlockRef !== storedFirstBlockRef || lastBlockRef !== storedLastBlockRef;
  }

  /** Decode current-frame samples, then immediately move their compact columns to the worker. */
  #processMessages(startTime: Time, messages: Immutable<MessageEvent[]>): void {
    const actions: StateTransitionsDatasetAction[] = [];
    for (const series of this.#series) {
      const topicName = series.parsed.topicName;
      if (!this.#isLiveSource && this.#rangeTopics.has(topicName)) {
        continue;
      }
      const datums: StateDatum[] = [];

      for (const msgEvent of messages) {
        if (msgEvent.topic !== topicName) {
          continue;
        }

        const datum = this.#messageEventToDatum(msgEvent, series, startTime);
        if (!datum) {
          continue;
        }
        datums.push(datum);
      }
      if (datums.length > 0) {
        actions.push({
          type: "append-current",
          key: this.#cursorKey(series),
          batch: packStateDatums(datums),
        });
      }
    }
    this.#datasetBuilder.applyActions(actions);
  }

  /**
   * Convert a message event to a chart datum.
   * Also tracks if the series has array input (invalid for StateTransitions).
   */
  #messageEventToDatum(
    msgEvent: Immutable<MessageEvent>,
    series: SeriesItem,
    startTime: Time,
  ): StateDatum | undefined {
    const timestamp = getTimestampForMessageEvent(msgEvent, series.path.timestampMethod);
    if (!timestamp || !this.#topicsByName || !this.#structures || !this.#enumValues) {
      return undefined;
    }

    const items = getMessagePathDataItems(
      msgEvent,
      series.parsed,
      this.#topicsByName,
      this.#structures,
      this.#enumValues,
    );

    if (items == undefined || items.length === 0) {
      return undefined;
    }

    // Extract value and constantName following original StateTransitions logic:
    // - Only accept exactly one item per message
    // - Arrays are invalid input (will be marked as isArray)
    const { value, constantName, isArray } = this.#extractValueFromItems(items);

    // Track if this series has array input
    if (isArray) {
      const cursorKey = `${series.configIndex}:${series.parsed.topicName}`;
      this.#seriesIsArray.set(cursorKey, true);
    }

    if (value == undefined) {
      return undefined;
    }

    // Skip anything that cannot be cast to a number or is a string.
    // This matches the original messagesToDataset.ts logic.
    if (Number.isNaN(value) && typeof value !== "string") {
      return undefined;
    }

    // Skip anything that cannot be cast to a valid value
    if (
      typeof value !== "number" &&
      typeof value !== "bigint" &&
      typeof value !== "boolean" &&
      typeof value !== "string"
    ) {
      return undefined;
    }

    const x = toSec(subtractTime(timestamp, startTime));
    return { x, value, constantName };
  }

  /**
   * Extract value and constantName from decoded items.
   *
   * Follows the original StateTransitions logic:
   * - Only accepts exactly ONE item (like the original queriedData.length !== 1 check)
   * - If item is an object with value/constantName (enum lookup), extract those
   * - If item is a primitive, use directly
   * - Arrays are considered invalid input (isArray case in original code)
   */
  #extractValueFromItems(items: unknown[]): {
    value: unknown;
    constantName?: string;
    isArray: boolean;
  } {
    // Original logic: queriedData.length !== 1 means invalid input
    if (items.length !== 1) {
      return { value: undefined, constantName: undefined, isArray: items.length > 1 };
    }

    const item = items[0];

    // If item is an array, this is invalid input (original code would skip)
    if (Array.isArray(item)) {
      return { value: undefined, constantName: undefined, isArray: true };
    }

    // If item is an object with value property (from enum/constant lookup)
    if (typeof item === "object" && item != undefined && "value" in item) {
      const obj = item as { value?: unknown; constantName?: string };
      return { value: obj.value, constantName: obj.constantName, isArray: false };
    }

    // Item is a primitive value directly
    return { value: item, constantName: undefined, isArray: false };
  }

  /** Make every viewport request started before a semantic storage reset immediately stale. */
  #invalidateViewportDatasets(): void {
    this.#datasetRequestGeneration++;
    this.#pendingDatasets = undefined;
  }

  #reportAsyncError(error: unknown): void {
    if (this.#destroyed || this.#asyncErrorReported) {
      return;
    }
    this.#asyncErrorReported = true;
    this.#handleDatasetError?.(error);
  }

  /**
   * Build datasets from accumulated data and update the renderer (throttled).
   * Merges fullData (blocks) and currentData (streaming) for each series.
   */
  #buildAndUpdateDatasets(): void {
    this.#throttledBuildAndUpdateDatasets();
  }

  /**
   * Implementation of buildAndUpdateDatasets.
   * Called by the throttled wrapper.
   */
  async #buildAndUpdateDatasetsImpl(): Promise<void> {
    if (this.isDestroyed() || !this.#config) {
      return;
    }

    let minY: number | undefined;

    // Resolve x bounds first so we can window-process only the visible range.
    if (this.#followRange != undefined && this.#currentSeconds != undefined) {
      this.#configBounds.x = {
        min: this.#currentSeconds - this.#followRange,
        max: this.#currentSeconds,
      };
    } else {
      this.#configBounds.x = {
        min: this.#config.xAxisMinValue ?? 0,
        max: this.#config.xAxisMaxValue ?? this.#datasetRange?.max,
      };
    }

    // Prefer interaction / global bounds when set (zoom/pan/sync). The Dataset Worker applies
    // the half-window pan buffer before binary slicing.
    const requestedViewMin =
      this.#interactionBounds?.x.min ?? this.#globalBounds?.min ?? this.#configBounds.x.min ?? 0;
    const requestedViewMax =
      this.#interactionBounds?.x.max ??
      this.#globalBounds?.max ??
      this.#configBounds.x.max ??
      requestedViewMin + 1;
    const defaultViewMax =
      this.#datasetRange?.max != undefined &&
      Number.isFinite(this.#datasetRange.max) &&
      this.#datasetRange.max > 0
        ? this.#datasetRange.max
        : 1;
    const boundsAreValid =
      Number.isFinite(requestedViewMin) &&
      Number.isFinite(requestedViewMax) &&
      requestedViewMax > requestedViewMin;
    const viewMin = boundsAreValid ? requestedViewMin : 0;
    const viewMax = boundsAreValid ? requestedViewMax : defaultViewMax;

    for (const series of this.#series) {
      const y = this.#getYForSeries(series.configIndex);
      minY = Math.min(minY ?? y, y - 5);
    }

    // Update y bounds
    this.#configBounds.y = { min: minY, max: -3 };
    this.#updateAction.yBounds = this.#configBounds.y;

    // Build pathState from all config.paths (including unparseable ones)
    // This ensures settings panel reflects all paths with updated isArray status
    const pathState: PathState[] = this.#config.paths.map((path, index) => {
      const series = this.#series.find((s) => s.configIndex === index);
      const cursorKey = series ? `${series.configIndex}:${series.parsed.topicName}` : "";
      return {
        path,
        isArray: this.#seriesIsArray.get(cursorKey) ?? false,
      };
    });

    this.emit("pathStateChanged", pathState);
    const viewport: Viewport | undefined =
      minY != undefined && this.#viewport.width > 0 && viewMax > viewMin
        ? {
            width: this.#viewport.width,
            height: this.#viewport.height,
            bounds: {
              x: { min: viewMin, max: viewMax },
              y: { min: minY, max: -3 },
            },
          }
        : undefined;
    const generation = ++this.#datasetRequestGeneration;
    const datasets = await this.#datasetBuilder.getViewportDatasets({
      xBounds: { min: viewMin, max: viewMax },
      viewport,
      showPoints: this.#showPoints,
    });
    if (this.isDestroyed() || generation !== this.#datasetRequestGeneration) {
      return;
    }
    this.updateDatasets(datasets);
  }

  /**
   * Get Y position for a series index.
   */
  #getYForSeries(index: number): number {
    return (index + 1) * 6 * -3;
  }

  #cursorKey(series: SeriesItem): string {
    return `${series.configIndex}:${series.parsed.topicName}`;
  }

  /**
   * Update the datasets to render.
   */
  public updateDatasets(datasets: PackedStateTransitionDataset[]): void {
    if (this.isDestroyed()) {
      return;
    }
    this.#pendingDatasets = datasets;
    this.#queueDispatchDatasets();
  }

  /**
   * Set the data range (used for x-axis bounds calculation).
   */
  public setDataRange(range: Bounds1D | undefined): void {
    if (this.isDestroyed()) {
      return;
    }
    this.#datasetRange = range;
    this.#queueDispatchRender();
  }

  /**
   * Set the global bounds (from synced panels).
   * Rebuild datasets so viewport-windowed series match the new bounds.
   */
  public setGlobalBounds(bounds: Immutable<Bounds1D> | undefined): void {
    if (this.isDestroyed()) {
      return;
    }
    this.#globalBounds = bounds;
    this.#interactionBounds = undefined;
    // Slice bounds changed — rebuild from fullData/currentData, then render.
    this.#buildAndUpdateDatasets();
    this.#queueDispatchRender();
  }

  /**
   * Reset the view to the default bounds.
   * Rebuild datasets so viewport-windowed series match the reset window.
   */
  public resetBounds(): void {
    if (this.isDestroyed()) {
      return;
    }
    this.#interactionBounds = undefined;
    this.#globalBounds = undefined;
    this.#updateAction.yBounds = this.#configBounds.y;
    this.#buildAndUpdateDatasets();
    this.#queueDispatchRender();
  }

  /**
   * Set the chart size.
   */
  public setSize(size: { width: number; height: number }): void {
    if (this.isDestroyed()) {
      return;
    }
    this.#viewport.width = size.width;
    this.#viewport.height = size.height;
    this.#updateAction.size = size;
    this.#buildAndUpdateDatasets();
    this.#queueDispatchRender();
  }

  /**
   * Add an interaction event (wheel, pan).
   */
  public addInteractionEvent(ev: InteractionEvent): void {
    if (this.isDestroyed()) {
      return;
    }
    if (!this.#updateAction.interactionEvents) {
      this.#updateAction.interactionEvents = [];
    }
    this.#updateAction.interactionEvents.push(ev);
    this.#queueDispatchRender();
  }

  /**
   * Get the plot x value at the canvas pixel x location.
   */
  public getXValueAtPixel(pixelX: number): number {
    if (!this.#latestXScale) {
      return -1;
    }

    const pixelRange = this.#latestXScale.right - this.#latestXScale.left;
    if (pixelRange <= 0) {
      return -1;
    }

    // Linear interpolation to place the pixelX value within min/max
    return (
      this.#latestXScale.min +
      ((pixelX - this.#latestXScale.left) / pixelRange) *
        (this.#latestXScale.max - this.#latestXScale.min)
    );
  }

  /**
   * Get hover elements at pixel position.
   */
  public async getElementsAtPixel(pixel: { x: number; y: number }): Promise<HoverElement[]> {
    if (this.isDestroyed()) {
      return [];
    }
    return await this.#renderer.getElementsAtPixel(pixel);
  }

  /**
   * Get datalabel at pixel position (for click handling).
   */
  public async getDatalabelAtEvent(pixel: { x: number; y: number }): Promise<Datum | undefined> {
    if (this.isDestroyed()) {
      return undefined;
    }
    return await this.#renderer.getDatalabelAtEvent(pixel);
  }

  /**
   * Check if the plot can be reset.
   */
  #canReset(): boolean {
    if (this.#interactionBounds) {
      return true;
    }

    if (this.#globalBounds) {
      const resetBounds = this.#getXResetBounds();
      return (
        this.#globalBounds.min !== resetBounds.min || this.#globalBounds.max !== resetBounds.max
      );
    }

    return false;
  }

  /**
   * Get the xBounds if we cleared the interaction and global bounds (reset).
   */
  #getXResetBounds(): Partial<Bounds1D> {
    const xMin = this.#configBounds.x.min ?? this.#datasetRange?.min;
    const xMax = this.#configBounds.x.max ?? this.#datasetRange?.max;
    return { min: xMin, max: xMax };
  }

  /**
   * Get the current x bounds.
   */
  #getXBounds(): Partial<Bounds1D> {
    const resetBounds = this.#getXResetBounds();
    return {
      min: this.#interactionBounds?.x.min ?? this.#globalBounds?.min ?? resetBounds.min,
      max: this.#interactionBounds?.x.max ?? this.#globalBounds?.max ?? resetBounds.max,
    };
  }

  async #dispatchRender(): Promise<void> {
    if (this.isDestroyed()) {
      return;
    }

    this.#updateAction.xBounds = this.#getXBounds();

    const haveInteractionEvents = (this.#updateAction.interactionEvents?.length ?? 0) > 0;

    const action = this.#updateAction;
    this.#updateAction = {
      type: "update",
    };

    const bounds = await this.#renderer.update(action);
    if (this.isDestroyed()) {
      return;
    }

    if (haveInteractionEvents) {
      this.#interactionBounds = bounds;
    }

    if (haveInteractionEvents && bounds) {
      this.emit("timeseriesBounds", bounds.x);
    }

    this.emit("viewportChange", this.#canReset());

    if (haveInteractionEvents) {
      // Pan/zoom changed the visible window — request a new worker-side slice.
      this.#buildAndUpdateDatasets();
      return;
    }

    // After non-interaction render update, dispatch any pending datasets.
    this.#queueDispatchDatasets();
  }

  async #dispatchDatasets(): Promise<void> {
    if (this.isDestroyed() || !this.#pendingDatasets) {
      return;
    }

    const datasets = this.#pendingDatasets;
    this.#pendingDatasets = undefined;

    // The Dataset Worker already applied the viewport and point budget. The renderer forwards
    // these compact columns to the Chart Worker without a second downsampling pass.
    this.#latestXScale = await this.#renderer.updateDatasets(datasets);
    if (this.isDestroyed()) {
      return;
    }

    this.emit("xScaleChanged", this.#latestXScale);
  }
}
