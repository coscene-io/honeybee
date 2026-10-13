// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";
import type { Theme } from "@mui/material";

import { ComlinkWrap, transferTypedArrays } from "@foxglove/den/worker";
import Logger from "@foxglove/log";
import { Immutable } from "@foxglove/studio";
import { Bounds } from "@foxglove/studio-base/types/Bounds";

import type { Service } from "./StateTransitionsChart.worker";
import {
  Dataset,
  HoverElement,
  Scale,
  StateTransitionsChartRenderer,
  UpdateAction,
} from "./StateTransitionsChartRenderer";
import { PackedStateTransitionDataset } from "./StateTransitionsDatasetBuilderImpl";
import { Viewport } from "./downsampleStates";
import { Datum } from "./types";

const log = Logger.getLogger(__filename);

// If the renderer is garbage collected we also need to cleanup the worker
// This registry ensures the worker is cleaned up when the renderer is garbage collected
const registry = new FinalizationRegistry<() => void>((dispose) => {
  dispose();
});

export class StateTransitionsRenderer {
  #canvas: OffscreenCanvas;
  #remote: Promise<Comlink.RemoteObject<StateTransitionsChartRenderer>>;
  #dispose?: () => void;
  #destroyed = false;
  #handleWorkerError?: (event: Event) => void;
  #workerErrorReported = false;

  #theme: Theme;

  public constructor(
    canvas: OffscreenCanvas,
    theme: Theme,
    { handleWorkerError }: { handleWorkerError?: (event: Event) => void } = {},
  ) {
    this.#theme = theme;
    this.#canvas = canvas;
    this.#handleWorkerError = handleWorkerError;

    const worker = new Worker(new URL("./StateTransitionsChart.worker", import.meta.url));
    worker.onerror = (event) => {
      this.#reportWorkerError(event);
    };
    worker.onmessageerror = (event) => {
      this.#reportWorkerError(event);
    };

    const { remote, dispose } =
      ComlinkWrap<Service<Comlink.RemoteObject<StateTransitionsChartRenderer>>>(worker);

    // Store dispose function for explicit cleanup
    this.#dispose = dispose;

    // Set the promise without await so init creates only one instance of renderer even if called
    // twice.
    this.#remote = remote.init(
      Comlink.transfer(
        {
          canvas: this.#canvas,
          devicePixelRatio: window.devicePixelRatio,
          gridColor: this.#theme.palette.divider,
          tickColor: this.#theme.palette.text.secondary,
        },
        [this.#canvas],
      ),
    );

    registry.register(this, dispose, this);
  }

  public async update(action: Immutable<UpdateAction>): Promise<Bounds | undefined> {
    if (this.#destroyed) {
      return undefined;
    }
    return await this.#runRemote(async () => await (await this.#remote).update(action), undefined);
  }

  public async getElementsAtPixel(pixel: { x: number; y: number }): Promise<HoverElement[]> {
    if (this.#destroyed) {
      return [];
    }
    return await this.#runRemote(
      async () => await (await this.#remote).getElementsAtPixel(pixel),
      [],
    );
  }

  public async updateDatasets(
    datasets: Dataset[] | PackedStateTransitionDataset[],
    viewport?: Viewport,
  ): Promise<Scale | undefined> {
    if (this.#destroyed) {
      return undefined;
    }
    return await this.#runRemote(
      async () =>
        await (await this.#remote).updateDatasets(transferTypedArrays(datasets), viewport),
      undefined,
    );
  }

  public async getDatalabelAtEvent(pixel: { x: number; y: number }): Promise<Datum | undefined> {
    if (this.#destroyed) {
      return undefined;
    }
    return await this.#runRemote(
      async () => await (await this.#remote).getDatalabelAtEvent(pixel),
      undefined,
    );
  }

  public destroy(): void {
    if (this.#destroyed) {
      return;
    }

    this.#destroyed = true;
    registry.unregister(this);

    // Immediately dispose of the worker to prevent further operations
    this.#dispose?.();
    this.#dispose = undefined;
  }

  public isDestroyed(): boolean {
    return this.#destroyed;
  }

  async #runRemote<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.#reportWorkerError(error);
      return fallback;
    }
  }

  #reportWorkerError(error: unknown): void {
    if (this.#destroyed || this.#workerErrorReported) {
      return;
    }
    this.#workerErrorReported = true;
    log.error("[StateTransitionsRenderer] Worker error:", error);
    const event =
      error instanceof Event
        ? error
        : typeof ErrorEvent !== "undefined"
          ? new ErrorEvent("error", {
              error,
              message: error instanceof Error ? error.message : String(error),
            })
          : new Event("error");
    try {
      this.#handleWorkerError?.(event);
    } catch (handlerError) {
      log.error("[StateTransitionsRenderer] Worker error handler failed", handlerError);
    }
  }
}
