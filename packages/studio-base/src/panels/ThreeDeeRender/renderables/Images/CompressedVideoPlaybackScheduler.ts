// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type {
  CompressedVideoPlaybackSchedulerConfig,
  CompressedVideoPlaybackSchedulerController,
  CompressedVideoPlaybackSchedulerResult,
} from "./CompressedVideoPlaybackSchedulerTypes";

export type {
  CompressedVideoPlaybackSchedulerConfig,
  CompressedVideoPlaybackSchedulerController,
  CompressedVideoPlaybackSchedulerResult,
} from "./CompressedVideoPlaybackSchedulerTypes";

const DEFAULT_MAX_CONCURRENT_FLUSHES = 2;
const DEFAULT_NORMAL_SLOTS_PER_SECOND = 45;
const DEFAULT_PRESSURE_SLOTS_PER_SECOND = 30;
const DEFAULT_BUCKET_CAPACITY = 6;
const DEFAULT_NORMAL_CONTROLLER_INTERVAL_MS = 33;
const DEFAULT_PRESSURE_CONTROLLER_INTERVAL_MS = 66;
const DEFAULT_PRESSURE_MIN_DURATION_MS = 1_000;
const DEFAULT_SLOW_FLUSH_THRESHOLD_MS = 50;
const DEFAULT_LATE_DROP_PRESSURE_COUNT = 2;

type ControllerState = {
  controller: CompressedVideoPlaybackSchedulerController;
  queued: boolean;
  running: boolean;
  pending: boolean;
  lastStartedAtMs: number | undefined;
  consecutiveLateDrops: number;
};

