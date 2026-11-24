// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { createContext } from "react";
import { createStore } from "zustand/vanilla";

import { toNanoSec } from "@foxglove/rostime";
import type { PlayerState, PlayerStateActiveData } from "@foxglove/studio-base/players/types";

import { VideoDiagnostics, type Interval } from "./videoDiagnostics";

type PreviewEntry = { owner: object; range: Interval };
type Seek = NonNullable<PlayerStateActiveData["acceptedSeek"]>;
const SEEK_TIMEOUT_MS = 10000;
export type PanelStats = {
  topic: string;
  panelId: string;
  active: boolean;
  status: "idle" | "decoding" | "lookback" | "displayed" | "failed" | "waiting";
  displayedFrame?: { time: bigint; owner: object };
  decodeMs?: number;
  lastSuccessSequence?: number;
  lastAttemptSequence?: number;
  samples: number[];
  successes: number;
  cancelled: number;
  timeouts: number;
  pending?: { seek: Seek; expected?: bigint; media?: bigint };
};

export class PlaybackDiagnostics extends VideoDiagnostics {
  public readonly id = _.uniqueId("playback-diagnostics-");
  public readonly panels = new Map<string, PanelStats>();
  public readonly preview = createStore<{ hovered?: PreviewEntry; focused?: PreviewEntry }>(
    () => ({}),
  );
  public start = 0n;
  #currentTime?: bigint;
  public actualSpeed?: number;
  public targetSpeed?: number;
  public mbps?: number;
  public buffering = false;
  #sample?: { now: number; time: bigint; bytes: number; seekTime: number; playing: boolean };
  #seek?: Seek;
  #backfilling?: Seek;
  public latestSeekSequence(): number | undefined {
    return this.#seek?.sequence;
  }
  #lastMessages?: PlayerStateActiveData["messages"];
  #bytes = 0;
  public panel(panelId: string, topic: string): PanelStats {
    const key = panelId + "/" + topic;
    let panel = this.panels.get(key);
    if (!panel) {
      panel = {
        panelId,
        topic,
        active: false,
        status: "idle",
        samples: [],
        successes: 0,
        cancelled: 0,
        timeouts: 0,
      };
      this.panels.set(key, panel);
    }
    return panel;
  }

  public bind(panelId: string, topic: string): () => void {
    this.topic(topic);
    const panel = this.panel(panelId, topic);
    panel.active = true;
    // The topic list can arrive after an initial seek is accepted. A panel which
    // subscribes before backfill completes can still display its target frame.
    if (this.#backfilling && panel.lastAttemptSequence !== this.#backfilling.sequence) {
      panel.pending = { seek: this.#backfilling };
      panel.lastAttemptSequence = this.#backfilling.sequence;
    }
    return () => {
      this.expire(panel);
      panel.active = false;
      panel.status = "idle";
      panel.displayedFrame = undefined;
      if (panel.pending) {
        panel.cancelled++;
        panel.pending = undefined;
      }
    };
  }

  public update(state: PlayerState, now = performance.now()): void {
    const data = state.activeData;
    this.#backfilling =
      data?.acceptedSeek?.backfillPending === true ? data.acceptedSeek : undefined;
    this.buffering = state.presence === "BUFFERING";
    if (!data) {
      return;
    }
    const time = toNanoSec(data.currentTime);
    this.#currentTime = time;
    this.start = toNanoSec(data.startTime);
    this.targetSpeed = data.speed;
    if (data.messages !== this.#lastMessages) {
      for (const message of data.messages) {
        this.#bytes += message.sizeInBytes;
      }
      this.#lastMessages = data.messages;
    }
    const seek = data.acceptedSeek;
    const newSeek = seek != undefined && this.#seek?.sequence !== seek.sequence;
    const sample = this.#sample;
    const continuous =
      sample != undefined &&
      !newSeek &&
      sample.seekTime === data.lastSeekTime &&
      sample.playing === data.isPlaying;
    if (!continuous || now - sample.now >= 500) {
      this.actualSpeed = continuous
        ? Number(time - sample.time) / 1e6 / (now - sample.now)
        : undefined;
      this.mbps = continuous
        ? ((this.#bytes - sample.bytes) * 0.008) / (now - sample.now)
        : undefined;
      this.#sample = {
        now,
        time,
        bytes: this.#bytes,
        seekTime: data.lastSeekTime,
        playing: data.isPlaying,
      };
    }
    if (newSeek) {
      const skipped = Math.max(0, seek.sequence - (this.#seek?.sequence ?? 0) - 1);
      for (const panel of this.panels.values()) {
        if (panel.active) {
          this.expire(panel, seek.started);
          panel.cancelled += skipped + (panel.pending ? 1 : 0);
          panel.pending = { seek };
          panel.lastAttemptSequence = seek.sequence;
        }
      }
      this.#seek = seek;
    }
  }

  public expire(panel: PanelStats, now = performance.now()): void {
    if (panel.pending && now - panel.pending.seek.started >= SEEK_TIMEOUT_MS) {
      panel.timeouts++;
      panel.pending = undefined;
    }
  }

  public expectFrame(
    panelId: string,
    topic: string,
    clock: bigint,
    frame: bigint,
    media: bigint | undefined,
  ): void {
    const panel = this.panel(panelId, topic);
    const pending = panel.pending;
    if (pending && clock === toNanoSec(pending.seek.target) && frame <= clock) {
      pending.expected = frame;
      pending.media = media;
    }
  }

  public frameLagMs(panel: PanelStats): number | undefined {
    return this.#currentTime != undefined && panel.displayedFrame != undefined
      ? Number(this.#currentTime - panel.displayedFrame.time) / 1e6
      : undefined;
  }

  public displayed(
    panelId: string,
    topic: string,
    frame: bigint,
    media: bigint | undefined,
    owner: object,
    now = performance.now(),
  ): void {
    const panel = this.panel(panelId, topic);
    panel.status = "displayed";
    panel.displayedFrame = { time: frame, owner };
    this.expire(panel, now);
    const pending = panel.pending;
    if (pending?.expected === frame && pending.media === media) {
      panel.lastSuccessSequence = pending.seek.sequence;
      panel.successes++;
      panel.samples.push(now - pending.seek.started);
      if (panel.samples.length > 256) {
        panel.samples.shift();
      }
      panel.pending = undefined;
    }
  }
}

export type PanelDiagnostics = { session: PlaybackDiagnostics; panelId: string };
export const PlaybackDiagnosticsContext = createContext<PlaybackDiagnostics | undefined>(undefined);
