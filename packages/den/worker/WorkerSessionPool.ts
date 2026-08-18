// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

type MaybePromise<T> = T | PromiseLike<T>;

const FALLBACK_HARDWARE_CONCURRENCY = 4;
const MAX_DEFAULT_WORKERS = 32;

export type WorkerSessionLease<TSession> = {
  session: TSession;
  /** The first call starts cleanup; later calls return the same promise and may still mark broken. */
  release: (options?: { broken?: boolean }) => Promise<void>;
};

export type WorkerSessionPoolOptions<TResource> = {
  createResource: () => MaybePromise<TResource>;
  disposeResource: (resource: TResource) => MaybePromise<void>;
  /** Detect resources that failed independently while they were idle in the pool. */
  isResourceBroken?: (resource: TResource) => boolean;
  maxWorkers?: number;
  /** Keep resources with no active sessions available for future acquisitions. */
  keepAlive?: boolean;
};

export type AcquireWorkerSessionOptions<TResource, TSession> = {
  createSession: (resource: TResource) => MaybePromise<TSession>;
  disposeSession: (session: TSession) => MaybePromise<void>;
  signal?: AbortSignal;
};

type ResourceHost<TResource> = {
  activeSessions: number;
  broken: boolean;
  resourceCreated: boolean;
  resource?: TResource;
  resourcePromise: Promise<TResource>;
  retirementPromise?: Promise<void>;
};

type SessionSetupOutcome<TSession> =
  | { type: "created"; session: TSession }
  | { type: "failed"; error: unknown }
  | { type: "aborted"; error: Error };

/**
 * Chooses a conservative default based on the browser's reported logical processor count.
 * The cap protects against implausibly large or virtualized hardware-concurrency values.
 */
export function getDefaultWorkerSessionPoolCapacity(
  hardwareConcurrency: number | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.hardwareConcurrency,
): number {
  const concurrency =
    hardwareConcurrency != undefined && Number.isFinite(hardwareConcurrency)
      ? Math.floor(hardwareConcurrency)
      : FALLBACK_HARDWARE_CONCURRENCY;
  return Math.min(MAX_DEFAULT_WORKERS, Math.max(1, concurrency - 1));
}

/**
 * A bounded pool of physical resources that can each host multiple long-lived logical sessions.
 *
 * While the pool has room it creates a new physical resource for each acquisition. Once it reaches
 * `maxWorkers`, new sessions are assigned to the non-broken resource with the fewest active
 * sessions. A broken resource is excluded immediately and disposed before its capacity slot is
 * reused.
 */
export class WorkerSessionPool<TResource> {
  readonly #createResource: () => MaybePromise<TResource>;
  readonly #disposeResource: (resource: TResource) => MaybePromise<void>;
  readonly #isResourceBroken?: (resource: TResource) => boolean;
  readonly #keepAlive: boolean;
  readonly #maxWorkers: number;

  #disposed = false;
  #disposePromise?: Promise<void>;
  #hosts: ResourceHost<TResource>[] = [];
  #stateWaiters = new Set<() => void>();

  public constructor(options: WorkerSessionPoolOptions<TResource>) {
    const maxWorkers = options.maxWorkers ?? getDefaultWorkerSessionPoolCapacity();
    if (!Number.isSafeInteger(maxWorkers) || maxWorkers <= 0) {
      throw new RangeError("maxWorkers must be a positive safe integer");
    }

    this.#createResource = options.createResource;
    this.#disposeResource = options.disposeResource;
    this.#isResourceBroken = options.isResourceBroken;
    this.#keepAlive = options.keepAlive ?? true;
    this.#maxWorkers = maxWorkers;
  }

