// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import {
  MockGpuChannelStatus,
  MockGpuIdentity,
  MockGpuPool,
  MockGpuSnapshot,
  MockGpuStatusEvent,
} from "./mockGpuPool";

/** Immutable frontend context: create a new session on user/source changes and dispose the old one. */
export class MockGpuSession {
  public readonly identity: MockGpuIdentity;
  #statusChannel: MockGpuChannelStatus = "closed";
  #closeChannel: (() => void) | undefined;
  readonly #listeners = new Set<(gpu: MockGpuSnapshot) => void>();
  #generation = 0;
  #operation = 0;
  #lastSequence = -1;
  #disposed = false;
  #pendingStart: Promise<MockGpuSnapshot> | undefined;

  public constructor(
    public readonly pool: MockGpuPool,
    identity: MockGpuIdentity,
  ) {
    if (!identity.userId.trim() || !identity.sessionId.trim()) {
      throw new Error("Mock GPU identity requires nonempty userId and sessionId");
    }
    this.identity = Object.freeze({ ...identity });
  }

  public snapshot(): MockGpuSnapshot {
    const gpu = this.pool.snapshot(this.identity);
    const connected = this.#statusChannel === "connected" && gpu.connected;
    return {
      ...gpu,
      ...this.identity,
      mock: true,
      status:
        gpu.status === "ready" && !connected
          ? this.#statusChannel === "connecting" || this.#statusChannel === "reconnecting"
            ? "connecting"
            : "disconnected"
          : gpu.status,
      connected,
      statusChannel: this.#statusChannel,
      activeUsers: this.pool.activeUsers(),
      maxUsers: this.pool.maxUsers,
    };
  }

  public subscribe(listener: (gpu: MockGpuSnapshot) => void): () => void {
    this.#assertLive();
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #emit(): void {
    if (this.#disposed) {
      return;
    }
    const gpu = this.snapshot();
    for (const listener of this.#listeners) {
      listener(gpu);
    }
  }

  /** Public event boundary for synthetic transport fixtures; foreign/stale messages never apply. */
  public receive(event: MockGpuStatusEvent, generation = this.#generation): void {
    if (
      this.#disposed ||
      generation !== this.#generation ||
      this.#statusChannel !== "connected" ||
      event.userId !== this.identity.userId ||
      event.sessionId !== this.identity.sessionId ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence <= this.#lastSequence
    ) {
      return;
    }
    this.#lastSequence = event.sequence;
    // Read the authorized backend snapshot, never trust a foreign payload to change allocation.
    this.#emit();
  }

  public async reconnect(): Promise<MockGpuSnapshot> {
    this.#assertLive();
    this.#closeChannel?.();
    const generation = ++this.#generation;
    this.#statusChannel = this.#statusChannel === "closed" ? "connecting" : "reconnecting";
    this.#emit();
    // A consumer can synchronously close/dispose while handling the connecting callback.
    this.#assertLive();
    if (generation !== this.#generation) {
      return this.snapshot();
    }
    try {
      this.#closeChannel = this.pool.openChannel(this.identity, (event) => {
        this.receive(event, generation);
      });
    } catch (error) {
      this.#closeChannel = undefined;
      this.#statusChannel = "disconnected";
      this.#emit();
      throw error;
    }
    await Promise.resolve();
    this.#assertLive();
    if (generation === this.#generation) {
      this.#statusChannel = "connected";
      this.#emit();
    }
    return this.snapshot();
  }

  public async start(
    count = 1,
    wait: () => Promise<void> = async () => {
      await Promise.resolve();
    },
  ): Promise<MockGpuSnapshot> {
    this.#assertLive();
    this.#pendingStart ??= this.#startOnce(count, wait).finally(() => {
      this.#pendingStart = undefined;
    });
    return await this.#pendingStart;
  }

  async #startOnce(count: number, wait: () => Promise<void>): Promise<MockGpuSnapshot> {
    const operation = ++this.#operation;
    await wait();
    this.#assertLive();
    if (operation !== this.#operation) {
      throw new Error("Mock GPU start superseded by a session change");
    }
    this.pool.start(this.identity, count);
    this.#assertLive();
    if (operation !== this.#operation) {
      throw new Error("Mock GPU start superseded by a session change");
    }
    return await this.reconnect();
  }

  public stop(): MockGpuSnapshot {
    this.#assertLive();
    ++this.#operation;
    this.pool.stop(this.identity);
    this.#emit();
    return this.snapshot();
  }

  public disconnect(): void {
    this.#assertLive();
    ++this.#generation;
    this.#closeChannel?.();
    this.#closeChannel = undefined;
    this.#statusChannel = "disconnected";
    this.#emit();
  }

  /** Suspend a cached workbench without deleting drafts or claiming to stop backend resources. */
  public close(): void {
    if (this.#disposed) {
      return;
    }
    ++this.#operation;
    ++this.#generation;
    this.#closeChannel?.();
    this.#closeChannel = undefined;
    this.#statusChannel = "closed";
    this.#emit();
  }

  public dispose(): void {
    this.#disposed = true;
    ++this.#operation;
    ++this.#generation;
    this.#closeChannel?.();
    this.#closeChannel = undefined;
    this.#statusChannel = "closed";
    this.#listeners.clear();
  }

  #assertLive(): void {
    if (this.#disposed) {
      throw new Error("Mock GPU session is disposed");
    }
  }
}
