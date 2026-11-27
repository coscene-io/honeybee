// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { ComlinkWrap } from "@foxglove/den/worker";
import Logger from "@foxglove/log";

import type { SegmentationMaskGeometry } from "../imageSource";
import { buildMaskPlanes, planeBytes, type MaskPlanes } from "./maskPlanes";

const log = Logger.getLogger(__filename);

/**
 * CPU-side bit planes, built in one shared Worker and kept in an LRU bounded by bytes. RLE counts
 * stay in the document (tens of KB per frame); only built planes count against this budget. The
 * GPU holds one plane texture per visible panel, never the cache.
 */
export const MASK_PLANE_CACHE_BYTES = 96 * 1024 * 1024;

/** Part of the budget prefetch may fill; the rest is headroom for the frames panels display. */
const PREFETCH_BUDGET_SHARE = 0.75;

/** A failed build is retried after this long, at most MAX_BUILD_ATTEMPTS times in all. */
const BUILD_RETRY_MS = 2000;
const MAX_BUILD_ATTEMPTS = 3;

export type MaskPlaneStats = {
  built: number;
  hits: number;
  /** A displayed frame whose planes were not ready: the mask was withheld, never shown stale. */
  misses: number;
  /** Why misses happened: still building, built then evicted, or never requested before display. */
  missPending: number;
  missEvicted: number;
  missUnrequested: number;
  evicted: number;
  errors: number;
  /** Total and worst build time, in ms. */
  buildMsTotal: number;
  buildMsMax: number;
  cachedBytes: number;
};

type MaskPlaneService = (typeof import("./maskPlanes.worker"))["service"];
type Builder = { remote: Comlink.Remote<MaskPlaneService>; dispose: () => void };
type Pending = { geometry: SegmentationMaskGeometry };
type Failure = { message: string; attempts: number; at: number; permanent: boolean };

/** What one panel is doing with the cache on its latest render frame. */
export type MaskPlaneConsumerState = {
  /** Geometry of the frame it draws; pinned, so prefetch of any panel never evicts it. */
  displayed?: number;
  /** It has masks on or ahead of its frame. Only such panels split the prefetch budget. */
  active: boolean;
};

export class MaskPlaneCache {
  readonly #entries = new Map<number, MaskPlanes>();
  readonly #pending = new Map<number, Pending>();
  readonly #errors = new Map<number, Failure>();
  readonly #listeners = new Set<() => void>();
  readonly #retryTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Recently evicted ids, only to classify misses. Bounded. */
  readonly #evictedIds = new Set<number>();
  readonly #consumers = new Map<object, MaskPlaneConsumerState>();
  #bytes = 0;
  #builder: Builder | undefined;
  #workerFailed = false;
  public readonly stats: MaskPlaneStats = {
    built: 0,
    hits: 0,
    misses: 0,
    missPending: 0,
    missEvicted: 0,
    missUnrequested: 0,
    evicted: 0,
    errors: 0,
    buildMsTotal: 0,
    buildMsMax: 0,
    cachedBytes: 0,
  };

  public constructor(
    private readonly createWorker: (() => Worker) | undefined,
    private readonly budgetBytes = MASK_PLANE_CACHE_BYTES,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** A panel that draws from and prefetches into this cache. Returns the unregister function. */
  public addConsumer(consumer: object): () => void {
    this.#consumers.set(consumer, { active: false });
    return () => {
      this.#consumers.delete(consumer);
    };
  }

  /** Report what a consumer draws and whether it needs masks; see MaskPlaneConsumerState. */
  public updateConsumer(consumer: object, state: MaskPlaneConsumerState): void {
    if (this.#consumers.has(consumer)) {
      this.#consumers.set(consumer, state);
    }
  }

  /**
   * How many frames past the displayed one each consumer may prefetch so that every active
   * consumer's set fits in the budget together. A larger working set evicts the frames another
   * camera is about to draw; rebuilding them evicts others in turn, and the panels re-render
   * forever, even paused. Panels without masks (another topic, nothing annotated) take no share.
   */
  public framesAhead(frameBytes: number, wanted: number): number {
    let active = 0;
    for (const state of this.#consumers.values()) {
      if (state.active) {
        active++;
      }
    }
    const share = (this.budgetBytes * PREFETCH_BUDGET_SHARE) / Math.max(1, active);
    return Math.max(0, Math.min(wanted, Math.floor(share / Math.max(1, frameBytes)) - 1));
  }

  public onReady(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Planes for displayed geometry, or undefined (and a build request) when not ready yet. */
  public get(geometry: SegmentationMaskGeometry): MaskPlanes | undefined {
    const planes = this.#entries.get(geometry.id);
    if (planes) {
      this.#entries.delete(geometry.id);
      this.#entries.set(geometry.id, planes);
      this.stats.hits++;
      return planes;
    }
    if (this.#retryable(geometry.id)) {
      this.stats.misses++;
      if (this.#pending.has(geometry.id)) {
        this.stats.missPending++;
      } else if (this.#evictedIds.has(geometry.id)) {
        this.stats.missEvicted++;
      } else {
        this.stats.missUnrequested++;
      }
      this.request(geometry);
    }
    return undefined;
  }

  public error(geometry: SegmentationMaskGeometry): string | undefined {
    return this.#errors.get(geometry.id)?.message;
  }

  public request(geometry: SegmentationMaskGeometry): void {
    if (this.#entries.has(geometry.id) || this.#pending.has(geometry.id)) {
      return;
    }
    if (this.#errors.has(geometry.id) && !this.#retryable(geometry.id)) {
      return;
    }
    if (
      planeBytes(geometry.width, geometry.height, geometry.counts.length) >
      this.budgetBytes / 4
    ) {
      this.#fail(geometry.id, "Mask planes exceed the cache budget", { permanent: true });
      return;
    }
    this.#pending.set(geometry.id, { geometry });
    const builder = this.#ensureBuilder();
    if (builder) {
      void this.#buildInWorker(builder, geometry);
      return;
    }
    // No Worker (tests, or a browser that refused it): build after the current task, still
    // outside the render frame that asked.
    setTimeout(() => {
      if (!this.#pending.has(geometry.id)) {
        return;
      }
      try {
        this.#store(geometry.id, buildMaskPlanes(geometry.width, geometry.height, geometry.counts));
      } catch (error) {
        this.#fail(geometry.id, error instanceof Error ? error.message : String(error));
      }
    }, 0);
  }

  public dispose(): void {
    for (const timer of this.#retryTimers) {
      clearTimeout(timer);
    }
    this.#retryTimers.clear();
    this.#builder?.dispose();
    this.#builder = undefined;
    this.#entries.clear();
    this.#pending.clear();
    this.#errors.clear();
    this.#evictedIds.clear();
    this.#listeners.clear();
    this.#consumers.clear();
    this.#bytes = 0;
    this.stats.cachedBytes = 0;
  }

  /** A transient failure may be retried after BUILD_RETRY_MS, up to MAX_BUILD_ATTEMPTS in all. */
  #retryable(id: number): boolean {
    const failure = this.#errors.get(id);
    if (!failure) {
      return true;
    }
    if (
      failure.permanent ||
      failure.attempts >= MAX_BUILD_ATTEMPTS ||
      this.now() - failure.at < BUILD_RETRY_MS
    ) {
      return false;
    }
    return true;
  }

  async #buildInWorker(builder: Builder, geometry: SegmentationMaskGeometry): Promise<void> {
    const { id, width, height, counts } = geometry;
    try {
      const planes = await builder.remote.buildMaskPlanes(width, height, [...counts]);
      // A reply from a worker that has been abandoned or disposed is void.
      if (this.#builder === builder) {
        this.#store(id, planes);
      }
    } catch (error) {
      if (this.#builder !== builder) {
        return;
      }
      if (error instanceof DOMException) {
        // The request could not be posted; abandoning re-requests everything pending.
        this.#abandonWorker("post failed", error);
        return;
      }
      this.#fail(id, error instanceof Error ? error.message : String(error));
    }
  }

