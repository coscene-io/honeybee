// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext } from "react";
import { createStore } from "zustand/vanilla";

import { toNanoSec } from "@foxglove/rostime";
import type { PlayerState, PlayerStateActiveData } from "@foxglove/studio-base/players/types";

import { VideoDiagnostics, type Interval } from "./videoDiagnostics";

type Seek = NonNullable<PlayerStateActiveData["acceptedSeek"]>;
const SEEK_TIMEOUT_MS = 10000;
export type PanelStats = {
  topic: string;
  panelId: string;
  active: boolean;
  status: "idle" | "decoding" | "lookback" | "displayed" | "failed" | "waiting";
  lagMs?: number;
  decodeMs?: number;
  lastSuccessSequence?: number;
  samples: number[];
  successes: number;
  cancelled: number;
  timeouts: number;
  pending?: { seek: Seek; expected?: bigint; media?: bigint };
};

export class PlaybackDiagnostics extends VideoDiagnostics {
  public readonly panels = new Map<string, PanelStats>();
  public readonly preview = createStore<{ owner?: object; range?: Interval }>(() => ({}));
  public start = 0n;
  public actualSpeed?: number;
  public targetSpeed?: number;
  public mbps?: number;
  public buffering = false;
  #sample?: { now: number; time: bigint; bytes: number; seekTime: number; playing: boolean };
  #seek?: Seek;
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
    const panel = this.panel(panelId, topic);
    panel.active = true;
    return () => {
      panel.active = false;
      panel.status = "idle";
      if (panel.pending) {
        panel.cancelled++;
        panel.pending = undefined;
      }
    };
  }

  public update(state: PlayerState, now = performance.now()): void {
    const data = state.activeData;
    this.buffering = state.presence === "BUFFERING";
    if (!data) {
      return;
    }
    const time = toNanoSec(data.currentTime);
    this.start = toNanoSec(data.startTime);
    this.targetSpeed = data.speed;
    if (data.messages !== this.#lastMessages) {
      for (const message of data.messages) {
        this.#bytes += message.sizeInBytes;
      }
      this.#lastMessages = data.messages;
    }
    const sample = this.#sample;
    if (
      sample?.seekTime !== data.lastSeekTime ||
      sample.playing !== data.isPlaying ||
      now - sample.now >= 500
    ) {
      const continuous =
        sample?.seekTime === data.lastSeekTime &&
        sample.playing === data.isPlaying &&
        now > sample.now;
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
    const seek = data.acceptedSeek;
    if (seek && this.#seek?.sequence !== seek.sequence) {
      const skipped = Math.max(0, seek.sequence - (this.#seek?.sequence ?? 0) - 1);
      for (const panel of this.panels.values()) {
        if (panel.active) {
          this.expire(panel, seek.started);
          panel.cancelled += skipped + (panel.pending ? 1 : 0);
          panel.pending = { seek };
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
    media: bigint,
  ): void {
    const panel = this.panel(panelId, topic);
    const pending = panel.pending;
    if (pending && clock === toNanoSec(pending.seek.target) && frame <= clock) {
      pending.expected = frame;
      pending.media = media;
    }
  }

  public displayed(
    panelId: string,
    topic: string,
    clock: bigint,
    frame: bigint,
    media: bigint,
    now = performance.now(),
  ): void {
    const panel = this.panel(panelId, topic);
    panel.status = "displayed";
    panel.lagMs = Number(clock - frame) / 1e6;
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
