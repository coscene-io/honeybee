// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Immutable, PanelExtensionContext, RenderState } from "@foxglove/studio";

import type { BuilderRenderStateInput } from "./renderState";
import { initRenderStateBuilder } from "./renderState";

type RenderFn = NonNullable<PanelExtensionContext["onRender"]>;
type RenderToken = { release: () => void; finished: boolean };

/** Owns one initPanel invocation, including its outstanding playback barrier. */
export class PanelRenderLifecycle {
  readonly #getInput: () => BuilderRenderStateInput;
  readonly #pauseFrame: () => () => void;
  readonly #onError: (error: unknown) => void;
  readonly #onSlowRender: (state: "busy" | "idle") => void;
  readonly #buildRenderState = initRenderStateBuilder();
  #active = true;
  #ready = false;
  #scheduled = false;
  #pending = false;
  #force = false;
  #handler: RenderFn | undefined;
  #token: RenderToken | undefined;
  #lastState: Immutable<RenderState> | undefined;

  public constructor(args: {
    getInput: () => BuilderRenderStateInput;
    pauseFrame: () => () => void;
    onError: (error: unknown) => void;
    onSlowRender: (state: "busy" | "idle") => void;
  }) {
    this.#getInput = args.getInput;
    this.#pauseFrame = args.pauseFrame;
    this.#onError = args.onError;
    this.#onSlowRender = args.onSlowRender;
  }

  public isActive(): boolean {
    return this.#active;
  }

  public start(): void {
    this.#ready = true;
    this.requestRender();
  }

  public setRenderFunction(handler: RenderFn | undefined): void {
    if (!this.#active || this.#handler === handler) {
      return;
    }
    this.#handler = handler;
    this.#cancelRender();
    this.#force = handler != undefined;
    this.requestRender();
  }

  public requestRender(): void {
    if (!this.#active) {
      return;
    }
    this.#pending = true;
    if (!this.#ready || !this.#handler || this.#scheduled) {
      return;
    }
    if (this.#token) {
      this.#onSlowRender("busy");
      return;
    }
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.#drain();
    });
  }

  public dispose(): void {
    this.#active = false;
    this.#handler = undefined;
    this.#pending = false;
    this.#cancelRender();
  }

  #cancelRender(): void {
    const token = this.#token;
    this.#token = undefined;
    if (token && !token.finished) {
      token.finished = true;
      token.release();
    }
  }

  #drain(): void {
    if (!this.#active || !this.#ready || !this.#handler || this.#token || !this.#pending) {
      return;
    }
    this.#pending = false;
    try {
      // The builder mutates its retained state. Never advance it while a panel is busy.
      const state =
        this.#buildRenderState(this.#getInput()) ?? (this.#force ? this.#lastState : undefined);
      this.#force = false;
      this.#onSlowRender("idle");
      if (!state) {
        return;
      }
      // Keep asynchronous consumers isolated from subsequent builder mutations without copying
      // potentially large message arrays or payloads.
      this.#lastState = { ...state };
      const token: RenderToken = { release: this.#pauseFrame(), finished: false };
      this.#token = token;
      this.#handler(this.#lastState, () => {
        if (token.finished) {
          return;
        }
        token.finished = true;
        if (this.#token === token) {
          this.#token = undefined;
        }
        token.release();
        if (this.#active && this.#pending) {
          this.requestRender();
        }
      });
    } catch (error) {
      this.dispose();
      this.#onError(error);
    }
  }
}
