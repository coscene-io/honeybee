// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import { Popover, Tooltip } from "@mui/material";
import { useMemo, useState } from "react";
import { useStore } from "zustand";

import ToolbarIconButton from "@foxglove/studio-base/components/PanelToolbar/ToolbarIconButton";

import {
  segmentationSession,
  type SegmentationRuntime,
  type SegmentationSurface,
} from "../runtime";
import { PropagationForm } from "./PropagationForm";
import { buildCanvasPropagationScope } from "./propagationSeeds";

/**
 * Propagation for one image panel. The service takes every instance of one canvas in a single
 * request and cannot cross canvases, so the form is scoped to this canvas's current frame.
 */
export function SegmentationPropagateButton({
  panelId,
}: {
  panelId: string;
}): React.JSX.Element | undefined {
  const session = useStore(segmentationSession);
  const surface = session.surfaces[panelId];
  return session.open && session.runtime && surface ? (
    <CanvasPropagate
      runtime={session.runtime}
      panelId={panelId}
      surface={surface}
      focused={session.panelId === panelId}
    />
  ) : undefined;
}

function CanvasPropagate({
  runtime,
  panelId,
  surface,
  focused,
}: {
  runtime: SegmentationRuntime;
  panelId: string;
  surface: SegmentationSurface;
  focused: boolean;
}): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement>();
  const state = useStore(runtime.store);
  const scope = useMemo(
    () => buildCanvasPropagationScope(state.document, surface.frameId),
    [state.document, surface.frameId],
  );
  const locked = ["running", "stopping"].includes(state.propagation.status);
  const frameReady =
    surface.sourceReady &&
    surface.frameId != undefined &&
    !state.loading &&
    state.isFrameReady(surface.frameId);
  const reason = locked
    ? "正在传播，请等待完成或停止"
    : !frameReady
      ? "当前帧加载中"
      : state.readonly
        ? "当前为只读"
        : !scope || scope.seeds.length === 0
          ? "当前帧没有可传播的实例"
          : undefined;
  const open = anchor != undefined;
  return (
    <>
      <Tooltip title={reason ?? "传播"}>
        <span>
          <ToolbarIconButton
            title={undefined}
            aria-label="传播"
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={reason != undefined && !(locked && open)}
            onClick={(event) => {
              const target = event.currentTarget;
              if (!focused && surface.frameId != undefined) {
                segmentationSession.setState({ panelId });
                state.setCurrentFrame(surface.frameId);
              }
              setAnchor(target);
            }}
          >
            <PlayCircleOutlineIcon />
          </ToolbarIconButton>
        </span>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => {
          setAnchor(undefined);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: 300, maxWidth: "calc(100vw - 24px)", p: 1 } } }}
      >
        <div role="dialog" aria-label="传播">
          <PropagationForm store={runtime.store} scope={scope} sourceReady={surface.sourceReady} />
        </div>
      </Popover>
    </>
  );
}
