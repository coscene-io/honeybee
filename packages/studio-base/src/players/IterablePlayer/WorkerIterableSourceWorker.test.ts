// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessageEvent } from "@foxglove/studio";
import { mockTopicSelection } from "@foxglove/studio-base/test/mocks/mockTopicSelection";

import {
  GetBackfillMessagesArgs,
  IIterableSource,
  ISerializedIterableSource,
  Initalization,
  IteratorResult,
  MessageIteratorArgs,
} from "./IIterableSource";
import { WorkerIterableSourceWorker } from "./WorkerIterableSourceWorker";
import { WorkerSerializedIterableSourceWorker } from "./WorkerSerializedIterableSourceWorker";

class TestSource implements IIterableSource {
  public messageIteratorArgs: MessageIteratorArgs | undefined;

  public async initialize(): Promise<Initalization> {
    return {
      start: { sec: 0, nsec: 0 },
      end: { sec: 1, nsec: 0 },
      topics: [],
      topicStats: new Map(),
      profile: undefined,
      problems: [],
      datatypes: new Map(),
      publishersByTopic: new Map(),
    };
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    this.messageIteratorArgs = args;
    yield* [];
  }

  public async getBackfillMessages(_args: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    return [];
  }
}

class TestSerializedSource implements ISerializedIterableSource {
  public readonly sourceType = "serialized";
  public messageIteratorArgs: MessageIteratorArgs | undefined;

  public async initialize(): Promise<Initalization> {
    return {
      start: { sec: 0, nsec: 0 },
      end: { sec: 1, nsec: 0 },
      topics: [],
      topicStats: new Map(),
      profile: undefined,
      problems: [],
      datatypes: new Map(),
      publishersByTopic: new Map(),
    };
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> {
    this.messageIteratorArgs = args;
    yield* [];
  }

  public async getBackfillMessages(
    _args: GetBackfillMessagesArgs,
  ): Promise<MessageEvent<Uint8Array>[]> {
    return [];
  }
}

describe("WorkerIterableSourceWorker", () => {
  it("passes the cursor abort signal to the source message iterator args", async () => {
    const source = new TestSource();
    const worker = new WorkerIterableSourceWorker(source);
    const abortController = new AbortController();

    const cursor = worker.getMessageCursor(
      {
        topics: mockTopicSelection("a"),
        start: { sec: 0, nsec: 0 },
      },
      abortController.signal,
    );
    await cursor.next();

    expect(source.messageIteratorArgs?.abortSignal).toBe(abortController.signal);
  });
});

describe("WorkerSerializedIterableSourceWorker", () => {
  it("passes the cursor abort signal to the serialized source message iterator args", async () => {
    const source = new TestSerializedSource();
    const worker = new WorkerSerializedIterableSourceWorker(source);
    const abortController = new AbortController();

    const cursor = worker.getMessageCursor(
      {
        topics: mockTopicSelection("a"),
        start: { sec: 0, nsec: 0 },
      },
      abortController.signal,
    );
    await cursor.next();

    expect(source.messageIteratorArgs?.abortSignal).toBe(abortController.signal);
  });
});
