// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as IDB from "idb";

import { toNanoSec } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";
import {
  CacheSessionMetadata,
  clearIndexedDbMessageStoreDatabase,
  IndexedDbMessageStore,
  PLAYBACK_MESSAGE_CACHE_DB_NAME,
} from "@foxglove/studio-base/persistence/IndexedDbMessageStore";
import { SubscribePayload, TopicSelection } from "@foxglove/studio-base/players/types";
import { mockTopicSelection } from "@foxglove/studio-base/test/mocks/mockTopicSelection";

import { CachingIterableSource } from "./CachingIterableSource";
import {
  GetBackfillMessagesArgs,
  IIterableSource,
  Initalization,
  IteratorResult,
  MessageIteratorArgs,
} from "./IIterableSource";

class TestSource implements IIterableSource {
  public messageIteratorCalls = 0;
  public getBackfillMessagesCalls = 0;

  public async initialize(): Promise<Initalization> {
    return {
      start: { sec: 0, nsec: 0 },
      end: { sec: 10, nsec: 0 },
      topics: [],
      topicStats: new Map(),
      profile: undefined,
      problems: [],
      datatypes: new Map(),
      publishersByTopic: new Map(),
    };
  }

  public async *messageIterator(
    _args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    this.messageIteratorCalls++;
    yield* [];
  }

  public async getBackfillMessages(_args: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    this.getBackfillMessagesCalls++;
    return [];
  }
}

function payloadSelection(payloads: SubscribePayload[]): TopicSelection {
  return new Map(payloads.map((payload) => [payload.topic, payload]));
}

async function getPlaybackSpillSessions(): Promise<CacheSessionMetadata[]> {
  const db = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
  try {
    const tx = db.transaction("sessions", "readonly");
    const sessions = (await tx.objectStore("sessions").getAll()) as CacheSessionMetadata[];
    await tx.done;
    return sessions.filter((session) => session.kind === "playback-spill");
  } finally {
    db.close();
  }
}

async function getPlaybackSpillLoadedRangeSessionIds(): Promise<string[]> {
  const db = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
  try {
    const tx = db.transaction("loadedRanges", "readonly");
    const ranges = (await tx.objectStore("loadedRanges").getAll()) as { sessionId: string }[];
    await tx.done;
    return ranges.map((range) => range.sessionId);
  } finally {
    db.close();
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(await predicate()).toBe(true);
}

async function deletePlaybackSpillSession(sessionId: string): Promise<void> {
  const store = new IndexedDbMessageStore({ sessionId, kind: "playback-spill" });
  await store.init();
  try {
    await store.deleteCurrentSession();
  } finally {
    await store.close();
  }
}

async function deletePlaybackSpillSessionMetadata(sessionId: string): Promise<void> {
  const db = await IDB.openDB(PLAYBACK_MESSAGE_CACHE_DB_NAME);
  try {
    const tx = db.transaction("sessions", "readwrite");
    await tx.store.delete(sessionId);
    await tx.done;
  } finally {
    db.close();
  }
}

function withBrowserEvents(): () => void {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowTarget,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: Object.assign(documentTarget, { visibilityState: "visible" }),
  });
  return () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: previousDocument,
    });
  };
}

