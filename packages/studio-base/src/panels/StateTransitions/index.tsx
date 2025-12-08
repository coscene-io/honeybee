// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { Button, Fade, Tooltip } from "@mui/material";
import Hammer from "hammerjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMountedState } from "react-use";
import { makeStyles } from "tss-react/mui";
import { v4 as uuidv4 } from "uuid";

import { debouncePromise } from "@foxglove/den/async";
import { filterMap } from "@foxglove/den/collection";
import { useRethrow } from "@foxglove/hooks";
import { parseMessagePath, MessagePathPart } from "@foxglove/message-path";
import { add as addTimes, fromSec } from "@foxglove/rostime";
import { Immutable } from "@foxglove/studio";
import { fillInGlobalVariablesInPath } from "@foxglove/studio-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
  useMessagePipelineSubscribe,
} from "@foxglove/studio-base/components/MessagePipeline";
import Panel from "@foxglove/studio-base/components/Panel";
import { usePanelContext } from "@foxglove/studio-base/components/PanelContext";
import PanelToolbar from "@foxglove/studio-base/components/PanelToolbar";
import Stack from "@foxglove/studio-base/components/Stack";
import TimeBasedChartTooltipContent, {
  TimeBasedChartTooltipData,
} from "@foxglove/studio-base/components/TimeBasedChart/TimeBasedChartTooltipContent";
import {
  TimelineInteractionStateStore,
  useClearHoverValue,
  useSetHoverValue,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import useGlobalVariables from "@foxglove/studio-base/hooks/useGlobalVariables";
import { PathLegend } from "@foxglove/studio-base/panels/StateTransitions/PathLegend";
import { SubscribePayload } from "@foxglove/studio-base/players/types";
import { Bounds1D } from "@foxglove/studio-base/types/Bounds";
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import { StateTransitionsCoordinator } from "./StateTransitionsCoordinator";
import { StateTransitionsRenderer } from "./StateTransitionsRenderer";
import { VerticalBars } from "./VerticalBars";
import { PathState, useStateTransitionsPanelSettings } from "./settings";
import { DEFAULT_PATH } from "./shared";
import { StateTransitionConfig } from "./types";

const useStyles = makeStyles()((theme) => ({
  chartWrapper: {
    position: "relative",
    marginTop: theme.spacing(0.5),
    width: "100%",
    overflow: "hidden",
  },
  canvasDiv: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    cursor: "crosshair",
    position: "relative",
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
    paddingBottom: theme.spacing(2),
    "& button": {
      pointerEvents: "auto",
    },
  },
  tooltip: {
    maxWidth: "none",
  },
}));

const selectGlobalBounds = (store: TimelineInteractionStateStore) => store.globalBounds;
const selectSetGlobalBounds = (store: TimelineInteractionStateStore) => store.setGlobalBounds;

type Props = {
  config: StateTransitionConfig;
  saveConfig: SaveConfig<StateTransitionConfig>;
};

