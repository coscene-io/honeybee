// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { getDefaultWorkerSessionPoolCapacity, WorkerSessionPool } from "./WorkerSessionPool";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("WorkerSessionPool", () => {
  it("creates physical resources up to the limit, then balances logical sessions", async () => {
    let nextResourceId = 0;
    const pool = new WorkerSessionPool({
      createResource: () => ({ id: nextResourceId++ }),
      disposeResource: jest.fn(),
      maxWorkers: 2,
    });
    const acquire = async () =>
      await pool.acquire({
        createSession: (resource) => ({ resourceId: resource.id }),
        disposeSession: jest.fn(),
      });

    const leases = [];
    leases.push(await acquire());
    leases.push(await acquire());
    leases.push(await acquire());
    leases.push(await acquire());

    expect(nextResourceId).toBe(2);
    expect(leases.map((lease) => lease.session.resourceId)).toEqual([0, 1, 0, 1]);

    await Promise.all(
      leases.map(async (lease) => {
        await lease.release();
      }),
    );
    await pool.dispose();
  });

  it("awaits async session cleanup and makes release idempotent", async () => {
    const cleanup = deferred<void>();
    const disposeSession = jest.fn(async () => {
      await cleanup.promise;
    });
    const disposeResource = jest.fn();
    let nextResourceId = 1;
    const pool = new WorkerSessionPool({
      createResource: () => ({ id: nextResourceId++ }),
      disposeResource,
      maxWorkers: 1,
    });
    const lease = await pool.acquire({
      createSession: async (resource) => ({ resource }),
      disposeSession,
    });

    const firstRelease = lease.release();
    const secondRelease = lease.release({ broken: true });
    expect(secondRelease).toBe(firstRelease);
    expect(disposeSession).toHaveBeenCalledTimes(1);

    cleanup.resolve(undefined);
    await firstRelease;
    expect(disposeResource).toHaveBeenCalledWith({ id: 1 });

    const replacement = await pool.acquire({
      createSession: async (resource) => ({ resource }),
      disposeSession: jest.fn(),
    });
    expect(replacement.session.resource).toEqual({ id: 2 });
    await replacement.release();
    await pool.dispose();
  });

  it("rejects a lease when its reserved host is retired during session setup", async () => {
    const disposeResource = jest.fn();
    const sessionGate = deferred<void>();
    const pool = new WorkerSessionPool({
      createResource: () => ({}),
      disposeResource,
      maxWorkers: 1,
    });
    const first = await pool.acquire({
      createSession: () => ({}),
      disposeSession: jest.fn(),
    });
    const disposePendingSession = jest.fn();
    const pendingAcquire = pool.acquire({
      createSession: async () => {
        await sessionGate.promise;
        return {};
      },
      disposeSession: disposePendingSession,
    });

    await first.release({ broken: true });
    sessionGate.resolve(undefined);

    await expect(pendingAcquire).rejects.toThrow(
      "Worker resource was retired during session setup",
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(disposePendingSession).toHaveBeenCalledTimes(1);
    await pool.dispose();
  });

  it("frees an aborted reservation whose session setup never settles", async () => {
    const disposeResource = jest.fn();
    const pool = new WorkerSessionPool({
      createResource: () => ({}),
      disposeResource,
      maxWorkers: 1,
    });
    const controller = new AbortController();
    const acquisition = pool.acquire({
      createSession: async () => await new Promise<never>(() => {}),
      disposeSession: jest.fn(),
      signal: controller.signal,
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    controller.abort();
    await expect(acquisition).rejects.toMatchObject({ name: "AbortError" });

    // The reservation was returned, so disposal treats the host as idle and can retire it.
    await pool.dispose();
    expect(disposeResource).toHaveBeenCalledTimes(1);
  });

  it("keeps release idempotent when disposeSession synchronously releases again", async () => {
    const pool = new WorkerSessionPool({
      createResource: () => ({}),
      disposeResource: jest.fn(),
      maxWorkers: 1,
    });
    let release: (() => Promise<void>) | undefined;
    const disposeSession = jest.fn(() => {
      void release?.();
    });
    const lease = await pool.acquire({ createSession: () => ({}), disposeSession });
    release = lease.release;

    await lease.release();
    expect(disposeSession).toHaveBeenCalledTimes(1);
    await pool.dispose();
  });

  it("retires a resource marked broken after its session was already released", async () => {
    let nextResourceId = 1;
    const disposeResource = jest.fn();
    const pool = new WorkerSessionPool({
      createResource: () => ({ id: nextResourceId++ }),
      disposeResource,
      maxWorkers: 1,
    });
    const acquire = async () =>
      await pool.acquire({
        createSession: (resource) => ({ resourceId: resource.id }),
        disposeSession: jest.fn(),
      });

    const first = await acquire();
    const firstRelease = first.release();
    await firstRelease;
    expect(disposeResource).not.toHaveBeenCalled();

    expect(first.release({ broken: true })).toBe(firstRelease);
    const replacement = await acquire();
    expect(disposeResource).toHaveBeenCalledWith({ id: 1 });
    expect(replacement.session.resourceId).toBe(2);

    await replacement.release();
    await pool.dispose();
  });

  it("rejects an aborted acquisition and cleans a session that finishes later", async () => {
    const sessionCreation = deferred<{ id: number }>();
    const sessionCreationStarted = deferred<void>();
    const disposeSession = jest.fn();
    const pool = new WorkerSessionPool({
      createResource: () => ({ id: 1 }),
      disposeResource: jest.fn(),
      maxWorkers: 1,
    });
    const abortController = new AbortController();
    const acquisition = pool.acquire({
      createSession: async () => {
        sessionCreationStarted.resolve(undefined);
        return await sessionCreation.promise;
      },
      disposeSession,
      signal: abortController.signal,
    });

    await sessionCreationStarted.promise;
    abortController.abort();
    await expect(acquisition).rejects.toMatchObject({ name: "AbortError" });

    const abandonedSession = { id: 1 };
    sessionCreation.resolve(abandonedSession);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(disposeSession).toHaveBeenCalledWith(abandonedSession);

    await pool.dispose();
  });

  it("does not create a resource for an already-aborted acquisition", async () => {
    const createResource = jest.fn(() => ({ id: 1 }));
    const pool = new WorkerSessionPool({
      createResource,
      disposeResource: jest.fn(),
      maxWorkers: 1,
    });
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      pool.acquire({
        createSession: jest.fn(),
        disposeSession: jest.fn(),
        signal: abortController.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(createResource).not.toHaveBeenCalled();
    await pool.dispose();
  });

  it("retires a broken resource once and never revives it from another session", async () => {
    let nextResourceId = 0;
    const disposeResource = jest.fn();
    const pool = new WorkerSessionPool({
      createResource: () => ({ id: nextResourceId++ }),
      disposeResource,
      maxWorkers: 1,
    });
    const acquire = async () =>
      await pool.acquire({
        createSession: (resource) => ({ resourceId: resource.id }),
        disposeSession: jest.fn(),
      });

    const first = await acquire();
    const second = await acquire();
    expect(first.session.resourceId).toBe(0);
    expect(second.session.resourceId).toBe(0);

    await first.release({ broken: true });
    expect(disposeResource).toHaveBeenCalledTimes(1);

    const replacement = await acquire();
    expect(replacement.session.resourceId).toBe(1);

    await second.release();
    expect(disposeResource).toHaveBeenCalledTimes(1);

    await replacement.release();
    await pool.dispose();
    expect(disposeResource).toHaveBeenCalledTimes(2);
  });

  it("waits for async broken-resource disposal before creating a replacement", async () => {
    const resourceDisposal = deferred<void>();
    let nextResourceId = 0;
    const pool = new WorkerSessionPool({
      createResource: () => ({ id: nextResourceId++ }),
      disposeResource: async () => {
        await resourceDisposal.promise;
      },
      maxWorkers: 1,
    });
    const acquire = async () =>
      await pool.acquire({
        createSession: (resource) => ({ resourceId: resource.id }),
        disposeSession: jest.fn(),
      });

    const broken = await acquire();
    const release = broken.release({ broken: true });
    let replacementResolved = false;
    const replacementPromise = acquire().then((lease) => {
      replacementResolved = true;
      return lease;
    });
    await Promise.resolve();
    expect(replacementResolved).toBe(false);
    expect(nextResourceId).toBe(1);

    resourceDisposal.resolve(undefined);
    await release;
    const replacement = await replacementPromise;
    expect(replacement.session.resourceId).toBe(1);

    await replacement.release();
    await pool.dispose();
  });

  it("disposes an idle resource when keepAlive is disabled", async () => {
    let nextResourceId = 0;
    const disposeResource = jest.fn();
    const pool = new WorkerSessionPool({
      createResource: () => ({ id: nextResourceId++ }),
      disposeResource,
      keepAlive: false,
      maxWorkers: 1,
    });
    const acquire = async () =>
      await pool.acquire({
        createSession: (resource) => ({ resourceId: resource.id }),
        disposeSession: jest.fn(),
      });

    const first = await acquire();
    await first.release();
    const second = await acquire();

    expect(second.session.resourceId).toBe(1);
    expect(disposeResource).toHaveBeenCalledTimes(1);
    await second.release();
    expect(disposeResource).toHaveBeenCalledTimes(2);
    await pool.dispose();
  });

  it("disposes idle resources immediately and active resources when returned", async () => {
    let nextResourceId = 0;
    const disposeResource = jest.fn();
    const pool = new WorkerSessionPool({
      createResource: () => ({ id: nextResourceId++ }),
      disposeResource,
      maxWorkers: 2,
    });
    const acquire = async () =>
      await pool.acquire({
        createSession: (resource) => ({ resourceId: resource.id }),
        disposeSession: jest.fn(),
      });

    const active = await acquire();
    const idle = await acquire();
    await idle.release();
    await pool.dispose();

    expect(disposeResource).toHaveBeenCalledTimes(1);
    expect(disposeResource.mock.calls[0]?.[0]).toEqual({ id: 1 });
    await expect(acquire()).rejects.toThrow("disposed");

    await active.release();
    expect(disposeResource).toHaveBeenCalledTimes(2);
  });

  it("handles failed async resource creation without leaking a capacity slot", async () => {
    let attempts = 0;
    const pool = new WorkerSessionPool({
      createResource: async () => {
        if (attempts++ === 0) {
          throw new Error("creation failed");
        }
        return { id: 2 };
      },
      disposeResource: jest.fn(),
      maxWorkers: 1,
    });
    const acquire = async () =>
      await pool.acquire({
        createSession: (resource) => ({ resourceId: resource.id }),
        disposeSession: jest.fn(),
      });

    await expect(acquire()).rejects.toThrow("creation failed");
    const lease = await acquire();
    expect(lease.session.resourceId).toBe(2);

    await lease.release();
    await pool.dispose();
  });

  it("rejects invalid explicit limits", () => {
    expect(
      () =>
        new WorkerSessionPool({
          createResource: jest.fn(),
          disposeResource: jest.fn(),
          maxWorkers: 0,
        }),
    ).toThrow(RangeError);
  });
});

describe("getDefaultWorkerSessionPoolCapacity", () => {
  it.each([
    [0, 1],
    [1, 1],
    [2, 1],
    [8, 7],
    [Number.NaN, 3],
    [Number.POSITIVE_INFINITY, 3],
    [1_000_000, 32],
  ])("normalizes hardware concurrency %p to %p", (hardwareConcurrency, expected) => {
    expect(getDefaultWorkerSessionPoolCapacity(hardwareConcurrency)).toBe(expected);
  });
});
