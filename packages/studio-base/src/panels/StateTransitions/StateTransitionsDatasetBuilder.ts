// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import race from "race-as-promised";

import { transferTypedArrays } from "@foxglove/den/worker";
import Logger from "@foxglove/log";
import { Immutable } from "@foxglove/studio";
import {
  acquireStateTransitionsDatasetBuilder,
  StateTransitionsDatasetWorkerLease,
} from "@foxglove/studio-base/panels/shared/DatasetWorkerPool";

import {
  PackedStateTransitionDataset,
  StateTransitionsDatasetAction,
  StateTransitionsDatasetBuilderImpl,
  StateTransitionsDatasetRequest,
} from "./StateTransitionsDatasetBuilderImpl";

const log = Logger.getLogger(__filename);

export interface IStateTransitionsDatasetBuilder {
  applyActions(actions: Immutable<StateTransitionsDatasetAction[]>): void;
  applyActionsAndFlush(actions: Immutable<StateTransitionsDatasetAction[]>): Promise<void>;
  getViewportDatasets(
    request: Immutable<StateTransitionsDatasetRequest>,
  ): Promise<PackedStateTransitionDataset[]>;
  destroy(): void;
}

type AcquireWorker = typeof acquireStateTransitionsDatasetBuilder;

type ViewportJob = {
  actions: StateTransitionsDatasetAction[];
  reject: (error: Error) => void;
  request: Immutable<StateTransitionsDatasetRequest>;
  resolve: (result: PackedStateTransitionDataset[]) => void;
  staleWaiters: {
    reject: (error: Error) => void;
    resolve: () => void;
  }[];
  type: "viewport";
};

type FlushJob = {
  actions: StateTransitionsDatasetAction[];
  reject: (error: Error) => void;
  resolve: () => void;
  type: "flush";
};

type BuilderJob = ViewportJob | FlushJob;

type BuilderLifetime = {
  abortController: AbortController;
  destroyPromise?: Promise<void>;
  fail: (error: Error) => boolean;
  failure?: Error;
  failurePromise: Promise<never>;
  inFlight: Set<Promise<unknown>>;
  leasePromise: Promise<StateTransitionsDatasetWorkerLease>;
  physicalFailure: boolean;
  pumpPromise?: Promise<void>;
  pumping: boolean;
  queue: BuilderJob[];
  releasePromise?: Promise<void>;
  reportError: (error: Error) => void;
};

// The held lifetime never points back to its builder, so registration does not prevent GC.
const registry = new FinalizationRegistry<BuilderLifetime>((lifetime) => {
  void destroyLifetime(lifetime).catch((error: unknown) => {
    log.error("[StateTransitionsDatasetBuilder] Failed to finalize worker session", error);
  });
});

/** Dataset-worker client with serialized ingestion and a latest-wins viewport queue. */
export class StateTransitionsDatasetBuilder implements IStateTransitionsDatasetBuilder {
  #destroyed = false;
  #lifetime: BuilderLifetime;
  #pendingActions: StateTransitionsDatasetAction[] = [];

  public constructor({
    acquireWorker = acquireStateTransitionsDatasetBuilder,
    handleWorkerError,
  }: {
    /** Intended for focused lifecycle tests. */
    acquireWorker?: AcquireWorker;
    handleWorkerError?: (event: Event) => void;
  } = {}) {
    const abortController = new AbortController();
    let rejectFailure!: (error: Error) => void;
    const failurePromise = new Promise<never>((_resolve, reject) => {
      rejectFailure = reject;
    });
    // Every remote operation races this promise, but also attach a permanent rejection handler for
    // a worker failure that occurs while the builder is idle.
    void failurePromise.catch(() => undefined);

    const lifetime: BuilderLifetime = {
      abortController,
      fail: (error: Error) => {
        if (lifetime.failure != undefined) {
          return false;
        }
        lifetime.failure = error;
        rejectFailure(error);
        failQueuedJobs(lifetime, error);
        return true;
      },
      failurePromise,
      inFlight: new Set<Promise<unknown>>(),
      leasePromise: undefined as unknown as Promise<StateTransitionsDatasetWorkerLease>,
      physicalFailure: false,
      pumping: false,
      queue: [],
      reportError: (error: Error) => {
        log.error("[StateTransitionsDatasetBuilder] Dataset worker session failed", error);
        try {
          handleWorkerError?.(makeErrorEvent(error));
        } catch (handlerError) {
          log.error("[StateTransitionsDatasetBuilder] Worker error handler failed", handlerError);
        }
      },
    };

    lifetime.leasePromise = acquireWorker({
      handleWorkerError: (event) => {
        lifetime.physicalFailure = true;
        const error = new Error("State transitions Dataset worker failed", { cause: event });
        const isFirstFailure = lifetime.fail(error);
        log.error("[StateTransitionsDatasetBuilder] Worker error:", event);
        if (isFirstFailure) {
          try {
            handleWorkerError?.(event);
          } catch (handlerError) {
            log.error("[StateTransitionsDatasetBuilder] Worker error handler failed", handlerError);
          }
        }
      },
      signal: abortController.signal,
    });
    this.#lifetime = lifetime;

    // Creation may reject before any viewport request observes the lease promise.
    void lifetime.leasePromise.catch((error: unknown) => {
      if (lifetime.abortController.signal.aborted) {
        return;
      }
      const normalized = normalizeError(error, "Failed to create Dataset worker session");
      const isFirstFailure = lifetime.fail(normalized);
      if (isFirstFailure) {
        lifetime.reportError(normalized);
      }
    });
    registry.register(this, lifetime, lifetime);
  }

