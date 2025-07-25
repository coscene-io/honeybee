// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";
import type { Theme } from "@mui/material";

import { ComlinkWrap } from "@foxglove/den/worker";
import { Immutable } from "@foxglove/studio";
import { Bounds } from "@foxglove/studio-base/types/Bounds";

import { ChartRenderer, Dataset, HoverElement, Scale, UpdateAction } from "./ChartRenderer";
import type { Service } from "./ChartRenderer.worker";

// If the datasets builder is garbage collected we also need to cleanup the worker
// This registry ensures the worker is cleaned up when the builder is garbage collected
const registry = new FinalizationRegistry<() => void>((dispose) => {
  dispose();
});

export class OffscreenCanvasRenderer {
  #canvas: OffscreenCanvas;
  #remote: Promise<Comlink.RemoteObject<ChartRenderer>>;
  #dispose?: () => void;
  #destroyed = false;

  #theme: Theme;

  public constructor(
    canvas: OffscreenCanvas,
    theme: Theme,
    { handleWorkerError }: { handleWorkerError?: (event: Event) => void } = {},
  ) {
    this.#theme = theme;
    this.#canvas = canvas;
    const worker = new Worker(
      // foxglove-depcheck-used: babel-plugin-transform-import-meta
      new URL("./ChartRenderer.worker", import.meta.url),
    );
    worker.onerror = (event) => {
      handleWorkerError?.(event);
    };
    worker.onmessageerror = (event) => {
      handleWorkerError?.(event);
    };

    const { remote, dispose } = ComlinkWrap<Service<Comlink.RemoteObject<ChartRenderer>>>(worker);

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

    registry.register(this, dispose);
  }

  public async update(action: Immutable<UpdateAction>): Promise<Bounds | undefined> {
    if (this.#destroyed) {
      return undefined;
    }
    return await (await this.#remote).update(action);
  }

  public async getElementsAtPixel(pixel: { x: number; y: number }): Promise<HoverElement[]> {
    if (this.#destroyed) {
      return [];
    }
    return await (await this.#remote).getElementsAtPixel(pixel);
  }

  public async updateDatasets(datasets: Dataset[]): Promise<Scale | undefined> {
    if (this.#destroyed) {
      return undefined;
    }
    return await (await this.#remote).updateDatasets(datasets);
  }

  public destroy(): void {
    if (this.#destroyed) {
      return;
    }

    this.#destroyed = true;

    // Immediately dispose of the worker to prevent further operations
    this.#dispose?.();
    this.#dispose = undefined;
  }

  public isDestroyed(): boolean {
    return this.#destroyed;
  }
}
