// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ErrorIcon from "@mui/icons-material/Error";
import { Button, Tooltip, Fade, buttonClasses, useTheme } from "@mui/material";
import Hammer from "hammerjs";
import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMountedState } from "react-use";
import { makeStyles } from "tss-react/mui";
import { v4 as uuidv4 } from "uuid";

import { debouncePromise } from "@foxglove/den/async";
import { filterMap } from "@foxglove/den/collection";
import { useRethrow } from "@foxglove/hooks";
import { parseMessagePath } from "@foxglove/message-path";
import { add as addTimes, fromSec, isTime, toSec } from "@foxglove/rostime";
import { Immutable } from "@foxglove/studio";
import { useDataSourceInfo } from "@foxglove/studio-base/PanelAPI";
import KeyListener from "@foxglove/studio-base/components/KeyListener";
import { fillInGlobalVariablesInPath } from "@foxglove/studio-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
  useMessagePipelineSubscribe,
} from "@foxglove/studio-base/components/MessagePipeline";
import { usePanelContext } from "@foxglove/studio-base/components/PanelContext";
import {
  PanelContextMenu,
  PanelContextMenuItem,
} from "@foxglove/studio-base/components/PanelContextMenu";
import PanelToolbar, {
  PANEL_TOOLBAR_MIN_HEIGHT,
} from "@foxglove/studio-base/components/PanelToolbar";
import ToolbarIconButton from "@foxglove/studio-base/components/PanelToolbar/ToolbarIconButton";
import Stack from "@foxglove/studio-base/components/Stack";
import TimeBasedChartTooltipContent, {
  TimeBasedChartTooltipData,
} from "@foxglove/studio-base/components/TimeBasedChart/TimeBasedChartTooltipContent";
import { Bounds1D } from "@foxglove/studio-base/components/TimeBasedChart/types";
import { useSelectedPanels } from "@foxglove/studio-base/context/CurrentLayoutContext";
import {
  TimelineInteractionStateStore,
  useClearHoverValue,
  useSetHoverValue,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import useGlobalVariables from "@foxglove/studio-base/hooks/useGlobalVariables";
import { VerticalBars } from "@foxglove/studio-base/panels/Plot/VerticalBars";
import { SubscribePayload } from "@foxglove/studio-base/players/types";
import { SaveConfig } from "@foxglove/studio-base/types/panels";
import { PANEL_TITLE_CONFIG_KEY } from "@foxglove/studio-base/util/layout";
import { getLineColor } from "@foxglove/studio-base/util/plotColors";

import { OffscreenCanvasRenderer } from "./OffscreenCanvasRenderer";
import { PlotCoordinator } from "./PlotCoordinator";
import { PlotLegend } from "./PlotLegend";
import { CurrentCustomDatasetsBuilder } from "./builders/CurrentCustomDatasetsBuilder";
import { CustomDatasetsBuilder } from "./builders/CustomDatasetsBuilder";
import { IndexDatasetsBuilder } from "./builders/IndexDatasetsBuilder";
import { TimestampDatasetsBuilder } from "./builders/TimestampDatasetsBuilder";
import { isReferenceLinePlotPathType, PlotConfig } from "./config";
import { downloadCSV } from "./csv";
import { usePlotPanelSettings } from "./settings";
import { pathToSubscribePayload } from "./subscription";

export const defaultSidebarDimension = 240;
const MAX_CURRENT_DATUMS_PER_SERIES = 50_000;

const useStyles = makeStyles()((theme) => ({
  tooltip: {
    maxWidth: "none",
  },
  resetZoomButton: {
    pointerEvents: "none",
    position: "absolute",
    display: "flex",
    justifyContent: "flex-end",
    paddingInline: theme.spacing(1),
    right: 0,
    left: 0,
    bottom: 0,
    width: "100%",
    paddingBottom: theme.spacing(4),

    [`.${buttonClasses.root}`]: {
      pointerEvents: "auto",
    },
  },
  canvasDiv: { width: "100%", height: "100%", overflow: "hidden", cursor: "crosshair" },
  verticalBarWrapper: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    position: "relative",
  },
}));

type Props = {
  config: PlotConfig;
  saveConfig: SaveConfig<PlotConfig>;
};

type ElementAtPixelArgs = {
  clientX: number;
  clientY: number;
  canvasX: number;
  canvasY: number;
};

const selectGlobalBounds = (store: TimelineInteractionStateStore) => store.globalBounds;
const selectSetGlobalBounds = (store: TimelineInteractionStateStore) => store.setGlobalBounds;

