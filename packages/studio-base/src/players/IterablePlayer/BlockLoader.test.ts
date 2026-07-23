// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Immutable, MessageEvent } from "@foxglove/studio";
import PlayerProblemManager from "@foxglove/studio-base/players/PlayerProblemManager";
import { MessageBlock } from "@foxglove/studio-base/players/types";
import { mockTopicSelection } from "@foxglove/studio-base/test/mocks/mockTopicSelection";

import {
  BLOCK_LOAD_MAX_SPAN_DURATION_NS,
  BlockLoader,
  MEMORY_INFO_PRELOADED_MSGS,
} from "./BlockLoader";
import {
  GetBackfillMessagesArgs,
  IDeserializedIterableSource,
  Initalization,
  IteratorResult,
  MessageIteratorArgs,
} from "./IIterableSource";

class TestSource implements IDeserializedIterableSource {
  public readonly sourceType = "deserialized";
  public async initialize(): Promise<Initalization> {
    return {
      start: { sec: 0, nsec: 0 },
      end: { sec: 10, nsec: 0 },
      topics: [],
      topicStats: new Map(),
      problems: [],
      profile: undefined,
      datatypes: new Map(),
      publishersByTopic: new Map(),
    };
  }

  public async *messageIterator(
    _args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {}

  public async getBackfillMessages(_args: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    return [];
  }
}

const consoleErrorMock = console.error as ReturnType<typeof jest.fn>;

describe("BlockLoader", () => {
  it("should make an empty block loader", async () => {
    const loader = new BlockLoader({
      maxBlocks: 4,
      cacheSizeBytes: 1,
      minBlockDurationNs: 1,
      source: new TestSource(),
      start: { sec: 0, nsec: 0 },
      end: { sec: 2, nsec: 0 },
      problemManager: new PlayerProblemManager(),
    });

    await loader.startLoading({
      progress: async (progress) => {
        expect(progress).toEqual({
          fullyLoadedFractionRanges: [],
          messageCache: {
            blocks: [undefined, undefined, undefined, undefined],
            startTime: { sec: 0, nsec: 0 },
          },
          memoryInfo: {
            [MEMORY_INFO_PRELOADED_MSGS]: 0,
          },
        });
        await loader.stopLoading();
      },
    });

    expect.assertions(1);
  });

  it("should load the source into blocks", async () => {
    const source = new TestSource();

    const loader = new BlockLoader({
      maxBlocks: 5,
      cacheSizeBytes: 5,
      minBlockDurationNs: 1,
      source,
      start: { sec: 0, nsec: 0 },
      end: { sec: 9, nsec: 0 },
      problemManager: new PlayerProblemManager(),
    });

    const msgEvents: MessageEvent[] = [];
    for (let i = 0; i < 10; i += 3) {
      msgEvents.push({
        topic: "a",
        receiveTime: { sec: i, nsec: 0 },
        message: undefined,
        sizeInBytes: 1,
        schemaName: "foo",
      });
    }

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (const msgEvent of msgEvents) {
        yield {
          type: "message-event",
          msgEvent,
        };
      }
    };

    loader.setTopics(mockTopicSelection("a"));
    let count = 0;
    await loader.startLoading({
      progress: async (progress) => {
        if (++count < 5) {
          return;
        }

        expect(progress).toEqual({
          fullyLoadedFractionRanges: [
            {
              start: 0,
              end: 1,
            },
          ],
          messageCache: {
            blocks: [
              {
                messagesByTopic: {
                  a: [msgEvents[0]],
                },
                needTopics: new Map(),
                sizeInBytes: 1,
              },
              {
                messagesByTopic: {
                  a: [msgEvents[1]],
                },
                needTopics: new Map(),
                sizeInBytes: 1,
              },
              {
                messagesByTopic: {
                  a: [],
                },
                needTopics: new Map(),
                sizeInBytes: 0,
              },
              {
                messagesByTopic: {
                  a: [msgEvents[2]],
                },
                needTopics: new Map(),
                sizeInBytes: 1,
              },
              {
                messagesByTopic: {
                  a: [msgEvents[3]],
                },
                needTopics: new Map(),
                sizeInBytes: 1,
              },
            ],
            startTime: { sec: 0, nsec: 0 },
          },
          memoryInfo: {
            [MEMORY_INFO_PRELOADED_MSGS]: 4,
          },
        });

        await loader.stopLoading();
      },
    });

    expect.assertions(1);
  });

  it("should not load messages past max cache size", async () => {
    const source = new TestSource();

    const loader = new BlockLoader({
      maxBlocks: 2,
      cacheSizeBytes: 3,
      minBlockDurationNs: 1,
      source,
      start: { sec: 0, nsec: 0 },
      end: { sec: 9, nsec: 0 },
      problemManager: new PlayerProblemManager(),
    });

    const msgEvents: MessageEvent[] = [];
    for (let i = 0; i < 10; i += 3) {
      msgEvents.push({
        topic: "a",
        receiveTime: { sec: i, nsec: 0 },
        message: undefined,
        sizeInBytes: 1,
        schemaName: "foo",
      });
    }

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (const msgEvent of msgEvents) {
        yield {
          type: "message-event",
          msgEvent,
        };
      }
    };

    loader.setTopics(mockTopicSelection("a"));
    let progressCount = 0;
    await loader.startLoading({
      progress: async (progress) => {
        expect(progress).toMatchObject({
          fullyLoadedFractionRanges: [
            {
              start: 0,
              end: 0.5,
            },
          ],
          messageCache: {
            blocks: [
              {
                messagesByTopic: {
                  a: [msgEvents[0], msgEvents[1]],
                },
                needTopics: new Map(),
                sizeInBytes: 2,
              },
            ],
            startTime: { sec: 0, nsec: 0 },
          },
        });
        // need to wait for second progress call to receive cache full error
        if (++progressCount > 1) {
          await loader.stopLoading();
        }
      },
    });
    expect(consoleErrorMock.mock.calls[0] ?? []).toContain("cache-full");
    consoleErrorMock.mockClear();
    expect.assertions(3);
  });