export class CompressedVideoPlaybackScheduler {
  readonly #maxConcurrentFlushes: number;
  readonly #normalSlotsPerSecond: number;
  readonly #pressureSlotsPerSecond: number;
  readonly #bucketCapacity: number;
  readonly #normalControllerIntervalMs: number;
  readonly #pressureControllerIntervalMs: number;
  readonly #pressureMinDurationMs: number;
  readonly #slowFlushThresholdMs: number;
  readonly #lateDropPressureCount: number;
  readonly #controllers = new Map<string, ControllerState>();
  readonly #readyQueue: string[] = [];
  #activeFlushes = 0;
  #tokens: number;
  #lastTokenRefillMs = Date.now();
  #pressureUntilMs = 0;
  #wakeTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(config: CompressedVideoPlaybackSchedulerConfig = {}) {
    this.#maxConcurrentFlushes = config.maxConcurrentFlushes ?? DEFAULT_MAX_CONCURRENT_FLUSHES;
    this.#normalSlotsPerSecond = config.normalSlotsPerSecond ?? DEFAULT_NORMAL_SLOTS_PER_SECOND;
    this.#pressureSlotsPerSecond =
      config.pressureSlotsPerSecond ?? DEFAULT_PRESSURE_SLOTS_PER_SECOND;
    this.#bucketCapacity = config.bucketCapacity ?? DEFAULT_BUCKET_CAPACITY;
    this.#tokens = Math.min(
      this.#bucketCapacity,
      config.initialTokens ?? this.#maxConcurrentFlushes,
    );
    this.#normalControllerIntervalMs =
      config.normalControllerIntervalMs ?? DEFAULT_NORMAL_CONTROLLER_INTERVAL_MS;
    this.#pressureControllerIntervalMs =
      config.pressureControllerIntervalMs ?? DEFAULT_PRESSURE_CONTROLLER_INTERVAL_MS;
    this.#pressureMinDurationMs = config.pressureMinDurationMs ?? DEFAULT_PRESSURE_MIN_DURATION_MS;
    this.#slowFlushThresholdMs = config.slowFlushThresholdMs ?? DEFAULT_SLOW_FLUSH_THRESHOLD_MS;
    this.#lateDropPressureCount = config.lateDropPressureCount ?? DEFAULT_LATE_DROP_PRESSURE_COUNT;
  }

  public request(controller: CompressedVideoPlaybackSchedulerController): void {
    const current = this.#controllers.get(controller.id);
    const state =
      current ??
      ({
        controller,
        queued: false,
        running: false,
        pending: false,
        lastStartedAtMs: undefined,
        consecutiveLateDrops: 0,
      } satisfies ControllerState);
    state.controller = controller;
    state.pending = true;
    this.#controllers.set(controller.id, state);
    this.#enqueue(state);
    this.#scheduleWake(0);
  }

  public cancel(controllerId: string): void {
    this.#controllers.delete(controllerId);
  }

  public isPressureMode(): boolean {
    return Date.now() < this.#pressureUntilMs;
  }

  #dispatch(): void {
    if (this.#wakeTimer != undefined) {
      clearTimeout(this.#wakeTimer);
      this.#wakeTimer = undefined;
    }

    this.#refillTokens();

    while (this.#activeFlushes < this.#maxConcurrentFlushes && this.#tokens >= 1) {
      const next = this.#dequeueEligibleController();
      if (next == undefined) {
        break;
      }
      this.#startController(next);
      this.#refillTokens();
    }

    const nextDelayMs = this.#nextWakeDelayMs();
    if (nextDelayMs != undefined) {
      this.#scheduleWake(nextDelayMs);
    }
  }

  #enqueue(state: ControllerState): void {
    if (
      state.queued ||
      state.running ||
      !state.pending ||
      state.controller.isPlaybackActive?.() === false
    ) {
      return;
    }
    state.queued = true;
    this.#readyQueue.push(state.controller.id);
  }

  #dequeueEligibleController(): ControllerState | undefined {
    const nowMs = Date.now();
    const queueLength = this.#readyQueue.length;
    for (let i = 0; i < queueLength; i++) {
      const controllerId = this.#readyQueue.shift();
      if (controllerId == undefined) {
        return undefined;
      }
      const state = this.#controllers.get(controllerId);
      if (state == undefined) {
        continue;
      }
      state.queued = false;
      if (!state.pending || state.running || state.controller.isPlaybackActive?.() === false) {
        continue;
      }
      const lastStartedAtMs = state.lastStartedAtMs;
      const intervalMs = this.#controllerIntervalMs();
      if (lastStartedAtMs != undefined && nowMs - lastStartedAtMs < intervalMs) {
        this.#enqueue(state);
        continue;
      }
      return state;
    }
    return undefined;
  }

  #startController(state: ControllerState): void {
    const startedAtMs = Date.now();
    state.running = true;
    state.pending = false;
    state.lastStartedAtMs = startedAtMs;
    this.#activeFlushes++;
    this.#tokens -= 1;

    void state.controller.runPlaybackFlush().then(
      (result) => {
        this.#completeController(state.controller.id, startedAtMs, result);
      },
      () => {
        this.#completeController(state.controller.id, startedAtMs, { queuePressured: true });
      },
    );
  }

  #completeController(
    controllerId: string,
    startedAtMs: number,
    result: CompressedVideoPlaybackSchedulerResult,
  ): void {
    this.#activeFlushes = Math.max(0, this.#activeFlushes - 1);
    const state = this.#controllers.get(controllerId);
    if (state != undefined) {
      state.running = false;
      this.#recordPressureSignals(state, Date.now() - startedAtMs, result);
      if (state.pending || state.controller.hasPendingPlayback()) {
        state.pending = true;
        this.#enqueue(state);
      }
    }
    this.#dispatch();
  }

  #recordPressureSignals(
    state: ControllerState,
    flushDurationMs: number,
    result: CompressedVideoPlaybackSchedulerResult,
  ): void {
    state.consecutiveLateDrops = result.lateDropped === true ? state.consecutiveLateDrops + 1 : 0;
    const shouldEnterPressure =
      state.consecutiveLateDrops >= this.#lateDropPressureCount ||
      result.queuePressured === true ||
      flushDurationMs > this.#slowFlushThresholdMs;
    if (shouldEnterPressure) {
      this.#pressureUntilMs = Math.max(
        this.#pressureUntilMs,
        Date.now() + this.#pressureMinDurationMs,
      );
    }
  }

  #refillTokens(): void {
    const nowMs = Date.now();
    const elapsedMs = nowMs - this.#lastTokenRefillMs;
    if (elapsedMs <= 0) {
      return;
    }
    const refillRate = this.#slotsPerSecond();
    this.#tokens = Math.min(this.#bucketCapacity, this.#tokens + (elapsedMs * refillRate) / 1_000);
    this.#lastTokenRefillMs = nowMs;
  }

  #nextWakeDelayMs(): number | undefined {
    if (this.#readyQueue.length === 0 || this.#activeFlushes >= this.#maxConcurrentFlushes) {
      return undefined;
    }

    this.#refillTokens();
    const nowMs = Date.now();
    const tokenDelayMs =
      this.#tokens >= 1 ? 0 : ((1 - this.#tokens) * 1_000) / this.#slotsPerSecond();
    let nextDelayMs: number | undefined;
    for (const controllerId of this.#readyQueue) {
      const state = this.#controllers.get(controllerId);
      if (
        state == undefined ||
        !state.pending ||
        state.running ||
        state.controller.isPlaybackActive?.() === false
      ) {
        continue;
      }
      const lastStartedAtMs = state.lastStartedAtMs;
      const intervalDelayMs =
        lastStartedAtMs != undefined
          ? Math.max(0, this.#controllerIntervalMs() - (nowMs - lastStartedAtMs))
          : 0;
      const delayMs = Math.max(tokenDelayMs, intervalDelayMs);
      nextDelayMs = nextDelayMs == undefined ? delayMs : Math.min(nextDelayMs, delayMs);
    }
    return nextDelayMs != undefined ? Math.ceil(nextDelayMs) : undefined;
  }

  #scheduleWake(delayMs: number): void {
    if (this.#wakeTimer != undefined) {
      clearTimeout(this.#wakeTimer);
    }
    this.#wakeTimer = setTimeout(() => {
      this.#wakeTimer = undefined;
      this.#dispatch();
    }, delayMs);
  }

  #slotsPerSecond(): number {
    return this.isPressureMode() ? this.#pressureSlotsPerSecond : this.#normalSlotsPerSecond;
  }

  #controllerIntervalMs(): number {
    return this.isPressureMode()
      ? this.#pressureControllerIntervalMs
      : this.#normalControllerIntervalMs;
  }
}

let compressedVideoPlaybackScheduler = new CompressedVideoPlaybackScheduler();

export function requestCompressedVideoPlaybackSlot(
  controller: CompressedVideoPlaybackSchedulerController,
): void {
  compressedVideoPlaybackScheduler.request(controller);
}

export function cancelCompressedVideoPlaybackSlot(controllerId: string): void {
  compressedVideoPlaybackScheduler.cancel(controllerId);
}

export function resetCompressedVideoPlaybackSchedulerForTests(
  config?: CompressedVideoPlaybackSchedulerConfig,
): void {
  compressedVideoPlaybackScheduler = new CompressedVideoPlaybackScheduler(config);
}
