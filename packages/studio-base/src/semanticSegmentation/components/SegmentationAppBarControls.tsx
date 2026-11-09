// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useStore } from "zustand";

import { segmentationSession } from "../runtime";
import { segmentationChrome } from "../segmentationChrome";
import { SegmentationActionMenu } from "./SegmentationActionMenu";

import "./workbench.css";

function endAnnotation(): void {
  segmentationSession.setState({
    open: false,
    imageUrl: undefined,
    sourceReady: false,
  });
}

/** Record-level annotation controls. They sit in the app bar, once, beside layout save and revert. */
export function SegmentationAppBarControls(): React.JSX.Element | undefined {
  const canvases = useStore(segmentationChrome, (state) => state.canvases);
  const open = useStore(segmentationSession, (state) => state.open);
  const first = canvases[0];

  if (!open && first == undefined) {
    return undefined;
  }

  return (
    <div className="seg-app-bar" data-testid="segmentation-app-bar">
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
