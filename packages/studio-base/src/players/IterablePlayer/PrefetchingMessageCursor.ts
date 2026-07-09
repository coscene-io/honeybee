// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@foxglove/studio";

import type { IMessageCursor, IteratorResult } from "./IIterableSource";

type CursorMode = "batch" | "direct";

/**
 * Wraps a message cursor and keeps one nextBatch call in flight.
 *
 * Worker-backed cursors otherwise only start loading the next batch after the main thread asks for it.
 * Prefetching overlaps worker/network reads with main-thread processing of the current batch.
 */
export class PrefetchingMessageCursor<MessageType = unknown>
  implements IMessageCursor<MessageType>
{
  #cursor: IMessageCursor<MessageType>;
  #pendingBatch?: Promise<IteratorResult<MessageType>[] | undefined>;
  #batchDurationMs?: number;
  #mode?: CursorMode;

  public constructor(cursor: IMessageCursor<MessageType>) {
    this.#cursor = cursor;
  }

  public async next(): ReturnType<IMessageCursor<MessageType>["next"]> {
    this.#enterDirectMode();
    return await this.#cursor.next();
  }

  public async nextBatch(durationMs: number): ReturnType<IMessageCursor<MessageType>["nextBatch"]> {
    this.#enterBatchMode(durationMs);

    const pendingBatch = this.#pendingBatch;
    this.#pendingBatch = undefined;

    const batch = pendingBatch ? await pendingBatch : await this.#cursor.nextBatch(durationMs);
    if (batch != undefined && batch.length > 0) {
      this.#pendingBatch = this.#cursor.nextBatch(durationMs);
      void this.#pendingBatch.catch(() => {
        // The next nextBatch call will observe this error. This catch only prevents an unhandled
        // rejection if the caller ends the cursor before consuming the prefetched batch.
      });
    }

    return batch;
  }

  public async readUntil(end: Time): ReturnType<IMessageCursor<MessageType>["readUntil"]> {
    this.#enterDirectMode();
    return await this.#cursor.readUntil(end);
  }

  public async end(): ReturnType<IMessageCursor<MessageType>["end"]> {
    const pendingBatch = this.#pendingBatch;
    this.#pendingBatch = undefined;
    try {
      await pendingBatch?.catch(() => undefined);
    } finally {
      await this.#cursor.end();
    }
  }

  #enterBatchMode(durationMs: number): void {
    if (this.#mode === "direct") {
      throw new Error("Cannot mix direct cursor reads with nextBatch on the same cursor");
    }
    if (this.#batchDurationMs != undefined && this.#batchDurationMs !== durationMs) {
      throw new Error(`Batch duration changed mid-stream: ${this.#batchDurationMs} -> ${durationMs}`);
    }

    this.#mode = "batch";
    this.#batchDurationMs = durationMs;
  }

  #enterDirectMode(): void {
    if (this.#mode === "batch") {
      throw new Error("Cannot mix nextBatch with direct cursor reads on the same cursor");
    }

    this.#mode = "direct";
  }
}
