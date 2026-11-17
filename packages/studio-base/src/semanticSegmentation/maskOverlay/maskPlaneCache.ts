// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SegmentationMaskGeometry } from "../imageSource";
import { buildMaskPlanes, planeBytes, type MaskPlanes } from "./maskPlanes";

/**
 * CPU-side bit planes, built in one shared Worker and kept in an LRU bounded by bytes. RLE counts
 * stay in the document (tens of KB per frame); only built planes count against this budget. The
 * GPU holds one plane texture per visible panel, never the cache.
 */
export const MASK_PLANE_CACHE_BYTES = 96 * 1024 * 1024;

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
  buildMs: number[];
  cachedBytes: number;
};

type Pending = { geometry: SegmentationMaskGeometry };

export class MaskPlaneCache {
  readonly #entries = new Map<number, MaskPlanes>();
  readonly #pending = new Map<number, Pending>();
  readonly #errors = new Map<number, string>();
  readonly #listeners = new Set<() => void>();
  /** Recently evicted ids, only to classify misses. Bounded. */
  readonly #evictedIds = new Set<number>();
  #bytes = 0;
  #worker: Worker | undefined;
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
    buildMs: [],
    cachedBytes: 0,
  };

  public constructor(
    private readonly createWorker: (() => Worker) | undefined,
    private readonly budgetBytes = MASK_PLANE_CACHE_BYTES,
  ) {}

  readonly #consumers = new Set<object>();

  /** A panel that prefetches into this cache. Returns the unregister function. */
  public addConsumer(consumer: object): () => void {
    this.#consumers.add(consumer);
    return () => {
      this.#consumers.delete(consumer);
    };
  }

  /**
   * How many frames past the displayed one each consumer may prefetch so that every consumer's
   * set fits in the budget together. A larger working set evicts the frames another camera is about
   * to draw; rebuilding them evicts others in turn, and the panels re-render forever, even paused.
   */
  public framesAhead(frameBytes: number, wanted: number): number {
    const share = (this.budgetBytes * 0.75) / Math.max(1, this.#consumers.size);
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
    if (!this.#errors.has(geometry.id)) {
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
    return this.#errors.get(geometry.id);
  }

  public request(geometry: SegmentationMaskGeometry): void {
    if (
      this.#entries.has(geometry.id) ||
      this.#pending.has(geometry.id) ||
      this.#errors.has(geometry.id)
    ) {
      return;
    }
    if (
      planeBytes(geometry.width, geometry.height, geometry.counts.length) >
      this.budgetBytes / 4
    ) {
      this.#fail(geometry.id, "Mask planes exceed the cache budget");
      return;
    }
    this.#pending.set(geometry.id, { geometry });
    const worker = this.#ensureWorker();
    if (worker) {
      worker.postMessage({
        id: geometry.id,
        width: geometry.width,
        height: geometry.height,
        counts: [...geometry.counts],
      });
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
    this.#worker?.terminate();
    this.#worker = undefined;
    this.#entries.clear();
    this.#pending.clear();
    this.#errors.clear();
    this.#evictedIds.clear();
    this.#listeners.clear();
    this.#bytes = 0;
  }

  #ensureWorker(): Worker | undefined {
    if (this.#worker || this.#workerFailed || !this.createWorker || typeof Worker === "undefined") {
      return this.#worker;
    }
    try {
      const worker = this.createWorker();
      worker.onmessage = (
        event: MessageEvent<{ id: number; planes?: MaskPlanes; error?: string }>,
      ) => {
        const { id, planes, error } = event.data;
        if (planes) {
          this.#store(id, planes);
        } else {
          this.#fail(id, error ?? "Mask plane worker failed");
        }
      };
      worker.onerror = () => {
        // Fall back to in-thread builds for whatever was in flight.
        this.#workerFailed = true;
        worker.terminate();
        this.#worker = undefined;
        const pending = [...this.#pending.values()];
        this.#pending.clear();
        for (const item of pending) {
          this.request(item.geometry);
        }
      };
      this.#worker = worker;
    } catch {
      this.#workerFailed = true;
    }
    return this.#worker;
  }

  #store(id: number, planes: MaskPlanes): void {
    if (!this.#pending.delete(id)) {
      return;
    }
    this.#entries.set(id, planes);
    this.#bytes += planeBytes(planes.width, planes.height, planes.slots);
    this.stats.built++;
    this.stats.buildMs.push(planes.buildMs);
    if (this.stats.buildMs.length > 2000) {
      this.stats.buildMs.splice(0, 1000);
    }
    while (this.#bytes > this.budgetBytes && this.#entries.size > 1) {
      const [oldest, value] = this.#entries.entries().next().value!;
      this.#entries.delete(oldest);
      this.#bytes -= planeBytes(value.width, value.height, value.slots);
      this.stats.evicted++;
      if (this.#evictedIds.size > 4096) {
        this.#evictedIds.clear();
      }
      this.#evictedIds.add(oldest);
    }
    this.stats.cachedBytes = this.#bytes;
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #fail(id: number, message: string): void {
    this.#pending.delete(id);
    this.#errors.set(id, message);
    this.stats.errors++;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
