// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Chart,
  ChartDataset,
  ChartOptions,
  Interaction,
  InteractionItem,
  InteractionModeFunction,
  Ticks,
} from "chart.js";
import { getRelativePosition } from "chart.js/helpers";
import type { Context as DatalabelContext } from "chartjs-plugin-datalabels";
import { type Options as DatalabelsPluginOptions } from "chartjs-plugin-datalabels/types/options";
import EventEmitter from "eventemitter3";

import { Zoom as ZoomPlugin } from "@foxglove/chartjs-plugin-zoom";
import { unwrap } from "@foxglove/den/monads";
import { Immutable } from "@foxglove/studio";
import { Bounds, Bounds1D } from "@foxglove/studio-base/types/Bounds";
import { maybeCast } from "@foxglove/studio-base/util/maybeCast";
import { grey } from "@foxglove/studio-base/util/toolsColorScheme";

import { downsampleStates, MAX_POINTS, Viewport } from "./downsampleStates";
import { Datum } from "./types";

// Define fontMonospace locally to avoid importing @foxglove/theme which includes React dependencies
// that cannot be loaded in a Worker context
const fontMonospace = "'IBM Plex Mono'";

// Line segment color function for state transitions
// Uses p0.raw.labelColor to match the original implementation in lineSegments.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lineSegmentLabelColor(ctx: any): string | undefined {
  return ctx?.p0?.raw?.labelColor as string | undefined;
}

export type Scale = {
  min: number;
  max: number;
  left: number;
  right: number;
};

type BaseInteractionEvent = {
  cancelable: boolean;
  deltaY: number;
  deltaX: number;
  boundingClientRect: DOMRect;
};

type MouseBase = BaseInteractionEvent & {
  clientX: number;
  clientY: number;
};

type WheelInteractionEvent = { type: "wheel" } & BaseInteractionEvent & MouseBase;
type PanStartInteractionEvent = { type: "panstart" } & BaseInteractionEvent & {
    center: { x: number; y: number };
  };
type PanMoveInteractionEvent = { type: "panmove" } & BaseInteractionEvent;
type PanEndInteractionEvent = { type: "panend" } & BaseInteractionEvent;

export type InteractionEvent =
  | WheelInteractionEvent
  | PanStartInteractionEvent
  | PanMoveInteractionEvent
  | PanEndInteractionEvent;

export type Dataset = ChartDataset<"scatter", Datum[]>;

type ChartType = Chart<"scatter", Datum[]>;

export type HoverElement = {
  data: Datum;
  configIndex: number;
};

export type Size = { width: number; height: number };

export type UpdateAction = {
  type: "update";
  size?: Size;
  xBounds?: Partial<Bounds1D>;
  yBounds?: Partial<Bounds1D>;
  zoomMode?: "x" | "y" | "xy";
  interactionEvents?: InteractionEvent[];
};

const fixedNumberFormat = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function addEventListener(emitter: EventEmitter) {
  return (eventName: string, fn?: () => void) => {
    const existing = emitter.listeners(eventName);
    if (!fn || existing.includes(fn)) {
      return;
    }
    emitter.on(eventName, fn);
  };
}

function removeEventListener(emitter: EventEmitter) {
  return (eventName: string, fn?: () => void) => {
    if (fn) {
      emitter.off(eventName, fn);
    }
  };
}

// allows us to override the chart.ctx instance field which zoom plugin uses for adding event listeners
type MutableContext<T> = Omit<Chart, "ctx"> & { ctx: T };

type PanEvent = {
  deltaX: number;
  deltaY: number;
};

type PanStartEvent = PanEvent & {
  center: { x: number; y: number };
  target: {
    getBoundingClientRect(): DOMRect;
  };
};

type ZoomableChart = Chart & {
  $zoom: {
    panStartHandler(event: PanStartEvent): void;
    panHandler(event: PanEvent): void;
    panEndHandler(): void;
  };
};

declare module "chart.js" {
  interface InteractionModeMap {
    lastX: InteractionModeFunction;
  }
}

