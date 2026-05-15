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
  const db = await IDB.openDB("studio-realtime-cache");
  try {
    const tx = db.transaction("sessions", "readonly");
    const sessions = (await tx.objectStore("sessions").getAll()) as CacheSessionMetadata[];
    await tx.done;
    return sessions.filter((session) => session.kind === "playback-spill");
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
      spillCache: { sourceId: "test-source", sourceKey: "same-topics" },
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

  it("records empty playback spill ranges so empty re-reads do not call the source", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source", sourceKey: "empty-range" },
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

  it("falls back to source when a stale spill range points at a deleted session", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      maxBlockSize: 102,
      maxTotalSize: 202,
      spillCache: { sourceId: "test-source", sourceKey: "deleted-session-read" },
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
      spillCache: { sourceId: "test-source", sourceKey: "partial-coverage" },
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
      spillCache: { sourceId: "test-source", sourceKey: "field-fingerprint" },
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
      spillCache: { sourceId: "test-source", sourceKey: "backfill" },
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
      spillCache: { sourceId: "test-source", sourceKey: "complete-topic-state" },
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

  it("records playback spill loaded ranges at stamp boundaries", async () => {
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source", sourceKey: "stamp-boundary" },
    });
    let releaseSource: (() => void) | undefined;

    await bufferedSource.initialize();

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

    const sessions = await getPlaybackSpillSessions();
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.sessionId).toMatch(/^playback-spill:test-source:/);
    expect(session.sourceId).toBe("test-source");
    expect(session.sourceKey).toBe("stamp-boundary");

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
    await expect(getPlaybackSpillSessions()).resolves.toEqual([]);
  });

  it("deletes playback spill session on terminate and does not reuse it after reopen", async () => {
    const source = new TestSource();
    const sourceKey = "reopen";
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source", sourceKey },
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

    await bufferedSource.terminate();
    await expect(getPlaybackSpillSessions()).resolves.toEqual([]);

    const reopenedSource = new TestSource();
    const reopenedBufferedSource = new CachingIterableSource(reopenedSource, {
      spillCache: { sourceId: "test-source", sourceKey },
    });
    await reopenedBufferedSource.initialize();

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
      spillCache: { sourceId: "test-source", sourceKey: "heartbeat" },
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

  it("does not recover a playback spill session from an obsolete heartbeat after terminate", async () => {
    jest.useFakeTimers();
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source", sourceKey: "heartbeat-terminate-race" },
    });

    let resolveTouch: ((value: boolean) => void) | undefined;
    const touchSpy = jest
      .spyOn(IndexedDbMessageStore.prototype, "touchSession")
      .mockImplementation(
        async () =>
          await new Promise<boolean>((resolve) => {
            resolveTouch = resolve;
          }),
      );

    try {
      await bufferedSource.initialize();

      await jest.advanceTimersByTimeAsync(30_000);
      expect(touchSpy).toHaveBeenCalledTimes(1);

      const terminatePromise = bufferedSource.terminate();
      resolveTouch?.(false);
      await terminatePromise;
      await Promise.resolve();

      await expect(getPlaybackSpillSessions()).resolves.toEqual([]);
    } finally {
      touchSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it("runs best-effort playback spill cleanup on pagehide without clearing local ranges", async () => {
    const restoreBrowserEvents = withBrowserEvents();
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source", sourceKey: "pagehide" },
    });
    const deleteSpy = jest.spyOn(IndexedDbMessageStore.prototype, "deleteCurrentSession");

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
      await waitFor(() => deleteSpy.mock.calls.length > 0);
      expect(bufferedSource.loadedRanges()).toEqual(rangesBeforePageHide);
    } finally {
      deleteSpy.mockRestore();
      await bufferedSource.terminate();
      restoreBrowserEvents();
    }
  });

  it("keeps playback spill session on bfcache pagehide", async () => {
    const restoreBrowserEvents = withBrowserEvents();
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source", sourceKey: "pagehide-bfcache" },
    });
    const deleteSpy = jest.spyOn(IndexedDbMessageStore.prototype, "deleteCurrentSession");

    try {
      await bufferedSource.initialize();

      const event = new Event("pagehide") as PageTransitionEvent;
      Object.defineProperty(event, "persisted", {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(event);

      await Promise.resolve();
      expect(deleteSpy).not.toHaveBeenCalled();
      await expect(getPlaybackSpillSessions()).resolves.toHaveLength(1);
    } finally {
      deleteSpy.mockRestore();
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
      spillCache: { sourceId: "test-source", sourceKey: "visible-recovery" },
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

  it("deduplicates concurrent playback spill recovery triggers", async () => {
    const restoreBrowserEvents = withBrowserEvents();
    const source = new TestSource();
    const bufferedSource = new CachingIterableSource(source, {
      spillCache: { sourceId: "test-source", sourceKey: "dedupe-recovery" },
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