describe("CachingIterableSource", () => {
  beforeEach(async () => {
    await clearIndexedDbMessageStoreDatabase();
  });

  afterEach(async () => {
    await clearIndexedDbMessageStoreDatabase();
  });

  it("should construct and initialize", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source);

    await bufferedSource.initialize();
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 0 }]);
  });

  it("rejects non-finite or negative cache limits", () => {
    const source = new TestSource();
    expect(
      () => new CachingIterableSource(source, { maxBlockSize: Number.POSITIVE_INFINITY }),
    ).toThrow("maxBlockSize must be a finite, non-negative number");
    expect(() => new CachingIterableSource(source, { maxTotalSize: -1 })).toThrow(
      "maxTotalSize must be a finite, non-negative number",
    );
  });

  it("keeps playback fail-open when message sizing is cyclic, unsupported, or invalid", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "unsafe-size-estimates" },
    });
    await bufferedSource.initialize();

    const cyclic: { value: string; self?: unknown } = { value: "cyclic" };
    cyclic.self = cyclic;
    const messages: unknown[] = [cyclic, { callback: () => undefined }, { value: "nan-size" }];
    source.messageIterator = async function* messageIterator(): AsyncIterableIterator<
      Readonly<IteratorResult>
    > {
      for (let index = 0; index < messages.length; index++) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: index, nsec: 0 },
            message: messages[index],
            sizeInBytes: index === 2 ? Number.NaN : 10,
            schemaName: "foo",
          },
        };
      }
    };

    const received: unknown[] = [];
    try {
      for await (const result of bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      })) {
        if (result.type === "message-event") {
          received.push(result.msgEvent.message);
        }
      }
      expect(received).toEqual(messages);
      expect(Number.isFinite(bufferedSource.getCacheSize())).toBe(true);
    } finally {
      await bufferedSource.terminate();
      jest.mocked(console.warn).mockClear();
    }
  });

  it("should produce messages that the source produces", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source);

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 8; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: 0, nsec: i * 1e8 },
            message: undefined,
            sizeInBytes: 0,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // confirm messages are what we expect
      for (let i = 0; i < 8; ++i) {
        const iterResult = messageIterator.next();
        await expect(iterResult).resolves.toEqual({
          done: false,
          value: {
            type: "message-event",
            msgEvent: {
              receiveTime: { sec: 0, nsec: i * 1e8 },
              message: undefined,
              sizeInBytes: 0,
              topic: "a",
              schemaName: "foo",
            },
          },
        });
      }

      // The message iterator should be done since we have no more data to read from the source
      const iterResult = messageIterator.next();
      await expect(iterResult).resolves.toEqual({
        done: true,
      });

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }

    // because we have cached we shouldn't be calling source anymore
    source.messageIterator = function messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      throw new Error("should not be called");
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // confirm messages are what we expect
      for (let i = 0; i < 8; ++i) {
        const iterResult = messageIterator.next();
        await expect(iterResult).resolves.toEqual({
          done: false,
          value: {
            type: "message-event",
            msgEvent: {
              receiveTime: { sec: 0, nsec: i * 1e8 },
              message: undefined,
              sizeInBytes: 0,
              topic: "a",
              schemaName: "foo",
            },
          },
        });
      }

      // The message iterator should be done since we have no more data to read from the source
      const iterResult = messageIterator.next();
      await expect(iterResult).resolves.toEqual({
        done: true,
      });

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }
  });

  it("should purge the cache when topics change", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source);

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 0, nsec: 1 },
          message: undefined,
          sizeInBytes: 0,
          schemaName: "foo",
        },
      };
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of messageIterator) {
        // no-op
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: new Map(),
      });

      await messageIterator.next();
      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 0 }]);
    }
  });

  it("should yield correct messages when starting a new iterator before the the cached items", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source);

    await bufferedSource.initialize();

    {
      source.messageIterator = async function* messageIterator(
        _args: MessageIteratorArgs,
      ): AsyncIterableIterator<Readonly<IteratorResult>> {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: 5, nsec: 0 },
            message: undefined,
            sizeInBytes: 0,
            schemaName: "foo",
          },
        };
      };

      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 5, nsec: 0 },
      });

      // Read one message
      {
        const iterResult = await messageIterator.next();
        expect(iterResult).toEqual({
          done: false,
          value: {
            type: "message-event",
            msgEvent: {
              receiveTime: { sec: 5, nsec: 0 },
              message: undefined,
              sizeInBytes: 0,
              topic: "a",
              schemaName: "foo",
            },
          },
        });
      }

      {
        const iterResult = await messageIterator.next();
        expect(iterResult).toEqual({
          done: true,
        });
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0.5, end: 1 }]);
    }

    // A new message iterator at the start time should emit the new message
    {
      source.messageIterator = async function* messageIterator(
        _args: MessageIteratorArgs,
      ): AsyncIterableIterator<Readonly<IteratorResult>> {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: 0, nsec: 0 },
            message: undefined,
            sizeInBytes: 0,
            schemaName: "foo",
          },
        };
      };

      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 0, nsec: 0 },
      });

      // Read one message
      {
        const iterResult = await messageIterator.next();
        expect(iterResult).toEqual({
          done: false,
          value: {
            type: "message-event",
            msgEvent: {
              receiveTime: { sec: 0, nsec: 0 },
              message: undefined,
              sizeInBytes: 0,
              topic: "a",
              schemaName: "foo",
            },
          },
        });
      }

      {
        const iterResult = await messageIterator.next();
        expect(iterResult).toEqual({
          done: false,
          value: {
            type: "message-event",
            msgEvent: {
              receiveTime: { sec: 5, nsec: 0 },
              message: undefined,
              sizeInBytes: 0,
              topic: "a",
              schemaName: "foo",
            },
          },
        });
      }

      {
        const iterResult = await messageIterator.next();
        expect(iterResult).toEqual({
          done: true,
        });
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }
  });

  it("should purge blocks when filled", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 100,
      maxTotalSize: 300,
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 0, nsec: 0 },
          message: undefined,
          sizeInBytes: 101,
          schemaName: "foo",
        },
      };

      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 5, nsec: 1 },
          message: undefined,
          sizeInBytes: 101,
          schemaName: "foo",
        },
      };

      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 10, nsec: 0 },
          message: undefined,
          sizeInBytes: 101,
          schemaName: "foo",
        },
      };
    };

    const messageIterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
    });

    // Reads the next message and updates the read head. The latter is done for the source to know
    // which blocks it can evict.
    const readNextMsgAndUpdateReadHead = async () => {
      const { done, value } = await messageIterator.next();
      if (done ?? false) {
        return;
      }
      if (value.type === "message-event") {
        bufferedSource.setCurrentReadHead(value.msgEvent.receiveTime);
      }
    };

    await readNextMsgAndUpdateReadHead();
    // Nothing has been actually saved into the cache but we did emit the first item
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 0 }]);

    await readNextMsgAndUpdateReadHead();
    // We've read another message which let us setup a block for all the time we've read till now
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 0.5 }]);

    await readNextMsgAndUpdateReadHead();
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0.5000000001, end: 0.9999999999 }]);

    await readNextMsgAndUpdateReadHead();
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0.5000000001, end: 1 }]);
  });

  it("should return fully cached when there is no data in the source", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 100,
      maxTotalSize: 300,
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      // no-op
    };

    const messageIterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
    });

    await messageIterator.next();
    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
  });

  it("should respect end bounds when loading the cache", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source);

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 3, nsec: 0 },
          message: undefined,
          sizeInBytes: 0,
          schemaName: "foo",
        },
      };

      if ((args.end?.sec ?? 100) < 6) {
        return;
      }

      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 6, nsec: 0 },
          message: undefined,
          sizeInBytes: 0,
          schemaName: "foo",
        },
      };
    };

    const messageIterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      end: { sec: 4, nsec: 0 },
    });

    {
      const res = await messageIterator.next();
      expect(res.value).toEqual({
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 3, nsec: 0 },
          message: undefined,
          sizeInBytes: 0,
          schemaName: "foo",
        },
      });
    }

    {
      const res = await messageIterator.next();
      expect(res.done).toEqual(true);
    }
  });

  it("should respect end bounds when reading the cache", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source);

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 3, nsec: 0 },
          message: undefined,
          sizeInBytes: 0,
          schemaName: "foo",
        },
      };

      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 6, nsec: 0 },
          message: undefined,
          sizeInBytes: 0,
          schemaName: "foo",
        },
      };
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of messageIterator) {
        // no-op
      }
    }

    const messageIterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      end: { sec: 4, nsec: 0 },
    });

    {
      const res = await messageIterator.next();
      expect(res.value).toEqual({
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 3, nsec: 0 },
          message: undefined,
          sizeInBytes: 0,
          schemaName: "foo",
        },
      });
    }

    {
      const res = await messageIterator.next();
      expect(res.done).toEqual(true);
    }
  });

  it("should getBackfillMessages from cache", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source);

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 8; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: 0, nsec: i * 1e8 },
            message: undefined,
            sizeInBytes: 0,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // load all the messages into cache
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of messageIterator) {
        // no-op
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }

    // because we have cached we shouldn't be calling source anymore
    source.messageIterator = function messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      throw new Error("should not be called");
    };

    const backfill = await bufferedSource.getBackfillMessages({
      topics: mockTopicSelection("a"),
      time: { sec: 2, nsec: 0 },
    });
    expect(backfill).toEqual([
      {
        message: undefined,
        receiveTime: { sec: 0, nsec: 700000000 },
        sizeInBytes: 0,
        topic: "a",
        schemaName: "foo",
      },
    ]);
  });

  it("does not mark an aborted source range as fully loaded", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source);
    const abortController = new AbortController();

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      const aborted = new Promise<void>((resolve) => {
        if (abortController.signal.aborted) {
          resolve();
          return;
        }
        abortController.signal.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        );
      });
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 1, nsec: 0 },
          message: undefined,
          sizeInBytes: 0,
          schemaName: "foo",
        },
      };
      await aborted;
    };

    const iterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 10, nsec: 0 },
      abortSignal: abortController.signal,
    } as MessageIteratorArgs & { abortSignal: AbortSignal });

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "message-event" },
    });
    abortController.abort();
    await expect(iterator.next()).resolves.toEqual({ done: true });

    expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 0.0999999999 }]);
  });

  it("should getBackfillMessages from multiple cache blocks", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, { maxBlockSize: 100 });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 1, nsec: 0 },
          message: undefined,
          sizeInBytes: 101,
          schemaName: "foo",
        },
      };
      yield {
        type: "message-event",
        msgEvent: {
          topic: "b",
          receiveTime: { sec: 2, nsec: 0 },
          message: undefined,
          sizeInBytes: 101,
          schemaName: "foo",
        },
      };
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a", "b"),
      });

      // load all the messages into cache
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of messageIterator) {
        // no-op
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }

    // because we have cached we shouldn't be calling source anymore
    source.messageIterator = function messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      throw new Error("should not be called");
    };

    const backfill = await bufferedSource.getBackfillMessages({
      topics: mockTopicSelection("a", "b"),
      time: { sec: 2, nsec: 500 },
    });
    expect(backfill).toEqual([
      {
        message: undefined,
        receiveTime: { sec: 2, nsec: 0 },
        sizeInBytes: 101,
        topic: "b",
        schemaName: "foo",
      },
      {
        message: undefined,
        receiveTime: { sec: 1, nsec: 0 },
        sizeInBytes: 101,
        topic: "a",
        schemaName: "foo",
      },
    ]);
  });

  it("should evict blocks as cache fills up", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 102,
      maxTotalSize: 202,
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 8; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: undefined,
            sizeInBytes: 101,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // load all the messages into cache
      for await (const result of messageIterator) {
        // Update the current read head so the source knows which blocks it can evict.
        if (result.type === "message-event") {
          bufferedSource.setCurrentReadHead(result.msgEvent.receiveTime);
        }
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0.6, end: 1 }]);
    }
  });

  it("should report full cache as cache fills up", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 102,
      maxTotalSize: 202,
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 8; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: undefined,
            sizeInBytes: 101,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // At the start the cache is empty and the source can read messages
      expect(bufferedSource.canReadMore()).toBeTruthy();

      // The cache size after reading the first message should still allow reading a new message
      await messageIterator.next();
      expect(bufferedSource.canReadMore()).toBeTruthy();

      // Next message fills up the cache and the source can not read more messages
      await messageIterator.next();
      expect(bufferedSource.canReadMore()).toBeFalsy();
    }
  });

  it("should clear the cache when topics change", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 1000,
      maxTotalSize: 1000,
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 10; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: undefined,
            sizeInBytes: 100,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // load all the messages into cache
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of messageIterator) {
        // no-op
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a", "b"),
      });

      await messageIterator.next();

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 0 }]);
    }
  });

  it("should produce messages that have the same timestamp", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 100,
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 10; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: Math.floor(i / 3), nsec: 0 },
            message: { value: i },
            sizeInBytes: 50,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // confirm messages are what we expect
      for (let i = 0; i < 10; ++i) {
        const iterResult = messageIterator.next();
        await expect(iterResult).resolves.toEqual({
          done: false,
          value: {
            type: "message-event",
            msgEvent: {
              receiveTime: { sec: Math.floor(i / 3), nsec: 0 },
              message: { value: i },
              sizeInBytes: 50,
              topic: "a",
              schemaName: "foo",
            },
          },
        });
      }

      // The message iterator should be done since we have no more data to read from the source
      const iterResult = messageIterator.next();
      await expect(iterResult).resolves.toEqual({
        done: true,
      });

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }

    // because we have cached we shouldn't be calling source anymore
    source.messageIterator = function messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      throw new Error("should not be called");
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      });

      // confirm messages are what we expect when reading from the cache
      for (let i = 0; i < 10; ++i) {
        const iterResult = messageIterator.next();
        await expect(iterResult).resolves.toEqual({
          done: false,
          value: {
            type: "message-event",
            msgEvent: {
              receiveTime: { sec: Math.floor(i / 3), nsec: 0 },
              message: { value: i },
              sizeInBytes: 50,
              topic: "a",
              schemaName: "foo",
            },
          },
        });
      }

      // The message iterator should be done since we have no more data to read from the source
      const iterResult = messageIterator.next();
      await expect(iterResult).resolves.toEqual({
        done: true,
      });

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }
  });

  it("should getBackfillMessages from cache where messages have same timestamp", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source);

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      for (let i = 0; i < 10; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: Math.floor(i / 3), nsec: 0 },
            message: { value: i },
            sizeInBytes: 0,
            schemaName: "foo",
          },
        };
        yield {
          type: "message-event",

          msgEvent: {
            topic: "b",
            receiveTime: { sec: Math.floor(i / 3), nsec: 0 },
            message: { value: i },
            sizeInBytes: 0,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const messageIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a", "b"),
      });

      // load all the messages into cache
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of messageIterator) {
        // no-op
      }

      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
    }

    // because we have cached we shouldn't be calling source anymore
    source.messageIterator = function messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      throw new Error("should not be called");
    };

    const backfill = await bufferedSource.getBackfillMessages({
      topics: mockTopicSelection("a", "b"),
      time: { sec: 2, nsec: 0 },
    });

    expect(backfill).toEqual([
      {
        message: { value: 8 },
        receiveTime: { sec: 2, nsec: 0 },
        sizeInBytes: 0,
        topic: "b",
        schemaName: "foo",
      },
      {
        message: { value: 8 },
        receiveTime: { sec: 2, nsec: 0 },
        sizeInBytes: 0,
        topic: "a",
        schemaName: "foo",
      },
    ]);
  });

  it("reads evicted ranges from playback spill cache without calling the source again", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 102,
      maxTotalSize: 202,
      spillCache: { sourceId: "test-source" },
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      source.messageIteratorCalls++;
      for (let i = 0; i < 8; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: { value: i },
            sizeInBytes: 101,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const iterator = bufferedSource.messageIterator({ topics: mockTopicSelection("a") });
      for await (const result of iterator) {
        if (result.type === "message-event") {
          bufferedSource.setCurrentReadHead(result.msgEvent.receiveTime);
        }
      }
      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 1 }]);
      expect(source.messageIteratorCalls).toBe(1);
    }

    source.messageIterator = function messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      throw new Error("source should not be called when spill cache covers the range");
    };

    const iterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 2, nsec: 0 },
    });

    const values: unknown[] = [];
    for await (const result of iterator) {
      if (result.type === "message-event") {
        values.push(result.msgEvent.message);
      }
    }

    expect(values).toEqual([{ value: 0 }, { value: 1 }, { value: 2 }]);
    expect(source.messageIteratorCalls).toBe(1);

    await bufferedSource.terminate();
  });

  it("streams a persisted range across bounded spill pages", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 600_001,
      maxTotalSize: 600_001,
      spillCache: { sourceId: "paged-hydration" },
    });

    await bufferedSource.initialize();
    source.messageIterator = async function* messageIterator(): AsyncIterableIterator<
      Readonly<IteratorResult>
    > {
      source.messageIteratorCalls++;
      for (let i = 0; i < 4; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: { value: i },
            sizeInBytes: 600_000,
            schemaName: "foo",
          },
        };
      }
    };

    for await (const result of bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
    })) {
      if (result.type === "message-event") {
        bufferedSource.setCurrentReadHead(result.msgEvent.receiveTime);
      }
    }
    expect(source.messageIteratorCalls).toBe(1);

    source.messageIterator = function messageIterator(): AsyncIterableIterator<
      Readonly<IteratorResult>
    > {
      throw new Error("source should not be called when paged spill coverage is available");
    };
    const pageSpy = jest.spyOn(IndexedDbMessageStore.prototype, "getMessagesPage");
    try {
      const values: unknown[] = [];
      for await (const result of bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 0, nsec: 0 },
        end: { sec: 3, nsec: 0 },
      })) {
        if (result.type === "message-event") {
          values.push(result.msgEvent.message);
        }
      }

      expect(values).toEqual([{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }]);
      expect(pageSpy.mock.calls.length).toBeGreaterThan(1);
      expect(source.messageIteratorCalls).toBe(1);
    } finally {
      pageSpy.mockRestore();
      await bufferedSource.terminate();
    }
  });

  it("flushes byte-bounded spill chunks before the store queue can overflow", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "byte-backpressure" },
    });
    const appendSpy = jest.spyOn(IndexedDbMessageStore.prototype, "append");
    const flushSpy = jest.spyOn(IndexedDbMessageStore.prototype, "flush");
    try {
      await bufferedSource.initialize();
      source.messageIterator = async function* messageIterator(): AsyncIterableIterator<
        Readonly<IteratorResult>
      > {
        for (let index = 0; index < 70; index++) {
          yield {
            type: "message-event",
            msgEvent: {
              topic: "a",
              receiveTime: { sec: 0, nsec: index },
              message: { index },
              sizeInBytes: 2 * 1024 * 1024,
              schemaName: "foo",
            },
          };
        }
      };

      for await (const result of bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
      })) {
        void result;
        // Consume a fast source without yielding to timer-driven background flushes.
      }

      const spillAppendCalls = appendSpy.mock.calls.filter(
        ([, options]) => options?.estimatedSizeBytes != undefined,
      );
      expect(spillAppendCalls.length).toBeGreaterThan(2);
      for (const [, options] of spillAppendCalls) {
        expect(
          options?.estimatedSizeBytes?.reduce((total, size) => total + size, 0),
        ).toBeLessThanOrEqual(64 * 1024 * 1024);
      }
      const secondAppendOrder = appendSpy.mock.invocationCallOrder[1];
      const thirdAppendOrder = appendSpy.mock.invocationCallOrder[2];
      expect(
        flushSpy.mock.invocationCallOrder.some(
          (order) =>
            secondAppendOrder != undefined &&
            thirdAppendOrder != undefined &&
            order > secondAppendOrder &&
            order < thirdAppendOrder,
        ),
      ).toBe(true);
    } finally {
      appendSpy.mockRestore();
      flushSpy.mockRestore();
      await bufferedSource.terminate();
    }
  });

  it("resumes the source without duplicating messages when a later spill page fails", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 600_001,
      maxTotalSize: 600_001,
      spillCache: { sourceId: "paged-hydration-failure" },
    });
    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(): AsyncIterableIterator<
      Readonly<IteratorResult>
    > {
      source.messageIteratorCalls++;
      for (let i = 0; i < 10; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: { value: i },
            sizeInBytes: 200_000,
            schemaName: "foo",
          },
        };
      }
    };

    for await (const result of bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
    })) {
      if (result.type === "message-event") {
        bufferedSource.setCurrentReadHead(result.msgEvent.receiveTime);
      }
    }

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalGetMessagesPage = IndexedDbMessageStore.prototype.getMessagesPage;
    let pageCallCount = 0;
    const pageSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "getMessagesPage")
      .mockImplementation(async function (this: IndexedDbMessageStore, params) {
        pageCallCount++;
        if (pageCallCount === 2) {
          throw new Error("later spill page failed");
        }
        return await originalGetMessagesPage.call(this, params);
      });
    try {
      const values: unknown[] = [];
      for await (const result of bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 0, nsec: 0 },
        end: { sec: 9, nsec: 0 },
      })) {
        if (result.type === "message-event") {
          values.push(result.msgEvent.message);
        }
      }

      expect(values).toEqual(Array.from({ length: 10 }, (_, value) => ({ value })));
      expect(pageCallCount).toBe(2);
      expect(source.messageIteratorCalls).toBe(2);
    } finally {
      pageSpy.mockRestore();
      await bufferedSource.terminate();
      jest.mocked(console.warn).mockClear();
    }
  });

  it("restarts an uncommitted same-topic timestamp group when replay order changes", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 600_001,
      maxTotalSize: 600_001,
      spillCache: { sourceId: "same-time-page-failure" },
    });
    await bufferedSource.initialize();
    const topics = mockTopicSelection("a");

    // Initialize the topic fingerprint without reading or creating an in-memory coverage block.
    await expect(
      bufferedSource
        .messageIterator({
          topics,
          start: { sec: 1, nsec: 0 },
          end: { sec: 0, nsec: 0 },
        })
        .next(),
    ).resolves.toEqual({ done: true });

    const session = (await getPlaybackSpillSessions())[0];
    if (session?.topicFingerprint == undefined) {
      throw new Error("Expected playback spill topic fingerprint");
    }
    const writer = new IndexedDbMessageStore({
      sessionId: session.sessionId,
      kind: "playback-spill",
    });
    await writer.init();
    await writer.append(
      [
        {
          topic: "a",
          receiveTime: { sec: 0, nsec: 0 },
          message: { value: 1 },
          sizeInBytes: 600_000,
          schemaName: "foo",
        },
        {
          topic: "a",
          receiveTime: { sec: 0, nsec: 0 },
          message: { value: 2 },
          sizeInBytes: 600_000,
          schemaName: "foo",
        },
      ],
      { estimatedSizeBytes: [600_000, 600_000] },
    );
    await writer.flush();
    await writer.putLoadedRange({
      sessionId: session.sessionId,
      topicFingerprint: session.topicFingerprint,
      start: { sec: 0, nsec: 0 },
      end: { sec: 0, nsec: 0 },
    });
    await writer.close();

    source.messageIterator = async function* messageIterator(): AsyncIterableIterator<
      Readonly<IteratorResult>
    > {
      source.messageIteratorCalls++;
      // Same-topic ties have no stable ordering contract. Reversing them must not duplicate or
      // omit either message when the second spill page fails.
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 0, nsec: 0 },
          message: { value: 2 },
          sizeInBytes: 600_000,
          schemaName: "foo",
        },
      };
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 0, nsec: 0 },
          message: { value: 1 },
          sizeInBytes: 600_000,
          schemaName: "foo",
        },
      };
    };

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalGetMessagesPage = IndexedDbMessageStore.prototype.getMessagesPage;
    let pageCallCount = 0;
    const pageSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "getMessagesPage")
      .mockImplementation(async function (this: IndexedDbMessageStore, params) {
        pageCallCount++;
        if (pageCallCount === 2) {
          throw new Error("second same-time page failed");
        }
        return await originalGetMessagesPage.call(this, params);
      });
    try {
      const values: unknown[] = [];
      for await (const result of bufferedSource.messageIterator({
        topics,
        start: { sec: 0, nsec: 0 },
        end: { sec: 0, nsec: 0 },
      })) {
        if (result.type === "message-event") {
          values.push(result.msgEvent.message);
        }
      }
      expect(values).toEqual([{ value: 2 }, { value: 1 }]);
      expect(source.messageIteratorCalls).toBe(1);
    } finally {
      pageSpy.mockRestore();
      await bufferedSource.terminate();
      jest.mocked(console.warn).mockClear();
    }
  });

  it("falls back to the source when a playback spill read never settles", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 102,
      maxTotalSize: 202,
      spillCache: { sourceId: "hung-read" },
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(): AsyncIterableIterator<
      Readonly<IteratorResult>
    > {
      source.messageIteratorCalls++;
      for (let i = 0; i < 8; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: { value: i, sourceCall: source.messageIteratorCalls },
            sizeInBytes: 101,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const iterator = bufferedSource.messageIterator({ topics: mockTopicSelection("a") });
      for await (const result of iterator) {
        if (result.type === "message-event") {
          bufferedSource.setCurrentReadHead(result.msgEvent.receiveTime);
        }
      }
    }
    expect(source.messageIteratorCalls).toBe(1);

    let signalReadStarted: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      signalReadStarted = resolve;
    });
    const hungReadSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "getMessagesPage")
      .mockImplementation(async () => {
        signalReadStarted?.();
        return await new Promise(() => undefined);
      });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalDiscardAndSeal = IndexedDbMessageStore.prototype.discardAndSeal;
    let releaseSeal: (() => void) | undefined;
    const sealGate = new Promise<void>((resolve) => {
      releaseSeal = resolve;
    });
    const discardSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "discardAndSeal")
      .mockImplementation(async function (this: IndexedDbMessageStore, status) {
        await sealGate;
        await originalDiscardAndSeal.call(this, status);
      });

    jest.useFakeTimers();
    try {
      const iterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 0, nsec: 0 },
        end: { sec: 2, nsec: 0 },
      });
      const nextResult = iterator.next();
      await readStarted;

      await jest.advanceTimersByTimeAsync(5_000);
      await expect(nextResult).resolves.toMatchObject({
        done: false,
        value: {
          type: "message-event",
          msgEvent: { message: { value: 0, sourceCall: 2 } },
        },
      });
      expect(source.messageIteratorCalls).toBe(2);
      expect(discardSpy).toHaveBeenCalledWith("abandoned");

      releaseSeal?.();
      await iterator.return?.();
    } finally {
      releaseSeal?.();
      jest.useRealTimers();
      hungReadSpy.mockRestore();
      await bufferedSource.terminate();
      discardSpy.mockRestore();
      jest.mocked(console.warn).mockClear();
    }
  });

  it("records empty playback spill ranges so empty re-reads do not call the source", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source" },
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      source.messageIteratorCalls++;
      yield* [];
    };

    {
      const iterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 1, nsec: 0 },
        end: { sec: 2, nsec: 0 },
      });
      await expect(iterator.next()).resolves.toEqual({ done: true });
      expect(source.messageIteratorCalls).toBe(1);
    }

    source.messageIterator = function messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      throw new Error("source should not be called for empty covered spill range");
    };

    const iterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      start: { sec: 1, nsec: 0 },
      end: { sec: 2, nsec: 0 },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true });
    expect(source.messageIteratorCalls).toBe(1);

    await bufferedSource.terminate();
  });

  it("does not record playback spill loaded ranges for aborted source ranges", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source" },
    });
    const abortController = new AbortController();

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      const aborted = new Promise<void>((resolve) => {
        if (abortController.signal.aborted) {
          resolve();
          return;
        }
        abortController.signal.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        );
      });
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 1, nsec: 0 },
          message: { value: 1 },
          sizeInBytes: 10,
          schemaName: "foo",
        },
      };
      await aborted;
    };

    const iterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 5, nsec: 0 },
      abortSignal: abortController.signal,
    } as MessageIteratorArgs & { abortSignal: AbortSignal });

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "message-event" },
    });
    let reader: IndexedDbMessageStore | undefined;
    try {
      abortController.abort();
      await expect(iterator.next()).resolves.toEqual({ done: true });
      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 0.0999999999 }]);
      expect(bufferedSource.getCacheSize()).toBe(0);

      const sessions = await getPlaybackSpillSessions();
      expect(sessions).toHaveLength(1);
      const session = sessions[0]!;
      reader = new IndexedDbMessageStore({
        sessionId: session.sessionId,
        kind: "playback-spill",
      });
      await reader.init();
      const topicFingerprint = (await reader.getSessionMetadata())?.topicFingerprint;
      if (topicFingerprint == undefined) {
        throw new Error("Expected playback spill topic fingerprint to be recorded");
      }
      await expect(reader.getLoadedRanges(topicFingerprint)).resolves.toEqual([]);
    } finally {
      await reader?.close();
      await bufferedSource.terminate();
    }
  });

  it("falls back to source when a stale spill range points at a deleted session", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 102,
      maxTotalSize: 202,
      spillCache: { sourceId: "test-source" },
    });

    try {
      await bufferedSource.initialize();

      source.messageIterator = async function* messageIterator(
        args: MessageIteratorArgs,
      ): AsyncIterableIterator<Readonly<IteratorResult>> {
        source.messageIteratorCalls++;
        const start = args.start?.sec ?? 0;
        const end = args.end?.sec ?? 3;
        for (let i = start; i <= end; ++i) {
          yield {
            type: "message-event",
            msgEvent: {
              topic: "a",
              receiveTime: { sec: i, nsec: 0 },
              message: { value: i, call: source.messageIteratorCalls },
              sizeInBytes: 101,
              schemaName: "foo",
            },
          };
        }
      };

      {
        const iterator = bufferedSource.messageIterator({
          topics: mockTopicSelection("a"),
          start: { sec: 0, nsec: 0 },
          end: { sec: 3, nsec: 0 },
        });
        for await (const result of iterator) {
          if (result.type === "message-event") {
            bufferedSource.setCurrentReadHead(result.msgEvent.receiveTime);
          }
        }
      }
      expect(source.messageIteratorCalls).toBe(1);

      const originalSession = (await getPlaybackSpillSessions())[0];
      if (originalSession == undefined) {
        throw new Error("Expected playback spill session");
      }
      await deletePlaybackSpillSession(originalSession.sessionId);

      source.messageIteratorCalls = 0;
      source.messageIterator = async function* messageIterator(
        _args: MessageIteratorArgs,
      ): AsyncIterableIterator<Readonly<IteratorResult>> {
        source.messageIteratorCalls++;
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: 0, nsec: 0 },
            message: { value: source.messageIteratorCalls },
            sizeInBytes: 10,
            schemaName: "foo",
          },
        };
      };

      const iterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 0, nsec: 0 },
        end: { sec: 0, nsec: 0 },
      });
      const messages: unknown[] = [];
      for await (const result of iterator) {
        if (result.type === "message-event") {
          messages.push(result.msgEvent.message);
        }
      }

      expect(messages).toEqual([{ value: 1 }]);
      expect(source.messageIteratorCalls).toBe(1);
      await waitFor(async () => {
        const sessions = await getPlaybackSpillSessions();
        return sessions.length === 1 && sessions[0]?.sessionId !== originalSession.sessionId;
      });
    } finally {
      await bufferedSource.terminate();
    }
  });

  it("only requests uncovered gaps when playback spill coverage is partial", async () => {
    const source = new TestSource();
    const sourceRequests: MessageIteratorArgs[] = [];
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 102,
      maxTotalSize: 202,
      spillCache: { sourceId: "test-source" },
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      source.messageIteratorCalls++;
      sourceRequests.push(args);

      const start = args.start ?? { sec: 0, nsec: 0 };
      const end = args.end ?? { sec: 10, nsec: 0 };
      const startNs = toNanoSec(start);
      const endNs = toNanoSec(end);

      for (let i = 0; i <= 9; ++i) {
        const receiveTime = { sec: i, nsec: 0 };
        const receiveTimeNs = toNanoSec(receiveTime);
        if (receiveTimeNs < startNs || receiveTimeNs > endNs) {
          continue;
        }

        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime,
            message: { value: i },
            sizeInBytes: 101,
            schemaName: "foo",
          },
        };
      }
    };

    const loadedSegments: [number, number][] = [
      [0, 1],
      [4, 5],
      [8, 9],
    ];
    for (const [startSec, endSec] of loadedSegments) {
      const iterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: startSec, nsec: 0 },
        end: { sec: endSec, nsec: 0 },
      });
      for await (const result of iterator) {
        if (result.type === "message-event") {
          bufferedSource.setCurrentReadHead(result.msgEvent.receiveTime);
        }
      }
    }
    expect(sourceRequests).toHaveLength(3);

    const iterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 5, nsec: 0 },
    });
    const messages: unknown[] = [];
    for await (const result of iterator) {
      if (result.type === "message-event") {
        messages.push(result.msgEvent.message);
      }
    }

    expect(messages).toEqual([
      { value: 0 },
      { value: 1 },
      { value: 2 },
      { value: 3 },
      { value: 4 },
      { value: 5 },
    ]);
    expect(sourceRequests).toHaveLength(4);
    expect(sourceRequests[3]).toMatchObject({
      start: { sec: 1, nsec: 1 },
      end: { sec: 3, nsec: 999999999 },
    });

    await bufferedSource.terminate();
  });

  it("keeps playback spill ranges isolated by topic fields fingerprint", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 102,
      maxTotalSize: 202,
      spillCache: { sourceId: "test-source" },
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      source.messageIteratorCalls++;
      const fields = args.topics.get("a")?.fields;
      const fieldLabel = fields?.join(",") ?? "all";
      for (let i = 0; i < 4; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: { fieldLabel, value: i },
            sizeInBytes: 101,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const iterator = bufferedSource.messageIterator({
        topics: payloadSelection([{ topic: "a", fields: ["x"] }]),
      });
      for await (const result of iterator) {
        if (result.type === "message-event") {
          bufferedSource.setCurrentReadHead(result.msgEvent.receiveTime);
        }
      }
      expect(source.messageIteratorCalls).toBe(1);
    }

    {
      const iterator = bufferedSource.messageIterator({
        topics: payloadSelection([{ topic: "a", fields: ["y"] }]),
      });
      for await (const result of iterator) {
        if (result.type === "message-event") {
          bufferedSource.setCurrentReadHead(result.msgEvent.receiveTime);
        }
      }
      expect(source.messageIteratorCalls).toBe(2);
    }

    source.messageIterator = async function* messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      source.messageIteratorCalls++;
      const fields = args.topics.get("a")?.fields;
      const fieldLabel = fields?.join(",") ?? "all";
      for (let i = 0; i < 2; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: { fieldLabel, value: i, reloaded: true },
            sizeInBytes: 101,
            schemaName: "foo",
          },
        };
      }
    };

    const iterator = bufferedSource.messageIterator({
      topics: payloadSelection([{ topic: "a", fields: ["x"] }]),
      start: { sec: 0, nsec: 0 },
      end: { sec: 1, nsec: 0 },
    });
    const messages: unknown[] = [];
    for await (const result of iterator) {
      if (result.type === "message-event") {
        messages.push(result.msgEvent.message);
      }
    }

    expect(messages).toEqual([
      { fieldLabel: "x", value: 0, reloaded: true },
      { fieldLabel: "x", value: 1, reloaded: true },
    ]);
    expect(source.messageIteratorCalls).toBe(3);

    await bufferedSource.terminate();
  });

  it("returns backfill messages from playback spill cache after memory eviction", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 102,
      maxTotalSize: 202,
      spillCache: { sourceId: "test-source" },
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      source.messageIteratorCalls++;
      for (let i = 0; i < 8; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: { value: i },
            sizeInBytes: 101,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const iterator = bufferedSource.messageIterator({ topics: mockTopicSelection("a") });
      for await (const result of iterator) {
        if (result.type === "message-event") {
          bufferedSource.setCurrentReadHead(result.msgEvent.receiveTime);
        }
      }
    }

    source.getBackfillMessages = async () => {
      source.getBackfillMessagesCalls++;
      throw new Error("source backfill should not be called when spill cache has the message");
    };
    const spillGetMessagesSpy = jest.spyOn(IndexedDbMessageStore.prototype, "getMessages");
    const spillGetBackfillMessagesSpy = jest.spyOn(
      IndexedDbMessageStore.prototype,
      "getBackfillMessages",
    );

    try {
      const backfill = await bufferedSource.getBackfillMessages({
        topics: mockTopicSelection("a"),
        time: { sec: 1, nsec: 0 },
      });

      expect(backfill).toEqual([
        {
          topic: "a",
          receiveTime: { sec: 1, nsec: 0 },
          message: { value: 1 },
          sizeInBytes: 101,
          schemaName: "foo",
        },
      ]);
      expect(source.getBackfillMessagesCalls).toBe(0);
      expect(spillGetMessagesSpy).not.toHaveBeenCalled();
      expect(spillGetBackfillMessagesSpy).toHaveBeenCalledTimes(1);
    } finally {
      spillGetMessagesSpy.mockRestore();
      spillGetBackfillMessagesSpy.mockRestore();
      await bufferedSource.terminate();
    }
  });

  it("does not use playback spill coverage for complete topic-state fetches", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 102,
      maxTotalSize: 202,
      spillCache: { sourceId: "test-source" },
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      source.messageIteratorCalls++;
      const complete = args.fetchCompleteTopicState === "complete";
      for (let i = 0; i < 3; ++i) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: i, nsec: 0 },
            message: { complete, value: i },
            sizeInBytes: 101,
            schemaName: "foo",
          },
        };
      }
    };

    {
      const iterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 0, nsec: 0 },
        end: { sec: 2, nsec: 0 },
      });
      for await (const result of iterator) {
        if (result.type === "message-event") {
          bufferedSource.setCurrentReadHead(result.msgEvent.receiveTime);
        }
      }
      expect(source.messageIteratorCalls).toBe(1);
    }

    const iterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 2, nsec: 0 },
      fetchCompleteTopicState: "complete",
    });
    const messages: unknown[] = [];
    for await (const result of iterator) {
      if (result.type === "message-event") {
        messages.push(result.msgEvent.message);
      }
    }

    expect(messages).toEqual([
      { complete: true, value: 0 },
      { complete: true, value: 1 },
      { complete: true, value: 2 },
    ]);
    expect(source.messageIteratorCalls).toBe(2);

    await bufferedSource.terminate();
  });

  it("does not call source for complete topic-state fetches when already aborted", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source);
    const abortController = new AbortController();

    await bufferedSource.initialize();

    source.messageIterator = function messageIterator(): AsyncIterableIterator<
      Readonly<IteratorResult>
    > {
      throw new Error("should not read from source");
    };

    abortController.abort();

    const iterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 2, nsec: 0 },
      fetchCompleteTopicState: "complete",
      abortSignal: abortController.signal,
    });

    await expect(iterator.next()).resolves.toEqual({ done: true });
    expect(source.messageIteratorCalls).toBe(0);
  });

  it("finishes complete topic-state fetches when abort makes source throw AbortError", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source);
    const abortController = new AbortController();
    let sourceStarted!: () => void;
    const sourceStartedPromise = new Promise<void>((resolve) => {
      sourceStarted = resolve;
    });

    await bufferedSource.initialize();

    source.messageIterator = function messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      source.messageIteratorCalls++;
      sourceStarted();
      let read = false;
      return {
        async next() {
          if (read) {
            return { done: true, value: undefined };
          }
          read = true;
          await new Promise<void>((resolve) => {
            args.abortSignal?.addEventListener(
              "abort",
              () => {
                resolve();
              },
              { once: true },
            );
          });
          throw new DOMException("signal is aborted without reason", "AbortError");
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    };

    const iterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 2, nsec: 0 },
      fetchCompleteTopicState: "complete",
      abortSignal: abortController.signal,
    });

    const next = iterator.next();
    await sourceStartedPromise;
    abortController.abort();

    await expect(next).resolves.toEqual({ done: true });
    expect(source.messageIteratorCalls).toBe(1);
  });

  it("preserves non-abort errors from complete topic-state fetches", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source);

    await bufferedSource.initialize();

    source.messageIterator = function messageIterator(): AsyncIterableIterator<
      Readonly<IteratorResult>
    > {
      source.messageIteratorCalls++;
      return {
        async next() {
          throw new Error("source failed");
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    };

    const iterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 2, nsec: 0 },
      fetchCompleteTopicState: "complete",
    });

    await expect(iterator.next()).rejects.toThrow("source failed");
    expect(source.messageIteratorCalls).toBe(1);
  });

  it("records playback spill loaded ranges at stamp boundaries", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source" },
    });
    let releaseSource: (() => void) | undefined;

    await bufferedSource.initialize();
    const appendSpy = jest.spyOn(IndexedDbMessageStore.prototype, "append");

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      source.messageIteratorCalls++;
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 0, nsec: 0 },
          message: { value: 0 },
          sizeInBytes: 10,
          schemaName: "foo",
        },
      };
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 1, nsec: 0 },
          message: { value: 1 },
          sizeInBytes: 10,
          schemaName: "foo",
        },
      };
      yield { type: "stamp", stamp: { sec: 2, nsec: 0 } };
      await new Promise<void>((resolve) => {
        releaseSource = resolve;
      });
    };

    const iterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 5, nsec: 0 },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "message-event" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "message-event" },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "stamp", stamp: { sec: 2, nsec: 0 } },
    });
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy.mock.calls[0]?.[0]).toHaveLength(2);
    const estimatedSizeBytes = appendSpy.mock.calls[0]?.[1]?.estimatedSizeBytes;
    expect(estimatedSizeBytes).toHaveLength(2);
    expect(estimatedSizeBytes?.every((size) => size >= 10)).toBe(true);

    const sessions = await getPlaybackSpillSessions();
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.sessionId).toMatch(/^playback-spill:test-source:/);
    expect(session.sourceId).toBe("test-source");
    expect(session).not.toHaveProperty("sourceKey");

    const reader = new IndexedDbMessageStore({
      sessionId: session.sessionId,
      kind: "playback-spill",
    });
    await reader.init();
    const topicFingerprint = (await reader.getSessionMetadata())?.topicFingerprint;
    if (topicFingerprint == undefined) {
      throw new Error("Expected playback spill topic fingerprint to be recorded");
    }
    await expect(reader.getLoadedRanges(topicFingerprint)).resolves.toMatchObject([
      { start: { sec: 0, nsec: 0 }, end: { sec: 2, nsec: 0 } },
    ]);

    await reader.close();
    releaseSource?.();
    await iterator.return?.();
    await bufferedSource.terminate();
    appendSpy.mockRestore();
    await expect(getPlaybackSpillSessions()).resolves.toMatchObject([
      { sessionId: session.sessionId, status: "pending-delete" },
    ]);
  });

  it("does not record a spill range when pruning changed the stored content", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "pruned-range" },
    });
    const revisionSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "getContentRevision")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(1);
    const putRangeSpy = jest.spyOn(IndexedDbMessageStore.prototype, "putLoadedRange");

    source.messageIterator = async function* messageIterator(): AsyncIterableIterator<
      Readonly<IteratorResult>
    > {
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 1, nsec: 0 },
          message: { value: 1 },
          sizeInBytes: 10,
          schemaName: "foo",
        },
      };
    };

    try {
      await bufferedSource.initialize();
      const iterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 0, nsec: 0 },
        end: { sec: 2, nsec: 0 },
      });
      for await (const result of iterator) {
        void result;
      }

      expect(putRangeSpy).not.toHaveBeenCalled();
    } finally {
      await bufferedSource.terminate();
      putRangeSpy.mockRestore();
      revisionSpy.mockRestore();
    }
  });

  it("seals playback spill session on terminate and does not reuse it after reopen", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source" },
    });

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 1, nsec: 0 },
          message: { value: 1 },
          sizeInBytes: 10,
          schemaName: "foo",
        },
      };
    };

    const iterator = bufferedSource.messageIterator({ topics: mockTopicSelection("a") });
    for await (const result of iterator) {
      void result;
      // no-op
    }

    const originalSession = (await getPlaybackSpillSessions())[0];
    if (originalSession == undefined) {
      throw new Error("Expected playback spill session");
    }
    await bufferedSource.terminate();
    await expect(getPlaybackSpillSessions()).resolves.toMatchObject([
      { sessionId: originalSession.sessionId, status: "pending-delete" },
    ]);

    const reopenedSource = new TestSource();
    const reopenedBufferedSource = new CachingIterableSource(reopenedSource, {
      spillCache: { sourceId: "test-source" },
    });
    await reopenedBufferedSource.initialize();
    const reopenedSession = (await getPlaybackSpillSessions()).find(
      (session) => session.status === "active",
    );
    expect(reopenedSession?.sessionId).toBeDefined();
    expect(reopenedSession?.sessionId).not.toBe(originalSession.sessionId);

    reopenedSource.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      reopenedSource.messageIteratorCalls++;
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 1, nsec: 0 },
          message: { value: 2 },
          sizeInBytes: 10,
          schemaName: "foo",
        },
      };
    };

    const reopenedIterator = reopenedBufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      start: { sec: 1, nsec: 0 },
      end: { sec: 1, nsec: 0 },
    });
    await expect(reopenedIterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 1, nsec: 0 },
          message: { value: 2 },
          sizeInBytes: 10,
          schemaName: "foo",
        },
      },
    });
    await expect(reopenedIterator.next()).resolves.toEqual({ done: true });
    expect(reopenedSource.messageIteratorCalls).toBe(1);

    await reopenedBufferedSource.terminate();
  });

  it("touches playback spill sessions from the heartbeat and stops on terminate", async () => {
    jest.useFakeTimers();
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source" },
    });
    const touchSpy = jest.spyOn(IndexedDbMessageStore.prototype, "touchSession");

    try {
      await bufferedSource.initialize();

      await jest.advanceTimersByTimeAsync(30_000);
      expect(touchSpy).toHaveBeenCalledTimes(1);

      await bufferedSource.terminate();
      await jest.advanceTimersByTimeAsync(30_000);
      expect(touchSpy).toHaveBeenCalledTimes(1);
    } finally {
      touchSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it("seals playback spill once without flushing or deleting queued data on terminate", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source" },
    });
    const flushSpy = jest.spyOn(IndexedDbMessageStore.prototype, "flush");
    const deleteSpy = jest.spyOn(IndexedDbMessageStore.prototype, "deleteCurrentSession");
    const discardSpy = jest.spyOn(IndexedDbMessageStore.prototype, "discardAndSeal");

    try {
      await bufferedSource.initialize();
      const firstTerminate = bufferedSource.terminate();
      const secondTerminate = bufferedSource.terminate();

      expect(secondTerminate).toBe(firstTerminate);
      await firstTerminate;
      expect(discardSpy).toHaveBeenCalledTimes(1);
      expect(discardSpy).toHaveBeenCalledWith("pending-delete");
      expect(flushSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
    } finally {
      discardSpy.mockRestore();
      deleteSpy.mockRestore();
      flushSpy.mockRestore();
    }
  });

  it("abandons and closes playback spill when initialization fails", async () => {
    const initSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "init")
      .mockRejectedValueOnce(new Error("init failed"));
    const discardSpy = jest.spyOn(IndexedDbMessageStore.prototype, "discardAndSeal");
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source" },
    });

    try {
      await expect(bufferedSource.initialize()).resolves.toBeDefined();
      expect(discardSpy).toHaveBeenCalledTimes(1);
      expect(discardSpy).toHaveBeenCalledWith("abandoned");
      await bufferedSource.terminate();
      expect(discardSpy).toHaveBeenCalledTimes(1);
      jest.mocked(console.warn).mockClear();
    } finally {
      discardSpy.mockRestore();
      initSpy.mockRestore();
    }
  });

  it("abandons playback spill after an append failure", async () => {
    const appendSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "append")
      .mockRejectedValueOnce(new Error("append failed"));
    const discardSpy = jest.spyOn(IndexedDbMessageStore.prototype, "discardAndSeal");
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source" },
    });

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 1, nsec: 0 },
          message: { value: 1 },
          sizeInBytes: 10,
          schemaName: "foo",
        },
      };
    };

    try {
      await bufferedSource.initialize();
      const iterator = bufferedSource.messageIterator({ topics: mockTopicSelection("a") });
      for await (const result of iterator) {
        void result;
      }

      expect(discardSpy).toHaveBeenCalledTimes(1);
      expect(discardSpy).toHaveBeenCalledWith("abandoned");
      await bufferedSource.terminate();
      expect(discardSpy).toHaveBeenCalledTimes(1);
      jest.mocked(console.warn).mockClear();
    } finally {
      discardSpy.mockRestore();
      appendSpy.mockRestore();
    }
  });

  it("does not recover a playback spill session from an obsolete heartbeat after terminate", async () => {
    jest.useFakeTimers();
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source" },
    });

    let resolveTouchAsNotTouched: (() => void) | undefined;
    const touchSpy = jest.spyOn(IndexedDbMessageStore.prototype, "touchSession").mockImplementation(
      async () =>
        await new Promise<boolean>((resolve) => {
          resolveTouchAsNotTouched = () => {
            resolve(false);
          };
        }),
    );

    try {
      await bufferedSource.initialize();

      await jest.advanceTimersByTimeAsync(30_000);
      expect(touchSpy).toHaveBeenCalledTimes(1);

      const terminatePromise = bufferedSource.terminate();
      resolveTouchAsNotTouched?.();
      await terminatePromise;
      await Promise.resolve();

      const sessions = await getPlaybackSpillSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.status).toBe("pending-delete");
    } finally {
      touchSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it("seals playback spill on pagehide without clearing local ranges", async () => {
    const restoreBrowserEvents = withBrowserEvents();
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source" },
    });
    const discardSpy = jest.spyOn(IndexedDbMessageStore.prototype, "discardAndSeal");

    await bufferedSource.initialize();

    source.messageIterator = async function* messageIterator(
      _args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      source.messageIteratorCalls++;
      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 1, nsec: 0 },
          message: { value: 1 },
          sizeInBytes: 10,
          schemaName: "foo",
        },
      };
    };

    const iterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      start: { sec: 1, nsec: 0 },
      end: { sec: 1, nsec: 0 },
    });
    for await (const result of iterator) {
      void result;
    }
    const rangesBeforePageHide = bufferedSource.loadedRanges();

    try {
      window.dispatchEvent(new Event("pagehide"));
      await waitFor(() => discardSpy.mock.calls.length > 0);
      expect(discardSpy).toHaveBeenCalledWith("pending-delete");
      expect(bufferedSource.loadedRanges()).toEqual(rangesBeforePageHide);
    } finally {
      discardSpy.mockRestore();
      await bufferedSource.terminate();
      restoreBrowserEvents();
    }
  });

  it("keeps playback spill session on bfcache pagehide", async () => {
    const restoreBrowserEvents = withBrowserEvents();
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source" },
    });
    const discardSpy = jest.spyOn(IndexedDbMessageStore.prototype, "discardAndSeal");

    try {
      await bufferedSource.initialize();

      const event = new Event("pagehide") as PageTransitionEvent;
      Object.defineProperty(event, "persisted", {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(event);

      await Promise.resolve();
      expect(discardSpy).not.toHaveBeenCalled();
      await expect(getPlaybackSpillSessions()).resolves.toHaveLength(1);
    } finally {
      discardSpy.mockRestore();
      await bufferedSource.terminate();
      restoreBrowserEvents();
    }
  });

  it("recovers playback spill cache on visible when the session was deleted", async () => {
    const restoreBrowserEvents = withBrowserEvents();
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 102,
      maxTotalSize: 202,
      spillCache: { sourceId: "test-source" },
    });

    try {
      await bufferedSource.initialize();

      source.messageIterator = async function* messageIterator(
        args: MessageIteratorArgs,
      ): AsyncIterableIterator<Readonly<IteratorResult>> {
        source.messageIteratorCalls++;
        const start = args.start?.sec ?? 0;
        const end = args.end?.sec ?? 3;
        for (let i = start; i <= end; ++i) {
          yield {
            type: "message-event",
            msgEvent: {
              topic: "a",
              receiveTime: { sec: i, nsec: 0 },
              message: { value: i, call: source.messageIteratorCalls },
              sizeInBytes: 101,
              schemaName: "foo",
            },
          };
        }
      };

      {
        const iterator = bufferedSource.messageIterator({
          topics: mockTopicSelection("a"),
          start: { sec: 0, nsec: 0 },
          end: { sec: 3, nsec: 0 },
        });
        for await (const result of iterator) {
          if (result.type === "message-event") {
            bufferedSource.setCurrentReadHead(result.msgEvent.receiveTime);
          }
        }
      }
      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0, end: 0.3 }]);
      const originalSession = (await getPlaybackSpillSessions())[0];
      if (originalSession == undefined) {
        throw new Error("Expected playback spill session");
      }

      await deletePlaybackSpillSession(originalSession.sessionId);
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));

      await waitFor(async () => (await getPlaybackSpillSessions()).length === 1);
      const recoveredSession = (await getPlaybackSpillSessions())[0];
      expect(recoveredSession?.sessionId).not.toBe(originalSession.sessionId);
      expect(bufferedSource.loadedRanges()).toEqual([{ start: 0.2, end: 0.3 }]);

      source.messageIteratorCalls = 0;
      const iterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 0, nsec: 0 },
        end: { sec: 1, nsec: 0 },
      });
      const messages: unknown[] = [];
      for await (const result of iterator) {
        if (result.type === "message-event") {
          messages.push(result.msgEvent.message);
        }
      }
      expect(messages).toEqual([
        { value: 0, call: 1 },
        { value: 1, call: 1 },
      ]);
      expect(source.messageIteratorCalls).toBe(1);
    } finally {
      await bufferedSource.terminate();
      restoreBrowserEvents();
    }
  });

  it("does not publish coverage into a replacement spill session for old queued writes", async () => {
    const restoreBrowserEvents = withBrowserEvents();
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 2_000_000,
      maxTotalSize: 2_000_000,
      spillCache: { sourceId: "test-source" },
    });
    let releaseStamp: (() => void) | undefined;
    const waitForStamp = new Promise<void>((resolve) => {
      releaseStamp = resolve;
    });

    try {
      await bufferedSource.initialize();
      source.messageIterator = async function* messageIterator(): AsyncIterableIterator<
        Readonly<IteratorResult>
      > {
        source.messageIteratorCalls++;
        for (let index = 0; index < 1_000; index++) {
          yield {
            type: "message-event",
            msgEvent: {
              topic: "a",
              receiveTime: { sec: 0, nsec: index },
              message: { index },
              sizeInBytes: 1,
              schemaName: "foo",
            },
          };
        }
        await waitForStamp;
        yield { type: "stamp", stamp: { sec: 1, nsec: 0 } };
      };

      const iterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 0, nsec: 0 },
        end: { sec: 1, nsec: 0 },
      });
      for (let index = 0; index < 1_000; index++) {
        await expect(iterator.next()).resolves.toMatchObject({ done: false });
      }

      const originalSession = (await getPlaybackSpillSessions())[0];
      if (originalSession == undefined) {
        throw new Error("Expected playback spill session");
      }
      // Remove only the liveness record so recovery can race the original writer without making
      // this regression test synchronously delete all 1,000 queued/persisted message records.
      await deletePlaybackSpillSessionMetadata(originalSession.sessionId);
      window.dispatchEvent(new Event("pageshow"));
      await waitFor(async () => {
        const sessions = await getPlaybackSpillSessions();
        return sessions.length === 1 && sessions[0]?.sessionId !== originalSession.sessionId;
      });
      const replacementSession = (await getPlaybackSpillSessions())[0];
      if (replacementSession == undefined) {
        throw new Error("Expected replacement playback spill session");
      }

      releaseStamp?.();
      await expect(iterator.next()).resolves.toMatchObject({
        done: false,
        value: { type: "stamp" },
      });
      await expect(iterator.next()).resolves.toEqual({ done: true });

      expect(await getPlaybackSpillLoadedRangeSessionIds()).not.toContain(
        replacementSession.sessionId,
      );
    } finally {
      releaseStamp?.();
      await bufferedSource.terminate();
      restoreBrowserEvents();
      jest.mocked(console.warn).mockClear();
    }
  });

  it("does not reattach an obsolete A iterator to spill after an A to B to A switch", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "topic-generation" },
    });
    let releaseOldIterator: (() => void) | undefined;
    const waitForTopicSwitch = new Promise<void>((resolve) => {
      releaseOldIterator = resolve;
    });
    let firstACall = true;

    source.messageIterator = async function* messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      if (args.topics.has("b")) {
        yield {
          type: "message-event",
          msgEvent: {
            topic: "b",
            receiveTime: { sec: 0, nsec: 0 },
            message: { source: "b" },
            sizeInBytes: 1,
            schemaName: "foo",
          },
        };
        return;
      }

      if (firstACall) {
        firstACall = false;
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: 0, nsec: 0 },
            message: { source: "old-a-before-switch" },
            sizeInBytes: 1,
            schemaName: "foo",
          },
        };
        await waitForTopicSwitch;
        yield { type: "stamp", stamp: { sec: 1, nsec: 0 } };
        yield {
          type: "message-event",
          msgEvent: {
            topic: "a",
            receiveTime: { sec: 2, nsec: 0 },
            message: { source: "old-a-after-switch" },
            sizeInBytes: 1,
            schemaName: "foo",
          },
        };
        return;
      }

      yield {
        type: "message-event",
        msgEvent: {
          topic: "a",
          receiveTime: { sec: 0, nsec: 0 },
          message: { source: "new-a" },
          sizeInBytes: 1,
          schemaName: "foo",
        },
      };
    };

    await bufferedSource.initialize();
    const oldAIterator = bufferedSource.messageIterator({
      topics: mockTopicSelection("a"),
      start: { sec: 0, nsec: 0 },
      end: { sec: 2, nsec: 0 },
    });
    let pendingOldResult: ReturnType<typeof oldAIterator.next> | undefined;

    try {
      await expect(oldAIterator.next()).resolves.toMatchObject({
        done: false,
        value: {
          type: "message-event",
          msgEvent: { message: { source: "old-a-before-switch" } },
        },
      });
      pendingOldResult = oldAIterator.next();

      const bIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("b"),
        start: { sec: 0, nsec: 0 },
        end: { sec: 0, nsec: 0 },
      });
      for await (const result of bIterator) {
        void result;
      }

      const newAIterator = bufferedSource.messageIterator({
        topics: mockTopicSelection("a"),
        start: { sec: 0, nsec: 0 },
        end: { sec: 0, nsec: 0 },
      });
      for await (const result of newAIterator) {
        void result;
      }

      const activeSession = (await getPlaybackSpillSessions()).find(
        (session) => session.status === "active",
      );
      if (activeSession?.topicFingerprint == undefined) {
        throw new Error("Expected active A playback spill session");
      }

      releaseOldIterator?.();
      await expect(pendingOldResult).resolves.toMatchObject({
        done: false,
        value: { type: "stamp" },
      });
      await expect(oldAIterator.next()).resolves.toMatchObject({
        done: false,
        value: {
          type: "message-event",
          msgEvent: { message: { source: "old-a-after-switch" } },
        },
      });
      await expect(oldAIterator.next()).resolves.toEqual({ done: true });

      const reader = new IndexedDbMessageStore({
        sessionId: activeSession.sessionId,
        kind: "playback-spill",
      });
      await reader.init();
      try {
        const messages = await reader.getMessages({
          start: { sec: 0, nsec: 0 },
          end: { sec: 2, nsec: 0 },
        });
        expect(messages.map((message) => message.message)).toEqual([{ source: "new-a" }]);
        await expect(reader.getLoadedRanges(activeSession.topicFingerprint)).resolves.toMatchObject(
          [{ start: { sec: 0, nsec: 0 }, end: { sec: 0, nsec: 0 } }],
        );
      } finally {
        await reader.close();
      }
    } finally {
      releaseOldIterator?.();
      await pendingOldResult?.catch(() => undefined);
      await oldAIterator.return?.();
      await bufferedSource.terminate();
    }
  });

  it("deduplicates concurrent playback spill recovery triggers", async () => {
    const restoreBrowserEvents = withBrowserEvents();
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source" },
    });

    try {
      await bufferedSource.initialize();

      const originalSession = (await getPlaybackSpillSessions())[0];
      if (originalSession == undefined) {
        throw new Error("Expected playback spill session");
      }
      await deletePlaybackSpillSession(originalSession.sessionId);

      window.dispatchEvent(new Event("pageshow"));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));

      await waitFor(async () => {
        const sessions = await getPlaybackSpillSessions();
        return sessions.length === 1 && sessions[0]?.sessionId !== originalSession.sessionId;
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      const sessions = await getPlaybackSpillSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.sessionId).not.toBe(originalSession.sessionId);
    } finally {
      await bufferedSource.terminate();
      restoreBrowserEvents();
    }
  });
});
