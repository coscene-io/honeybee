// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EventEmitter from "eventemitter3";
import * as _ from "lodash-es";
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
import { VIEWPORT_PAN_BUFFER_FRACTION, Viewport } from "./downsampleStates";
import positiveModulo from "./positiveModulo";
import { PathState } from "./settings";
import {
  mergeSortedByX,
  processCacheFingerprint,
  sliceInterleavedStateDataForViewport,
  sliceMergedStateDataForViewport,
} from "./stateTransitionData";
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
  #throttledBuildAndUpdateDatasets = _.throttle(
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

  // Cache for processed data to avoid reprocessing unchanged data. Cleared when Show Points
  // toggles because the fingerprint does not encode the render representation.
  #processedDataCache = new Map<string, { data: Datum[]; fingerprint: string }>();

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

    const prevConfig = this.#config;
    this.#config = config;

    // Detect showPoints change - need to invalidate processed data cache
    const showPointsChanged = this.#showPoints !== (config.showPoints === true);
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
      this.#series.some((s, i) => {
        const nextSeries = newSeries[i];
        return (
          s.path.value !== nextSeries?.path.value ||
          s.path.timestampMethod !== nextSeries.path.timestampMethod
        );
      });

    if (seriesChanged) {
      this.#blockCursors.clear();
      this.#fullData.clear();
      this.#currentData.clear();
      this.#processedDataCache.clear();
      this.#seriesIsArray.clear();
      this.#firstBlockRefs.clear();
      this.#lastBlockRefs.clear();
      this.#latestBlocks = undefined; // Force reprocessing of blocks
    } else if (showPointsChanged) {
      // Canonical stores always retain raw samples, so toggling Show Points only changes the
      // render representation: drop the processed cache and rebuild from the same data. No block
      // reprocessing and no player re-emit is required, and live-only history is lossless.
      this.#processedDataCache.clear();
    }

    this.#series = newSeries;

    // Update config bounds
    const xMin = config.xAxisMinValue ?? 0;
    const xMax = config.xAxisMaxValue;

    this.#configBounds = {
      x: { min: xMin, max: xMax },
      y: {},
    };

    // Datasets are viewport-sliced, so any config change that moves the slice window (axis
    // bounds, follow range) or changes the render representation (Show Points) must rebuild
    // them from canonical data. A render dispatch alone would keep the old narrow slice on
    // screen until the next player emit — invisible on live sources, stale on paused ones.
    const axisBoundsChanged =
      prevConfig != undefined &&
      (prevConfig.xAxisMinValue !== config.xAxisMinValue ||
        prevConfig.xAxisMaxValue !== config.xAxisMaxValue ||
        prevConfig.xAxisRange !== config.xAxisRange);
    if (!seriesChanged && (showPointsChanged || axisBoundsChanged)) {
      this.#buildAndUpdateDatasets();
    }

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
      let existingData = this.#fullData.get(cursorKey) ?? [];
      const appendedFrom = existingData.length;

      for (let blockIdx = cursor; blockIdx < blocks.length; blockIdx++) {
        const messagesForTopic = blocks[blockIdx]?.messagesByTopic[topicName];
        if (messagesForTopic == undefined) {
          // Gap: stop here instead of skipping ahead. Advancing the cursor past an unloaded block
          // would permanently drop its history once it loads *behind* the cursor, leaving a silent
          // hole in the plot. Matches Plot's BlockTopicCursor semantics.
          break;
        }

        for (const msgEvent of messagesForTopic) {
          const datum = this.#messageEventToDatum(msgEvent, series, startTime);
          if (datum) {
            // Canonical stores retain every raw sample. Plateau collapsing happens only in the
            // render transform, so Show Points and troubleshooting always see the original data.
            existingData.push(datum);
          }
        }

        // Update last block reference after processing each block
        this.#lastBlockRefs.set(cursorKey, messagesForTopic);
        cursor = blockIdx + 1;
      }

      if (series.path.timestampMethod === "headerStamp" && existingData.length > appendedFrom) {
        // Blocks are receive-time ordered, but header stamps can move backwards. Normalize before
        // any binary viewport slicing; otherwise valid transitions can be omitted from the window.
        // Only this pass's appended samples are sorted, then merged with the already-sorted
        // prefix: the block loader emits progress once per loaded block, so re-sorting the whole
        // accumulated history here made loading quadratic in total samples. Passes that append
        // nothing (every non-block player emit) skip sorting entirely.
        const appended = existingData.slice(appendedFrom).sort((a, b) => a.x - b.x);
        const prefixMaxX = appendedFrom > 0 ? existingData[appendedFrom - 1]!.x : -Infinity;
        if (appended[0]!.x >= prefixMaxX) {
          // Common case: the new stamps do not interleave with the prefix; write the sorted
          // tail back in place.
          for (let i = 0; i < appended.length; i++) {
            existingData[appendedFrom + i] = appended[i]!;
          }
        } else {
          existingData.length = appendedFrom;
          existingData = mergeSortedByX(existingData, appended);
        }
      }

      this.#blockCursors.set(cursorKey, cursor);
      this.#fullData.set(cursorKey, existingData);
      // Record blocks[0] every pass, not only on reset. Leaving it unset made the *second* pass
      // always see "first block changed" and wipe + reprocess the whole series once.
      this.#firstBlockRefs.set(cursorKey, blocks[0]?.messagesByTopic[topicName]);

      // After updating fullData, trim currentData to remove duplicates
      this.#trimCurrentData(cursorKey, series.path.timestampMethod);
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
   *
   * Receive-time series are receive-ordered, so everything at or below fullData's last x is
   * covered by blocks and can be range-trimmed. Header stamps are not monotonic in receive
   * order: blocks containing stamps [0, 100, 50] do not cover a live sample stamped 75, so for
   * header-stamped series only exact-stamp duplicates may be removed.
   */
  #trimCurrentData(cursorKey: string, timestampMethod: string | undefined): void {
    const fullData = this.#fullData.get(cursorKey);
    const currentData = this.#currentData.get(cursorKey);

    if (!fullData || fullData.length === 0 || !currentData || currentData.length === 0) {
      return;
    }

    if (timestampMethod === "headerStamp") {
      const kept = currentData.filter((datum) => !this.#sortedDataContainsX(fullData, datum.x));
      if (kept.length !== currentData.length) {
        this.#currentData.set(cursorKey, kept);
      }
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

  /** Whether sorted data contains a datum at exactly x (binary search). */
  #sortedDataContainsX(data: Datum[], x: number): boolean {
    const pos = this.#findInsertPosition(data, x);
    return data[pos]?.x === x;
  }

  /**
   * Process streaming messages into currentData.
   * Streaming data is kept separate from block data and merged at render time.
   */
  #processMessages(startTime: Time, messages: Immutable<MessageEvent[]>): void {
    for (const series of this.#series) {
      const topicName = series.parsed.topicName;
      const cursorKey = `${series.configIndex}:${topicName}`;
      const isHeaderStamp = series.path.timestampMethod === "headerStamp";

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

        // Skip if this datum is already covered by fullData. Header stamps are not monotonic in
        // receive order, so block coverage of stamp 100 does not imply coverage of a live sample
        // stamped 75 — dedupe those by exact stamp membership instead of range (see
        // #trimCurrentData).
        if (isHeaderStamp) {
          if (fullData != undefined && this.#sortedDataContainsX(fullData, datum.x)) {
            continue;
          }
        } else if (datum.x <= lastFullX) {
          continue;
        }

        const currentData = this.#currentData.get(cursorKey) ?? [];

        // Streaming path is usually already sorted by time; append raw samples to the end
        // (common case). Fall back to ordered insert otherwise.
        const last = currentData[currentData.length - 1];
        if (last == undefined || datum.x > last.x) {
          currentData.push(datum);
          this.#currentData.set(cursorKey, currentData);
          continue;
        }

        // Check for duplicates in currentData using binary search position
        const insertPos = this.#findInsertPosition(currentData, datum.x);

        // Avoid exact duplicates (same x value)
        if (insertPos < currentData.length && currentData[insertPos]?.x === datum.x) {
          continue;
        }
        if (insertPos > 0 && currentData[insertPos - 1]?.x === datum.x) {
          continue;
        }

        // Insert in sorted order (rare out-of-order stream).
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

    // Resolve x bounds first so we can window-process only the visible range.
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

    // Prefer interaction / global bounds when set (zoom/pan/sync).
    const viewMin =
      this.#interactionBounds?.x.min ?? this.#globalBounds?.min ?? this.#configBounds.x.min ?? 0;
    const viewMax =
      this.#interactionBounds?.x.max ??
      this.#globalBounds?.max ??
      this.#configBounds.x.max ??
      viewMin + 1;
    // Pad the window by the renderer's shared pan buffer (VIEWPORT_PAN_BUFFER_FRACTION) so
    // pan/edge segments stay connected without processing the full bag: #dispatchRender applies
    // an interaction to the already-loaded dataset before the throttled rebuild lands, so a
    // smaller upstream slice would expose blank regions during fast pans.
    const viewPad = Math.max(0, (viewMax - viewMin) * VIEWPORT_PAN_BUFFER_FRACTION);
    const sliceMin = viewMin - viewPad;
    const sliceMax = viewMax + viewPad;

    for (const series of this.#series) {
      const y = this.#getYForSeries(series.configIndex);
      minY = Math.min(minY ?? y, y - 5);

      const cursorKey = `${series.configIndex}:${series.parsed.topicName}`;

      // Window to the viewport *while* merging fullData and currentData. Materializing the merge
      // first copied the whole preloaded history on every rebuild. Header-stamped series need the
      // interleave-safe variant: their live samples' stamps can fall between block stamps, which
      // the concatenation-based slice would drop.
      const sliceForViewport =
        series.path.timestampMethod === "headerStamp"
          ? sliceInterleavedStateDataForViewport
          : sliceMergedStateDataForViewport;
      const data = sliceForViewport(
        this.#fullData.get(cursorKey) ?? [],
        this.#currentData.get(cursorKey) ?? [],
        sliceMin,
        sliceMax,
      );

      // Process data to create state transition segments (with caching)
      const processedData = this.#processDataForStateTransitions(
        data,
        y,
        cursorKey,
        sliceMin,
        sliceMax,
      );

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
  #processDataForStateTransitions(
    data: Datum[],
    y: number,
    cacheKey: string,
    viewMin: number,
    viewMax: number,
  ): Datum[] {
    if (data.length === 0) {
      return [];
    }

    // Include head/tail so plateau endpoint mutation (same length) still busts the cache.
    const fingerprint = processCacheFingerprint(data, y, viewMin, viewMax);
    const cached = this.#processedDataCache.get(cacheKey);
    if (cached?.fingerprint === fingerprint) {
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
    this.#processedDataCache.set(cacheKey, { data: result, fingerprint });

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
   * Rebuild datasets so viewport-windowed series match the new bounds.
   */
  public setGlobalBounds(bounds: Immutable<Bounds1D> | undefined): void {
    if (this.isDestroyed()) {
      return;
    }
    this.#globalBounds = bounds;
    this.#interactionBounds = undefined;
    // Slice bounds changed — rebuild from fullData/currentData, then render.
    this.#buildAndUpdateDatasets();
    this.#queueDispatchRender();
  }

  /**
   * Reset the view to the default bounds.
   * Rebuild datasets so viewport-windowed series match the reset window.
   */
  public resetBounds(): void {
    if (this.isDestroyed()) {
      return;
    }
    this.#interactionBounds = undefined;
    this.#globalBounds = undefined;
    this.#updateAction.yBounds = this.#configBounds.y;
    this.#buildAndUpdateDatasets();
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
   * Get hover elements at pixel position.
   */
  public async getElementsAtPixel(pixel: { x: number; y: number }): Promise<HoverElement[]> {
    if (this.isDestroyed()) {
      return [];
    }
    return await this.#renderer.getElementsAtPixel(pixel);
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

    if (haveInteractionEvents) {
      // Pan/zoom changed the visible window — rebuild sliced series from fullData
      // (previously only re-dispatched stale pending datasets).
      this.#buildAndUpdateDatasets();
      return;
    }

    // After non-interaction render update, dispatch any pending datasets.
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