// A custom interaction mode that returns the items before an x cursor position.
// This mode is used by the state transition panel to show a tooltip of the current state
// "between" state datapoints.
//
// See: https://www.chartjs.org/docs/latest/configuration/interactions.html#custom-interaction-modes
const lastX: InteractionModeFunction = (chart, event, _options, useFinalPosition) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
  const position = getRelativePosition(event, chart as any);

  // Create a sparse array to track the last datum for each dataset
  const datasetIndexToLastItem: InteractionItem[] = [];
  Interaction.evaluateInteractionItems(chart, "x", position, (element, datasetIndex, index) => {
    const center = element.getCenterPoint(useFinalPosition);
    if (center.x <= position.x) {
      datasetIndexToLastItem[datasetIndex] = { element, datasetIndex, index };
    }
  });
  // Filter unused entries from the sparse array
  return datasetIndexToLastItem.filter(Boolean);
};

// Register the custom interaction mode
Interaction.modes.lastX = lastX;

export type InitArgs = {
  canvas: OffscreenCanvas;
  devicePixelRatio: number;
  gridColor: string;
  tickColor: string;
};

export class StateTransitionsChartRenderer {
  #chartInstance: ChartType;
  #fakeNodeEvents = new EventEmitter();
  #fakeDocumentEvents = new EventEmitter();
  #lastDatalabelClickContext?: DatalabelContext;

