// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EventEmitter from "eventemitter3";
import { throttle } from "lodash-es";
import stringHash from "string-hash";

import { debouncePromise } from "@foxglove/den/async";
import {
  parseMessagePath,
  MessagePath,
  MessagePathStructureItemMessage,
} from "@foxglove/message-path";
import { toSec, subtract as subtractTime } from "@foxglove/rostime";
import { Immutable, Time, MessageEvent } from "@foxglove/studio";
import { messagePathStructures } from "@foxglove/studio-base/components/MessagePathSyntax/messagePathsForDatatype";
import {
  fillInGlobalVariablesInPath,
  getMessagePathDataItems,
} from "@foxglove/studio-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { GlobalVariables } from "@foxglove/studio-base/hooks/useGlobalVariables";
import { MessageBlock, PlayerState, Topic } from "@foxglove/studio-base/players/types";
import { Bounds, Bounds1D } from "@foxglove/studio-base/types/Bounds";
import { enumValuesByDatatypeAndField } from "@foxglove/studio-base/util/enums";
import { expandedLineColors } from "@foxglove/studio-base/util/plotColors";
import { getTimestampForMessageEvent } from "@foxglove/studio-base/util/time";
import { grey } from "@foxglove/studio-base/util/toolsColorScheme";

import {
  Dataset,
  HoverElement,
  InteractionEvent,
  Scale,
  UpdateAction,
} from "./StateTransitionsChartRenderer";
import { StateTransitionsRenderer } from "./StateTransitionsRenderer";
import { Viewport } from "./downsampleStates";
import positiveModulo from "./positiveModulo";
import { PathState } from "./settings";
import { StateTransitionConfig, StateTransitionPath, Datum } from "./types";

type EventTypes = {
  /** X scale changed. */
  xScaleChanged(scale: Scale | undefined): void;

  /** User interacted with the chart (zoom/pan). */
  timeseriesBounds(bounds: Immutable<Bounds1D>): void;

  /** Rendering updated the viewport. `canReset` is true if the viewport can be reset. */
  viewportChange(canReset: boolean): void;

  /** Path state changed (for settings panel). */
  pathStateChanged(pathState: PathState[]): void;
};

type SeriesItem = {
  configIndex: number;
  path: StateTransitionPath;
  parsed: MessagePath;
};

/**
 * StateTransitionsCoordinator interfaces commands and updates between the datasets and the chart renderer.
 */
export class StateTransitionsCoordinator extends EventEmitter<EventTypes> {
  #renderer: StateTransitionsRenderer;

