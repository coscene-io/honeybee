// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { compare, Time } from "@foxglove/rostime";
import { IteratorResult } from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";

// k-way merge across N async iterators of IteratorResult, ordered by `logTime`.
//
// - "message-event" results sort by msgEvent.receiveTime.
// - "stamp" results sort by stamp.
// - "problem" results have no time; they are emitted before the next message
//   from the same iterator.
// - Tie-break on simultaneous timestamps is by stable iterator index.
//
// On AbortSignal, all iterators are explicitly returned/closed and the
// generator finishes.

const EXHAUSTED = Symbol("exhausted");

type IteratorEntry<T> = {
  index: number;
  iterator: AsyncIterator<Readonly<IteratorResult<T>>>;
  // Buffered next result. undefined = no value loaded yet, EXHAUSTED = done.
  buffered: Readonly<IteratorResult<T>> | typeof EXHAUSTED | undefined;
};

function timeOf<T>(result: IteratorResult<T>): Time | undefined {
  if (result.type === "message-event") {
    return result.msgEvent.receiveTime;
  }
  if (result.type === "stamp") {
    return result.stamp;
  }
  return undefined;
}

export async function* mergeShards<T>(
  iterators: AsyncIterator<Readonly<IteratorResult<T>>>[],
  abortSignal?: AbortSignal,
): AsyncIterableIterator<Readonly<IteratorResult<T>>> {
  if (iterators.length === 0) {
    return;
  }

  const entries: IteratorEntry<T>[] = iterators.map((iterator, index) => ({
    index,
    iterator,
    buffered: undefined,
  }));

  const advance = async (entry: IteratorEntry<T>): Promise<void> => {
    const next = await entry.iterator.next();
    if (next.done === true) {
      entry.buffered = EXHAUSTED;
      return;
    }
    // Always queue problem results immediately — they get yielded out-of-band.
    entry.buffered = next.value;
  };

  try {
    // Prime all entries.
    for (const entry of entries) {
      if (abortSignal?.aborted === true) {
        return;
      }
      await advance(entry);
    }

    for (;;) {
      if (abortSignal?.aborted === true) {
        return;
      }

      // Drain any buffered "problem" results first — they have no logTime.
      let drainedProblem = false;
      for (const entry of entries) {
        if (
          entry.buffered != undefined &&
          entry.buffered !== EXHAUSTED &&
          entry.buffered.type === "problem"
        ) {
          yield entry.buffered;
          await advance(entry);
          drainedProblem = true;
        }
      }
      if (drainedProblem) {
        continue;
      }

      // Find the entry with the smallest logTime.
      let bestIdx = -1;
      let bestTime: Time | undefined;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e?.buffered == undefined || e.buffered === EXHAUSTED) {
          continue;
        }
        const t = timeOf(e.buffered);
        if (t == undefined) {
          // shouldn't happen — problems drained above
          continue;
        }
        if (bestTime == undefined || compare(t, bestTime) < 0) {
          bestIdx = i;
          bestTime = t;
        }
      }
      if (bestIdx === -1) {
        return; // all iterators exhausted
      }
      const winner = entries[bestIdx]!;
      const value = winner.buffered!;
      if (value === EXHAUSTED) {
        return;
      }
      yield value;
      await advance(winner);
    }
  } finally {
    // Ensure iterators are closed.
    for (const entry of entries) {
      try {
        await entry.iterator.return?.();
      } catch {
        // best-effort
      }
    }
  }
}