  public constructor(args: InitArgs) {
    const fakeNode = {
      addEventListener: addEventListener(this.#fakeNodeEvents),
      removeEventListener: removeEventListener(this.#fakeNodeEvents),
      ownerDocument: {
        addEventListener: addEventListener(this.#fakeDocumentEvents),
        removeEventListener: removeEventListener(this.#fakeDocumentEvents),
      },
    };

    const origZoomStart = ZoomPlugin.start?.bind(ZoomPlugin);
    ZoomPlugin.start = (chartInstance: MutableContext<unknown>, startArgs, pluginOptions) => {
      // swap the canvas with our fake dom node canvas to support zoom plugin addEventListener
      const ctx = chartInstance.ctx;
      chartInstance.ctx = {
        canvas: fakeNode,
      };
      const res = origZoomStart?.(chartInstance as Chart, startArgs, pluginOptions);
      chartInstance.ctx = ctx;
      return res;
    };

    const fullOptions: ChartOptions<"scatter"> = {
      maintainAspectRatio: false,
      animation: false,
      // Disable splines, they seem to cause weird rendering artifacts:
      elements: { line: { tension: 0 } },
      interaction: {
        intersect: false,
        mode: "lastX",
      },
      devicePixelRatio: args.devicePixelRatio,
      font: { family: fontMonospace, size: 10 },
      // we force responsive off since we manually trigger width/height updates on the chart
      // responsive mode does not work properly with offscreen canvases and retina device pixel ratios
      // it results in a run-away canvas that keeps doubling in size!
      responsive: false,
      // Disable top padding - StateTransitions data points are far below y max (-3),
      // so no padding is needed at the top. This matches the original behavior.
      layout: {
        autoPadding: false,
        padding: {
          top: 0,
          bottom: 5, // borderWidth / 2, to prevent bottom clipping
          left: 5,
          right: 5,
        },
      },
      scales: {
        x: {
          type: "linear",
          display: true,
          grid: { color: args.gridColor },
          border: { display: false },
          ticks: {
            font: {
              family: fontMonospace,
              size: 10,
            },
            color: args.tickColor,
            maxRotation: 0,
          },
        },
        y: {
          type: "linear",
          display: true,
          grid: { display: false },
          ticks: {
            display: false,
            font: {
              family: fontMonospace,
              size: 10,
            },
            color: args.tickColor,
            padding: 0,
          },
        },
      },
      plugins: {
        decimation: {
          enabled: false,
        },
        tooltip: {
          enabled: false, // Disable native tooltips since we use custom ones.
        },
        zoom: {
          zoom: {
            enabled: true,
            mode: "x",
            sensitivity: 3,
            speed: 0.1,
          },
          pan: {
            mode: "x",
            enabled: true,
            speed: 20,
            threshold: 10,
          },
        },
        datalabels: {
          display: "auto",
          anchor: "center",
          align: -45,
          offset: 0,
          clip: true,
          font: {
            family: fontMonospace,
            size: 10,
            weight: "bold",
          },
        },
      },
    };

    // Add functions to datalabels config (can't be serialized)
    const datalabelsOptions = fullOptions.plugins?.datalabels as
      | DatalabelsPluginOptions
      | undefined;
    if (datalabelsOptions) {
      datalabelsOptions.listeners = {
        click: (context: DatalabelContext) => {
          this.#lastDatalabelClickContext = context;
        },
      };

      datalabelsOptions.formatter = (value: { label?: string }, _context: unknown) => {
        // Return "null" if we don't want this label to be displayed.
        // eslint-disable-next-line no-restricted-syntax
        return value.label ?? null;
      };

      const staticColor = datalabelsOptions.color ?? "white";
      datalabelsOptions.color = (context: DatalabelContext) => {
        const value = context.dataset.data[context.dataIndex];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (value as any)?.labelColor ?? staticColor;
      };
    }

    // ChartJS supports offscreen canvas however the type definitions do not so we need to cast and
    // fool the constructor.
    const canvas = args.canvas as unknown as HTMLCanvasElement;
    const chartInstance = new Chart<"scatter", Datum[]>(canvas, {
      type: "scatter",
      data: {
        datasets: [],
      },
      options: fullOptions,
      plugins: [ZoomPlugin],
    });

    ZoomPlugin.start = origZoomStart;
    this.#chartInstance = chartInstance;
  }

  public update(action: Immutable<UpdateAction>): Bounds | undefined {
    if (action.size) {
      this.#chartInstance.canvas.width = action.size.width;
      this.#chartInstance.canvas.height = action.size.height;
      this.#chartInstance.resize();
    }

    if (action.yBounds) {
      const scaleOption = this.#chartInstance.options.scales?.y;
      if (scaleOption && scaleOption.min !== action.yBounds.min) {
        scaleOption.min = action.yBounds.min;
      }
      if (scaleOption && scaleOption.max !== action.yBounds.max) {
        scaleOption.max = action.yBounds.max;
      }
    }

    if (action.xBounds) {
      const scaleOption = this.#chartInstance.options.scales?.x;
      if (scaleOption && scaleOption.min !== action.xBounds.min) {
        scaleOption.min = action.xBounds.min;
      }

      if (scaleOption && scaleOption.max !== action.xBounds.max) {
        scaleOption.max = action.xBounds.max;
      }

      // Adjust the `ticks` of the chart options to ensure the first/last x labels remain a
      // constant width. See https://github.com/foxglove/studio/issues/2926
      if (scaleOption?.ticks) {
        scaleOption.ticks.callback = function (value, index, ticks) {
          // use a fixed formatter for the first/last ticks
          if (index === 0 || index === ticks.length - 1) {
            return fixedNumberFormat.format(value as number);
          }
          // otherwise use chart.js's default formatter
          return Ticks.formatters.numeric.apply(this, [value as number, index, ticks]);
        };
      }
    }

    if (action.interactionEvents) {
      for (const event of action.interactionEvents) {
        this.#applyInteractionEvent(event);
      }
    }

    if (action.zoomMode) {
      unwrap(this.#chartInstance.options.plugins?.zoom?.zoom).mode = action.zoomMode;
    }

    // NOTE: "none" disables animations - this is important for chart performance because we update
    // the entire data set which does not preserve history for the chart animations
    this.#chartInstance.update("none");

    // fill our rpc scales - we only support x and y scales for now
    const xScale = this.#chartInstance.scales.x;
    const yScale = this.#chartInstance.scales.y;

    if (!xScale || !yScale) {
      return undefined;
    }

    return {
      x: {
        min: xScale.min,
        max: xScale.max,
      },
      y: {
        min: yScale.min,
        max: yScale.max,
      },
    };
  }

  public updateDatasets(datasets: Dataset[], viewport?: Viewport): Scale | undefined {
    // Downsample datasets before rendering (if viewport is provided)
    const processedDatasets = viewport ? this.#downsampleDatasets(datasets, viewport) : datasets;

    // Apply a line segment coloring function
    for (const ds of processedDatasets) {
      ds.segment = {
        borderColor: lineSegmentLabelColor,
      };
    }

    this.#chartInstance.data.datasets = processedDatasets;

    // NOTE: "none" disables animations
    this.#chartInstance.update("none");
    return this.#getXScale();
  }

  /**
   * Downsample datasets for rendering.
   * When there are many state transitions in a small visual area,
   * they are collapsed into a gray "[...]" segment.
   */
  #downsampleDatasets(datasets: Dataset[], viewport: Viewport): Dataset[] {
    // If we don't have valid bounds, return original datasets
    if (viewport.width <= 0) {
      return datasets;
    }

    // Calculate max points per dataset
    const numPoints = MAX_POINTS / Math.max(datasets.length, 1);

    return datasets.map((dataset) => {
      const data = dataset.data;
      if (data.length === 0) {
        return dataset;
      }

      // Get the y value from the first data point
      const yValue = data[0]?.y ?? 0;

      // Perform downsampling
      const downsampled = downsampleStates(data, viewport, numPoints);

      // Resolve downsampled points back to actual data
      const resolved = downsampled.map(({ x, index, states }) => {
        if (index == undefined) {
          // This is a compressed segment with multiple states
          // Render as gray "[...]" to indicate hidden detail
          return {
            x,
            y: yValue,
            labelColor: grey,
            label: "[...]",
            states,
            value: undefined,
          };
        }

        // Get the original point
        const point = data[index];
        if (point == undefined) {
          return { x: NaN, y: NaN, value: NaN };
        }

        return {
          ...point,
          x,
        };
      });

      // NaN item values create gaps in the line
      const cleanedData = resolved.map((item) => {
        if (isNaN(item.x) || isNaN(item.y)) {
          return { x: NaN, y: NaN, value: NaN };
        }
        return item;
      });

      return { ...dataset, data: cleanedData };
    });
  }

  public getDatalabelAtEvent(pixel: { x: number; y: number }): Datum | undefined {
    const ev = {
      type: "click",
      x: pixel.x,
      y: pixel.y,
    };

    this.#chartInstance.notifyPlugins("beforeEvent", { event: ev });

    // clear the stored click context - we have consumed it
    const context = this.#lastDatalabelClickContext;
    this.#lastDatalabelClickContext = undefined;

    if (!context) {
      return undefined;
    }

    return context.dataset.data[context.dataIndex] as Datum | undefined;
  }

  #getXScale(): Scale | undefined {
    const xScale = this.#chartInstance.scales.x;
    if (!xScale) {
      return undefined;
    }

    return {
      min: xScale.min,
      max: xScale.max,
      left: xScale.left,
      right: xScale.right,
    };
  }

  #applyInteractionEvent(event: Immutable<InteractionEvent>): void {
    const { type, boundingClientRect, ...rest } = event;
    switch (type) {
      case "wheel":
        this.#fakeNodeEvents.emit("wheel", {
          ...rest,
          target: {
            getBoundingClientRect() {
              return boundingClientRect;
            },
          },
        });
        break;
      case "panstart":
        maybeCast<ZoomableChart>(this.#chartInstance)?.$zoom.panStartHandler({
          center: event.center,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          target: {
            getBoundingClientRect() {
              return boundingClientRect;
            },
          },
        });
        break;
      case "panmove":
        maybeCast<ZoomableChart>(this.#chartInstance)?.$zoom.panHandler(event);
        break;
      case "panend":
        maybeCast<ZoomableChart>(this.#chartInstance)?.$zoom.panEndHandler();
        break;
    }
  }
}