  public async acquire<TSession>(
    options: AcquireWorkerSessionOptions<TResource, TSession>,
  ): Promise<WorkerSessionLease<TSession>> {
    this.#throwIfUnavailable(options.signal);
    const host = await this.#reserveHost(options.signal);

    if (options.signal?.aborted === true) {
      this.#finishSession(host);
      throw makeAbortError();
    }

    const setupPromise = host.resourcePromise.then(async (resource) => {
      if (options.signal?.aborted === true) {
        throw makeAbortError();
      }
      return await options.createSession(resource);
    });

    const { outcome, removeAbortListener } = makeSessionSetupOutcome(setupPromise, options.signal);
    const result = await outcome;
    removeAbortListener();

    if (result.type === "failed") {
      this.#finishSession(host);
      throw result.error;
    }

    if (result.type === "aborted") {
      // Session creation cannot always be cancelled. If it finishes later, clean it up without
      // allowing the abandoned reservation to keep the host busy forever.
      void setupPromise
        .then(
          async (session) => {
            await this.#releaseSession(host, session, options.disposeSession);
          },
          () => {
            this.#finishSession(host);
          },
        )
        .catch(() => undefined);
      throw result.error;
    }

    let releasePromise: Promise<void> | undefined;
    let retirementFollowupAttached = false;
    return {
      session: result.session,
      // oxlint-disable-next-line typescript/promise-function-async -- repeated calls intentionally return the identical promise
      release: (releaseOptions) => {
        if (releaseOptions?.broken === true) {
          host.broken = true;
          if (releasePromise != undefined && !retirementFollowupAttached) {
            retirementFollowupAttached = true;
            void releasePromise
              .then(async () => {
                await this.#retireHost(host);
              })
              .catch(() => undefined);
          }
        }
        releasePromise ??= this.#releaseSession(
          host,
          result.session,
          options.disposeSession,
          releaseOptions,
        );
        return releasePromise;
      },
    };
  }

  /**
   * Rejects future acquisitions and disposes resources that are currently idle. Resources with
   * active sessions are disposed when their final lease is released.
   */
  public async dispose(): Promise<void> {
    if (this.#disposePromise != undefined) {
      await this.#disposePromise;
      return;
    }

    this.#disposed = true;
    this.#notifyStateWaiters();
    const idleHosts = this.#hosts.filter((host) => host.activeSessions === 0);
    this.#disposePromise = Promise.all(
      idleHosts.map(async (host) => {
        await this.#retireHost(host);
      }),
    ).then(() => undefined);
    await this.#disposePromise;
  }

  async #reserveHost(signal: AbortSignal | undefined): Promise<ResourceHost<TResource>> {
    for (;;) {
      this.#throwIfUnavailable(signal);

      for (const candidate of this.#hosts) {
        if (
          !candidate.broken &&
          candidate.resourceCreated &&
          this.#isResourceBroken?.(candidate.resource as TResource) === true
        ) {
          candidate.broken = true;
          if (candidate.activeSessions === 0) {
            void this.#retireHost(candidate).catch(() => undefined);
          }
        }
      }

      let host: ResourceHost<TResource> | undefined;
      if (this.#hosts.length < this.#maxWorkers) {
        host = this.#createHost();
      } else {
        for (const candidate of this.#hosts) {
          if (
            !candidate.broken &&
            candidate.retirementPromise == undefined &&
            (host == undefined || candidate.activeSessions < host.activeSessions)
          ) {
            host = candidate;
          }
        }
      }

      if (host != undefined) {
        host.activeSessions++;
        return host;
      }

      // Every capacity slot is occupied by a broken resource that is retiring. Wait until a slot
      // is actually freed so asynchronous disposal never exceeds maxWorkers transiently.
      await this.#waitForStateChange(signal);
    }
  }

  #createHost(): ResourceHost<TResource> {
    const host: ResourceHost<TResource> = {
      activeSessions: 0,
      broken: false,
      resourceCreated: false,
      resourcePromise: undefined as unknown as Promise<TResource>,
    };
    host.resourcePromise = Promise.resolve()
      .then(async () => await this.#createResource())
      .then(
        (resource) => {
          host.resource = resource;
          host.resourceCreated = true;
          return resource;
        },
        (error: unknown) => {
          host.broken = true;
          void this.#retireHost(host).catch(() => undefined);
          throw error;
        },
      );
    this.#hosts.push(host);
    return host;
  }

  async #releaseSession<TSession>(
    host: ResourceHost<TResource>,
    session: TSession,
    disposeSession: (session: TSession) => MaybePromise<void>,
    options?: { broken?: boolean },
  ): Promise<void> {
    if (options?.broken === true) {
      host.broken = true;
    }

    let sessionError: Error | undefined;
    try {
      await disposeSession(session);
    } catch (error) {
      sessionError = normalizeError(error, "Failed to dispose the worker session");
      // One session's failed cleanup must not tear a shared resource out from under its sibling
      // sessions. Retire the resource only when it cannot prove it is still healthy.
      if (
        this.#isResourceBroken == undefined ||
        !host.resourceCreated ||
        this.#isResourceBroken(host.resource as TResource)
      ) {
        host.broken = true;
      }
    } finally {
      this.#finishSession(host);
    }

    let resourceError: Error | undefined;
    if (host.broken) {
      try {
        await this.#retireHost(host);
      } catch (error) {
        resourceError = normalizeError(error, "Failed to dispose the worker resource");
      }
    }

    if (sessionError != undefined && resourceError != undefined) {
      throw new AggregateError(
        [sessionError, resourceError],
        "Failed to dispose the worker session and its resource",
      );
    }
    if (sessionError != undefined) {
      throw sessionError;
    }
    if (resourceError != undefined) {
      throw resourceError;
    }
  }

  #finishSession(host: ResourceHost<TResource>): void {
    host.activeSessions--;
    if (host.activeSessions < 0) {
      throw new Error("WorkerSessionPool session count became negative");
    }

    if (
      host.activeSessions === 0 &&
      host.retirementPromise == undefined &&
      (host.broken || this.#disposed || !this.#keepAlive)
    ) {
      void this.#retireHost(host).catch(() => undefined);
    }
  }

  async #retireHost(host: ResourceHost<TResource>): Promise<void> {
    if (host.retirementPromise != undefined) {
      await host.retirementPromise;
      return;
    }

    // Mark first so the host cannot be selected while asynchronous cleanup is in progress.
    host.broken = true;
    host.retirementPromise = (async () => {
      try {
        await host.resourcePromise.catch(() => undefined);
        if (host.resourceCreated) {
          await this.#disposeResource(host.resource as TResource);
        }
      } finally {
        const index = this.#hosts.indexOf(host);
        if (index >= 0) {
          this.#hosts.splice(index, 1);
        }
        this.#notifyStateWaiters();
      }
    })();
    await host.retirementPromise;
  }

  async #waitForStateChange(signal: AbortSignal | undefined): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        this.#stateWaiters.delete(onStateChange);
        signal?.removeEventListener("abort", onAbort);
      };
      const onStateChange = () => {
        finish();
        resolve();
      };
      const onAbort = () => {
        finish();
        reject(makeAbortError());
      };

      this.#stateWaiters.add(onStateChange);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (this.#disposed) {
        finish();
        reject(new Error("WorkerSessionPool has been disposed"));
      } else if (signal?.aborted === true) {
        onAbort();
      }
    });
  }

  #notifyStateWaiters(): void {
    const waiters = [...this.#stateWaiters];
    this.#stateWaiters.clear();
    for (const notify of waiters) {
      notify();
    }
  }

  #throwIfUnavailable(signal: AbortSignal | undefined): void {
    if (this.#disposed) {
      throw new Error("WorkerSessionPool has been disposed");
    }
    if (signal?.aborted === true) {
      throw makeAbortError();
    }
  }
}

function makeSessionSetupOutcome<TSession>(
  setupPromise: Promise<TSession>,
  signal: AbortSignal | undefined,
): {
  outcome: Promise<SessionSetupOutcome<TSession>>;
  removeAbortListener: () => void;
} {
  let onAbort: (() => void) | undefined;
  const outcome = new Promise<SessionSetupOutcome<TSession>>((resolve) => {
    let settled = false;
    const settle = (result: SessionSetupOutcome<TSession>) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    void setupPromise.then(
      (session) => {
        settle({ type: "created", session });
      },
      (error: unknown) => {
        settle({ type: "failed", error });
      },
    );

    if (signal != undefined) {
      onAbort = () => {
        settle({ type: "aborted", error: makeAbortError() });
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });

  return {
    outcome,
    removeAbortListener: () => {
      if (onAbort != undefined) {
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

function makeAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function normalizeError(error: unknown, message: string): Error {
  return error instanceof Error ? error : new Error(message, { cause: error });
}
