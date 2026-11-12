// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useMemo } from "react";
import { useStore } from "zustand";

import { add, fromSec, toNanoSec } from "@foxglove/rostime";
import { useMessagePipelineGetter } from "@foxglove/studio-base/components/MessagePipeline";
import { PANEL_TOOLBAR_MIN_HEIGHT } from "@foxglove/studio-base/components/PanelToolbar";

import { SemanticSegmentationWorkbench } from "../SemanticSegmentationWorkbench";
import { createNativeFramePresentation } from "../nativeFramePresentation";
import {
  segmentationSession,
  type DecodedSegmentationFrame,
  type SegmentationRuntime,
} from "../runtime";

function ActiveWorkbench({
  runtime,
  imageUrl,
  sourceReady,
  panelId,
  decodedFrame,
  frameId,
  focused,
  onClaimFocus,
}: {
  runtime: SegmentationRuntime;
  imageUrl?: string;
  sourceReady: boolean;
  panelId: string;
  decodedFrame?: DecodedSegmentationFrame;
  frameId?: string;
  focused: boolean;
  onClaimFocus: () => void;
}): React.JSX.Element {
  const loading = useStore(runtime.store, (state) => state.loading);
  const getPipeline = useMessagePipelineGetter();
  const onFrameChange = useCallback(
    (timestampSec: number) => {
      const pipeline = getPipeline();
      const start = pipeline.playerState.activeData?.startTime;
      if (start) {
        segmentationSession.setState({ sourceReady: false });
        pipeline.pausePlayback?.();
        pipeline.seekPlayback?.(add(start, fromSec(timestampSec)));
      }
    },
    [getPipeline],
  );
  const presentation = useMemo(
    () =>
      createNativeFramePresentation(runtime, panelId, {
        seek: (timestampSec) => {
          const pipeline = getPipeline();
          const start = pipeline.playerState.activeData?.startTime;
          if (!start || !pipeline.seekPlayback) {
            throw new Error("Native player is unavailable; reopen the Image Panel.");
          }
          pipeline.pausePlayback?.();
          pipeline.seekPlayback(add(start, fromSec(timestampSec)));
        },
        seekTime: () => getPipeline().playerState.activeData?.lastSeekTime,
        atTime: (timestampSec) => {
          const data = getPipeline().playerState.activeData;
          return (
            data != undefined &&
            toNanoSec(data.currentTime) === toNanoSec(add(data.startTime, fromSec(timestampSec)))
          );
        },
      }),
    [runtime, panelId, getPipeline],
  );
  useEffect(
    () => () => {
      presentation.dispose();
    },
    [presentation],
  );
  return (
    <div style={{ position: "absolute", inset: `${PANEL_TOOLBAR_MIN_HEIGHT}px 0 0`, zIndex: 5 }}>
      <SemanticSegmentationWorkbench
        runtime={runtime}
        imageUrl={sourceReady ? imageUrl : undefined}
        embedded
        sourceReady={sourceReady && !loading}
        showTree={false}
        onFrameChange={onFrameChange}
        onPresentFrame={presentation.present}
        decodedFrame={sourceReady ? decodedFrame : undefined}
        onFrameRendered={presentation.rendered}
        onFrameRenderError={presentation.failed}
        frameId={frameId}
        focused={focused}
        onClaimFocus={onClaimFocus}
        onClose={() => {
          segmentationSession.setState({ open: false, imageUrl: undefined, sourceReady: false });
        }}
      />
    </div>
  );
}

/** Lives inside the existing Image Panel, so the panel's own maximize and real timeline stay authoritative. */
export function SegmentationWorkspace({
  panelId,
}: {
  panelId: string;
}): React.JSX.Element | undefined {
  const session = useStore(segmentationSession);
  const surface = session.surfaces[panelId];
  const focused = session.panelId === panelId;
  const legacy = surface == undefined && focused;
  const shownUrl = surface ? surface.imageUrl : legacy ? session.imageUrl : undefined;
  if (
    !session.open ||
    !focused ||
    !session.runtime ||
    shownUrl == undefined ||
    (surface == undefined && !legacy)
  ) {
    return undefined;
  }
  return (
    <ActiveWorkbench
      runtime={session.runtime}
      imageUrl={surface ? surface.imageUrl : session.imageUrl}
      sourceReady={surface ? surface.sourceReady : session.sourceReady}
      panelId={panelId}
      decodedFrame={surface ? surface.decodedFrame : session.decodedFrame}
      frameId={surface?.frameId}
      focused={focused}
      onClaimFocus={() => {}}
    />
  );
}
