// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";

import { createLiveSemanticSegmentationService } from "@foxglove/studio-base/util/coscene/annotation";

import { segmentationSession } from "../runtime";
import { segmentationChrome } from "../segmentationChrome";
import { SegmentationActionMenu } from "./SegmentationActionMenu";

import "./workbench.css";

const useStyles = makeStyles()((theme) => ({
  // The app bar forces white text. Inherit that and these controls disappear on the light bar.
  root: {
    color: theme.palette.appBar.text,
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

/** Record-level annotation controls. They sit in the app bar, once, beside layout save and revert. */
export function SegmentationAppBarControls(): React.JSX.Element | undefined {
  const { classes, cx } = useStyles();
  const canvases = useStore(segmentationChrome, (state) => state.canvases);
  const open = useStore(segmentationSession, (state) => state.open);
  const localBackend = createLiveSemanticSegmentationService() == undefined;
  const first = canvases[0];

  if (!open && first == undefined) {
    return undefined;
  }

  return (
    <div className={cx("seg-app-bar", classes.root)} data-testid="segmentation-app-bar">
      {localBackend && (
        <span
          className="seg-muted"
          title="标注服务尚未发布。这一路视频的标注只保存在这台浏览器里，不会发给服务器。"
        >
          本机标注
        </span>
      )}
      {open ? (
        <>
          <SegmentationActionMenu />
          <button type="button" onClick={endAnnotation}>
            结束标注
          </button>
        </>
      ) : (
        <>
          <button type="button" title="编辑空间标注" onClick={first?.enterInline}>
            ✎ 编辑空间标注
          </button>
          {canvases.length === 1 && (
            <button
              type="button"
              title="放大并编辑空间标注"
              aria-label="放大并编辑空间标注"
              onClick={first?.enterMaximize}
            >
              ⛶
            </button>
          )}
        </>
      )}
    </div>
  );
}
