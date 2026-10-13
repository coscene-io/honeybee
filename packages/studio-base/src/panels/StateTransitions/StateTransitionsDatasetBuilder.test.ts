// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { makeComlinkWorkerMock } from "@foxglove/den/testing";
import { StateTransitionsDatasetWorkerLease } from "@foxglove/studio-base/panels/shared/DatasetWorkerPool";

import { StateTransitionsDatasetBuilder } from "./StateTransitionsDatasetBuilder";
import {
  StateTransitionsDatasetAction,
  StateTransitionsDatasetBuilderImpl,
  packStateDatums,
  unpackStateTransitionDataset,
} from "./StateTransitionsDatasetBuilderImpl";

let createStateTransitionsDatasetBuilderImpl: () => object = () =>
  new StateTransitionsDatasetBuilderImpl();

Object.defineProperty(global, "Worker", {
  writable: true,
  value: makeComlinkWorkerMock(() => ({
    async createStateTransitionsDatasetBuilder() {
      return Comlink.proxy(createStateTransitionsDatasetBuilderImpl());
    },
  })),
});

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

function makeLease(
  remote: object,
  release: StateTransitionsDatasetWorkerLease["release"] = async () => undefined,
): StateTransitionsDatasetWorkerLease {
  return {
    remote: remote as StateTransitionsDatasetWorkerLease["remote"],
    release,
  };
}

function resetAction(key: string): StateTransitionsDatasetAction {
  return { key, type: "reset-series" };
}

