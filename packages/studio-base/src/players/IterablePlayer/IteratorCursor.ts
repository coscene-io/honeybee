// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { compare, add as addTime } from "@foxglove/rostime";
import { Time } from "@foxglove/studio";

import type { IMessageCursor, IteratorResult } from "./IIterableSource";

const TIME_ZERO = Object.freeze({ sec: 0, nsec: 0 });

/// IteratorCursor implements a IMessageCursor interface on top of an AsyncIterable
class IteratorCursor<MessageType = unknown> implements IMessageCursor<MessageType> {
  #iter: AsyncIterableIterator<Readonly<IteratorResult<MessageType>>>;
  // readUntil reads from the iterator inclusive of end time. To do this, it reads from the iterator
  // until it receives a receiveTime after end time to signal it has received all the messages
  // inclusive of end time. Since iterators are read once, this last result must be stored for the
  // next readUntil call otherwise it would be lost.
  #lastIteratorResult?: IteratorResult<MessageType>;
  #abort?: AbortSignal;
  // Set once the underlying iterator has been finalized (its return() invoked). Finalization
  // happens on end(), on the abort signal firing, or on a read that observes an already-aborted
  // signal, whichever comes first.
  #finalized?: Promise<void>;
  // The abort listener registered by this cursor, kept so it can be detached once finalization
  // happens for any reason. Without this, a cursor that ends normally (never aborts) would stay
  // attached to a long-lived, externally-reused AbortSignal for as long as that signal lives —
  // e.g. BlockLoader shares one controller across many sequential cursors.
  #abortListener?: () => void;

  public constructor(
    iterator: AsyncIterableIterator<Readonly<IteratorResult<MessageType>>>,
    abort?: AbortSignal,
  ) {
    this.#iter = iterator;
    this.#abort = abort;

    // Finalize proactively so cleanup does not depend on the caller polling next/nextBatch/
    // readUntil again after aborting. The read-time aborted checks below remain as a fast path
    // and to cover a signal that was already aborted before this cursor was constructed (the
    // "abort" event only fires at the moment abort() is called, so a listener added afterward
    // would never see it).
    if (abort?.aborted === true) {
      void this.#finalize();
    } else if (abort) {
      this.#abortListener = () => void this.#finalize();
      abort.addEventListener("abort", this.#abortListener, { once: true });
    }
  }

  public async next(): ReturnType<IMessageCursor<MessageType>["next"]> {
    if (this.#abort?.aborted === true) {
      await this.#finalize();
      return undefined;
    }

    const result = await this.#iter.next();
    return result.value;
  }

  public async nextBatch(durationMs: number): Promise<IteratorResult<MessageType>[] | undefined> {
    const firstResult = await this.next();
    if (!firstResult) {
      return undefined;
    }

    if (firstResult.type === "problem") {
      return [firstResult];
    }

    const results: IteratorResult<MessageType>[] = [firstResult];

    let cutoffTime: Time = TIME_ZERO;
    switch (firstResult.type) {
      case "stamp":
        cutoffTime = addTime(firstResult.stamp, { sec: 0, nsec: durationMs * 1e6 });
        break;
      case "message-event":
        cutoffTime = addTime(firstResult.msgEvent.receiveTime, { sec: 0, nsec: durationMs * 1e6 });
        break;
    }

    for (;;) {
      const result = await this.next();
      if (!result) {
        return results;
      }

      results.push(result);

      if (result.type === "problem") {
        break;
      }
      if (result.type === "stamp" && compare(result.stamp, cutoffTime) > 0) {
        break;
      }
      if (result.type === "message-event" && compare(result.msgEvent.receiveTime, cutoffTime) > 0) {
        break;
      }
    }
    return results;
  }

  public async readUntil(end: Time): ReturnType<IMessageCursor<MessageType>["readUntil"]> {
    // Assign to a variable to fool typescript control flow analysis which does not understand
    // that this value could change after the _await_
    const isAborted = this.#abort?.aborted;
    if (isAborted === true) {
      await this.#finalize();
      return undefined;
    }

    const results: IteratorResult<MessageType>[] = [];

    // if the last result is still past end time, return empty results
    if (
      this.#lastIteratorResult?.type === "stamp" &&
      compare(this.#lastIteratorResult.stamp, end) >= 0
    ) {
      return results;
    }

    if (
      this.#lastIteratorResult?.type === "message-event" &&
      compare(this.#lastIteratorResult.msgEvent.receiveTime, end) > 0
    ) {
      return results;
    }

    if (this.#lastIteratorResult) {
      results.push(this.#lastIteratorResult);
      this.#lastIteratorResult = undefined;
    }

    for (;;) {
      const result = await this.#iter.next();
      if (this.#abort?.aborted === true) {
        await this.#finalize();
        return undefined;
      }

      if (result.done === true) {
        break;
      }

      const value = result.value;
      if (value.type === "stamp" && compare(value.stamp, end) >= 0) {
        this.#lastIteratorResult = value;
        break;
      }
      if (value.type === "message-event" && compare(value.msgEvent.receiveTime, end) > 0) {
        this.#lastIteratorResult = value;
        break;
      }
      results.push(value);
    }

    return results;
  }

  public async end(): ReturnType<IMessageCursor<MessageType>["end"]> {
    await this.#finalize();
  }

  // Invoke the underlying iterator's return() exactly once so its cleanup (finally blocks) runs
  // even when callers never call end() after an abort. Memoizing the promise keeps concurrent
  // callers awaiting the same return() invocation. Best-effort: rejections are swallowed since
  // callers finalizing an aborted or ended cursor have no use for cleanup errors.
  async #finalize(): Promise<void> {
    if (this.#abortListener) {
      this.#abort?.removeEventListener("abort", this.#abortListener);
      this.#abortListener = undefined;
    }

    this.#finalized ??= (async () => {
      try {
        await this.#iter.return?.();
      } catch {
        // ignore cleanup errors
      }
    })();
    await this.#finalized;
  }
}

export { IteratorCursor };