  #configBounds: { x: Partial<Bounds1D>; y: Partial<Bounds1D> } = {
    x: {},
    y: {},
  };

  #globalBounds?: Immutable<Partial<Bounds1D>>;
  #datasetRange?: Bounds1D;
  #interactionBounds?: Bounds;
  #followRange?: number;
  #currentSeconds?: number;

  #updateAction: UpdateAction = { type: "update" };

  #latestXScale?: Scale;
  #destroyed = false;

  #queueDispatchRender = debouncePromise(this.#dispatchRender.bind(this));
  #queueDispatchDatasets = debouncePromise(this.#dispatchDatasets.bind(this));

  // Throttle buildAndUpdateDatasets to avoid excessive computation on frequent playerState updates
  // Using 100ms throttle with trailing edge to ensure final state is always rendered
  #throttledBuildAndUpdateDatasets = throttle(
    () => {
      this.#buildAndUpdateDatasetsImpl();
    },
    100,
    { leading: true, trailing: true },
  );

  #pendingDatasets?: Dataset[];

  // Viewport for downsampling
  #viewport: Viewport = {
    width: 0,
    height: 0,
    bounds: { x: { min: 0, max: 1 }, y: { min: 0, max: 1 } },
  };

  // Config and series management
  #config?: Immutable<StateTransitionConfig>;
  #series: SeriesItem[] = [];
  #showPoints = false;

  // Data tracking
  #lastSeekTime = NaN;

  // Block cursors for tracking processed blocks per series
  #blockCursors = new Map<string, number>();
  #latestBlocks?: Immutable<(MessageBlock | undefined)[]>;

  // Block reference tracking for detecting data source changes (like BlockTopicCursor)
  #firstBlockRefs = new Map<string, Immutable<MessageEvent[]> | undefined>();
  #lastBlockRefs = new Map<string, Immutable<MessageEvent[]> | undefined>();

  // Separated data storage for proper deduplication
  #fullData = new Map<string, Datum[]>(); // Preloaded block data (complete history)
  #currentData = new Map<string, Datum[]>(); // Streaming data (real-time)

  // Cache for processed data to avoid reprocessing unchanged data
  #processedDataCache = new Map<string, { data: Datum[]; inputLength: number; y: number }>();

  // Cache latest datasets for synchronous hover lookup (avoids Worker communication)
  #latestDatasets: Dataset[] = [];

  // Track which series have detected array input (invalid for StateTransitions)
  #seriesIsArray = new Map<string, boolean>();

  // Cached decoding helpers for enum constant names
  #topicsByName?: Record<string, Topic> = {};
  #structures?: Record<string, MessagePathStructureItemMessage>;
  #enumValues?: ReturnType<typeof enumValuesByDatatypeAndField>;

  public constructor(renderer: StateTransitionsRenderer) {
    super();
    this.#renderer = renderer;
  }

  /** Stop the coordinator from sending any future updates to the renderer. */
  public destroy(): void {
    this.#destroyed = true;
    this.#throttledBuildAndUpdateDatasets.cancel();
  }

  public isDestroyed(): boolean {
    return this.#destroyed;
  }

  /**
   * Handle config changes.
   */
  public handleConfig(
    config: Immutable<StateTransitionConfig>,
    globalVariables: GlobalVariables,
  ): void {
    if (this.isDestroyed()) {
      return;
    }

    this.#config = config;
    this.#showPoints = config.showPoints === true;
    this.#followRange = config.xAxisRange;

    // Parse and store series
    const newSeries: SeriesItem[] = [];
    for (let i = 0; i < config.paths.length; i++) {
      const path = config.paths[i]!;
      const parsed = parseMessagePath(path.value);
      if (!parsed) {
        continue;
      }

      const filledParsed = fillInGlobalVariablesInPath(parsed, globalVariables);
      newSeries.push({
        configIndex: i,
        path,
        parsed: filledParsed,
      });
    }

    // Check if series changed (need to reset all data)
    const seriesChanged =
      this.#series.length !== newSeries.length ||
      this.#series.some(
        (s, i) =>
          s.path.value !== newSeries[i]?.path.value ||
          s.path.timestampMethod !== newSeries[i]?.path.timestampMethod,
      );

    if (seriesChanged) {
      this.#blockCursors.clear();
      this.#fullData.clear();
      this.#currentData.clear();
      this.#processedDataCache.clear();
      this.#seriesIsArray.clear();
      this.#firstBlockRefs.clear();
      this.#lastBlockRefs.clear();
      this.#latestBlocks = undefined; // Force reprocessing of blocks
    }

    this.#series = newSeries;

    // Update config bounds
    const xMin = config.xAxisMinValue ?? 0;
    const xMax = config.xAxisMaxValue;

    this.#configBounds = {
      x: { min: xMin, max: xMax },
      y: {},
    };

    // Emit pathStateChanged for all config.paths (including unparseable ones)
    // This ensures settings panel reflects all paths immediately
    const pathState: PathState[] = config.paths.map((path, index) => {
      const series = newSeries.find((s) => s.configIndex === index);
      const cursorKey = series ? `${series.configIndex}:${series.parsed.topicName}` : "";
      return {
        path,
        isArray: this.#seriesIsArray.get(cursorKey) ?? false,
      };
    });

    this.emit("pathStateChanged", pathState);

    this.#queueDispatchRender();
  }

  /**
   * Handle player state updates.
   */
  public handlePlayerState(state: Immutable<PlayerState>): void {
    if (this.isDestroyed()) {
      return;
    }

    const activeData = state.activeData;
    if (!activeData) {
      return;
    }

    const { messages, lastSeekTime, currentTime, startTime, endTime, topics, datatypes } =
      activeData;
    this.#topicsByName = Object.fromEntries(topics.map((topic) => [topic.name, topic]));
    this.#structures = messagePathStructures(datatypes);
    this.#enumValues = enumValuesByDatatypeAndField(datatypes);

    // console.log("this.#enumValues", this.#enumValues);

    // Calculate current time since start for follow mode
    this.#currentSeconds = toSec(subtractTime(currentTime, startTime));

    // Calculate data range
    const endTimeSinceStart = toSec(subtractTime(endTime, startTime));
    this.#datasetRange = { min: 0, max: endTimeSinceStart };

    // Reset only streaming data on seek (keep preloaded block data intact)
    if (lastSeekTime !== this.#lastSeekTime) {
      this.#lastSeekTime = lastSeekTime;
      // Only clear streaming data, preserve fullData from blocks
      this.#currentData.clear();
      // Clear processed cache since merged data will change
      this.#processedDataCache.clear();
    }

    // Process blocks (preloaded data)
    const blocks = state.progress.messageCache?.blocks;
    if (blocks && blocks !== this.#latestBlocks) {
      this.#latestBlocks = blocks;
      this.#processBlocks(startTime, blocks);
    }

    // Process current messages (streaming data)
    this.#processMessages(startTime, messages);

    // Build and update datasets
    this.#buildAndUpdateDatasets();

    this.#queueDispatchRender();
  }

  /**
   * Process preloaded blocks incrementally.
   * Blocks are processed from where the cursor left off to avoid reprocessing.
   */
  #processBlocks(startTime: Time, blocks: Immutable<(MessageBlock | undefined)[]>): void {
    for (const series of this.#series) {
      const topicName = series.parsed.topicName;
      const cursorKey = `${series.configIndex}:${topicName}`;

      // Check if blocks have been reset (new data source, different blocks array)
      // Uses reference comparison similar to BlockTopicCursor.nextWillReset()
      const needsReset = this.#checkBlocksNeedReset(cursorKey, topicName, blocks);

      if (needsReset) {
        this.#blockCursors.set(cursorKey, 0);
        this.#fullData.set(cursorKey, []);
        // Also clear streaming data to avoid stale states when data source changes
        this.#currentData.set(cursorKey, []);
        // Clear processed cache for this series
        this.#processedDataCache.delete(cursorKey);
        // Update first block reference on reset
        this.#firstBlockRefs.set(cursorKey, blocks[0]?.messagesByTopic[topicName]);
      }

      let cursor = this.#blockCursors.get(cursorKey) ?? 0;
      const existingData = this.#fullData.get(cursorKey) ?? [];

      for (let blockIdx = cursor; blockIdx < blocks.length; blockIdx++) {
        const block = blocks[blockIdx];
        if (!block) {
          continue;
        }

        const messagesForTopic = block.messagesByTopic[topicName];
        if (!messagesForTopic) {
          continue;
        }

        for (const msgEvent of messagesForTopic) {
          const datum = this.#messageEventToDatum(msgEvent, series, startTime);
          if (datum) {
            existingData.push(datum);
          }
        }

        // Update last block reference after processing each block
        this.#lastBlockRefs.set(cursorKey, messagesForTopic);
        cursor = blockIdx + 1;
      }

      this.#blockCursors.set(cursorKey, cursor);
      this.#fullData.set(cursorKey, existingData);

      // After updating fullData, trim currentData to remove duplicates
      this.#trimCurrentData(cursorKey);
    }
  }

  /**
   * Check if blocks need to be reset (e.g., new data source loaded).
   * Uses reference comparison similar to BlockTopicCursor.nextWillReset().
   */
  #checkBlocksNeedReset(
    cursorKey: string,
    topicName: string,
    blocks: Immutable<(MessageBlock | undefined)[]>,
  ): boolean {
    const firstBlockRef = blocks[0]?.messagesByTopic[topicName];
    const storedFirstBlockRef = this.#firstBlockRefs.get(cursorKey);

    const cursor = this.#blockCursors.get(cursorKey) ?? 0;
    const lastIdx = Math.max(0, cursor - 1);
    const lastBlockRef = blocks[lastIdx]?.messagesByTopic[topicName];
    const storedLastBlockRef = this.#lastBlockRefs.get(cursorKey);

    return firstBlockRef !== storedFirstBlockRef || lastBlockRef !== storedLastBlockRef;
  }

  /**
   * Trim currentData to remove entries that are already covered by fullData.
   * This ensures no duplicate data points when merging.
   */
  #trimCurrentData(cursorKey: string): void {
    const fullData = this.#fullData.get(cursorKey);
    const currentData = this.#currentData.get(cursorKey);

    if (!fullData || fullData.length === 0 || !currentData || currentData.length === 0) {
      return;
    }

    // Get the last timestamp from fullData
    const lastFullX = fullData[fullData.length - 1]?.x;
    if (lastFullX == undefined) {
      return;
    }

    // Remove all currentData entries with x <= lastFullX
    let trimIndex = 0;
    for (const datum of currentData) {
      if (datum.x > lastFullX) {
        break;
      }
      trimIndex++;
    }

    if (trimIndex > 0) {
      currentData.splice(0, trimIndex);
    }
  }

  /**
   * Process streaming messages into currentData.
   * Streaming data is kept separate from block data and merged at render time.
   */
  #processMessages(startTime: Time, messages: Immutable<MessageEvent[]>): void {
    for (const series of this.#series) {
      const topicName = series.parsed.topicName;
      const cursorKey = `${series.configIndex}:${topicName}`;

      // Get the last timestamp from fullData to avoid duplicates
      const fullData = this.#fullData.get(cursorKey);
      const lastFullX = fullData?.[fullData.length - 1]?.x ?? -Infinity;

      for (const msgEvent of messages) {
        if (msgEvent.topic !== topicName) {
          continue;
        }

        const datum = this.#messageEventToDatum(msgEvent, series, startTime);
        if (!datum) {
          continue;
        }

        // Skip if this datum is already covered by fullData
        if (datum.x <= lastFullX) {
          continue;
        }

        const currentData = this.#currentData.get(cursorKey) ?? [];

        // Check for duplicates in currentData using binary search position
        const insertPos = this.#findInsertPosition(currentData, datum.x);

        // Avoid exact duplicates (same x value)
        if (insertPos < currentData.length && currentData[insertPos]?.x === datum.x) {
          continue;
        }
        if (insertPos > 0 && currentData[insertPos - 1]?.x === datum.x) {
          continue;
        }

        // Insert in sorted order
        currentData.splice(insertPos, 0, datum);
        this.#currentData.set(cursorKey, currentData);
      }
    }
  }

  /**
   * Binary search to find insertion position for sorted data.
   */
  #findInsertPosition(data: Datum[], x: number): number {
    let low = 0;
    let high = data.length;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (data[mid]!.x < x) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  }

  /**
   * Merge fullData and currentData for a given series.
   * fullData has priority - currentData only includes points after fullData's last point.
   */
  #getMergedData(cursorKey: string): Datum[] {
    const fullData = this.#fullData.get(cursorKey) ?? [];
    const currentData = this.#currentData.get(cursorKey) ?? [];

    if (currentData.length === 0) {
      return fullData;
    }

    if (fullData.length === 0) {
      return currentData;
    }

    // Get the last timestamp from fullData
    const lastFullX = fullData[fullData.length - 1]?.x ?? -Infinity;

    // Filter currentData to only include points after fullData
    const filteredCurrent = currentData.filter((datum) => datum.x > lastFullX);

    // Concatenate: fullData first, then currentData
    return [...fullData, ...filteredCurrent];
  }

  /**
   * Convert a message event to a chart datum.
   * Also tracks if the series has array input (invalid for StateTransitions).
   */
  #messageEventToDatum(
    msgEvent: Immutable<MessageEvent>,
    series: SeriesItem,
    startTime: Time,
  ): Datum | undefined {
    const timestamp = getTimestampForMessageEvent(msgEvent, series.path.timestampMethod);
    if (!timestamp || !this.#topicsByName || !this.#structures || !this.#enumValues) {
      return undefined;
    }

    const items = getMessagePathDataItems(
      msgEvent,
      series.parsed,
      this.#topicsByName,
      this.#structures,
      this.#enumValues,
    );

    if (items == undefined || items.length === 0) {
      return undefined;
    }

    // Extract value and constantName following original StateTransitions logic:
    // - Only accept exactly one item per message
    // - Arrays are invalid input (will be marked as isArray)
    const { value, constantName, isArray } = this.#extractValueFromItems(items);

    // Track if this series has array input
    if (isArray) {
      const cursorKey = `${series.configIndex}:${series.parsed.topicName}`;
      this.#seriesIsArray.set(cursorKey, true);
    }

    if (value == undefined) {
      return undefined;
    }

    // Skip anything that cannot be cast to a number or is a string.
    // This matches the original messagesToDataset.ts logic.
    if (Number.isNaN(value) && typeof value !== "string") {
      return undefined;
    }

    // Skip anything that cannot be cast to a valid value
    if (
      typeof value !== "number" &&
      typeof value !== "bigint" &&
      typeof value !== "boolean" &&
      typeof value !== "string"
    ) {
      return undefined;
    }

    const x = toSec(subtractTime(timestamp, startTime));
    const y = this.#getYForSeries(series.configIndex);

    // Color based on value - uses same logic as original messagesToDataset.ts
    const valueForColor = typeof value === "string" ? stringHash(value) : Math.round(Number(value));
    const color = this.#getColorForValue(valueForColor);

    const label = constantName != undefined ? `${constantName} (${String(value)})` : String(value);

    return {
      x,
      y,
      label,
      labelColor: color,
      value,
      constantName,
    };
  }

  /**
   * Extract value and constantName from decoded items.
   *
   * Follows the original StateTransitions logic:
   * - Only accepts exactly ONE item (like the original queriedData.length !== 1 check)
   * - If item is an object with value/constantName (enum lookup), extract those
   * - If item is a primitive, use directly
   * - Arrays are considered invalid input (isArray case in original code)
   */
  #extractValueFromItems(items: unknown[]): {
    value: unknown;
    constantName?: string;
    isArray: boolean;
  } {
    // Original logic: queriedData.length !== 1 means invalid input
    if (items.length !== 1) {
      return { value: undefined, constantName: undefined, isArray: items.length > 1 };
    }

    const item = items[0];

    // If item is an array, this is invalid input (original code would skip)
    if (Array.isArray(item)) {
      return { value: undefined, constantName: undefined, isArray: true };
    }

    // If item is an object with value property (from enum/constant lookup)
    if (typeof item === "object" && item != undefined && "value" in item) {
      const obj = item as { value?: unknown; constantName?: string };
      return { value: obj.value, constantName: obj.constantName, isArray: false };
    }

    // Item is a primitive value directly
    return { value: item, constantName: undefined, isArray: false };
  }

  /**
   * Build datasets from accumulated data and update the renderer (throttled).
   * Merges fullData (blocks) and currentData (streaming) for each series.
   */
  #buildAndUpdateDatasets(): void {
    this.#throttledBuildAndUpdateDatasets();
  }

  /**
   * Implementation of buildAndUpdateDatasets.
   * Called by the throttled wrapper.
   */
  #buildAndUpdateDatasetsImpl(): void {
    if (this.isDestroyed() || !this.#config) {
      return;
    }

    const datasets: Dataset[] = [];
    let minY: number | undefined;

    for (const series of this.#series) {
      const y = this.#getYForSeries(series.configIndex);
      minY = Math.min(minY ?? y, y - 5);

      const cursorKey = `${series.configIndex}:${series.parsed.topicName}`;

      // Merge fullData and currentData
      const data = this.#getMergedData(cursorKey);

      // Process data to create state transition segments (with caching)
      const processedData = this.#processDataForStateTransitions(data, y, cursorKey);

      const dataset: Dataset = {
        borderWidth: 10,
        data: processedData,
        label: series.path.label ?? series.path.value,
        pointBackgroundColor: "rgba(0, 0, 0, 0.4)",
        pointBorderColor: "transparent",
        pointHoverRadius: 3,
        pointRadius: this.#showPoints ? 1.25 : 0,
        pointStyle: "circle",
        showLine: true,
      };

      datasets.push(dataset);
    }

    // Update y bounds
    this.#configBounds.y = { min: minY, max: -3 };
    this.#updateAction.yBounds = this.#configBounds.y;

    // Update x bounds with follow mode
    if (this.#followRange != undefined && this.#currentSeconds != undefined) {
      this.#configBounds.x = {
        min: this.#currentSeconds - this.#followRange,
        max: this.#currentSeconds,
      };
    } else {
      this.#configBounds.x = {
        min: this.#config.xAxisMinValue ?? 0,
        max: this.#config.xAxisMaxValue ?? this.#datasetRange?.max,
      };
    }

    // Build pathState from all config.paths (including unparseable ones)
    // This ensures settings panel reflects all paths with updated isArray status
    const pathState: PathState[] = this.#config.paths.map((path, index) => {
      const series = this.#series.find((s) => s.configIndex === index);
      const cursorKey = series ? `${series.configIndex}:${series.parsed.topicName}` : "";
      return {
        path,
        isArray: this.#seriesIsArray.get(cursorKey) ?? false,
      };
    });

    this.emit("pathStateChanged", pathState);
    this.updateDatasets(datasets);
  }

  /**
   * Process raw data into state transition format (only show state changes).
   * Uses caching to avoid reprocessing unchanged data.
   */
  #processDataForStateTransitions(data: Datum[], y: number, cacheKey: string): Datum[] {
    if (data.length === 0) {
      return [];
    }

    // Check cache - if data length and y are the same, reuse cached result
    const cached = this.#processedDataCache.get(cacheKey);
    if (cached && cached.inputLength === data.length && cached.y === y) {
      return cached.data;
    }

    // Data is typically already sorted by time from the source.
    // Only sort if we detect it's not sorted (check first few elements).
    let sorted = data;
    if (data.length > 1) {
      const needsSort = data[0]!.x > data[1]!.x || (data.length > 2 && data[1]!.x > data[2]!.x);
      if (needsSort) {
        sorted = [...data].sort((a, b) => a.x - b.x);
      }
    }

    const result: Datum[] = [];
    let lastValue: unknown = undefined;
    let lastDatum: Datum | undefined = undefined;

    for (const datum of sorted) {
      const isNewSegment = lastValue !== datum.value;

      lastValue = datum.value;

      // Reuse datum object when possible, only create new object when necessary
      if (isNewSegment || this.#showPoints) {
        result.push({
          x: datum.x,
          y,
          value: datum.value,
          label: isNewSegment ? datum.label : undefined,
          labelColor: datum.labelColor,
          constantName: datum.constantName,
        });
        lastDatum = undefined;
      } else {
        // Track last datum for potential final push
        lastDatum = datum;
      }
    }

    // Add the last datum if not already added
    if (lastDatum != undefined) {
      result.push({
        x: lastDatum.x,
        y,
        value: lastDatum.value,
        label: undefined,
        labelColor: lastDatum.labelColor,
        constantName: lastDatum.constantName,
      });
    }

    // Cache the result
    this.#processedDataCache.set(cacheKey, { data: result, inputLength: data.length, y });

    return result;
  }

  /**
   * Get Y position for a series index.
   */
  #getYForSeries(index: number): number {
    return (index + 1) * 6 * -3;
  }

  /**
   * Get color for a value.
   * Uses the same color scheme as the original StateTransitions implementation.
   */
  #getColorForValue(value: number): string {
    const baseColorsLength = expandedLineColors.length;
    return expandedLineColors[positiveModulo(value, baseColorsLength)] ?? grey;
  }

  /**
   * Update the datasets to render.
   */
  public updateDatasets(datasets: Dataset[]): void {
    if (this.isDestroyed()) {
      return;
    }
    // Cache datasets for synchronous hover lookup
    this.#latestDatasets = datasets;
    this.#pendingDatasets = datasets;
    this.#queueDispatchDatasets();
  }

  /**
   * Set the data range (used for x-axis bounds calculation).
   */
  public setDataRange(range: Bounds1D | undefined): void {
    if (this.isDestroyed()) {
      return;
    }
    this.#datasetRange = range;
    this.#queueDispatchRender();
  }

  /**
   * Set the global bounds (from synced panels).
   */
  public setGlobalBounds(bounds: Immutable<Bounds1D> | undefined): void {
    if (this.isDestroyed()) {
      return;
    }
    this.#globalBounds = bounds;
    this.#interactionBounds = undefined;
    this.#queueDispatchRender();
  }

  /**
   * Reset the view to the default bounds.
   */
  public resetBounds(): void {
    if (this.isDestroyed()) {
      return;
    }
    this.#interactionBounds = undefined;
    this.#globalBounds = undefined;
    this.#updateAction.yBounds = this.#configBounds.y;
    this.#queueDispatchRender();
  }

  /**
   * Set the chart size.
   */
  public setSize(size: { width: number; height: number }): void {
    if (this.isDestroyed()) {
      return;
    }
    this.#viewport.width = size.width;
    this.#viewport.height = size.height;
    this.#updateAction.size = size;
    this.#queueDispatchRender();
  }

  /**
   * Add an interaction event (wheel, pan).
   */
  public addInteractionEvent(ev: InteractionEvent): void {
    if (this.isDestroyed()) {
      return;
    }
    if (!this.#updateAction.interactionEvents) {
      this.#updateAction.interactionEvents = [];
    }
    this.#updateAction.interactionEvents.push(ev);
    this.#queueDispatchRender();
  }

  /**
   * Get the plot x value at the canvas pixel x location.
   */
  public getXValueAtPixel(pixelX: number): number {
    if (!this.#latestXScale) {
      return -1;
    }

    const pixelRange = this.#latestXScale.right - this.#latestXScale.left;
    if (pixelRange <= 0) {
      return -1;
    }

    // Linear interpolation to place the pixelX value within min/max
    return (
      this.#latestXScale.min +
      ((pixelX - this.#latestXScale.left) / pixelRange) *
        (this.#latestXScale.max - this.#latestXScale.min)
    );
  }

  /**
   * Get hover elements at pixel position (synchronous, main thread).
   * Uses cached datasets to avoid Worker communication during data loading.
   */
  public getElementsAtPixelSync(pixel: { x: number; y: number }): HoverElement[] {
    if (this.isDestroyed() || !this.#latestXScale) {
      return [];
    }

    const xValue = this.getXValueAtPixel(pixel.x);
    if (xValue < 0) {
      return [];
    }

    const results: HoverElement[] = [];

    // Find the element at the given x position for each dataset
    for (let datasetIndex = 0; datasetIndex < this.#latestDatasets.length; datasetIndex++) {
      const dataset = this.#latestDatasets[datasetIndex];
      if (!dataset) {
        continue;
      }

      const data = dataset.data;
      if (data.length === 0) {
        continue;
      }

      // Binary search to find the element at or before the x position
      let low = 0;
      let high = data.length - 1;
      let foundIndex = -1;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const datum = data[mid];
        if (!datum || isNaN(datum.x)) {
          // Skip NaN values
          high = mid - 1;
          continue;
        }

        if (datum.x <= xValue) {
          foundIndex = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      if (foundIndex >= 0) {
        const datum = data[foundIndex];
        if (datum && !isNaN(datum.x) && !isNaN(datum.y)) {
          results.push({
            data: datum,
            configIndex: datasetIndex,
          });
        }
      }
    }

    return results;
  }

  /**
   * Get datalabel at pixel position (for click handling).
   */
  public async getDatalabelAtEvent(pixel: { x: number; y: number }): Promise<Datum | undefined> {
    if (this.isDestroyed()) {
      return undefined;
    }
    return await this.#renderer.getDatalabelAtEvent(pixel);
  }

  /**
   * Check if the plot can be reset.
   */
  #canReset(): boolean {
    if (this.#interactionBounds) {
      return true;
    }

    if (this.#globalBounds) {
      const resetBounds = this.#getXResetBounds();
      return (
        this.#globalBounds.min !== resetBounds.min || this.#globalBounds.max !== resetBounds.max
      );
    }

    return false;
  }

  /**
   * Get the xBounds if we cleared the interaction and global bounds (reset).
   */
  #getXResetBounds(): Partial<Bounds1D> {
    const xMin = this.#configBounds.x.min ?? this.#datasetRange?.min;
    const xMax = this.#configBounds.x.max ?? this.#datasetRange?.max;
    return { min: xMin, max: xMax };
  }

  /**
   * Get the current x bounds.
   */
  #getXBounds(): Partial<Bounds1D> {
    const resetBounds = this.#getXResetBounds();
    return {
      min: this.#interactionBounds?.x.min ?? this.#globalBounds?.min ?? resetBounds.min,
      max: this.#interactionBounds?.x.max ?? this.#globalBounds?.max ?? resetBounds.max,
    };
  }

  async #dispatchRender(): Promise<void> {
    if (this.isDestroyed()) {
      return;
    }

    this.#updateAction.xBounds = this.#getXBounds();

    const haveInteractionEvents = (this.#updateAction.interactionEvents?.length ?? 0) > 0;

    const action = this.#updateAction;
    this.#updateAction = {
      type: "update",
    };

    const bounds = await this.#renderer.update(action);
    if (this.isDestroyed()) {
      return;
    }

    if (haveInteractionEvents) {
      this.#interactionBounds = bounds;
    }

    if (haveInteractionEvents && bounds) {
      this.emit("timeseriesBounds", bounds.x);
    }

    this.emit("viewportChange", this.#canReset());

    // After render update, dispatch datasets to update the chart data
    this.#queueDispatchDatasets();
  }

  async #dispatchDatasets(): Promise<void> {
    if (this.isDestroyed() || !this.#pendingDatasets) {
      return;
    }

    const datasets = this.#pendingDatasets;
    this.#pendingDatasets = undefined;

    // Build viewport for downsampling in worker
    const xBounds = this.#getXBounds();
    const yBounds = this.#configBounds.y;

    let viewport: Viewport | undefined;
    if (
      xBounds.min != undefined &&
      xBounds.max != undefined &&
      yBounds.min != undefined &&
      yBounds.max != undefined &&
      this.#viewport.width > 0
    ) {
      viewport = {
        width: this.#viewport.width,
        height: this.#viewport.height,
        bounds: {
          x: { min: xBounds.min, max: xBounds.max },
          y: { min: yBounds.min, max: yBounds.max },
        },
      };
    }

    // Pass viewport to renderer for downsampling in worker
    this.#latestXScale = await this.#renderer.updateDatasets(datasets, viewport);
    if (this.isDestroyed()) {
      return;
    }

    this.emit("xScaleChanged", this.#latestXScale);
  }
}