describe("StateTransitionsDatasetBuilder worker bridge", () => {
  afterEach(async () => {
    createStateTransitionsDatasetBuilderImpl = () => new StateTransitionsDatasetBuilderImpl();
    await flushPromises();
  });

  it("flushes compact ingestion before requesting the viewport", async () => {
    const builder = new StateTransitionsDatasetBuilder();
    builder.applyActions([
      {
        type: "set-series",
        series: [
          {
            key: "0:/state",
            configIndex: 0,
            enabled: true,
            label: "State",
            timestampMethod: "receiveTime",
            y: -18,
          },
        ],
      },
      {
        type: "append-full",
        key: "0:/state",
        batch: packStateDatums([
          { x: 0, value: false },
          { x: 1, value: true },
        ]),
      },
    ]);

    const datasets = await builder.getViewportDatasets({
      xBounds: { min: 0, max: 1 },
      showPoints: false,
    });
    expect(unpackStateTransitionDataset(datasets[0]!).map(({ value }) => value)).toEqual([
      false,
      true,
    ]);

    builder.destroy();
    builder.destroy();
    await expect(
      builder.getViewportDatasets({ xBounds: { min: 0, max: 1 }, showPoints: false }),
    ).resolves.toEqual([]);
  });

  it("waits for applyActionsAndFlush to reach the remote session in order", async () => {
    const allowApply = deferred<void>();
    const applyStarted = deferred<void>();
    const applyActions = jest.fn(async () => {
      applyStarted.resolve(undefined);
      await allowApply.promise;
    });
    const builder = new StateTransitionsDatasetBuilder({
      acquireWorker: async () =>
        makeLease({
          applyActions,
          async getViewportDatasets() {
            return [];
          },
        }),
    });
    builder.applyActions([resetAction("first")]);

    const flushed = builder.applyActionsAndFlush([resetAction("second")]);
    await applyStarted.promise;
    expect(applyActions).toHaveBeenCalledWith([resetAction("first"), resetAction("second")]);

    let didFlush = false;
    void flushed.then(() => {
      didFlush = true;
    });
    await flushPromises();
    expect(didFlush).toBe(false);

    allowApply.resolve(undefined);
    await flushed;
    builder.destroy();
  });

  it("coalesces queued viewport requests and only builds the newest viewport", async () => {
    const firstStarted = deferred<void>();
    const finishFirst = deferred<void>();
    const requests: number[] = [];
    const applied: StateTransitionsDatasetAction[][] = [];
    const builder = new StateTransitionsDatasetBuilder({
      acquireWorker: async () =>
        makeLease({
          async applyActions(actions: StateTransitionsDatasetAction[]) {
            applied.push(actions);
          },
          async getViewportDatasets(request: { xBounds: { min: number } }) {
            requests.push(request.xBounds.min);
            if (requests.length === 1) {
              firstStarted.resolve(undefined);
              await finishFirst.promise;
            }
            return [];
          },
        }),
    });

    const first = builder.getViewportDatasets({
      xBounds: { min: 0, max: 10 },
      showPoints: false,
    });
    await firstStarted.promise;

    builder.applyActions([resetAction("second")]);
    const second = builder.getViewportDatasets({
      xBounds: { min: 1, max: 11 },
      showPoints: false,
    });
    builder.applyActions([resetAction("third")]);
    const third = builder.getViewportDatasets({
      xBounds: { min: 2, max: 12 },
      showPoints: false,
    });

    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await flushPromises();
    expect(secondSettled).toBe(false);
    expect(requests).toEqual([0]);
    finishFirst.resolve(undefined);
    await first;
    await expect(second).resolves.toEqual([]);
    await third;

    expect(requests).toEqual([0, 2]);
    expect(applied).toEqual([[resetAction("second"), resetAction("third")]]);
    builder.destroy();
  });

  it("waits for an in-flight viewport before releasing the child session", async () => {
    const requestStarted = deferred<void>();
    const finishRequest = deferred<void>();
    const release = jest.fn(async () => undefined);
    const builder = new StateTransitionsDatasetBuilder({
      acquireWorker: async () =>
        makeLease(
          {
            async applyActions() {},
            async getViewportDatasets() {
              requestStarted.resolve(undefined);
              await finishRequest.promise;
              return [];
            },
          },
          release,
        ),
    });

    const viewport = builder.getViewportDatasets({
      xBounds: { min: 0, max: 1 },
      showPoints: false,
    });
    await requestStarted.promise;
    builder.destroy();
    builder.destroy();
    await flushPromises();
    expect(release).not.toHaveBeenCalled();

    finishRequest.resolve(undefined);
    await expect(viewport).resolves.toEqual([]);
    await flushPromises();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith({ broken: false });
  });

  it("reports session creation failures and rejects queued work", async () => {
    const error = new Error("session setup failed");
    const handleWorkerError = jest.fn();
    const builder = new StateTransitionsDatasetBuilder({
      acquireWorker: async () => {
        throw error;
      },
      handleWorkerError,
    });

    await expect(
      builder.getViewportDatasets({ xBounds: { min: 0, max: 1 }, showPoints: false }),
    ).rejects.toBe(error);
    expect(handleWorkerError).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
    jest.mocked(console.error).mockClear();
    builder.destroy();
  });

  it("broadcasts an idle worker failure and releases the broken session", async () => {
    let emitWorkerError!: (event: Event) => void;
    const release = jest.fn(async () => undefined);
    const handleWorkerError = jest.fn();
    const builder = new StateTransitionsDatasetBuilder({
      acquireWorker: async (options) => {
        emitWorkerError = options?.handleWorkerError ?? (() => undefined);
        return makeLease(
          {
            async applyActions() {},
            async getViewportDatasets() {
              return [];
            },
          },
          release,
        );
      },
      handleWorkerError,
    });
    await flushPromises();

    const event = new Event("error");
    emitWorkerError(event);
    expect(handleWorkerError).toHaveBeenCalledWith(event);
    await expect(
      builder.getViewportDatasets({ xBounds: { min: 0, max: 1 }, showPoints: false }),
    ).rejects.toThrow("State transitions Dataset worker failed");

    builder.destroy();
    await flushPromises();
    expect(release).toHaveBeenCalledWith({ broken: true });
    expect(console.error).toHaveBeenCalled();
    jest.mocked(console.error).mockClear();
  });

  it("releases only the logical session when a remote operation rejects", async () => {
    const error = new Error("remote failed");
    const release = jest.fn(async () => undefined);
    const handleWorkerError = jest.fn();
    const builder = new StateTransitionsDatasetBuilder({
      acquireWorker: async () =>
        makeLease(
          {
            async applyActions() {},
            async getViewportDatasets() {
              throw error;
            },
          },
          release,
        ),
      handleWorkerError,
    });

    await expect(
      builder.getViewportDatasets({ xBounds: { min: 0, max: 1 }, showPoints: false }),
    ).rejects.toBe(error);
    await flushPromises();
    expect(release).toHaveBeenCalledWith({ broken: false });
    expect(handleWorkerError).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
    jest.mocked(console.error).mockClear();
    builder.destroy();
  });
});
