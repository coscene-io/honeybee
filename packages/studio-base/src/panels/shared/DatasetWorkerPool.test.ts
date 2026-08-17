// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { makeComlinkWorkerMock } from "@foxglove/den/testing";
import { TimestampDatasetsBuilderImpl } from "@foxglove/studio-base/panels/Plot/builders/TimestampDatasetsBuilderImpl";
import { StateTransitionsDatasetBuilder } from "@foxglove/studio-base/panels/StateTransitions/StateTransitionsDatasetBuilder";
import {
  StateTransitionsDatasetBuilderImpl,
  packStateDatums,
  unpackStateTransitionDataset,
} from "@foxglove/studio-base/panels/StateTransitions/StateTransitionsDatasetBuilderImpl";

import { DatasetWorkerPool } from "./DatasetWorkerPool";

type MockWorker = Worker & {
  emit(type: string, event: Event): void;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("DatasetWorkerPool", () => {
  it("shares one host across isolated state transition sessions", async () => {
    const workers: Worker[] = [];
    const createStateTransitionsDatasetBuilder = jest.fn(async () =>
      Comlink.proxy(new StateTransitionsDatasetBuilderImpl()),
    );
    const WorkerMock = makeComlinkWorkerMock(() => ({
      createStateTransitionsDatasetBuilder,
    }));
    const pool = new DatasetWorkerPool({
      createWorker: () => {
        const worker = new WorkerMock() as unknown as Worker;
        workers.push(worker);
        return worker;
      },
      maxWorkers: 1,
    });

    const first = await pool.acquireStateTransitionsDatasetBuilder();
    const second = await pool.acquireStateTransitionsDatasetBuilder();
    const series = {
      configIndex: 0,
      enabled: true,
      key: "0:/state",
      label: "State",
      timestampMethod: "receiveTime" as const,
      y: -18,
    };
    await first.remote.applyActions([
      { series: [series], type: "set-series" },
      {
        batch: packStateDatums([{ value: "first", x: 0 }]),
        key: series.key,
        type: "append-full",
      },
    ]);
    await second.remote.applyActions([
      { series: [series], type: "set-series" },
      {
        batch: packStateDatums([{ value: "second", x: 0 }]),
        key: series.key,
        type: "append-full",
      },
    ]);

    const [firstDatasets, secondDatasets] = await Promise.all([
      first.remote.getViewportDatasets({
        showPoints: false,
        xBounds: { max: 1, min: 0 },
      }),
      second.remote.getViewportDatasets({
        showPoints: false,
        xBounds: { max: 1, min: 0 },
      }),
    ]);

    expect(workers).toHaveLength(1);
    expect(createStateTransitionsDatasetBuilder).toHaveBeenCalledTimes(2);
    expect(unpackStateTransitionDataset(firstDatasets[0]!)[0]?.value).toBe("first");
    expect(unpackStateTransitionDataset(secondDatasets[0]!)[0]?.value).toBe("second");

    await first.release();
    await second.release();
    await pool.dispose();
  });

  it("keeps a co-tenant usable when one state session RPC rejects", async () => {
    const workers: Worker[] = [];
    let sessionIndex = 0;
    const WorkerMock = makeComlinkWorkerMock(() => ({
      async createStateTransitionsDatasetBuilder() {
        const index = sessionIndex++;
        if (index === 0) {
          return Comlink.proxy({
            applyActions() {},
            getViewportDatasets() {
              throw new Error("logical session failed");
            },
          });
        }
        return Comlink.proxy(new StateTransitionsDatasetBuilderImpl());
      },
    }));
    const pool = new DatasetWorkerPool({
      createWorker: () => {
        const worker = new WorkerMock() as unknown as Worker;
        workers.push(worker);
        return worker;
      },
      maxWorkers: 1,
    });
    const acquireWorker: ConstructorParameters<typeof StateTransitionsDatasetBuilder>[0] = {
      acquireWorker: async (options) => await pool.acquireStateTransitionsDatasetBuilder(options),
    };
    const failed = new StateTransitionsDatasetBuilder(acquireWorker);
    const healthy = new StateTransitionsDatasetBuilder(acquireWorker);
    healthy.applyActions([
      {
        type: "set-series",
        series: [
          {
            configIndex: 0,
            enabled: true,
            key: "0:/state",
            label: "State",
            timestampMethod: "receiveTime",
            y: -18,
          },
        ],
      },
      {
        batch: packStateDatums([{ value: "healthy", x: 0 }]),
        key: "0:/state",
        type: "append-full",
      },
    ]);

    await expect(
      failed.getViewportDatasets({ showPoints: false, xBounds: { max: 1, min: 0 } }),
    ).rejects.toThrow("logical session failed");
    expect(console.error).toHaveBeenCalled();
    jest.mocked(console.error).mockClear();
    const datasets = await healthy.getViewportDatasets({
      showPoints: false,
      xBounds: { max: 1, min: 0 },
    });

    expect(workers).toHaveLength(1);
    expect(unpackStateTransitionDataset(datasets[0]!)[0]?.value).toBe("healthy");

    failed.destroy();
    healthy.destroy();
    await flushPromises();
    await pool.dispose();
  });

  it("shares physical workers and balances logical sessions at capacity", async () => {
    const services: { createTimestampDatasetsBuilder: jest.Mock }[] = [];
    const workers: MockWorker[] = [];
    const WorkerMock = makeComlinkWorkerMock(() => {
      const service = {
        createTimestampDatasetsBuilder: jest.fn(async () =>
          Comlink.proxy(new TimestampDatasetsBuilderImpl()),
        ),
      };
      services.push(service);
      return service;
    });
    const pool = new DatasetWorkerPool({
      createWorker: () => {
        const worker = new WorkerMock() as unknown as MockWorker;
        workers.push(worker);
        return worker;
      },
      maxWorkers: 2,
    });

    const leases = [];
    leases.push(await pool.acquireTimestampDatasetsBuilder());
    leases.push(await pool.acquireTimestampDatasetsBuilder());
    leases.push(await pool.acquireTimestampDatasetsBuilder());
    leases.push(await pool.acquireTimestampDatasetsBuilder());

    expect(workers).toHaveLength(2);
    expect(
      services.map((service) => service.createTimestampDatasetsBuilder.mock.calls.length),
    ).toEqual([2, 2]);

    await Promise.all(
      leases.map(async (lease) => {
        await lease.release();
      }),
    );
    await pool.dispose();
  });

  it.each(["error", "messageerror"])(
    "broadcasts %s and replaces the broken physical worker",
    async (eventType) => {
      const workers: MockWorker[] = [];
      const WorkerMock = makeComlinkWorkerMock(() => ({
        async createTimestampDatasetsBuilder() {
          return Comlink.proxy(new TimestampDatasetsBuilderImpl());
        },
      }));
      const pool = new DatasetWorkerPool({
        createWorker: () => {
          const worker = new WorkerMock() as unknown as MockWorker;
          workers.push(worker);
          return worker;
        },
        maxWorkers: 1,
      });
      const firstHandler = jest.fn(() => {
        throw new Error("panel error handler failed");
      });
      const secondHandler = jest.fn();
      const first = await pool.acquireTimestampDatasetsBuilder({
        handleWorkerError: firstHandler,
      });
      const second = await pool.acquireTimestampDatasetsBuilder({
        handleWorkerError: secondHandler,
      });
      const event = new Event(eventType);

      workers[0]!.emit(eventType, event);

      expect(firstHandler).toHaveBeenCalledWith(event);
      expect(secondHandler).toHaveBeenCalledWith(event);
      expect(console.error).toHaveBeenCalled();
      jest.mocked(console.error).mockClear();
      const replacement = await pool.acquireTimestampDatasetsBuilder();
      expect(workers).toHaveLength(2);

      await first.release();
      await second.release();
      await replacement.release();
      await pool.dispose();
    },
  );

  it.each(["error", "messageerror"])(
    "replaces an idle worker after %s without failing the next acquisition",
    async (eventType) => {
      const workers: MockWorker[] = [];
      const services: { createTimestampDatasetsBuilder: jest.Mock }[] = [];
      const WorkerMock = makeComlinkWorkerMock(() => {
        const service = {
          createTimestampDatasetsBuilder: jest.fn(async () =>
            Comlink.proxy(new TimestampDatasetsBuilderImpl()),
          ),
        };
        services.push(service);
        return service;
      });
      const pool = new DatasetWorkerPool({
        createWorker: () => {
          const worker = new WorkerMock() as unknown as MockWorker;
          workers.push(worker);
          return worker;
        },
        maxWorkers: 1,
      });
      const first = await pool.acquireTimestampDatasetsBuilder();
      await first.release();

      workers[0]!.emit(eventType, new Event(eventType));
      expect(console.error).toHaveBeenCalled();
      jest.mocked(console.error).mockClear();
      const replacement = await pool.acquireTimestampDatasetsBuilder();

      expect(workers).toHaveLength(2);
      expect(services[0]!.createTimestampDatasetsBuilder).toHaveBeenCalledTimes(1);
      expect(services[1]!.createTimestampDatasetsBuilder).toHaveBeenCalledTimes(1);

      await replacement.release();
      await pool.dispose();
    },
  );

  it("retires a host when a child session constructor rejects", async () => {
    let workerCount = 0;
    const WorkerMock = makeComlinkWorkerMock(() => {
      const workerIndex = workerCount++;
      return {
        async createTimestampDatasetsBuilder() {
          if (workerIndex === 0) {
            throw new Error("session setup failed");
          }
          return Comlink.proxy(new TimestampDatasetsBuilderImpl());
        },
      };
    });
    const pool = new DatasetWorkerPool({
      createWorker: () => new WorkerMock() as unknown as Worker,
      maxWorkers: 1,
    });

    await expect(pool.acquireTimestampDatasetsBuilder()).rejects.toThrow(
      "Dataset worker failed while creating a session",
    );
    const replacement = await pool.acquireTimestampDatasetsBuilder();
    expect(workerCount).toBe(2);

    await replacement.release();
    await pool.dispose();
  });

  it("retires a host when a state transition session constructor rejects", async () => {
    let workerCount = 0;
    const WorkerMock = makeComlinkWorkerMock(() => {
      const workerIndex = workerCount++;
      return {
        async createStateTransitionsDatasetBuilder() {
          if (workerIndex === 0) {
            throw new Error("session setup failed");
          }
          return Comlink.proxy(new StateTransitionsDatasetBuilderImpl());
        },
      };
    });
    const pool = new DatasetWorkerPool({
      createWorker: () => new WorkerMock() as unknown as Worker,
      maxWorkers: 1,
    });

    await expect(pool.acquireStateTransitionsDatasetBuilder()).rejects.toThrow(
      "Dataset worker failed while creating a session",
    );
    const replacement = await pool.acquireStateTransitionsDatasetBuilder();
    expect(workerCount).toBe(2);

    await replacement.release();
    await pool.dispose();
  });

  it.each(["error", "messageerror"])(
    "rejects a pending session constructor and replaces its worker after %s",
    async (eventType) => {
      const creationStarted = deferred<void>();
      const workers: MockWorker[] = [];
      let workerCount = 0;
      const WorkerMock = makeComlinkWorkerMock(() => {
        const workerIndex = workerCount++;
        return {
          async createTimestampDatasetsBuilder() {
            if (workerIndex === 0) {
              creationStarted.resolve(undefined);
              return await new Promise<never>(() => undefined);
            }
            return Comlink.proxy(new TimestampDatasetsBuilderImpl());
          },
        };
      });
      const pool = new DatasetWorkerPool({
        createWorker: () => {
          const worker = new WorkerMock() as unknown as MockWorker;
          workers.push(worker);
          return worker;
        },
        maxWorkers: 1,
      });
      const acquisition = pool.acquireTimestampDatasetsBuilder();
      await creationStarted.promise;

      workers[0]!.emit(eventType, new Event(eventType));
      expect(console.error).toHaveBeenCalled();
      jest.mocked(console.error).mockClear();
      await expect(acquisition).rejects.toThrow("Dataset worker failed while creating a session");

      const replacement = await pool.acquireTimestampDatasetsBuilder();
      expect(workers).toHaveLength(2);
      await replacement.release();
      await pool.dispose();
    },
  );

  it("aborts promptly and releases a child session that finishes creating later", async () => {
    const allowCreation = deferred<void>();
    const creationStarted = deferred<void>();
    const finalized = jest.fn();
    class FinalizableBuilder extends TimestampDatasetsBuilderImpl {
      public [Comlink.finalizer](): void {
        finalized();
      }
    }
    const WorkerMock = makeComlinkWorkerMock(() => ({
      async createTimestampDatasetsBuilder() {
        creationStarted.resolve(undefined);
        await allowCreation.promise;
        return Comlink.proxy(new FinalizableBuilder());
      },
    }));
    const pool = new DatasetWorkerPool({
      createWorker: () => new WorkerMock() as unknown as Worker,
      maxWorkers: 1,
    });
    const abortController = new AbortController();
    const acquisition = pool.acquireTimestampDatasetsBuilder({
      signal: abortController.signal,
    });
    await creationStarted.promise;

    abortController.abort();
    await expect(acquisition).rejects.toMatchObject({ name: "AbortError" });
    expect(finalized).not.toHaveBeenCalled();

    allowCreation.resolve(undefined);
    await flushPromises();
    await flushPromises();
    expect(finalized).toHaveBeenCalledTimes(1);
    await pool.dispose();
  });
});
