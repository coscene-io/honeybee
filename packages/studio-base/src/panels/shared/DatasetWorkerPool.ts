// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { WorkerSessionPool } from "@foxglove/den/worker";
import Logger from "@foxglove/log";
import type { TimestampDatasetsBuilderImpl } from "@foxglove/studio-base/panels/Plot/builders/TimestampDatasetsBuilderImpl";

import type {
  CustomDatasetsBuilderSessionService,
  Service,
  StateTransitionsDatasetSessionService,
} from "./DatasetWorker.worker";

const log = Logger.getLogger(__filename);

export type TimestampDatasetsBuilderRemote = Comlink.Remote<
  Comlink.RemoteObject<TimestampDatasetsBuilderImpl>
>;

export type TimestampDatasetWorkerLease = {
  remote: TimestampDatasetsBuilderRemote;
  /** Release is idempotent. A broken lease also retires its physical worker. */
  release: (options?: { broken?: boolean }) => Promise<void>;
};

export type CustomDatasetsBuilderRemote = Comlink.Remote<
  Comlink.RemoteObject<CustomDatasetsBuilderSessionService>
>;

export type CustomDatasetWorkerLease = {
  remote: CustomDatasetsBuilderRemote;
  /** Release is idempotent. A broken lease also retires its physical worker. */
  release: (options?: { broken?: boolean }) => Promise<void>;
};

export type StateTransitionsDatasetBuilderRemote = Comlink.Remote<
  Comlink.RemoteObject<StateTransitionsDatasetSessionService>
>;

export type StateTransitionsDatasetWorkerLease = {
  remote: StateTransitionsDatasetBuilderRemote;
  /** Release is idempotent. A broken lease also retires its physical worker. */
  release: (options?: { broken?: boolean }) => Promise<void>;
};

type ReleasableRemote = {
  [Comlink.releaseProxy](): void;
};

type SessionRecord = {
  failRemote?: (error: Error) => void;
  handleWorkerError?: (event: Event) => void;
  host: DatasetWorkerHost;
  markBroken?: () => void;
  remote?: ReleasableRemote;
  remotePromise: Promise<ReleasableRemote>;
};

type DatasetWorkerHost = {
  broken: boolean;
  dispose: () => void;
  handleError: (event: Event) => void;
  handleMessageError: (event: Event) => void;
  remote: Comlink.Remote<
    Service<
      Comlink.RemoteObject<TimestampDatasetsBuilderImpl>,
      Comlink.RemoteObject<StateTransitionsDatasetSessionService>,
      Comlink.RemoteObject<CustomDatasetsBuilderSessionService>
    >
  >;
  sessions: Set<SessionRecord>;
  worker: Worker;
};

export type DatasetWorkerPoolOptions = {
  /** Intended for tests; production uses the Dataset worker module. */
  createWorker?: () => Worker;
  maxWorkers?: number;
};

/**
 * Pools physical Dataset workers while keeping one isolated Comlink child object per panel.
 *
 * A physical worker may host several logical sessions. The underlying WorkerSessionPool creates
 * workers until `maxWorkers` is reached, then places new sessions on the least-loaded worker.
 */
export class DatasetWorkerPool {
  readonly #pool: WorkerSessionPool<DatasetWorkerHost>;