  it("should remove unused topics on blocks if cache is full", async () => {
    const source = new TestSource();

    const loader = new BlockLoader({
      maxBlocks: 2,
      cacheSizeBytes: 6,
      minBlockDurationNs: 1,
      source,
      start: { sec: 0, nsec: 0 },
      end: { sec: 5, nsec: 0 },
      problemManager: new PlayerProblemManager(),
    });

    const msgEvents: MessageEvent[] = [];
    for (let i = 0; i < 4; ++i) {
      msgEvents.push({
        topic: "a",
        receiveTime: { sec: i, nsec: 0 },
        message: undefined,
        sizeInBytes: 1,
        schemaName: "foo",
      });
      msgEvents.push({
        topic: "b",
        receiveTime: { sec: i, nsec: 0 },
        message: undefined,
        sizeInBytes: 1,
        schemaName: "foo",
      });
    }

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (const msgEvent of msgEvents) {
        // need to filter iterator by requested topics since there's messages from more than 1 topic in here
        if (_args.topics.has(msgEvent.topic)) {
          yield {
            type: "message-event",
            msgEvent,
          };
        }
      }
    };

    loader.setTopics(mockTopicSelection("a"));
    let count = 0;
    await loader.startLoading({
      progress: async (progress) => {
        count++;
        if (count === 2) {
          expect(progress).toEqual({
            fullyLoadedFractionRanges: [
              {
                start: 0,
                end: 1,
              },
            ],
            messageCache: {
              blocks: [
                {
                  messagesByTopic: {
                    a: [msgEvents[0], msgEvents[2], msgEvents[4]],
                  },
                  sizeInBytes: 3,
                  needTopics: new Map(),
                },
                {
                  messagesByTopic: {
                    a: [msgEvents[6]],
                  },
                  sizeInBytes: 1,
                  needTopics: new Map(),
                },
              ],
              startTime: { sec: 0, nsec: 0 },
            },
            memoryInfo: {
              [MEMORY_INFO_PRELOADED_MSGS]: 4,
            },
          });
          await loader.stopLoading();
        }
      },
    });

    loader.setTopics(mockTopicSelection("b"));

    count = 0;
    // at the end of loading "b" topic it should have removed the "a" topic as its no longer used.
    await loader.startLoading({
      progress: async (progress) => {
        count += 1;
        if (count === 2) {
          expect(progress).toEqual({
            fullyLoadedFractionRanges: [
              {
                start: 0,
                end: 1,
              },
            ],
            messageCache: {
              blocks: [
                {
                  messagesByTopic: {
                    b: [msgEvents[1], msgEvents[3], msgEvents[5]],
                  },
                  sizeInBytes: 3,
                  needTopics: new Map(),
                },
                {
                  messagesByTopic: {
                    b: [msgEvents[7]],
                  },
                  sizeInBytes: 1,
                  needTopics: new Map(),
                },
              ],
              startTime: { sec: 0, nsec: 0 },
            },
            memoryInfo: {
              [MEMORY_INFO_PRELOADED_MSGS]: 4,
            },
          });
          await loader.stopLoading();
        }
      },
    });
    expect.assertions(2);
  });

  it("should avoid emitting progress when nothing changed", async () => {
    const source = new TestSource();

    const loader = new BlockLoader({
      maxBlocks: 2,
      cacheSizeBytes: 1,
      minBlockDurationNs: 1,
      source,
      start: { sec: 0, nsec: 0 },
      end: { sec: 5, nsec: 0 },
      problemManager: new PlayerProblemManager(),
    });

    const msgEvents: MessageEvent[] = [];
    for (let i = 0; i < 4; ++i) {
      msgEvents.push({
        topic: "a",
        receiveTime: { sec: i, nsec: 0 },
        message: undefined,
        sizeInBytes: 0,
        schemaName: "foo",
      });
    }

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (const msgEvent of msgEvents) {
        yield {
          type: "message-event",
          msgEvent,
        };
      }
    };

    loader.setTopics(mockTopicSelection("a"));
    let count = 0;
    await loader.startLoading({
      progress: async (progress) => {
        count += 1;
        if (count > 2) {
          throw new Error("Too many progress callbacks");
        }

        if (count === 2) {
          expect(progress).toEqual({
            fullyLoadedFractionRanges: [
              {
                start: 0,
                end: 1,
              },
            ],
            messageCache: {
              blocks: [
                {
                  messagesByTopic: {
                    a: [msgEvents[0], msgEvents[1], msgEvents[2]],
                  },
                  sizeInBytes: 0,
                  needTopics: new Map(),
                },
                {
                  messagesByTopic: {
                    a: [msgEvents[3]],
                  },
                  sizeInBytes: 0,
                  needTopics: new Map(),
                },
              ],
              startTime: { sec: 0, nsec: 0 },
            },
            memoryInfo: {
              [MEMORY_INFO_PRELOADED_MSGS]: 0,
            },
          });

          // eslint-disable-next-line require-yield
          source.messageIterator = async function* messageIterator(
            _args: MessageIteratorArgs,
          ): AsyncIterableIterator<Readonly<IteratorResult>> {
            throw new Error("Should not call iterator");
          };

          setTimeout(async () => {
            await loader.stopLoading();
          }, 500);
        }
      },
    });
  });

  it("should drop preloaded topics when subscription options change", async () => {
    const source = new TestSource();
    const maxBlockCount = 2;
    const loader = new BlockLoader({
      maxBlocks: maxBlockCount,
      cacheSizeBytes: 60,
      minBlockDurationNs: 1,
      source,
      start: { sec: 0, nsec: 0 },
      end: { sec: 9, nsec: 0 },
      problemManager: new PlayerProblemManager(),
    });

    const msgEvents: MessageEvent[] = [];
    for (let i = 0; i < 10; i += 1) {
      msgEvents.push({
        topic: "a",
        receiveTime: { sec: i, nsec: 0 },
        message: undefined,
        sizeInBytes: 10,
        schemaName: "foo",
      });
    }
    const slicedMsgEvents = msgEvents.map((msgEvent) => ({ ...msgEvent, sizeInBytes: 1 }));

    source.messageIterator = async function* messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      const fields = args.topics.get("a")?.fields;
      const events = fields ? slicedMsgEvents : msgEvents;
      for (const msgEvent of events) {
        yield {
          type: "message-event",
          msgEvent,
        };
      }
    };

    loader.setTopics(mockTopicSelection("a"));
    let progressCount = 0;
    await loader.startLoading({
      progress: async (progress) => {
        expect(progress).toMatchObject({
          fullyLoadedFractionRanges: [
            {
              start: 0,
              end: 0.5,
            },
          ],
          messageCache: {
            blocks: [
              {
                messagesByTopic: {
                  a: msgEvents.slice(0, 5),
                },
                needTopics: new Map(),
                sizeInBytes: 50,
              },
            ],
            startTime: { sec: 0, nsec: 0 },
          },
        });

        // need to wait for second progress call to receive cache full error
        if (++progressCount > 1) {
          await loader.stopLoading();
        }
      },
    });
    expect(consoleErrorMock.mock.calls[0] ?? []).toContain("cache-full");
    consoleErrorMock.mockClear();

    // Load the same topic but with message slicing. Since messages are much smaller then,
    // we expect that we can preload the full range.
    loader.setTopics(new Map([["a", { topic: "a", fields: ["some_field"] }]]));
    let count = 0;
    await loader.startLoading({
      progress: async (progress) => {
        count += 1;
        if (count > maxBlockCount) {
          throw new Error("Too many progress callbacks");
        }

        if (count === maxBlockCount) {
          expect(progress).toEqual({
            fullyLoadedFractionRanges: [
              {
                start: 0,
                end: 1.0,
              },
            ],
            messageCache: {
              blocks: [
                {
                  messagesByTopic: {
                    a: slicedMsgEvents.slice(0, 5),
                  },
                  needTopics: new Map(),
                  sizeInBytes: 5,
                },
                {
                  messagesByTopic: {
                    a: slicedMsgEvents.slice(5, 10),
                  },
                  needTopics: new Map(),
                  sizeInBytes: 5,
                },
              ],
              startTime: { sec: 0, nsec: 0 },
            },
            memoryInfo: {
              [MEMORY_INFO_PRELOADED_MSGS]: 10,
            },
          });

          await loader.stopLoading();
        }
      },
    });
  });

  it("should keep existing topic message references when removing another topic", async () => {
    const source = new TestSource();
    const maxBlockCount = 2;
    const loader = new BlockLoader({
      maxBlocks: maxBlockCount,
      cacheSizeBytes: 1_000,
      minBlockDurationNs: 1,
      source,
      start: { sec: 0, nsec: 0 },
      end: { sec: 9, nsec: 0 },
      problemManager: new PlayerProblemManager(),
    });

    const msgEvents: MessageEvent[] = [];
    for (let i = 0; i < 10; i += 1) {
      msgEvents.push({
        topic: "a",
        receiveTime: { sec: i, nsec: 0 },
        message: undefined,
        sizeInBytes: 10,
        schemaName: "foo",
      });
    }

    source.messageIterator = async function* messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 10; ++i) {
        for (const [topic] of args.topics) {
          yield {
            type: "message-event",
            msgEvent: {
              topic,
              receiveTime: { sec: i, nsec: 0 },
              message: undefined,
              sizeInBytes: 10,
              schemaName: "foo",
            },
          };
        }
      }
    };

    loader.setTopics(mockTopicSelection("a", "b"));
    let lastBlocks: Immutable<(MessageBlock | undefined)[]> | undefined;
    await loader.startLoading({
      progress: async (progress) => {
        lastBlocks = progress.messageCache?.blocks;

        if (
          progress.fullyLoadedFractionRanges?.[0]?.start === 0 &&
          progress.fullyLoadedFractionRanges[0].end === 1
        ) {
          await loader.stopLoading();
        }
      },
    });

    const firstBlockLoad = lastBlocks;

    loader.setTopics(mockTopicSelection("a"));
    let count = 0;

    setTimeout(async () => {
      await loader.stopLoading();
    }, 1000);
    await loader.startLoading({
      progress: async (progress) => {
        lastBlocks = progress.messageCache?.blocks;
        count += 1;
      },
    });

    // There should not be any loading calls because the topic is already loaded
    expect(count).toEqual(0);

    // Topic _a_ does not change and should not be re-loaded into the blocks. The existing message
    // arrays should be unchanged.
    expect(firstBlockLoad?.[0]?.messagesByTopic["a"]).toBe(lastBlocks?.[0]?.messagesByTopic["a"]);
    expect(firstBlockLoad?.[1]?.messagesByTopic["a"]).toBe(lastBlocks?.[1]?.messagesByTopic["a"]);
  });

  it("loads blocks near focus time before earlier blocks (REI-125)", async () => {
    const source = new TestSource();
    const loadStarts: Array<{ start: number; end: number }> = [];

    const loader = new BlockLoader({
      maxBlocks: 4,
      cacheSizeBytes: 100,
      minBlockDurationNs: 1e9, // 1s blocks over [0,4)
      source,
      start: { sec: 0, nsec: 0 },
      end: { sec: 3, nsec: 999_999_999 },
      problemManager: new PlayerProblemManager(),
      playheadFocusEnabled: true,
    });

    // One message per second → one message per block
    const msgEvents: MessageEvent[] = [0, 1, 2, 3].map((sec) => ({
      topic: "a",
      receiveTime: { sec, nsec: 0 },
      message: undefined,
      sizeInBytes: 1,
      schemaName: "foo",
    }));

    source.messageIterator = async function* messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      loadStarts.push({
        start: args.start?.sec ?? -1,
        end: args.end?.sec ?? -1,
      });
      for (const msgEvent of msgEvents) {
        const t = msgEvent.receiveTime.sec;
        const startSec = args.start?.sec ?? 0;
        const endSec = args.end?.sec ?? Number.MAX_SAFE_INTEGER;
        if (t >= startSec && t <= endSec) {
          yield { type: "message-event", msgEvent };
        }
      }
    };

    // Focus near the end (block ~3) so the first span should start there, not at 0.
    loader.setFocusTime({ sec: 3, nsec: 0 });
    loader.setTopics(mockTopicSelection("a"));

    await loader.startLoading({
      progress: async (progress) => {
        const ranges = progress.fullyLoadedFractionRanges ?? [];
        const fullyLoaded = ranges.some((r) => r.start === 0 && r.end === 1);
        if (fullyLoaded) {
          await loader.stopLoading();
        }
      },
    });

    expect(loadStarts.length).toBeGreaterThanOrEqual(1);
    // First range request should begin at/near the focus (sec >= 2), not at the bag start.
    expect(loadStarts[0]!.start).toBeGreaterThanOrEqual(2);
    // Later a range covering earlier history should also run.
    expect(loadStarts.some((r) => r.start === 0)).toBe(true);
  });

  it("caps each load span duration so focus does not pull focus→EOF (REI-125)", async () => {
    const source = new TestSource();
    const loadRanges: Array<{ startSec: number; endSec: number }> = [];
    // 30 one-second blocks; span cap is 10s so first focused request must not cover all 30.
    const blockCount = 30;
    const loader = new BlockLoader({
      maxBlocks: blockCount,
      cacheSizeBytes: 1_000_000,
      minBlockDurationNs: 1e9,
      source,
      start: { sec: 0, nsec: 0 },
      end: { sec: blockCount - 1, nsec: 999_999_999 },
      problemManager: new PlayerProblemManager(),
      playheadFocusEnabled: true,
    });

    const msgEvents: MessageEvent[] = Array.from({ length: blockCount }, (_, sec) => ({
      topic: "a",
      receiveTime: { sec, nsec: 0 },
      message: undefined,
      sizeInBytes: 1,
      schemaName: "foo",
    }));

    source.messageIterator = async function* messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      const startSec = args.start?.sec ?? 0;
      const endSec = args.end?.sec ?? Number.MAX_SAFE_INTEGER;
      loadRanges.push({ startSec, endSec });
      for (const msgEvent of msgEvents) {
        const t = msgEvent.receiveTime.sec;
        if (t >= startSec && t <= endSec) {
          yield { type: "message-event", msgEvent };
        }
      }
    };

    // Focus mid-bag so without a cap the first span would expand to EOF.
    loader.setFocusTime({ sec: 15, nsec: 0 });
    loader.setTopics(mockTopicSelection("a"));

    await loader.startLoading({
      progress: async (progress) => {
        const ranges = progress.fullyLoadedFractionRanges ?? [];
        if (ranges.some((r) => r.start === 0 && r.end === 1)) {
          await loader.stopLoading();
        }
      },
    });

    expect(loadRanges.length).toBeGreaterThan(1);
    const first = loadRanges[0]!;
    // First request starts at/near focus.
    expect(first.startSec).toBeGreaterThanOrEqual(14);
    // And is capped (~10s of blocks), not the full remaining timeline to ~29s.
    const firstDurationSec = first.endSec - first.startSec;
    const maxSpanSec = BLOCK_LOAD_MAX_SPAN_DURATION_NS / 1e9;
    expect(firstDurationSec).toBeLessThanOrEqual(maxSpanSec + 1);
    expect(first.endSec).toBeLessThan(blockCount - 1);
  });

  it("aborts in-flight load and restarts near a new focus on seek (REI-125)", async () => {
    const source = new TestSource();
    const loadStarts: number[] = [];
    let resolveSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      resolveSlow = resolve;
    });
    let iteratorCalls = 0;

    const loader = new BlockLoader({
      maxBlocks: 20,
      cacheSizeBytes: 1_000_000,
      minBlockDurationNs: 1e9,
      source,
      start: { sec: 0, nsec: 0 },
      end: { sec: 19, nsec: 999_999_999 },
      problemManager: new PlayerProblemManager(),
      playheadFocusEnabled: true,
    });

    source.messageIterator = async function* messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      iteratorCalls += 1;
      const startSec = args.start?.sec ?? 0;
      loadStarts.push(startSec);

      // First open stalls until we seek, simulating a slow range read from bag start.
      if (iteratorCalls === 1) {
        await slowGate;
        if (args.abortSignal?.aborted === true) {
          return;
        }
      }

      for (let sec = 0; sec < 20; sec++) {
        if (args.abortSignal?.aborted === true) {
          return;
        }
        const t = sec;
        const endSec = args.end?.sec ?? Number.MAX_SAFE_INTEGER;
        if (t >= startSec && t <= endSec) {
          yield {
            type: "message-event",
            msgEvent: {
              topic: "a",
              receiveTime: { sec: t, nsec: 0 },
              message: undefined,
              sizeInBytes: 1,
              schemaName: "foo",
            },
          };
        }
      }
    };

    loader.setTopics(mockTopicSelection("a"));

    const loading = loader.startLoading({
      progress: async (progress) => {
        const ranges = progress.fullyLoadedFractionRanges ?? [];
        if (ranges.some((r) => r.start === 0 && r.end === 1)) {
          await loader.stopLoading();
        }
      },
    });

    // Wait until the first iterator has started at bag start.
    for (let i = 0; i < 50 && loadStarts.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(loadStarts[0]).toBe(0);

    // Seek focus to mid-bag with abort — should cancel the start-of-bag span.
    loader.setFocusTime({ sec: 12, nsec: 0 }, { abortInFlight: true });
    resolveSlow?.();

    await loading;

    // A later request should start near the seek focus (not only complete from 0).
    expect(loadStarts.some((s) => s >= 10)).toBe(true);
  });

  it("ignores focus and loads one contiguous span by default (REI-125)", async () => {
    const source = new TestSource();
    const loadRanges: Array<{ startSec: number; endSec: number }> = [];
    const blockCount = 30;

    // No playheadFocusEnabled: block consumers use ascending cursors, so focus must stay off.
    const loader = new BlockLoader({
      maxBlocks: blockCount,
      cacheSizeBytes: 1_000_000,
      minBlockDurationNs: 1e9,
      source,
      start: { sec: 0, nsec: 0 },
      end: { sec: blockCount - 1, nsec: 999_999_999 },
      problemManager: new PlayerProblemManager(),
    });

    const msgEvents: MessageEvent[] = Array.from({ length: blockCount }, (_, sec) => ({
      topic: "a",
      receiveTime: { sec, nsec: 0 },
      message: undefined,
      sizeInBytes: 1,
      schemaName: "foo",
    }));

    source.messageIterator = async function* messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      loadRanges.push({
        startSec: args.start?.sec ?? -1,
        endSec: args.end?.sec ?? -1,
      });
      for (const msgEvent of msgEvents) {
        const t = msgEvent.receiveTime.sec;
        const startSec = args.start?.sec ?? 0;
        const endSec = args.end?.sec ?? Number.MAX_SAFE_INTEGER;
        if (t >= startSec && t <= endSec) {
          yield { type: "message-event", msgEvent };
        }
      }
    };

    // Focus calls are no-ops while the feature is off; an abort here must not restart loading.
    loader.setFocusTime({ sec: 25, nsec: 0 }, { abortInFlight: true });
    loader.setTopics(mockTopicSelection("a"));

    await loader.startLoading({
      progress: async (progress) => {
        const ranges = progress.fullyLoadedFractionRanges ?? [];
        if (ranges.some((r) => r.start === 0 && r.end === 1)) {
          await loader.stopLoading();
        }
      },
    });

    // Exactly one contiguous span from the bag start — no focus jump, no 10s span fragmentation.
    expect(loadRanges).toHaveLength(1);
    expect(loadRanges[0]!.startSec).toBe(0);
    expect(loadRanges[0]!.endSec).toBe(blockCount - 1);
  });
});