export function Plot(props: Props): React.JSX.Element {
  const { saveConfig, config } = props;
  const {
    paths: series,
    showLegend,
    xAxisVal: xAxisMode,
    xAxisPath,
    legendDisplay = config.showSidebar === true ? "left" : "floating",
    sidebarDimension = config.sidebarWidth ?? defaultSidebarDimension,
    [PANEL_TITLE_CONFIG_KEY]: customTitle,
  } = config;

  const { openPanelSettings } = useWorkspaceActions();
  const { id: panelId } = usePanelContext();
  const { setSelectedPanelIds } = useSelectedPanels();
  const { topics } = useDataSourceInfo();

  const { classes } = useStyles();
  const theme = useTheme();
  const { t } = useTranslation("plot");

  const { setMessagePathDropConfig } = usePanelContext();
  const draggingRef = useRef(false);

  const [hasTooManyMessages, setHasTooManyMessages] = useState(false);

  useEffect(() => {
    setMessagePathDropConfig({
      getDropStatus(paths) {
        if (paths.some((path) => !path.isLeaf)) {
          return { canDrop: false };
        }
        return { canDrop: true, effect: "add" };
      },
      handleDrop(paths) {
        saveConfig((prevConfig) => ({
          ...prevConfig,
          paths: [
            ...prevConfig.paths,
            ...paths.map((path) => ({
              value: path.path,
              enabled: true,
              timestampMethod: "receiveTime" as const,
            })),
          ],
        }));
      },
    });
  }, [saveConfig, setMessagePathDropConfig]);

  const isMounted = useMountedState();
  const [focusedPath, setFocusedPath] = useState<undefined | string[]>(undefined);
  const [subscriberId] = useState(() => uuidv4());
  const [canvasDiv, setCanvasDiv] = useState<HTMLDivElement | ReactNull>(ReactNull);
  const [renderer, setRenderer] = useState<OffscreenCanvasRenderer | undefined>(undefined);
  const [coordinator, setCoordinator] = useState<PlotCoordinator | undefined>(undefined);

  // When true the user can reset the plot back to the original view
  const [canReset, setCanReset] = useState(false);

  const [activeTooltip, setActiveTooltip] = useState<{
    x: number;
    y: number;
    data: TimeBasedChartTooltipData[];
  }>();

  usePlotPanelSettings(config, saveConfig, focusedPath);

  const setHoverValue = useSetHoverValue();
  const clearHoverValue = useClearHoverValue();

  const onClickPath = useCallback((index: number) => {
    setFocusedPath(["paths", String(index)]);
  }, []);

  const getMessagePipelineState = useMessagePipelineGetter();
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLElement>): void => {
      // If we started a drag we should not register a seek
      if (draggingRef.current) {
        return;
      }

      // Only timestamp plots support click-to-seek
      if ((xAxisMode !== "timestamp" && xAxisMode !== "partialTimestamp") || !coordinator) {
        return;
      }

      const {
        seekPlayback,
        playerState: { activeData: { startTime: start } = {} },
      } = getMessagePipelineState();

      if (!seekPlayback || !start) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;

      const seekSeconds = coordinator.getXValueAtPixel(mouseX);
      // Avoid normalizing a negative time if the clicked point had x < 0.
      if (seekSeconds >= 0) {
        seekPlayback(addTimes(start, fromSec(seekSeconds)));
      }
    },
    [coordinator, getMessagePipelineState, xAxisMode],
  );

  const getPanelContextMenuItems = useCallback(() => {
    const items: PanelContextMenuItem[] = [
      {
        type: "item",
        label: "Download plot data as CSV",
        onclick: async () => {
          const data = await coordinator?.getCsvData();
          if (!data || !isMounted()) {
            return;
          }

          downloadCSV(customTitle ?? "plot_data", data, xAxisMode);
        },
      },
    ];
    return items;
  }, [coordinator, customTitle, isMounted, xAxisMode]);

  const setSubscriptions = useMessagePipeline(
    useCallback(
      ({ setSubscriptions: pipelineSetSubscriptions }: MessagePipelineContext) =>
        pipelineSetSubscriptions,
      [],
    ),
  );
  const subscribeMessagePipeline = useMessagePipelineSubscribe();

  const { globalVariables } = useGlobalVariables();

  useEffect(() => {
    coordinator?.handleConfig(config, theme.palette.mode, globalVariables);
  }, [coordinator, config, globalVariables, theme.palette.mode]);

  // This effect must come after the one above it so the coordinator gets the latest config before
  // the latest player state and can properly initialize if the player state already contains the
  // data for display.
  useEffect(() => {
    if (!coordinator) {
      return;
    }

    const unsub = subscribeMessagePipeline((state) => {
      coordinator.handlePlayerState(state.playerState);
    });

    // Subscribing only gets us _new_ updates, so we feed the latest state into the chart
    coordinator.handlePlayerState(getMessagePipelineState().playerState);
    return unsub;
  }, [coordinator, getMessagePipelineState, subscribeMessagePipeline]);

  // Crash the panel when a worker fails to load or encounters an error
  const handleWorkerError = useRethrow(
    useCallback((_err: Event) => {
      throw new Error(`Error encountered in plot worker`);
    }, []),
  );

  const datasetsBuilder = useMemo(() => {
    switch (xAxisMode) {
      case "timestamp":
      case "partialTimestamp":
        return new TimestampDatasetsBuilder({ handleWorkerError, xAxisMode });
      case "index":
        return new IndexDatasetsBuilder();
      case "custom":
        return new CustomDatasetsBuilder({ handleWorkerError });
      case "currentCustom":
        return new CurrentCustomDatasetsBuilder();
      default:
        throw new Error(`unsupported mode: ${xAxisMode}`);
    }
  }, [xAxisMode, handleWorkerError]);

  useEffect(() => {
    if (
      datasetsBuilder instanceof CurrentCustomDatasetsBuilder ||
      datasetsBuilder instanceof CustomDatasetsBuilder
    ) {
      if (!xAxisPath?.value) {
        datasetsBuilder.setXPath(undefined);
        return;
      }

      const parsed = parseMessagePath(xAxisPath.value);
      if (!parsed) {
        datasetsBuilder.setXPath(undefined);
        return;
      }

      datasetsBuilder.setXPath(fillInGlobalVariablesInPath(parsed, globalVariables));
    }
  }, [datasetsBuilder, globalVariables, xAxisPath]);

  useEffect(() => {
    if (!canvasDiv) {
      return;
    }

    const clientRect = canvasDiv.getBoundingClientRect();

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    // So the canvas does not affect the size of the parent
    canvas.style.position = "absolute";
    canvas.width = clientRect.width;
    canvas.height = clientRect.height;
    canvasDiv.appendChild(canvas);

    const offscreenCanvas = canvas.transferControlToOffscreen();
    const newRenderer = new OffscreenCanvasRenderer(offscreenCanvas, theme, { handleWorkerError });
    setRenderer(newRenderer);

    return () => {
      // Explicitly destroy the renderer to ensure worker cleanup
      newRenderer.destroy();
      canvasDiv.removeChild(canvas);

      // Debug logging to verify cleanup
      if (process.env.NODE_ENV === "development") {
        console.debug("[Plot] Canvas cleanup completed - renderer destroyed and canvas removed");
      }
    };
  }, [canvasDiv, theme, handleWorkerError]);

  useEffect(() => {
    if (!renderer || !canvasDiv) {
      return;
    }

    const contentRect = canvasDiv.getBoundingClientRect();

    const plotCoordinator = new PlotCoordinator(renderer, datasetsBuilder);
    setCoordinator(plotCoordinator);

    plotCoordinator.setSize({
      width: contentRect.width,
      height: contentRect.height,
    });

    const isCanvasTarget = (entry: Immutable<ResizeObserverEntry>) => entry.target === canvasDiv;
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = _.findLast(entries, isCanvasTarget);
      if (entry) {
        plotCoordinator.setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    resizeObserver.observe(canvasDiv);

    return () => {
      resizeObserver.disconnect();
      plotCoordinator.destroy();
      // Also explicitly destroy renderer if it hasn't been destroyed yet
      if (!renderer.isDestroyed()) {
        renderer.destroy();
      }

      // Debug logging to verify cleanup
      if (process.env.NODE_ENV === "development") {
        console.debug("[Plot] Cleanup completed - coordinator and renderer destroyed");
      }
    };
  }, [canvasDiv, datasetsBuilder, renderer]);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      if (!coordinator) {
        return;
      }

      const boundingRect = event.currentTarget.getBoundingClientRect();
      coordinator.addInteractionEvent({
        type: "wheel",
        cancelable: false,
        deltaY: event.deltaY,
        deltaX: event.deltaX,
        clientX: event.clientX,
        clientY: event.clientY,
        boundingClientRect: boundingRect.toJSON(),
      });
    },
    [coordinator],
  );

  const mousePresentRef = useRef(false);

  const buildTooltip = useMemo(() => {
    return debouncePromise(async (args: ElementAtPixelArgs) => {
      const elements = await renderer?.getElementsAtPixel({
        x: args.canvasX,
        y: args.canvasY,
      });

      if (!isMounted()) {
        return;
      }

      // Looking up a tooltip is an async operation so the mouse might leave the component while
      // that is happening and we need to avoid showing a tooltip.
      if (!elements || elements.length === 0 || !mousePresentRef.current) {
        setActiveTooltip(undefined);
        return;
      }

      const tooltipItems: TimeBasedChartTooltipData[] = [];

      for (const element of elements) {
        const value = element.data.value ?? element.data.y;
        const tooltipValue = typeof value === "object" && isTime(value) ? toSec(value) : value;

        tooltipItems.push({
          configIndex: element.configIndex,
          value: tooltipValue,
        });
      }

      if (tooltipItems.length === 0) {
        setActiveTooltip(undefined);
        return;
      }

      setActiveTooltip({
        x: args.clientX,
        y: args.clientY,
        data: tooltipItems,
      });
    });
  }, [renderer, isMounted]);

  // Extract the bounding client rect from currentTarget before calling the debounced function
  // because react re-uses the SyntheticEvent objects.
  const onMouseMove = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      mousePresentRef.current = true;
      const boundingRect = event.currentTarget.getBoundingClientRect();
      buildTooltip({
        clientX: event.clientX,
        clientY: event.clientY,
        canvasX: event.clientX - boundingRect.left,
        canvasY: event.clientY - boundingRect.top,
      });

      if (!coordinator) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const seconds = coordinator.getXValueAtPixel(mouseX);

      setHoverValue({
        componentId: subscriberId,
        value: seconds,
        type:
          xAxisMode === "timestamp" || xAxisMode === "partialTimestamp"
            ? "PLAYBACK_SECONDS"
            : "OTHER",
      });
    },
    [buildTooltip, coordinator, setHoverValue, subscriberId, xAxisMode],
  );

  const onMouseOut = useCallback(() => {
    mousePresentRef.current = false;
    setActiveTooltip(undefined);
    clearHoverValue(subscriberId);
  }, [clearHoverValue, subscriberId]);

  const { colorsByDatasetIndex, labelsByDatasetIndex } = useMemo(() => {
    const labels: Record<string, string> = {};
    const colors: Record<string, string> = {};

    for (let idx = 0; idx < config.paths.length; ++idx) {
      const item = config.paths[idx]!;
      labels[idx] = item.label ?? item.value;
      colors[idx] = getLineColor(item.color, idx);
    }

    return {
      colorsByDatasetIndex: colors,
      labelsByDatasetIndex: labels,
    };
  }, [config.paths]);

  const numSeries = config.paths.length;
  const tooltipContent = useMemo(() => {
    return activeTooltip ? (
      <TimeBasedChartTooltipContent
        content={activeTooltip.data}
        multiDataset={numSeries > 1}
        colorsByConfigIndex={colorsByDatasetIndex}
        labelsByConfigIndex={labelsByDatasetIndex}
      />
    ) : undefined;
  }, [activeTooltip, colorsByDatasetIndex, labelsByDatasetIndex, numSeries]);

  // panning
  useEffect(() => {
    if (!canvasDiv || !coordinator) {
      return;
    }

    const hammerManager = new Hammer.Manager(canvasDiv);
    const threshold = 10;
    hammerManager.add(new Hammer.Pan({ threshold }));

    hammerManager.on("panstart", (event) => {
      draggingRef.current = true;
      const boundingRect = event.target.getBoundingClientRect();
      coordinator.addInteractionEvent({
        type: "panstart",
        cancelable: false,
        deltaY: event.deltaY,
        deltaX: event.deltaX,
        center: {
          x: event.center.x,
          y: event.center.y,
        },
        boundingClientRect: boundingRect.toJSON(),
      });
    });

    hammerManager.on("panmove", (event) => {
      const boundingRect = event.target.getBoundingClientRect();
      coordinator.addInteractionEvent({
        type: "panmove",
        cancelable: false,
        deltaY: event.deltaY,
        deltaX: event.deltaX,
        boundingClientRect: boundingRect.toJSON(),
      });
    });

    hammerManager.on("panend", (event) => {
      const boundingRect = event.target.getBoundingClientRect();
      coordinator.addInteractionEvent({
        type: "panend",
        cancelable: false,
        deltaY: event.deltaY,
        deltaX: event.deltaX,
        boundingClientRect: boundingRect.toJSON(),
      });

      // We need to do this a little bit later so that the onClick handler still sees
      // draggingRef.current===true and can skip the seek.
      setTimeout(() => {
        draggingRef.current = false;
      }, 0);
    });

    return () => {
      hammerManager.destroy();
    };
  }, [canvasDiv, coordinator]);

  // We could subscribe in the chart renderer, but doing it with react effects is easier for
  // managing the lifecycle of the subscriptions. The renderer will correlate input message data to
  // the correct series.
  useEffect(() => {
    // The index and currentCustom modes only need the latest message on each topic so we use
    // partial subscribe mode for those to avoid preloading data that we don't need
    const preloadType =
      xAxisMode === "index" || xAxisMode === "currentCustom" || xAxisMode === "partialTimestamp"
        ? "partial"
        : "full";

    if (preloadType === "full") {
      let maxMessageCount = 0;

      for (const item of series) {
        if (isReferenceLinePlotPathType(item)) {
          return;
        }

        const parsed = parseMessagePath(item.value);
        if (!parsed) {
          return;
        }

        const variablesInPath = fillInGlobalVariablesInPath(parsed, globalVariables);

        const targetTopic = topics.find((topic) => topic.name === variablesInPath.topicName);
        if (!targetTopic) {
          return;
        }

        maxMessageCount = Math.max(maxMessageCount, targetTopic.messageCount ?? 0);
      }

      // if the number of messages in the topic is greater than the max, set the xAxis to partialTimestamp
      if (maxMessageCount > MAX_CURRENT_DATUMS_PER_SERIES) {
        // notify the user that the xAxis has been set to partialTimestamp
        setHasTooManyMessages(true);
      } else {
        setHasTooManyMessages(false);
      }
    } else {
      setHasTooManyMessages(false);
    }

    const subscriptions = filterMap(series, (item): SubscribePayload | undefined => {
      if (isReferenceLinePlotPathType(item)) {
        return;
      }

      const parsed = parseMessagePath(item.value);
      if (!parsed) {
        return;
      }

      return pathToSubscribePayload(
        fillInGlobalVariablesInPath(parsed, globalVariables),
        preloadType,
      );
    });

    if ((xAxisMode === "custom" || xAxisMode === "currentCustom") && xAxisPath) {
      const parsed = parseMessagePath(xAxisPath.value);
      if (parsed) {
        const sub = pathToSubscribePayload(
          fillInGlobalVariablesInPath(parsed, globalVariables),
          preloadType,
        );
        if (sub) {
          subscriptions.push(sub);
        }
      }
    }

    setSubscriptions(subscriberId, subscriptions);
  }, [
    series,
    setSubscriptions,
    subscriberId,
    globalVariables,
    xAxisMode,
    xAxisPath,
    topics,
    saveConfig,
  ]);

  // Only unsubscribe on unmount so that when the above subscriber effect dependencies change we
  // don't transition to unsubscribing all to then re-subscribe.
  useEffect(() => {
    return () => {
      setSubscriptions(subscriberId, []);
    };
  }, [subscriberId, setSubscriptions]);

  const globalBounds = useTimelineInteractionState(selectGlobalBounds);
  const setGlobalBounds = useTimelineInteractionState(selectSetGlobalBounds);

  const shouldSync =
    (config.xAxisVal === "timestamp" || config.xAxisVal === "partialTimestamp") && config.isSynced;

  useEffect(() => {
    if (globalBounds?.sourceId === subscriberId || !shouldSync) {
      return;
    }

    coordinator?.setGlobalBounds(globalBounds);
  }, [coordinator, globalBounds, shouldSync, subscriberId]);

  useEffect(() => {
    if (!coordinator || !shouldSync) {
      return;
    }

    const onTimeseriesBounds = (newBounds: Immutable<Bounds1D>) => {
      setGlobalBounds({
        min: newBounds.min,
        max: newBounds.max,
        sourceId: subscriberId,
        userInteraction: true,
      });
    };
    coordinator.on("timeseriesBounds", onTimeseriesBounds);
    coordinator.on("viewportChange", setCanReset);
    return () => {
      coordinator.off("timeseriesBounds", onTimeseriesBounds);
      coordinator.off("viewportChange", setCanReset);
    };
  }, [coordinator, setGlobalBounds, shouldSync, subscriberId]);

  const onResetView = useCallback(() => {
    if (!coordinator) {
      return;
    }

    coordinator.resetBounds();

    if (shouldSync) {
      setGlobalBounds(undefined);
    }
  }, [coordinator, setGlobalBounds, shouldSync]);

  const hoveredValuesBySeriesIndex = useMemo(() => {
    if (!config.showPlotValuesInLegend) {
      return;
    }

    if (!activeTooltip?.data) {
      return;
    }

    const values = new Array(config.paths.length).fill(undefined);
    for (const item of activeTooltip.data) {
      values[item.configIndex] ??= item.value;
    }

    return values;
  }, [activeTooltip, config.paths.length, config.showPlotValuesInLegend]);

  const { keyDownHandlers, keyUphandlers } = useMemo(() => {
    return {
      keyDownHandlers: {
        v: () => {
          coordinator?.setZoomMode("y");
        },
        b: () => {
          coordinator?.setZoomMode("xy");
        },
      },
      keyUphandlers: {
        v: () => {
          coordinator?.setZoomMode("x");
        },
        b: () => {
          coordinator?.setZoomMode("x");
        },
      },
    };
  }, [coordinator]);

  const additionalIcons = (
    <Tooltip
      placement="left"
      title={
        <span>
          {t("tooManyMessages")}
          <Button
            variant="text"
            color="info"
            size="small"
            onClick={() => {
              saveConfig({
                ...config,
                xAxisVal: "partialTimestamp",
              });
            }}
          >
            {t("switchImmediately")}
          </Button>
        </span>
      }
    >
      <ToolbarIconButton>
        <ErrorIcon
          fontSize="inherit"
          color="error"
          onClick={() => {
            setSelectedPanelIds([panelId]);
            openPanelSettings();
            setFocusedPath(["xAxis"]);
          }}
        />
      </ToolbarIconButton>
    </Tooltip>
  );

  return (
    <Stack
      flex="auto"
      alignItems="center"
      justifyContent="center"
      overflow="hidden"
      position="relative"
    >
      <PanelToolbar additionalIcons={hasTooManyMessages ? additionalIcons : undefined} />
      <Stack
        direction={legendDisplay === "top" ? "column" : "row"}
        flex="auto"
        fullWidth
        style={{ height: `calc(100% - ${PANEL_TOOLBAR_MIN_HEIGHT}px)` }}
        position="relative"
      >
        {/* Pass stable values here for properties when not showing values so that the legend memoization remains stable. */}
        {legendDisplay !== "none" && (
          <PlotLegend
            coordinator={coordinator}
            legendDisplay={legendDisplay}
            onClickPath={onClickPath}
            paths={series}
            saveConfig={saveConfig}
            showLegend={showLegend}
            sidebarDimension={sidebarDimension}
            showValues={config.showPlotValuesInLegend}
            hoveredValuesBySeriesIndex={hoveredValuesBySeriesIndex}
          />
        )}
        <Tooltip
          arrow={false}
          classes={{ tooltip: classes.tooltip }}
          open={tooltipContent != undefined}
          placement="right"
          title={tooltipContent ?? <></>}
          disableInteractive
          followCursor
          slots={{
            transition: Fade,
          }}
          slotProps={{
            transition: { timeout: 0 },
          }}
        >
          <div className={classes.verticalBarWrapper}>
            <div
              className={classes.canvasDiv}
              ref={setCanvasDiv}
              onWheel={onWheel}
              onMouseMove={onMouseMove}
              onMouseOut={onMouseOut}
              onClick={onClick}
              onDoubleClick={onResetView}
            />
            <VerticalBars
              coordinator={coordinator}
              hoverComponentId={subscriberId}
              xAxisIsPlaybackTime={xAxisMode === "timestamp" || xAxisMode === "partialTimestamp"}
            />
          </div>
        </Tooltip>
        {canReset && (
          <div className={classes.resetZoomButton}>
            <Button
              variant="contained"
              color="inherit"
              title="(shortcut: double-click)"
              onClick={onResetView}
            >
              {t("resetView")}
            </Button>
          </div>
        )}
        <PanelContextMenu getItems={getPanelContextMenuItems} />
      </Stack>
      <KeyListener global keyDownHandlers={keyDownHandlers} keyUpHandlers={keyUphandlers} />
    </Stack>
  );
}