  public constructor(options: DatasetWorkerPoolOptions = {}) {
    const createWorker =
      options.createWorker ??
      (() =>
        new Worker(
          // foxglove-depcheck-used: babel-plugin-transform-import-meta
          new URL("./DatasetWorker.worker", import.meta.url),
        ));

    this.#pool = new WorkerSessionPool({
      createResource: () => createHost(createWorker()),
      disposeResource: (host) => {
        host.worker.removeEventListener("error", host.handleError);
        host.worker.removeEventListener("messageerror", host.handleMessageError);
        host.dispose();
      },
      isResourceBroken: (host) => host.broken,
      maxWorkers: options.maxWorkers,
    });
  }

  public async acquireTimestampDatasetsBuilder(options?: {
    handleWorkerError?: (event: Event) => void;
    signal?: AbortSignal;
  }): Promise<TimestampDatasetWorkerLease> {
    return await this.#acquireDatasetBuilder(
      async (host) =>
        (await host.remote.createTimestampDatasetsBuilder()) as TimestampDatasetsBuilderRemote,
      options,
    );
  }

  public async acquireCustomDatasetsBuilder(options?: {
    handleWorkerError?: (event: Event) => void;
    signal?: AbortSignal;
  }): Promise<CustomDatasetWorkerLease> {
    return await this.#acquireDatasetBuilder(
      async (host) =>
        (await host.remote.createCustomDatasetsBuilder()) as CustomDatasetsBuilderRemote,
      options,
    );
  }

  public async acquireStateTransitionsDatasetBuilder(options?: {
    handleWorkerError?: (event: Event) => void;
    signal?: AbortSignal;
  }): Promise<StateTransitionsDatasetWorkerLease> {
    return await this.#acquireDatasetBuilder(
      async (host) =>
        (await host.remote.createStateTransitionsDatasetBuilder()) as StateTransitionsDatasetBuilderRemote,
      options,
    );
  }

  async #acquireDatasetBuilder<TRemote extends ReleasableRemote>(
    createRemote: (host: DatasetWorkerHost) => Promise<TRemote>,
    options?: {
      handleWorkerError?: (event: Event) => void;
      signal?: AbortSignal;
    },
  ): Promise<{
    remote: TRemote;
    release: (options?: { broken?: boolean }) => Promise<void>;
  }> {
    const rawLease = await this.#pool.acquire({
      createSession: (host): SessionRecord => {
        // Return the record synchronously so the generic pool establishes the raw lease before the
        // remote constructor settles. Setup failure can then release only this logical reservation.
        let remotePromise: Promise<ReleasableRemote>;
        try {
          remotePromise = createRemote(host);
        } catch (error) {
          remotePromise = Promise.reject(
            normalizeError(error, "Dataset worker session setup failed"),
          );
        }
        const record: SessionRecord = {
          handleWorkerError: options?.handleWorkerError,
          host,
          remotePromise,
        };
        host.sessions.add(record);
        void remotePromise.then(
          (remote) => {
            record.remote = remote;
          },
          () => {
            // A rejected child constructor is a logical session setup failure. The physical Worker
            // remains usable by existing co-tenants and future child sessions.
          },
        );
        return record;
      },
      disposeSession,
      signal: options?.signal,
    });

    const record = rawLease.session;
    record.markBroken = () => {
      void rawLease.release({ broken: true }).catch((error: unknown) => {
        log.error("[DatasetWorkerPool] Failed to retire a broken Dataset worker", error);
      });
    };

    if (isHostBroken(record.host)) {
      await rawLease.release({ broken: true });
      throw new Error("Dataset worker failed while creating a session");
    }

    let remote: ReleasableRemote;
    try {
      remote = await waitForRemote(record, options?.signal);
    } catch (error) {
      const aborted = isAbortError(error);
      const releasePromise = rawLease.release();
      if (aborted) {
        // Remote construction cannot be cancelled. Let session cleanup finish in the background so
        // an AbortSignal remains responsive while the eventual child proxy is still released.
        void releasePromise.catch((releaseError: unknown) => {
          log.error(
            "[DatasetWorkerPool] Failed to release an aborted Dataset session",
            releaseError,
          );
        });
      } else {
        await releasePromise;
      }
      throw error;
    }

    if (isHostBroken(record.host)) {
      await rawLease.release({ broken: true });
      throw new Error("Dataset worker failed while creating a session");
    }

    return {
      remote: remote as TRemote,
      release: async (releaseOptions) => {
        if (releaseOptions?.broken === true) {
          // Fail sibling sessions loudly before their physical worker is retired. Terminating the
          // shared worker silently would leave other panels waiting on a dead Comlink endpoint.
          markHostBroken(
            record.host,
            makeSessionCreationErrorEvent(
              new Error("Dataset worker lease was released as broken"),
            ),
          );
        }
        await rawLease.release(releaseOptions);
      },
    };
  }

  public async dispose(): Promise<void> {
    await this.#pool.dispose();
  }
}

