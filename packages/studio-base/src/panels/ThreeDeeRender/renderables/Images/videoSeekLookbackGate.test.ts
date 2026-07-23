// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { VideoSeekLookbackGate } from "./videoSeekLookbackGate";

describe("VideoSeekLookbackGate", () => {
  it("tryAcquire is synchronous and does not queue", () => {
    const gate = new VideoSeekLookbackGate(1);
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
    expect(gate.getActiveCount()).toBe(1);
    expect(gate.getPendingCount()).toBe(0);
    gate.release();
    expect(gate.tryAcquire()).toBe(true);
    gate.release();
  });

  it("allows up to maxConcurrent acquires without waiting", async () => {
    const gate = new VideoSeekLookbackGate(2);
    await gate.acquire();
    await gate.acquire();
    expect(gate.getActiveCount()).toBe(2);
    expect(gate.getPendingCount()).toBe(0);
    gate.release();
    gate.release();
    expect(gate.getActiveCount()).toBe(0);
  });

  it("queues a third acquire until a slot is released", async () => {
    const gate = new VideoSeekLookbackGate(2);
    await gate.acquire();
    await gate.acquire();

    let thirdResolved = false;
    const third = gate.acquire().then(() => {
      thirdResolved = true;
    });

    // Let the microtask queue flush; third must still be pending.
    await Promise.resolve();
    expect(thirdResolved).toBe(false);
    expect(gate.getPendingCount()).toBe(1);
    expect(gate.getActiveCount()).toBe(2);

    gate.release();
    await third;
    expect(thirdResolved).toBe(true);
    expect(gate.getActiveCount()).toBe(2);
    expect(gate.getPendingCount()).toBe(0);

    gate.release();
    gate.release();
    expect(gate.getActiveCount()).toBe(0);
  });

  it("runExclusive serializes work beyond the concurrency limit", async () => {
    const gate = new VideoSeekLookbackGate(1);
    const order: number[] = [];
    let releaseFirst!: () => void;
    const firstHold = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = gate.runExclusive(async () => {
      order.push(1);
      await firstHold;
      order.push(2);
      return "a";
    });

    const second = gate.runExclusive(async () => {
      order.push(3);
      return "b";
    });

    await Promise.resolve();
    expect(order).toEqual([1]);
    expect(gate.getPendingCount()).toBe(1);

    releaseFirst();
    await expect(first).resolves.toBe("a");
    await expect(second).resolves.toBe("b");
    expect(order).toEqual([1, 2, 3]);
    expect(gate.getActiveCount()).toBe(0);
  });

  it("rejects maxConcurrent < 1", () => {
    expect(() => new VideoSeekLookbackGate(0)).toThrow(/maxConcurrent/);
  });

  it("acquire resolves true when a slot is taken", async () => {
    const gate = new VideoSeekLookbackGate(1);
    await expect(gate.acquire()).resolves.toBe(true);
    gate.release();
  });

  it("drops a superseded waiter and resolves it false without consuming a slot", async () => {
    const gate = new VideoSeekLookbackGate(1);
    expect(gate.tryAcquire()).toBe(true);

    // This waiter's work is already superseded, so it should never receive the slot.
    const superseded = gate.acquire(() => false);
    const live = gate.acquire();

    await Promise.resolve();
    expect(gate.getPendingCount()).toBe(2);

    // The stale waiter is dropped when the slot frees; the live one gets it instead.
    gate.release();
    await expect(superseded).resolves.toBe(false);
    await expect(live).resolves.toBe(true);
    expect(gate.getActiveCount()).toBe(1);
    expect(gate.getPendingCount()).toBe(0);

    gate.release();
    expect(gate.getActiveCount()).toBe(0);
  });

  it("does not head-of-line block: a live waiter behind stale ones runs immediately", async () => {
    const gate = new VideoSeekLookbackGate(1);
    expect(gate.tryAcquire()).toBe(true);

    const order: string[] = [];
    const dead = [0, 1, 2].map(async (i) => {
      const acquired = await gate.acquire(() => false);
      order.push(`dead${i}:${acquired}`);
      return acquired;
    });
    const livePromise = gate
      .acquire(() => true)
      .then((acquired) => {
        order.push(`live:${acquired}`);
        return acquired;
      });

    await Promise.resolve();
    expect(gate.getPendingCount()).toBe(4);

    // A single release drains all three stale waiters and hands the slot to the live one.
    gate.release();
    await Promise.all(dead);
    await expect(livePromise).resolves.toBe(true);
    expect(order).toEqual(["dead0:false", "dead1:false", "dead2:false", "live:true"]);
    expect(gate.getActiveCount()).toBe(1);

    gate.release();
    expect(gate.getActiveCount()).toBe(0);
  });

  it("releases the slot entirely when every waiter is stale", async () => {
    const gate = new VideoSeekLookbackGate(1);
    expect(gate.tryAcquire()).toBe(true);

    const stale = gate.acquire(() => false);
    await Promise.resolve();

    gate.release();
    await expect(stale).resolves.toBe(false);
    expect(gate.getActiveCount()).toBe(0);
    expect(gate.getPendingCount()).toBe(0);
    expect(gate.tryAcquire()).toBe(true);
    gate.release();
  });
});
