// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";

import {
  isAnnotationRecordName,
  localPropagationUrl,
  resolveAnnotationBackend,
} from "@foxglove/studio-base/util/coscene/annotation";

import { annotationBackend } from "../annotationBackend";
import { segmentationSession } from "../runtime";
import { mainSegmentationCanvas, segmentationChrome } from "../segmentationChrome";
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
  const recordName = useStore(annotationBackend, (state) => state.recordName);
  // Subscribed so the badge follows a switch.
  useStore(annotationBackend, (state) => state.mode);
  const sessionService = useStore(segmentationSession, (state) =>
    state.open ? state.runtime?.service : undefined,
  );
  // An open session shows what actually backs it; otherwise what the next session would use.
  const live =
    sessionService != undefined
      ? (sessionService as { backend?: string }).backend === "live"
      : resolveAnnotationBackend(recordName).kind === "live";
  // Switching applies to the next session; an open one keeps its backend until 结束标注.
  const canChoose = !open && isAnnotationRecordName(recordName);
  const first = mainSegmentationCanvas(canvases);

  if (!open && first == undefined) {
    return undefined;
  }

  return (
    <div className={cx("seg-app-bar", classes.root)} data-testid="segmentation-app-bar">
      {live ? (
        <span
          className="seg-muted"
          data-testid="segmentation-backend"
          data-backend="live"
          data-propagation={localPropagationUrl() != undefined ? "local" : "live"}
          title={`标注读写正式标注服务（AnnotationService）。保存覆盖服务器上这些帧的当前状态，没有历史版本。${
            localPropagationUrl() != undefined
              ? `传播改由本机 SAM2 服务 ${localPropagationUrl()} 计算，结果只是草稿。`
              : ""
          }`}
        >
          {localPropagationUrl() != undefined ? "正式服务 · 本机传播" : "正式服务"}
        </span>
      ) : (
        <span
          className="seg-muted"
          data-testid="segmentation-backend"
          data-backend="local"
          title="标注只保存在这台浏览器里，不会发给服务器。"
        >
          本机标注
        </span>
      )}
      {canChoose && (
        <button
          type="button"
          title={
            live
              ? "下次进入标注时改用本机标注（不读写服务器）"
              : "下次进入标注时改用正式标注服务"
          }
          onClick={() => {
            annotationBackend.getState().setMode(live ? "local" : "live");
          }}
        >
          {live ? "改用本机" : "改用正式服务"}
        </button>
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