  public applyActions(actions: Immutable<StateTransitionsDatasetAction[]>): void {
    if (!this.#destroyed) {
      appendActions(this.#pendingActions, actions);
    }
  }

  public async applyActionsAndFlush(
    actions: Immutable<StateTransitionsDatasetAction[]>,
  ): Promise<void> {
    if (this.#destroyed) {
      return;
    }
    const pending = this.#takePendingActions();
    appendActions(pending, actions);
    await enqueueFlush(this.#lifetime, pending);
  }

  public async getViewportDatasets(
    request: Immutable<StateTransitionsDatasetRequest>,
  ): Promise<PackedStateTransitionDataset[]> {
    if (this.#destroyed) {
      return [];
    }
    return await enqueueViewport(this.#lifetime, this.#takePendingActions(), request);
  }

  public destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#pendingActions = [];
    registry.unregister(this.#lifetime);
    void destroyLifetime(this.#lifetime).catch((error: unknown) => {
      log.error("[StateTransitionsDatasetBuilder] Failed to destroy worker session", error);
    });
  }

  #takePendingActions(): StateTransitionsDatasetAction[] {
    const pending = this.#pendingActions;
    this.#pendingActions = [];
    return pending;
  }
}

/** In-process adapter used by focused coordinator tests. */
export class LocalStateTransitionsDatasetBuilder implements IStateTransitionsDatasetBuilder {
  readonly #impl = new StateTransitionsDatasetBuilderImpl();
  #destroyed = false;

  public applyActions(actions: Immutable<StateTransitionsDatasetAction[]>): void {
    if (!this.#destroyed) {
      this.#impl.applyActions(actions);
    }
  }

  public async applyActionsAndFlush(
    actions: Immutable<StateTransitionsDatasetAction[]>,
  ): Promise<void> {
    this.applyActions(actions);
  }

  public async getViewportDatasets(
    request: Immutable<StateTransitionsDatasetRequest>,
  ): Promise<PackedStateTransitionDataset[]> {
    return this.#destroyed ? [] : this.#impl.getViewportDatasets(request);
  }