function createHost(worker: Worker): DatasetWorkerHost {
  const remote =
    Comlink.wrap<
      Service<
        Comlink.RemoteObject<TimestampDatasetsBuilderImpl>,
        Comlink.RemoteObject<StateTransitionsDatasetSessionService>,
        Comlink.RemoteObject<CustomDatasetsBuilderSessionService>
      >
    >(worker);
  let disposed = false;
  const host = {
    broken: false,
    dispose: () => {
      if (!disposed) {
        disposed = true;
        try {
          remote[Comlink.releaseProxy]();
        } finally {
          worker.terminate();
        }
      }
    },
    handleError: undefined as unknown as (event: Event) => void,
    handleMessageError: undefined as unknown as (event: Event) => void,
    remote,
    sessions: new Set<SessionRecord>(),
    worker,
  } satisfies DatasetWorkerHost;

  host.handleError = (event) => {
    log.error("[DatasetWorkerPool] Dataset worker error", event);
    markHostBroken(host, event);
  };
  host.handleMessageError = (event) => {
    log.error("[DatasetWorkerPool] Dataset worker message error", event);
    markHostBroken(host, event);
  };
  worker.addEventListener("error", host.handleError);
  worker.addEventListener("messageerror", host.handleMessageError);
  return host;
}

async function disposeSession(record: SessionRecord): Promise<void> {
  // Stop reporting physical errors to a panel as soon as its logical lease starts releasing. Keep
  // the record itself registered until setup settles so a later Worker failure can still retire the
  // physical host through markBroken.
  record.handleWorkerError = undefined;
  try {
    if (isHostBroken(record.host)) {
      // The physical endpoint is being terminated. Waiting for a pending Comlink constructor can
      // hang forever after a Worker failure. Release an already-created child best-effort; physical
      // Worker termination closes any endpoint that cannot answer.
      try {
        record.remote?.[Comlink.releaseProxy]();
      } catch {
        // The worker endpoint is already unusable; physical termination is the remaining cleanup.
      }
      return;
    }

    const remote = record.remote ?? (await waitForRemoteDuringDisposal(record));
    if (remote != undefined && !isHostBroken(record.host)) {
      try {
        remote[Comlink.releaseProxy]();
      } catch (error) {
        // Releasing one logical child must not evict healthy co-tenants. Physical endpoint errors
        // are handled exclusively by the Worker's error/messageerror listeners.
        log.error("[DatasetWorkerPool] Failed to release Dataset worker child session", error);
      }
    }
  } finally {
    // Keep the record registered while an asynchronous child constructor settles. If the Worker
    // fails meanwhile, markBroken must still retire the generic pool host rather than leave a
    // custom-host object that can be selected again.
    record.host.sessions.delete(record);
    record.failRemote = undefined;
    record.markBroken = undefined;
  }
}

/**
 * Waits for an asynchronously-created child during logical cleanup.
 *
 * A constructor rejection means no child exists to release and is therefore successful cleanup.
 * A physical Worker failure also stops the wait immediately; the host-level disposer will close the
 * endpoint. `failRemote` doubles as the host-failure notification while acquisition is no longer
 * waiting on this record.
 */
