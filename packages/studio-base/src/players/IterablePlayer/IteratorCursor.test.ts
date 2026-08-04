// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { IteratorResult } from "./IIterableSource";
import { IteratorCursor } from "./IteratorCursor";

function stamp(sec: number): IteratorResult {
  return { type: "stamp", stamp: { sec, nsec: 0 } };
}

describe("IteratorCursor", () => {
  it("reads all results from a non-aborted iterator", async () => {
    let finallyRan = false;
    async function* source(): AsyncIterableIterator<IteratorResult> {
      try {
        yield stamp(1);
        yield stamp(2);
      } finally {
        finallyRan = true;
      }
    }

    const cursor = new IteratorCursor(source());
    await expect(cursor.next()).resolves.toEqual(stamp(1));
    await expect(cursor.next()).resolves.toEqual(stamp(2));
    await expect(cursor.next()).resolves.toBeUndefined();
    await cursor.end();
    expect(finallyRan).toBe(true);
  });

  it("detaches its abort listener once the cursor ends normally, so a reused signal does not retain it", async () => {
    const controller = new AbortController();
    const addSpy = jest.spyOn(controller.signal, "addEventListener");
    const removeSpy = jest.spyOn(controller.signal, "removeEventListener");

    async function* source(): AsyncIterableIterator<IteratorResult> {
      yield stamp(1);
    }

    const cursor = new IteratorCursor(source(), controller.signal);
    expect(addSpy).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    const listener = addSpy.mock.calls[0]?.[1];

    await cursor.next();
    await cursor.end();

    expect(removeSpy).toHaveBeenCalledWith("abort", listener);
  });

  it("drives cleanup to completion when the iterator's finally block itself yields", async () => {
    // Mirrors coScene-data-platform's streamMessages: on close it flushes buffered results with
    // a yield before running the rest of its cleanup (e.g. aborting a fetch controller).
    let cleanupCompleted = false;
    const controller = new AbortController();
    async function* source(): AsyncIterableIterator<IteratorResult> {
      try {
        for (let i = 0; ; i++) {
          yield stamp(i);
        }
      } finally {
        yield stamp(999);
        cleanupCompleted = true;
      }
    }

    const cursor = new IteratorCursor(source(), controller.signal);
    await expect(cursor.next()).resolves.toEqual(stamp(0));

    controller.abort();
    await expect(cursor.next()).resolves.toBeUndefined();
    expect(cleanupCompleted).toBe(true);
  });

  it("finalizes the iterator when next observes an abort without end() being called", async () => {
    let finallyRan = false;
    const controller = new AbortController();
    async function* source(): AsyncIterableIterator<IteratorResult> {
      try {
        for (let i = 0; ; i++) {
          yield stamp(i);
        }
      } finally {
        finallyRan = true;
      }
    }

    const cursor = new IteratorCursor(source(), controller.signal);
    await expect(cursor.next()).resolves.toEqual(stamp(0));

    controller.abort();
    await expect(cursor.next()).resolves.toBeUndefined();
    expect(finallyRan).toBe(true);
  });

  it("finalizes the iterator as soon as the abort signal fires, with no further cursor calls", async () => {
    let finallyRan = false;
    const controller = new AbortController();
    async function* source(): AsyncIterableIterator<IteratorResult> {
      try {
        for (let i = 0; ; i++) {
          yield stamp(i);
        }
      } finally {
        finallyRan = true;
      }
    }

    const cursor = new IteratorCursor(source(), controller.signal);
    await expect(cursor.next()).resolves.toEqual(stamp(0));

    controller.abort();
    // No further next()/nextBatch()/readUntil()/end() call — cleanup must happen from the
    // abort event listener alone.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(finallyRan).toBe(true);
  });

  it("finalizes immediately when constructed with an already-aborted signal", async () => {
    let finallyRan = false;
    const controller = new AbortController();
    async function* source(): AsyncIterableIterator<IteratorResult> {
      try {
        for (let i = 0; ; i++) {
          yield stamp(i);
        }
      } finally {
        finallyRan = true;
      }
    }

    const iterator = source();
    await iterator.next();
    controller.abort();

    new IteratorCursor(iterator, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(finallyRan).toBe(true);
  });

  it("finalizes the iterator when nextBatch observes an abort without end() being called", async () => {
    let finallyRan = false;
    const controller = new AbortController();
    async function* source(): AsyncIterableIterator<IteratorResult> {
      try {
        for (let i = 0; ; i++) {
          yield stamp(i);
        }
      } finally {
        finallyRan = true;
      }
    }

    const cursor = new IteratorCursor(source(), controller.signal);
    await expect(cursor.nextBatch(0)).resolves.toEqual([stamp(0), stamp(1)]);

    controller.abort();
    await expect(cursor.nextBatch(100)).resolves.toBeUndefined();
    expect(finallyRan).toBe(true);
  });

  it("finalizes the iterator when readUntil observes an abort on entry", async () => {
    let finallyRan = false;
    const controller = new AbortController();
    async function* source(): AsyncIterableIterator<IteratorResult> {
      try {
        for (let i = 0; ; i++) {
          yield stamp(i);
        }
      } finally {
        finallyRan = true;
      }
    }

    const cursor = new IteratorCursor(source(), controller.signal);
    await expect(cursor.readUntil({ sec: 0, nsec: 0 })).resolves.toEqual([]);

    controller.abort();
    await expect(cursor.readUntil({ sec: 100, nsec: 0 })).resolves.toBeUndefined();
    expect(finallyRan).toBe(true);
  });

  it("finalizes the iterator when readUntil observes an abort mid-iteration", async () => {
    let finallyRan = false;
    const controller = new AbortController();
    async function* source(): AsyncIterableIterator<IteratorResult> {
      try {
        yield stamp(0);
        controller.abort();
        yield stamp(1);
      } finally {
        finallyRan = true;
      }
    }

    const cursor = new IteratorCursor(source(), controller.signal);
    await expect(cursor.readUntil({ sec: 100, nsec: 0 })).resolves.toBeUndefined();
    expect(finallyRan).toBe(true);
  });

  it("allows a safe end() after an abort already finalized the iterator", async () => {
    let finallyCount = 0;
    const controller = new AbortController();
    async function* source(): AsyncIterableIterator<IteratorResult> {
      try {
        for (let i = 0; ; i++) {
          yield stamp(i);
        }
      } finally {
        finallyCount += 1;
      }
    }

    const iterator = source();
    const returnSpy = jest.spyOn(iterator, "return");
    const cursor = new IteratorCursor(iterator, controller.signal);
    await cursor.next();

    controller.abort();
    await expect(cursor.next()).resolves.toBeUndefined();
    await expect(cursor.end()).resolves.toBeUndefined();
    expect(returnSpy).toHaveBeenCalledTimes(1);
    expect(finallyCount).toBe(1);
  });

  it("does not propagate errors thrown during finalization", async () => {
    const controller = new AbortController();
    async function* source(): AsyncIterableIterator<IteratorResult> {
      try {
        for (let i = 0; ; i++) {
          yield stamp(i);
        }
      } finally {
        // eslint-disable-next-line no-unsafe-finally
        throw new Error("cleanup failed");
      }
    }

    const cursor = new IteratorCursor(source(), controller.signal);
    await cursor.next();

    controller.abort();
    await expect(cursor.next()).resolves.toBeUndefined();
    await expect(cursor.end()).resolves.toBeUndefined();
  });
});