  public destroy(): void {
    this.#destroyed = true;
  }
}

async function enqueueViewport(
  lifetime: BuilderLifetime,
  actions: StateTransitionsDatasetAction[],
  request: Immutable<StateTransitionsDatasetRequest>,
): Promise<PackedStateTransitionDataset[]> {
  if (lifetime.abortController.signal.aborted) {
    return [];
  }
  if (lifetime.failure != undefined) {
    throw lifetime.failure;
  }

  return await new Promise<PackedStateTransitionDataset[]>((resolve, reject) => {
    const queued = lifetime.queue.at(-1);
    if (queued?.type === "viewport") {
      appendActions(queued.actions, actions);
      // Only the newest caller receives the transferable buffers. Older callers are stale and
      // eventually resolve empty, preventing two consumers from transferring the same ArrayBuffers.
      // Keep them pending until their ingestion has reached the worker.
      const staleResolve = queued.resolve;
      queued.staleWaiters.push({
        reject: queued.reject,
        resolve: () => {
          staleResolve([]);
        },
      });
      queued.request = request;
      queued.resolve = resolve;
      queued.reject = reject;
    } else {
      lifetime.queue.push({
        actions,
        reject,
        request,
        resolve,
        staleWaiters: [],
        type: "viewport",
      });
    }
    startPump(lifetime);
  });
}

async function enqueueFlush(
  lifetime: BuilderLifetime,
  actions: StateTransitionsDatasetAction[],
): Promise<void> {
  if (lifetime.abortController.signal.aborted) {
    return;
  }
  if (lifetime.failure != undefined) {
    throw lifetime.failure;
  }

  await new Promise<void>((resolve, reject) => {
    lifetime.queue.push({ actions, reject, resolve, type: "flush" });
    startPump(lifetime);
  });
}

function startPump(lifetime: BuilderLifetime): void {
  if (lifetime.pumping) {
    return;
  }
  lifetime.pumping = true;
  const pumpPromise = pumpQueue(lifetime);
  lifetime.pumpPromise = pumpPromise;
  void pumpPromise.then(
    () => {
      if (lifetime.pumpPromise === pumpPromise) {
        lifetime.pumpPromise = undefined;
      }
      lifetime.pumping = false;
      if (lifetime.queue.length > 0) {
        startPump(lifetime);
      }
    },
    (error: unknown) => {
      // pumpQueue handles individual job failures. This guard keeps an implementation mistake from
      // becoming an unhandled background rejection.
      const normalized = normalizeError(error, "Dataset worker queue failed");
      lifetime.pumping = false;
      lifetime.fail(normalized);
      lifetime.reportError(normalized);
    },
  );
}

async function pumpQueue(lifetime: BuilderLifetime): Promise<void> {
  while (lifetime.queue.length > 0) {
    const job = lifetime.queue.shift()!;
    if (lifetime.abortController.signal.aborted) {
      settleDestroyedJob(job);
      continue;
    }
    if (lifetime.failure != undefined) {
      if (job.type === "viewport") {
        failStaleViewportWaiters(job, lifetime.failure);
      }
      job.reject(lifetime.failure);
      continue;
    }

    try {
      const lease = await race([lifetime.leasePromise, lifetime.failurePromise]);
      if (job.actions.length > 0) {
        await runRemote(lifetime, async () => {
          await lease.remote.applyActions(transferTypedArrays(job.actions));
        });
      }

      if (job.type === "flush") {
        job.resolve();
        continue;
      }
      settleStaleViewportWaiters(job);

      const result = await runRemote(lifetime, async () => {
        return await lease.remote.getViewportDatasets(job.request);
      });
      job.resolve(isLifetimeAborted(lifetime) ? [] : result);
    } catch (error) {
      if (isLifetimeAborted(lifetime)) {
        settleDestroyedJob(job);
        continue;
      }

      const normalized = normalizeError(error, "Dataset worker operation failed");
      const isFirstFailure = lifetime.fail(normalized);
      if (isFirstFailure) {
        lifetime.reportError(normalized);
      }
      if (job.type === "viewport") {
        failStaleViewportWaiters(job, normalized);
      }
      job.reject(normalized);
      void releaseLifetime(lifetime, { broken: lifetime.physicalFailure }).catch(
        (releaseError: unknown) => {
          log.error(
            "[StateTransitionsDatasetBuilder] Failed to release failed session",
            releaseError,
          );
        },
      );
    }
  }
}

async function runRemote<T>(lifetime: BuilderLifetime, operation: () => Promise<T>): Promise<T> {
  const promise = Promise.resolve().then(operation);
  lifetime.inFlight.add(promise);
  void promise.then(
    () => {
      lifetime.inFlight.delete(promise);
    },
    () => {
      lifetime.inFlight.delete(promise);
    },
  );
  return await race([promise, lifetime.failurePromise]);
}

async function destroyLifetime(lifetime: BuilderLifetime): Promise<void> {
  if (lifetime.destroyPromise != undefined) {
    await lifetime.destroyPromise;
    return;
  }

  lifetime.abortController.abort();
  settleQueuedJobsAsDestroyed(lifetime);
  lifetime.destroyPromise = (async () => {
    await lifetime.pumpPromise;
    // A broken Worker may leave its raw RPC promise pending forever. Its physical endpoint is
    // retired below; normal destruction still waits for all in-flight RPCs before releasing.
    if (lifetime.failure == undefined) {
      await Promise.allSettled([...lifetime.inFlight]);
    }
    await releaseLifetime(lifetime, { broken: lifetime.physicalFailure });
  })();
  await lifetime.destroyPromise;
}

async function releaseLifetime(
  lifetime: BuilderLifetime,
  options: { broken: boolean },
): Promise<void> {
  lifetime.releasePromise ??= (async () => {
    const lease = await lifetime.leasePromise.catch(() => undefined);
    await lease?.release(options);
  })();
  await lifetime.releasePromise;
}

function isLifetimeAborted(lifetime: BuilderLifetime): boolean {
  return lifetime.abortController.signal.aborted;
}

function failQueuedJobs(lifetime: BuilderLifetime, error: Error): void {
  for (const job of lifetime.queue.splice(0)) {
    if (job.type === "viewport") {
      failStaleViewportWaiters(job, error);
    }
    job.reject(error);
  }
}

function settleQueuedJobsAsDestroyed(lifetime: BuilderLifetime): void {
  for (const job of lifetime.queue.splice(0)) {
    settleDestroyedJob(job);
  }
}

function settleDestroyedJob(job: BuilderJob): void {
  if (job.type === "viewport") {
    settleStaleViewportWaiters(job);
    job.resolve([]);
  } else {
    job.resolve();
  }
}

function settleStaleViewportWaiters(job: ViewportJob): void {
  for (const waiter of job.staleWaiters.splice(0)) {
    waiter.resolve();
  }
}

function failStaleViewportWaiters(job: ViewportJob, error: Error): void {
  for (const waiter of job.staleWaiters.splice(0)) {
    waiter.reject(error);
  }
}

function appendActions(
  target: StateTransitionsDatasetAction[],
  actions: Immutable<StateTransitionsDatasetAction[]>,
): void {
  for (const action of actions) {
    target.push(action as StateTransitionsDatasetAction);
  }
}

function makeErrorEvent(error: Error): Event {
  if (typeof ErrorEvent !== "undefined") {
    return new ErrorEvent("error", { error, message: error.message });
  }
  return new Event("error");
}

function normalizeError(error: unknown, message: string): Error {
  return error instanceof Error ? error : new Error(message, { cause: error });
}