function StateTransitions(props: Props) {
  const { config, saveConfig } = props;
  const { paths } = config;
  const { classes, theme } = useStyles();

  const { setMessagePathDropConfig } = usePanelContext();
  const [focusedPath, setFocusedPath] = useState<undefined | string[]>(undefined);
  const [pathState, setPathState] = useState<PathState[]>([]);

  const [subscriberId] = useState(() => uuidv4());
  const [canvasDiv, setCanvasDiv] = useState<HTMLDivElement | ReactNull>(ReactNull);
  const [renderer, setRenderer] = useState<StateTransitionsRenderer | undefined>(undefined);
  const [coordinator, setCoordinator] = useState<StateTransitionsCoordinator | undefined>(
    undefined,
  );
  const [canReset, setCanReset] = useState(false);

  // Tooltip state
  const [activeTooltip, setActiveTooltip] = useState<{
    x: number;
    y: number;
    data: TimeBasedChartTooltipData[];
  }>();
  const mouseYRef = useRef<number | undefined>(undefined);

  const isMounted = useMountedState();
  const draggingRef = useRef(false);

  const { globalVariables } = useGlobalVariables();

  // Get setSubscriptions from MessagePipeline
  const setSubscriptions = useMessagePipeline(
    useCallback(
      ({ setSubscriptions: pipelineSetSubscriptions }: MessagePipelineContext) =>
        pipelineSetSubscriptions,
      [],
    ),
  );
  const subscribeMessagePipeline = useMessagePipelineSubscribe();
  const getMessagePipelineState = useMessagePipelineGetter();

  // Crash the panel when a worker fails to load or encounters an error
  const handleWorkerError = useRethrow(
    useCallback((_err: Event) => {
      throw new Error(`Error encountered in StateTransitions worker`);
    }, []),
  );

  useEffect(() => {
    setMessagePathDropConfig({
      getDropStatus(draggedPaths) {
        if (draggedPaths.some((path) => !path.isLeaf)) {
          return { canDrop: false };
        }
        return { canDrop: true, effect: "add" };
      },
      handleDrop(draggedPaths) {
        saveConfig((prevConfig) => ({
          ...prevConfig,
          paths: [
            ...prevConfig.paths,
            ...draggedPaths.map((path) => ({
              value: path.path,
              enabled: true,
              timestampMethod: "receiveTime" as const,
            })),
          ],
        }));
      },
    });
  }, [saveConfig, setMessagePathDropConfig]);

  // Calculate chart height based on number of paths
  const { height, heightPerTopic } = useMemo(() => {
    const onlyTopicsHeight = paths.length * 64;
    const xAxisHeight = 30;
    return {
      height: Math.max(80, onlyTopicsHeight + xAxisHeight),
      heightPerTopic: onlyTopicsHeight / paths.length,
    };
  }, [paths.length]);

  // Create renderer
  useEffect(() => {
    if (!canvasDiv) {
      return;
    }

    const clientRect = canvasDiv.getBoundingClientRect();

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.position = "absolute";
    canvas.width = clientRect.width;
    canvas.height = clientRect.height;
    canvasDiv.appendChild(canvas);

    const offscreenCanvas = canvas.transferControlToOffscreen();
    const newRenderer = new StateTransitionsRenderer(offscreenCanvas, theme, { handleWorkerError });
    setRenderer(newRenderer);

    return () => {
      newRenderer.destroy();
      canvasDiv.removeChild(canvas);
    };
  }, [canvasDiv, theme, handleWorkerError]);

  // Create coordinator
  useEffect(() => {
    if (!renderer) {
      return;
    }

    const newCoordinator = new StateTransitionsCoordinator(renderer);
    setCoordinator(newCoordinator);

    newCoordinator.on("viewportChange", setCanReset);
    newCoordinator.on("pathStateChanged", (state) => {
      setPathState(state);
    });

    return () => {
      newCoordinator.off("viewportChange", setCanReset);
      newCoordinator.off("pathStateChanged", setPathState);
      newCoordinator.destroy();
    };
  }, [renderer]);

  // Handle config changes
  useEffect(() => {
    coordinator?.handleConfig(config, globalVariables);
  }, [coordinator, config, globalVariables]);

  // Subscribe to player state updates
  useEffect(() => {
    if (!coordinator) {
      return;
    }

    const unsub = subscribeMessagePipeline((state) => {
      coordinator.handlePlayerState(state.playerState);
    });

    // Feed the latest state into the coordinator
    coordinator.handlePlayerState(getMessagePipelineState().playerState);

    return unsub;
  }, [coordinator, getMessagePipelineState, subscribeMessagePipeline]);

  // Set up message subscriptions
  useEffect(() => {
    const subscriptions = filterMap(paths, (path): SubscribePayload | undefined => {
      const parsed = parseMessagePath(path.value);
      if (!parsed) {
        return;
      }

      // Fill in global variables before subscribing
      const filledInPath = fillInGlobalVariablesInPath(parsed, globalVariables);

      // Get the first field name from the message path for field-level subscription
      type NamePart = MessagePathPart & { type: "name" };
      const firstField = filledInPath.messagePath.find(
        (element): element is NamePart => element.type === "name",
      );

      const fields: string[] = firstField ? [firstField.name] : [];

      // Include the header in case we are ordering by header stamp.
      if (path.timestampMethod === "headerStamp") {
        fields.push("header");
      }

      return {
        topic: filledInPath.topicName,
        preloadType: "full",
        fields: fields.length > 0 ? fields : undefined,
      };
    });

    setSubscriptions(subscriberId, subscriptions);
  }, [paths, setSubscriptions, subscriberId, globalVariables]);

  // Unsubscribe on unmount
  useEffect(() => {
    return () => {
      setSubscriptions(subscriberId, []);
    };
  }, [subscriberId, setSubscriptions]);

  // Handle size changes
  useEffect(() => {
    if (!canvasDiv || !coordinator) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) {
        coordinator.setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    resizeObserver.observe(canvasDiv);

    // Initial size
    const clientRect = canvasDiv.getBoundingClientRect();
    coordinator.setSize({
      width: clientRect.width,
      height: clientRect.height,
    });

    return () => {
      resizeObserver.disconnect();
    };
  }, [canvasDiv, coordinator]);

  // Global bounds synchronization
  const globalBounds = useTimelineInteractionState(selectGlobalBounds);
  const setGlobalBounds = useTimelineInteractionState(selectSetGlobalBounds);

  useEffect(() => {
    if (!config.isSynced || globalBounds?.sourceId === subscriberId) {
      return;
    }
    coordinator?.setGlobalBounds(globalBounds);
  }, [coordinator, globalBounds, config.isSynced, subscriberId]);

  useEffect(() => {
    if (!coordinator || !config.isSynced) {
      return;
    }

    const handler = (bounds: Immutable<Bounds1D>) => {
      setGlobalBounds({
        min: bounds.min,
        max: bounds.max,
        sourceId: subscriberId,
        userInteraction: true,
      });
    };
    coordinator.on("timeseriesBounds", handler);
    return () => {
      coordinator.off("timeseriesBounds", handler);
    };
  }, [coordinator, setGlobalBounds, config.isSynced, subscriberId]);

  // Wheel event
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

  // Pan events
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

      setTimeout(() => {
        draggingRef.current = false;
      }, 0);
    });

    return () => {
      hammerManager.destroy();
    };
  }, [canvasDiv, coordinator]);

  // Click to seek
  const messagePipeline = useMessagePipelineGetter();
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLElement>): void => {
      if (draggingRef.current || !coordinator) {
        return;
      }

      const {
        seekPlayback,
        playerState: { activeData: { startTime: start } = {} },
      } = messagePipeline();

      if (!seekPlayback || !start) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;

      const seekSeconds = coordinator.getXValueAtPixel(mouseX);
      if (seekSeconds >= 0) {
        seekPlayback(addTimes(start, fromSec(seekSeconds)));
      }
    },
    [coordinator, messagePipeline],
  );

  // Reset view
  const onResetView = useCallback(() => {
    if (!coordinator) {
      return;
    }

    coordinator.resetBounds();

    if (config.isSynced) {
      setGlobalBounds(undefined);
    }
  }, [coordinator, setGlobalBounds, config.isSynced]);

  // Hover value
  const setHoverValue = useSetHoverValue();
  const clearHoverValue = useClearHoverValue();

  const updateTooltip = useCallback(
    async (canvasX: number, canvasY: number, boundingRect: DOMRect) => {
      if (!coordinator || !isMounted()) {
        setActiveTooltip(undefined);
        return;
      }

      // Update hover value for vertical bar
      const seconds = coordinator.getXValueAtPixel(canvasX);
      if (seconds >= 0) {
        setHoverValue({
          componentId: subscriberId,
          value: seconds,
          type: "PLAYBACK_SECONDS",
        });
      }

      // Get elements at pixel for tooltip
      const elements = await coordinator.getElementsAtPixel({ x: canvasX, y: canvasY });

      if (elements.length === 0 || mouseYRef.current == undefined) {
        setActiveTooltip(undefined);
        return;
      }

      const tooltipItems: TimeBasedChartTooltipData[] = [];

      for (const element of elements) {
        const { data: datum, configIndex } = element;
        const { value, constantName, states } = datum;
        if (value == undefined && states == undefined) {
          continue;
        }

        tooltipItems.push({
          configIndex,
          value: value ?? (states ?? []).join(", "),
          constantName,
        });
      }

      if (tooltipItems.length === 0) {
        setActiveTooltip(undefined);
        return;
      }

      setActiveTooltip({
        x: boundingRect.left + canvasX,
        y: boundingRect.top + mouseYRef.current,
        data: tooltipItems,
      });
    },
    [coordinator, isMounted, setHoverValue, subscriberId],
  );

  const debouncedUpdateTooltip = useMemo(() => debouncePromise(updateTooltip), [updateTooltip]);

  const onMouseMove = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const boundingRect = event.currentTarget.getBoundingClientRect();
      const canvasX = event.clientX - boundingRect.left;
      const canvasY = event.clientY - boundingRect.top;
      mouseYRef.current = canvasY;
      debouncedUpdateTooltip(canvasX, canvasY, boundingRect);
    },
    [debouncedUpdateTooltip],
  );

  const onMouseOut = useCallback(() => {
    clearHoverValue(subscriberId);
    setActiveTooltip(undefined);
    mouseYRef.current = undefined;
  }, [clearHoverValue, subscriberId]);

  useStateTransitionsPanelSettings(config, saveConfig, pathState, focusedPath);

  useEffect(() => {
    if (config.paths.length === 0) {
      saveConfig((prevConfig) => {
        if (prevConfig.paths.length > 0) {
          return prevConfig;
        }
        return {
          ...prevConfig,
          paths: [{ ...DEFAULT_PATH }],
        };
      });
    }
  }, [config.paths.length, saveConfig]);

  // Labels for tooltip (path label or value for each config index)
  const labelsByConfigIndex = useMemo(() => {
    const labels: Record<string, string | undefined> = {};
    paths.forEach((path, index) => {
      labels[index] = path.label ?? path.value;
    });
    return labels;
  }, [paths]);

  // Tooltip content
  const tooltipContent = useMemo(() => {
    if (!activeTooltip) {
      return undefined;
    }
    return (
      <TimeBasedChartTooltipContent
        content={activeTooltip.data}
        multiDataset={paths.length > 1}
        labelsByConfigIndex={labelsByConfigIndex}
      />
    );
  }, [activeTooltip, paths.length, labelsByConfigIndex]);

  return (
    <Stack flexGrow={1} overflow="hidden" style={{ zIndex: 0 }}>
      <PanelToolbar />
      <Stack fullWidth fullHeight flex="auto" overflowX="hidden" overflowY="auto">
        <Tooltip
          arrow={false}
          classes={{ tooltip: classes.tooltip }}
          open={activeTooltip != undefined}
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
          <div className={classes.chartWrapper} style={{ minHeight: height }}>
            <div
              className={classes.canvasDiv}
              ref={setCanvasDiv}
              onWheel={onWheel}
              onMouseMove={onMouseMove}
              onMouseOut={onMouseOut}
              onClick={onClick}
              onDoubleClick={onResetView}
            />
            <VerticalBars coordinator={coordinator} hoverComponentId={subscriberId} />
            {canReset && (
              <div className={classes.resetZoomButton}>
                <Button
                  variant="contained"
                  color="inherit"
                  title="(shortcut: double-click)"
                  onClick={onResetView}
                >
                  Reset view
                </Button>
              </div>
            )}
            <PathLegend
              paths={paths}
              heightPerTopic={heightPerTopic}
              setFocusedPath={setFocusedPath}
              saveConfig={saveConfig}
            />
          </div>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

const defaultConfig: StateTransitionConfig = {
  paths: [],
  isSynced: true,
};
export default Panel(
  Object.assign(StateTransitions, {
    panelType: "StateTransitions",
    defaultConfig,
  }),
);
