// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import type { GpuState, MediaCache } from "./types";

export const MOCK_GPU_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const MOCK_MEDIA_CACHE_LIMIT_BYTES = 16 * 1024 ** 3;

/** Trusted local adapter input, not a credential or a production authentication claim. */
export type MockGpuIdentity = Readonly<{ userId: string; sessionId: string }>;
export type MockGpuChannelStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "closed";
export type MockGpuSnapshot = GpuState &
  MockGpuIdentity & {
    mock: true;
    statusChannel: MockGpuChannelStatus;
    activeUsers: number;
    maxUsers: number;
  };
export type MockGpuStatusEvent = MockGpuIdentity & { sequence: number; gpu: GpuState };
export type MockMediaIdentity = Readonly<{
  recordId: string;
  videoId: string;
  /** Include the source content identity, not just the display name. */
  sourceKey: string;
}>;
type CacheEntry = MediaCache["entries"][number] &
  MockMediaIdentity & {
    userId: string;
    cacheKey: string;
  };
type Allocation = {
  count: number;
  lastActivityAt: number;
  status: "ready" | "error";
  error?: string;
};

/** In-memory mock backend. Share one instance to simulate global capacity across workbenches. */
export class MockGpuPool {
  public readonly maxUsers = 4;
  public readonly quota = 4;
  readonly #allocations = new Map<string, Allocation>();
  readonly #caches = new Map<string, Map<string, CacheEntry>>();
  readonly #channels = new Map<
    string,
    {
      userId: string;
      listeners: Set<(event: MockGpuStatusEvent) => void>;
    }
  >();
  #sequence = 0;

  readonly #now: () => number;

  public constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  public snapshot(identity: MockGpuIdentity): GpuState {
    const allocation = this.#allocations.get(identity.userId);
    return {
      status: allocation?.status ?? "stopped",
      allocated: allocation?.count ?? 0,
      quota: this.quota,
      connected: allocation?.status === "ready",
      lastActivityAt: allocation?.lastActivityAt ?? this.#now(),
      idleTimeoutMs: MOCK_GPU_IDLE_TIMEOUT_MS,
      ...(allocation?.error ? { error: allocation.error } : {}),
    };
  }

  public activeUsers(): number {
    return this.#allocations.size;
  }

  public start(identity: MockGpuIdentity, count: number): GpuState {
    if (!Number.isInteger(count) || count < 1 || count > this.quota) {
      throw new Error("GPU quota is 4 per user; request an integer from 1 to 4");
    }
    if (!this.#allocations.has(identity.userId) && this.activeUsers() >= this.maxUsers) {
      throw new Error("Mock GPU capacity reached: 4 active users; stop an allocation and retry");
    }
    // Repeated starts and other sessions of the same user reuse one allocation.
    if (!this.#allocations.has(identity.userId)) {
      this.#allocations.set(identity.userId, {
        count,
        lastActivityAt: this.#now(),
        status: "ready",
      });
    }
    this.#notify(identity.userId);
    return this.snapshot(identity);
  }

  public stop(identity: MockGpuIdentity): GpuState {
    this.#allocations.delete(identity.userId);
    this.#notify(identity.userId);
    return this.snapshot(identity);
  }

  public touch(identity: MockGpuIdentity): void {
    const allocation = this.#allocations.get(identity.userId);
    if (allocation) {
      allocation.lastActivityAt = this.#now();
    }
  }

  /** Explicit mock-backend clock/event input. No browser timer claims actual resource shutdown. */
  public reportIdle(now = this.#now()): void {
    for (const [userId, allocation] of this.#allocations) {
      if (now - allocation.lastActivityAt >= MOCK_GPU_IDLE_TIMEOUT_MS) {
        this.#allocations.delete(userId);
        this.#notify(userId);
      }
    }
  }

  public reportFailure(identity: MockGpuIdentity, error: string): void {
    const allocation = this.#allocations.get(identity.userId);
    if (allocation) {
      this.#allocations.set(identity.userId, { ...allocation, status: "error", error });
      this.#notify(identity.userId);
    }
  }

  public openChannel(
    identity: MockGpuIdentity,
    listener: (event: MockGpuStatusEvent) => void,
  ): () => void {
    if (!identity.userId.trim() || !identity.sessionId.trim()) {
      throw new Error("Mock status channel requires an explicit user and session identity");
    }
    const existing = this.#channels.get(identity.sessionId);
    if (existing && existing.userId !== identity.userId) {
      throw new Error("Mock status session belongs to a different user");
    }
    const channel = existing ?? {
      userId: identity.userId,
      listeners: new Set<(event: MockGpuStatusEvent) => void>(),
    };
    channel.listeners.add(listener);
    this.#channels.set(identity.sessionId, channel);
    return () => {
      channel.listeners.delete(listener);
      if (channel.listeners.size === 0 && this.#channels.get(identity.sessionId) === channel) {
        this.#channels.delete(identity.sessionId);
      }
    };
  }

  #notify(userId: string): void {
    for (const [sessionId, channel] of this.#channels) {
      if (channel.userId !== userId) {
        continue;
      }
      const identity = { userId, sessionId };
      const event = { ...identity, sequence: ++this.#sequence, gpu: this.snapshot(identity) };
      for (const listener of channel.listeners) {
        listener(event);
      }
    }
  }

  public mediaKey(identity: MockMediaIdentity): string {
    return JSON.stringify([identity.recordId, identity.videoId, identity.sourceKey])!;
  }

  public mediaCache(userId: string): Omit<MediaCache, "entries"> & { entries: CacheEntry[] } {
    const entries = [...(this.#caches.get(userId)?.values() ?? [])].map((entry) => ({ ...entry }));
    return {
      limitBytes: MOCK_MEDIA_CACHE_LIMIT_BYTES,
      usedBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
      entries,
    };
  }

  public acknowledgeMedia(
    userId: string,
    identity: MockMediaIdentity,
    sizeBytes: number,
  ): MediaCache {
    const key = this.mediaKey(identity);
    const entries = this.#caches.get(userId) ?? new Map<string, CacheEntry>();
    if (!entries.has(key)) {
      if (
        !Number.isFinite(sizeBytes) ||
        sizeBytes < 0 ||
        this.mediaCache(userId).usedBytes + sizeBytes > MOCK_MEDIA_CACHE_LIMIT_BYTES
      ) {
        throw new Error("Media cache exceeds 16 GiB per user");
      }
      entries.set(key, {
        ...identity,
        userId,
        sizeBytes,
        uploadedAt: this.#now(),
        cacheKey: JSON.stringify([userId, key])!,
      });
      this.#caches.set(userId, entries);
    }
    return this.mediaCache(userId);
  }

  public clearMedia(userId: string): void {
    this.#caches.delete(userId);
  }
  public evictMedia(userId: string, identity: MockMediaIdentity): void {
    this.#caches.get(userId)?.delete(this.mediaKey(identity));
  }
}

/** Only explicit identity adapters use this application-wide local pool. */
export const sharedMockGpuPool = new MockGpuPool();
