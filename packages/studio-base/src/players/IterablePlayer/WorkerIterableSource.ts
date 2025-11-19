// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { abortSignalTransferHandler } from "@foxglove/comlink-transfer-handlers";
import { ComlinkWrap } from "@foxglove/den/worker";
import { Immutable, MessageEvent, Time } from "@foxglove/studio";

import type {
  GetBackfillMessagesArgs,
  IMessageCursor,
  Initalization,
  IteratorResult,
  MessageIteratorArgs,
  IterableSourceInitializeArgs,
  IDeserializedIterableSource,
} from "./IIterableSource";
import type { WorkerIterableSourceWorker } from "./WorkerIterableSourceWorker";

Comlink.transferHandlers.set("abortsignal", abortSignalTransferHandler);

type ConstructorArgs = {
  initWorker: () => Worker;
  initArgs: IterableSourceInitializeArgs;
};

export class WorkerIterableSource implements IDeserializedIterableSource {
  readonly #args: ConstructorArgs;

  #sourceWorkerRemote?: Comlink.Remote<WorkerIterableSourceWorker>;
  #disposeRemote?: () => void;

  public readonly sourceType = "deserialized";

  public constructor(args: ConstructorArgs) {
    this.#args = args;
  }

  public async initialize(): Promise<Initalization> {
    this.#disposeRemote?.();

    // Note: this launches the worker.
    const worker = this.#args.initWorker();

    const { remote: initializeWorker, dispose } =
      ComlinkWrap<
        (args: IterableSourceInitializeArgs) => Comlink.Remote<WorkerIterableSourceWorker>
      >(worker);

    this.#disposeRemote = dispose;
    this.#sourceWorkerRemote = await initializeWorker(this.#args.initArgs);
    return await this.#sourceWorkerRemote.initialize();
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    if (this.#sourceWorkerRemote == undefined) {
      throw new Error(`WorkerIterableSource is not initialized`);
    }

    const cursor = this.getMessageCursor(args);
    try {
      for (;;) {
        // We previously used 17ms batches (roughly one 60fps frame) so each fetch could feed a frame,
        // but profiling showed each Comlink round trip costs ~6-15ms regardless of payload size.
        // Pulling ~100ms per batch trades a bit more latency for ~6x fewer worker round trips,
        // significantly reducing time lost to cross-thread overhead while still returning data fast enough
        // for playback and preloading consumers. With the same 6-15ms per-call cost but 5-6x more payload per call,
        // our downstream consumers see roughly 2x higher effective throughput even though the per-batch latency grew modestly.
        const results = await cursor.nextBatch(100 /* milliseconds */);
        if (!results || results.length === 0) {
          break;
        }
        yield* results;
      }
    } finally {
      await cursor.end();
    }
  }

  public async getBackfillMessages(args: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    if (this.#sourceWorkerRemote == undefined) {
      throw new Error(`WorkerIterableSource is not initialized`);
    }

    // An AbortSignal is not clonable, so we remove it from the args and send it as a separate argumet
    // to our worker getBackfillMessages call. Our installed Comlink handler for AbortSignal handles
    // making the abort signal available within the worker.
    const { abortSignal, ...rest } = args;
    return await this.#sourceWorkerRemote.getBackfillMessages(rest, abortSignal);
  }

  public getMessageCursor(
    args: Immutable<MessageIteratorArgs & { abort?: AbortSignal }>,
  ): IMessageCursor {
    if (this.#sourceWorkerRemote == undefined) {
      throw new Error(`WorkerIterableSource is not initialized`);
    }

    // An AbortSignal is not clonable, so we remove it from the args and send it as a separate argumet
    // to our worker getBackfillMessages call. Our installed Comlink handler for AbortSignal handles
    // making the abort signal available within the worker.
    const { abort, ...rest } = args;
    const messageCursorPromise = this.#sourceWorkerRemote.getMessageCursor(rest, abort);

    const cursor: IMessageCursor = {
      async next() {
        const messageCursor = await messageCursorPromise;
        return await messageCursor.next();
      },

      async nextBatch(durationMs: number) {
        const messageCursor = await messageCursorPromise;
        return await messageCursor.nextBatch(durationMs);
      },

      async readUntil(end: Time) {
        const messageCursor = await messageCursorPromise;
        return await messageCursor.readUntil(end);
      },

      async end() {
        const messageCursor = await messageCursorPromise;
        try {
          await messageCursor.end();
        } finally {
          messageCursor[Comlink.releaseProxy]();
        }
      },
    };

    return cursor;
  }

  public async terminate(): Promise<void> {
    await this.#sourceWorkerRemote?.terminate();
    this.#disposeRemote?.();
    // shouldn't normally have to do this, but if `initialize` is called after again we don't want
    // to reuse the old remote
    this.#disposeRemote = undefined;
    this.#sourceWorkerRemote = undefined;
  }
}
