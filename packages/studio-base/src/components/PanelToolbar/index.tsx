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

import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import { styled as muiStyled, Typography } from "@mui/material";
import { useContext, useMemo, CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import PanelContext from "@foxglove/studio-base/components/PanelContext";
import ToolbarIconButton from "@foxglove/studio-base/components/PanelToolbar/ToolbarIconButton";
import { useDefaultPanelTitle } from "@foxglove/studio-base/providers/PanelStateContextProvider";
import { PANEL_TITLE_CONFIG_KEY } from "@foxglove/studio-base/util/layout";

import { PanelToolbarControls } from "./PanelToolbarControls";

export const PANEL_TOOLBAR_MIN_HEIGHT = 30;

type Props = {
  additionalIcons?: React.ReactNode;
  backgroundColor?: CSSProperties["backgroundColor"];
  children?: React.ReactNode;
  isUnknownPanel?: boolean;
};

const PanelToolbarRoot = muiStyled("div", {
  shouldForwardProp: (prop) => prop !== "backgroundColor" && prop !== "enableDrag",
})<{ backgroundColor?: CSSProperties["backgroundColor"]; enableDrag: boolean }>(
  ({ theme, backgroundColor, enableDrag }) => ({
    transition: "transform 80ms ease-in-out, opacity 80ms ease-in-out",
    cursor: enableDrag ? "grab" : "auto",
    flex: "0 0 auto",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: theme.spacing(0.25, 0.75),
    display: "flex",
    minHeight: PANEL_TOOLBAR_MIN_HEIGHT,
    backgroundColor: backgroundColor ?? theme.palette.background.paper,
    width: "100%",
    left: 0,
    zIndex: theme.zIndex.appBar,
  }),
);

// Panel toolbar should be added to any panel that's part of the
// react-mosaic layout.  It adds a drag handle, remove/replace controls
// and has a place to add custom controls via it's children property
export default React.memo<Props>(function PanelToolbar({
  additionalIcons,
  backgroundColor,
  children,
  isUnknownPanel = false,
}: Props) {
  const {
    isFullscreen,
    exitFullscreen,
    config: { [PANEL_TITLE_CONFIG_KEY]: customTitle = undefined } = {},
  } = useContext(PanelContext) ?? {};
  const { t } = useTranslation("addPanel");

  const panelContext = useContext(PanelContext);
  const panelContextTitleDisplay = (item: string | undefined) => {
    switch (item) {
      case "setting":
      case "level":
      case "addPanel":
      case "impExpSetting":
      case "reset":
      case "displayFrame":
      case "followMode":
      case "renderStats":
      case "background":
      case "labelScale":
      case "ignoreTag":
      case "syncCamera":
      case "meshUpAxis":
      case "view":
      case "editable":
      case "labels":
      case "labelSize":
      case "axisScale":
      case "lineWidth":
      case "lineColor":
      case "addGrid":
      case "addFormat":
      case "type":
      case "topic":
      case "dataSourceInfo":
      case "changePanel":
      case "splitHorizontal":
      case "splitVertical":
      case "fullScreen":
      case "removePanel":
      case "diagnosticsDetail":
      case "diagnosticsSummary":
      case "general":
      case "numericPrecision":
      case "sortByLevel":
      case "gauge":
      case "data":
      case "minimum":
      case "maxiMum":
      case "colorMode":
      case "colorMap":
      case "reverse":
      case "image":
      case "cameraTopic":
      case "transformMarkers":
      case "synchronizeTimestamps":
      case "bilinearSmoothing":
      case "flipHorizontal":
      case "flipVertical":
      case "rotation":
      case "minimumValue":
      case "maximumValue":
      case "markers":
      case "indicator":
      case "indicatorPanelSettings":
      case "style":
      case "rules":
      case "comparison":
      case "comparisonWith":
      case "color":
      case "label":
      case "otherwise":
      case "legacyPlot":
      case "legacyPlotPanelSettings":
      case "log":
      case "logPanelSettings":
      case "map":
      case "mapPanelSettings":
      case "tileLayer":
      case "followTopic":
      case "topics":
      case "parameters":
      case "parametersPanelSettings":
      case "plot":
      case "plotPanelSettings":
      case "title":
      case "syncWithOtherPlots":
      case "showLabels":
      case "rangeSecond":
      case "series":
      case "path":
      case "timeStamp":
      case "publish":
      case "publishPanelSettings":
      case "editingMode":
      case "buttonTitle":
      case "buttonTooltip":
      case "buttonColor":
      case "rawMessage":
      case "rawMessagePanelSettings":
      case "stateTransition":
      case "stateTransitionPanelSettings":
      case "studioPlaybackPerformance":
      case "studioPlaybackPerformancePanelSettings":
      case "tab":
      case "tabPanelSettings":
      case "table":
      case "tablePanelSettings":
      case "teleop":
      case "teleopPanelSettings":
      case "publishRate":
      case "upButton":
      case "downButton":
      case "leftButton":
      case "rightButton":
      case "field":
      case "value":
      case "topicGraph":
      case "topicGraphPanelSettings":
      case "urdfViewer":
      case "urdfViewerPanelSettings":
      case "asset":
      case "opacity":
      case "manualControl":
      case "userScript":
      case "userScriptPanelSettings":
      case "autoSave":
      case "variableSlider":
      case "variableSliderPanelSettings":
      case "variableName":
      case "selectPanelLayout":
      case "learnMore":
      case "studioDescription":
        return t(item);
      default:
        return item;
    }
  };
  // Help-shown state must be hoisted outside the controls container so the modal can remain visible
  // when the panel is no longer hovered.
  const additionalIconsWithHelp = useMemo(() => {
    return (
      <>
        {additionalIcons}
        {isFullscreen === true && (
          <ToolbarIconButton
            value="exit-fullscreen"
            title="Exit fullscreen"
            onClick={exitFullscreen}
          >
            <FullscreenExitIcon />
          </ToolbarIconButton>
        )}
      </>
    );
  }, [additionalIcons, isFullscreen, exitFullscreen]);

  // If we have children then we limit the drag area to the controls. Otherwise the entire
  // toolbar is draggable.
  const rootDragRef =
    isUnknownPanel || children != undefined ? undefined : panelContext?.connectToolbarDragHandle;

  const controlsDragRef =
    isUnknownPanel || children == undefined ? undefined : panelContext?.connectToolbarDragHandle;

  const [defaultPanelTitle] = useDefaultPanelTitle();
  const customPanelTitle =
    customTitle != undefined && typeof customTitle === "string" && customTitle.length > 0
      ? customTitle
      : defaultPanelTitle;

  const title = customPanelTitle ?? panelContext?.title;
  return (
    <PanelToolbarRoot
      backgroundColor={backgroundColor}
      data-testid="mosaic-drag-handle"
      enableDrag={rootDragRef != undefined}
      ref={rootDragRef}
    >
      {children ??
        (title != undefined && (
          <Typography noWrap variant="body2" color="text.secondary" flex="auto">
            {panelContextTitleDisplay(panelContext?.title)}
          </Typography>
        ))}
      <PanelToolbarControls
        additionalIcons={additionalIconsWithHelp}
        isUnknownPanel={!!isUnknownPanel}
        ref={controlsDragRef}
      />
    </PanelToolbarRoot>
  );
});