async function waitForRemoteDuringDisposal(
  record: SessionRecord,
): Promise<ReleasableRemote | undefined> {
  if (isHostBroken(record.host)) {
    return undefined;
  }

  return await new Promise<ReleasableRemote | undefined>((resolve) => {
    const finish = (remote: ReleasableRemote | undefined) => {
      if (record.failRemote === failRemote) {
        record.failRemote = undefined;
        resolve(remote);
      }
    };
    const failRemote = () => {
      finish(undefined);
    };
    record.failRemote = failRemote;
    void record.remotePromise.then(
      (remote) => {
        finish(remote);
      },
      () => {
        // Child construction failed before producing a proxy; there is nothing to release.
        finish(undefined);
      },
    );

    // Close the small window between the initial check and installing failRemote.
    if (isHostBroken(record.host)) {
      failRemote();
    }
  });
}

function markHostBroken(host: DatasetWorkerHost, event: Event): void {
  if (host.broken) {
    return;
  }
  host.broken = true;

  for (const session of [...host.sessions]) {
    try {
      session.failRemote?.(
        new Error("Dataset worker failed while creating a session", { cause: event }),
      );
      session.handleWorkerError?.(event);
    } catch (error) {
      log.error("[DatasetWorkerPool] Dataset worker error handler failed", error);
    }
    session.markBroken?.();
  }
}

async function waitForRemote(
  record: SessionRecord,
  signal: AbortSignal | undefined,
): Promise<ReleasableRemote> {
  if (signal == undefined) {
    return await new Promise<ReleasableRemote>((resolve, reject) => {
      const failRemote = (error: Error) => {
        record.failRemote = undefined;
        reject(error);
      };
      record.failRemote = failRemote;
      void record.remotePromise.then(
        (remote) => {
          if (record.failRemote === failRemote) {
            record.failRemote = undefined;
            resolve(remote);
          }
        },
        (error: unknown) => {
          if (record.failRemote === failRemote) {
            record.failRemote = undefined;
            reject(normalizeError(error, "Dataset worker session setup failed"));
          }
        },
      );
    });
  }
  if (signal.aborted) {
    throw makeAbortError();
  }

  return await new Promise<ReleasableRemote>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", onAbort);
      if (record.failRemote === failRemote) {
        record.failRemote = undefined;
      }
    };
    const onAbort = () => {
      finish();
      reject(makeAbortError());
    };
    const failRemote = (error: Error) => {
      finish();
      reject(error);
    };
    record.failRemote = failRemote;
    signal.addEventListener("abort", onAbort, { once: true });
    void record.remotePromise.then(
      (remote) => {
        if (record.failRemote === failRemote) {
          finish();
          resolve(remote);
        }
      },
      (error: unknown) => {
        if (record.failRemote === failRemote) {
          finish();
          reject(normalizeError(error, "Dataset worker session setup failed"));
        }
      },
    );
  });
}

function makeAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isHostBroken(host: DatasetWorkerHost): boolean {
  return host.broken;
}

function normalizeError(error: unknown, message: string): Error {
  return error instanceof Error ? error : new Error(message, { cause: error });
}

const sharedDatasetWorkerPool = new DatasetWorkerPool();

export async function acquireTimestampDatasetsBuilder(options?: {
  handleWorkerError?: (event: Event) => void;
  signal?: AbortSignal;
}): Promise<TimestampDatasetWorkerLease> {
  return await sharedDatasetWorkerPool.acquireTimestampDatasetsBuilder(options);
}

export async function acquireCustomDatasetsBuilder(options?: {
  handleWorkerError?: (event: Event) => void;
  signal?: AbortSignal;
}): Promise<CustomDatasetWorkerLease> {
  return await sharedDatasetWorkerPool.acquireCustomDatasetsBuilder(options);
}

export async function acquireStateTransitionsDatasetBuilder(options?: {
  handleWorkerError?: (event: Event) => void;
  signal?: AbortSignal;
}): Promise<StateTransitionsDatasetWorkerLease> {
  return await sharedDatasetWorkerPool.acquireStateTransitionsDatasetBuilder(options);
}