  #ensureBuilder(): Builder | undefined {
    if (
      this.#builder ||
      this.#workerFailed ||
      !this.createWorker ||
      typeof Worker === "undefined"
    ) {
      return this.#builder;
    }
    try {
      const worker = this.createWorker();
      const builder = ComlinkWrap<MaskPlaneService>(worker);
      worker.onerror = (event) => {
        event.preventDefault();
        this.#abandonWorker("error", event.message);
      };
      // A reply that cannot be deserialized names no request; without this its build stays
      // pending forever and that frame never shows a mask.
      worker.onmessageerror = () => {
        this.#abandonWorker("message could not be deserialized");
      };
      this.#builder = builder;
    } catch (error) {
      this.#workerFailed = true;
      log.warn("Mask plane worker unavailable; building masks on the main thread", error);
    }
    return this.#builder;
  }

  /** Stop using the worker and rebuild whatever was in flight on the main thread. */
  #abandonWorker(reason: string, detail?: unknown): void {
    log.warn(`Mask plane worker ${reason}; building masks on the main thread`, detail);
    this.#workerFailed = true;
    this.#builder?.dispose();
    this.#builder = undefined;
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const item of pending) {
      this.request(item.geometry);
    }
  }

  #pinned(): Set<number> {
    const pinned = new Set<number>();
    for (const state of this.#consumers.values()) {
      if (state.displayed != undefined) {
        pinned.add(state.displayed);
      }
    }
    return pinned;
  }

  #store(id: number, planes: MaskPlanes): void {
    if (!this.#pending.delete(id)) {
      return;
    }
    this.#errors.delete(id);
    this.#entries.set(id, planes);
    this.#bytes += planeBytes(planes.width, planes.height, planes.slots);
    this.stats.built++;
    this.stats.buildMsTotal += planes.buildMs;
    this.stats.buildMsMax = Math.max(this.stats.buildMsMax, planes.buildMs);
    if (this.#bytes > this.budgetBytes) {
      // Least recently used first, never a frame some panel is drawing: evicting that would make
      // the panel rebuild it on its next frame, evicting another panel's, and the masks blink.
      const pinned = this.#pinned();
      for (const [candidate, value] of this.#entries) {
        if (this.#bytes <= this.budgetBytes || this.#entries.size <= 1) {
          break;
        }
        if (candidate === id || pinned.has(candidate)) {
          continue;
        }
        this.#entries.delete(candidate);
        this.#bytes -= planeBytes(value.width, value.height, value.slots);
        this.stats.evicted++;
        if (this.#evictedIds.size > 4096) {
          this.#evictedIds.clear();
        }
        this.#evictedIds.add(candidate);
      }
    }
    this.stats.cachedBytes = this.#bytes;
    this.#notify();
  }

  #fail(id: number, message: string, { permanent = false }: { permanent?: boolean } = {}): void {
    this.#pending.delete(id);
    const attempts = (this.#errors.get(id)?.attempts ?? 0) + 1;
    this.#errors.set(id, { message, attempts, at: this.now(), permanent });
    this.stats.errors++;
    if (!permanent && attempts < MAX_BUILD_ATTEMPTS) {
      // A paused panel renders only when asked: wake it when the retry becomes possible.
      const timer = setTimeout(() => {
        this.#retryTimers.delete(timer);
        this.#notify();
      }, BUILD_RETRY_MS);
      this.#retryTimers.add(timer);
    }
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
