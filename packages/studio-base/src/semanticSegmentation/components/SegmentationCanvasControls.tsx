// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";

import { createLiveSemanticSegmentationService } from "@foxglove/studio-base/util/coscene/annotation";

import { segmentationSession } from "../runtime";
import { SegmentationActionMenu } from "./SegmentationActionMenu";

import "./workbench.css";

const useStyles = makeStyles()((theme) => ({
  root: {
    color: theme.palette.text.primary,
    "& .seg-muted": {
      color: theme.palette.text.secondary,
    },
  },
}));

function endAnnotation(): void {
  segmentationSession.setState({
    open: false,
    imageUrl: undefined,
    sourceReady: false,
  });
}

/** Annotation actions belong to the canvas that opened the session. */
export function SegmentationCanvasControls({
  panelId,
}: {
  panelId: string;
}): React.JSX.Element | undefined {
  const { classes, cx } = useStyles();
  const open = useStore(segmentationSession, (state) => state.open);
  const activePanel = useStore(segmentationSession, (state) => state.panelId);
  const localBackend = createLiveSemanticSegmentationService() == undefined;

  if (!open || activePanel !== panelId) {
    return undefined;
  }

  return (
    <div className={cx("seg-app-bar", classes.root)} data-testid="segmentation-canvas-controls">
      {localBackend && (
        <span
          className="seg-muted"
          title="标注服务尚未发布。这一路视频的标注只保存在这台浏览器里，不会发给服务器。"
        >
          本机标注
        </span>
      )}
      <SegmentationActionMenu panelId={panelId} />
      <button type="button" onClick={endAnnotation}>
        结束标注
      </button>
    </div>
  );
}
