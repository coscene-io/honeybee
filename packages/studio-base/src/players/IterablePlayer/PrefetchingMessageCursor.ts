// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { add as addTime, compare } from "@foxglove/rostime";
import { Time } from "@foxglove/studio";

import type { IMessageCursor, IteratorResult } from "./IIterableSource";

type PendingBatchResult<MessageType> =
  | { status: "none" }
  | { durationMs: number; status: "done" | "empty" }
  | { batch: IteratorResult<MessageType>[]; durationMs: number; status: "data" };

/**
 * Wraps a message cursor and keeps one nextBatch call in flight.
 *
 * Worker-backed cursors otherwise only start loading the next batch after the main thread asks for it.
 * Prefetching overlaps worker/network reads with main-thread processing of the current batch.
 */
export class PrefetchingMessageCursor<
  MessageType = unknown,
> implements IMessageCursor<MessageType> {
  #cursor: IMessageCursor<MessageType>;
  #pendingBatch?: {
    durationMs: number;
    promise: Promise<IteratorResult<MessageType>[] | undefined>;
  };
  #bufferedResults: IteratorResult<MessageType>[] = [];

  public constructor(cursor: IMessageCursor<MessageType>) {
    this.#cursor = cursor;
  }

  public async next(): ReturnType<IMessageCursor<MessageType>["next"]> {
    const buffered = await this.#shiftBufferedResult();
    if (buffered.hasBufferedResult) {
      return buffered.result;
    }

    return await this.#cursor.next();
  }

  public async nextBatch(durationMs: number): ReturnType<IMessageCursor<MessageType>["nextBatch"]> {
    const hadBufferedResults = this.#bufferedResults.length > 0;
    const pendingBatch =
      this.#pendingBatch == undefined
        ? { status: "none" as const }
        : await this.#consumePendingBatch();

    let batch: IteratorResult<MessageType>[] | undefined;
    let exhausted = pendingBatch.status === "done";
    if (
      pendingBatch.status === "data" &&
      pendingBatch.durationMs === durationMs &&
      !hadBufferedResults
    ) {
      batch = pendingBatch.batch;
    } else {
      this.#bufferPendingBatch(pendingBatch);
    }

    if (batch == undefined) {
      if (this.#bufferedResults.length > 0) {
        ({ batch, exhausted } = await this.#readBatchFromBufferedResults(durationMs));
      } else if (pendingBatch.status === "done") {
        batch = undefined;
      } else if (pendingBatch.status === "empty") {
        batch = [];
      } else {
        batch = await this.#cursor.nextBatch(durationMs);
        exhausted = batch == undefined;
      }
    }

    if (!exhausted && batch != undefined && batch.length > 0) {
      this.#prefetch(durationMs);
    }

    return batch;
  }

  public async readUntil(end: Time): ReturnType<IMessageCursor<MessageType>["readUntil"]> {
    this.#bufferPendingBatch(await this.#consumePendingBatch());

    const results: IteratorResult<MessageType>[] = [];
    while (this.#bufferedResults.length > 0) {
      const result = this.#bufferedResults[0]!;
      if (this.#isReadUntilBoundary(result, end)) {
        return results;
      }
      results.push(this.#bufferedResults.shift()!);
    }

    const remainingResults = await this.#cursor.readUntil(end);
    if (remainingResults == undefined) {
      return results.length === 0 ? undefined : results;
    }

    return results.concat(remainingResults);
  }

  public async end(): ReturnType<IMessageCursor<MessageType>["end"]> {
    const pendingBatch = this.#pendingBatch;
    this.#pendingBatch = undefined;
    this.#bufferedResults = [];
    void pendingBatch?.promise.catch(() => {
      // Prevent an unhandled rejection if the prefetch completes after the cursor has been ended.
    });
    await this.#cursor.end();
  }

  async #consumePendingBatch(): Promise<PendingBatchResult<MessageType>> {
    const pendingBatch = this.#pendingBatch;
    if (pendingBatch == undefined) {
      return { status: "none" };
    }

    this.#pendingBatch = undefined;
    const batch = await pendingBatch.promise;
    if (batch == undefined) {
      return { durationMs: pendingBatch.durationMs, status: "done" };
    }
    if (batch.length === 0) {
      return { durationMs: pendingBatch.durationMs, status: "empty" };
    }

    return { batch, durationMs: pendingBatch.durationMs, status: "data" };
  }

  #bufferPendingBatch(pendingBatch: PendingBatchResult<MessageType>): void {
    if (pendingBatch.status === "data") {
      this.#bufferedResults.push(...pendingBatch.batch);
    }
  }

  async #shiftBufferedResult(): Promise<{
    hasBufferedResult: boolean;
    result: IteratorResult<MessageType> | undefined;
  }> {
    if (this.#bufferedResults.length > 0) {
      return { hasBufferedResult: true, result: this.#bufferedResults.shift() };
    }

    const pendingBatch = await this.#consumePendingBatch();
    this.#bufferPendingBatch(pendingBatch);
    if (this.#bufferedResults.length > 0) {
      return { hasBufferedResult: true, result: this.#bufferedResults.shift() };
    }
    if (pendingBatch.status === "done") {
      return { hasBufferedResult: true, result: undefined };
    }

    return { hasBufferedResult: false, result: undefined };
  }

  async #readBatchFromBufferedResults(durationMs: number): Promise<{
    batch: IteratorResult<MessageType>[] | undefined;
    exhausted: boolean;
  }> {
    const firstResult = this.#bufferedResults.shift() ?? (await this.#cursor.next());
    if (firstResult == undefined) {
      return { batch: undefined, exhausted: true };
    }

    const batch: IteratorResult<MessageType>[] = [firstResult];
    if (firstResult.type === "problem") {
      return { batch, exhausted: false };
    }

    const cutoffTime =
      firstResult.type === "stamp"
        ? addTime(firstResult.stamp, { sec: 0, nsec: durationMs * 1e6 })
        : addTime(firstResult.msgEvent.receiveTime, { sec: 0, nsec: durationMs * 1e6 });

    for (;;) {
      const result = this.#bufferedResults.shift() ?? (await this.#cursor.next());
      if (result == undefined) {
        return { batch, exhausted: true };
      }

      batch.push(result);
      if (this.#isBatchBoundary(result, cutoffTime)) {
        return { batch, exhausted: false };
      }
    }
  }

  #prefetch(durationMs: number): void {
    const promise = this.#cursor.nextBatch(durationMs);
    this.#pendingBatch = { durationMs, promise };
    void promise.catch(() => {
      // The next read will observe this error. This catch only prevents an unhandled rejection if
      // the caller ends the cursor before consuming the prefetched batch.
    });
  }

  #isBatchBoundary(result: IteratorResult<MessageType>, cutoffTime: Time): boolean {
    if (result.type === "problem") {
      return true;
    }
    if (result.type === "stamp") {
      return compare(result.stamp, cutoffTime) > 0;
    }
    return compare(result.msgEvent.receiveTime, cutoffTime) > 0;
  }

  #isReadUntilBoundary(result: IteratorResult<MessageType>, end: Time): boolean {
    if (result.type === "stamp") {
      return compare(result.stamp, end) >= 0;
    }
    if (result.type === "message-event") {
      return compare(result.msgEvent.receiveTime, end) > 0;
    }
    return false;
  }
}
