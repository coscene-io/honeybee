// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Global concurrency limit for H.264/H.265 seek keyframe lookback **range reads**.
 *
 * Multi-camera layouts (e.g. 5 Image panels) each start a lookback on seek. Without a gate,
 * concurrent range reads contend for the browser's per-origin HTTP connection pool and for
 * remote shard readers, causing seek jank. Limiting concurrent reads keeps early cameras
 * responsive while others queue.
 *
 * Scope note (REI-125 review): the gate deliberately covers only the network range read, **not**
 * WebCodecs decode/display. Decode runs on a separate worker/hardware path and is not a contended
 * resource, so holding a slot across it only serialized cameras 3-5 for no benefit (measured
 * ~2.6 s of aggregate queue wait with no wall-clock win). Retry backoff sleeps are likewise
 * outside the slot.
 *
 * REI-125: Astribot S1 public share-manifest has 5 concurrent video panels.
 */
export const DEFAULT_VIDEO_SEEK_LOOKBACK_CONCURRENCY = 2;

/** Outcome handed to a queued waiter: it either got the slot or was dropped as superseded. */
type WaiterOutcome = "acquired" | "dropped";

type Waiter = {
  resolve: (outcome: WaiterOutcome) => void;
  reject: (error: Error) => void;
  /**
   * Optional liveness predicate. Evaluated when a slot frees: a waiter whose work has been
   * superseded (e.g. a newer seek) is dropped and the slot passes to the next live waiter,
   * so stale entries cannot head-of-line block the queue.
   */
  isStillNeeded?: () => boolean;
};

export class VideoSeekLookbackGate {
  readonly #maxConcurrent: number;
  #active = 0;
  readonly #waiters: Waiter[] = [];

  public constructor(maxConcurrent: number = DEFAULT_VIDEO_SEEK_LOOKBACK_CONCURRENCY) {
    if (maxConcurrent < 1) {
      throw new Error("VideoSeekLookbackGate maxConcurrent must be >= 1");
    }
    this.#maxConcurrent = maxConcurrent;
  }

  public getActiveCount(): number {
    return this.#active;
  }

  public getPendingCount(): number {
    return this.#waiters.length;
  }

  public getMaxConcurrent(): number {
    return this.#maxConcurrent;
  }

  /**
   * Try to take a slot without waiting. Returns true if acquired (caller must `release()`).
   * Prefer this on the hot path so seek lookback can start synchronously when under the limit.
   */
  public tryAcquire(): boolean {
    if (this.#active < this.#maxConcurrent) {
      this.#active += 1;
      return true;
    }
    return false;
  }

  /**
   * Acquire a lookback slot, waiting if necessary. Prefer `tryAcquire()` first to avoid an
   * unnecessary microtask when a slot is free.
   *
   * Resolves `true` when a slot was taken (the caller **must** `release()`), or `false` when the
   * caller was dropped from the queue because `isStillNeeded` returned false while it waited. A
   * `false` result means no slot is held and nothing needs releasing.
   */
  public async acquire(isStillNeeded?: () => boolean): Promise<boolean> {
    if (this.tryAcquire()) {
      return true;
    }

    const outcome = await new Promise<WaiterOutcome>((resolve, reject) => {
      this.#waiters.push({ resolve, reject, isStillNeeded });
    });
    return outcome === "acquired";
  }

  public release(): void {
    if (this.#active <= 0) {
      return;
    }

    // Hand the slot to the first waiter that still needs it, discarding superseded waiters along
    // the way. Without this drain a cancelled seek's waiter would hold its place in line and
    // delay live work behind it.
    for (;;) {
      const next = this.#waiters.shift();
      if (!next) {
        this.#active -= 1;
        return;
      }
      if (next.isStillNeeded != undefined && !next.isStillNeeded()) {
        next.resolve("dropped");
        continue;
      }
      // Transfer the slot directly to the next waiter without decrementing.
      next.resolve("acquired");
      return;
    }
  }

  /** Run `fn` while holding a slot. */
  public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Test helper: drain waiters (reject) and reset counts. */
  public resetForTests(): void {
    const waiters = this.#waiters.splice(0, this.#waiters.length);
    this.#active = 0;
    for (const waiter of waiters) {
      waiter.reject(new Error("VideoSeekLookbackGate reset"));
    }
  }
}

/** Process-wide gate shared by all CompressedVideoController instances. */
export const globalVideoSeekLookbackGate = new VideoSeekLookbackGate();
