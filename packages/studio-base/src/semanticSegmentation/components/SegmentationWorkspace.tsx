// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { PANEL_TOOLBAR_MIN_HEIGHT } from "@foxglove/studio-base/components/PanelToolbar";

import { SemanticSegmentationWorkbench } from "./SemanticSegmentationWorkbench";
import type { DecodedSegmentationFrame, SegmentationRuntime } from "../runtime";
import { useSegmentationHost } from "../segmentationHostContext";

const useStyles = makeStyles()({
  // Over the Image panel, below its toolbar.
  overlay: { position: "absolute", inset: `${PANEL_TOOLBAR_MIN_HEIGHT}px 0 0`, zIndex: 5 },
});

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
  const { classes } = useStyles();
  const loading = useStore(runtime.store, (state) => state.loading);
  const document = useStore(runtime.store, (state) => state.document);
  const frame = document?.frames.find((item) => item.id === frameId);
  const topic = document?.videos.find((item) => item.id === frame?.videoId)?.topic;
  return (
    <div
      className={classes.overlay}
      data-testid="segmentation-native-overlay"
      data-panel-id={panelId}
      data-log-time-ns={frame?.logTimeNs}
      data-topic={topic}
      data-source-ready={sourceReady && !loading}
    >
      <SemanticSegmentationWorkbench
        runtime={runtime}
        imageUrl={sourceReady ? imageUrl : undefined}
        sourceReady={sourceReady && !loading}
        decodedFrame={decodedFrame}
        frameId={frameId}
        focused={focused}
        onClaimFocus={onClaimFocus}
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
  // Only the fields read here: a whole-store subscription re-rendered every panel's workspace for
  // any panel's surface change.
  const host = useSegmentationHost();
  const session = useStore(
    host.session,
    useShallow((state) => ({
      open: state.open,
      runtime: state.runtime,
      surface: state.surfaces[panelId],
      focused: state.panelId === panelId,
    })),
  );
  const { surface, focused } = session;
  if (!session.open || !session.runtime || surface?.imageUrl == undefined) {
    return undefined;
  }
  return (
    <ActiveWorkbench
      runtime={session.runtime}
      imageUrl={surface.imageUrl}
      sourceReady={surface.sourceReady}
      panelId={panelId}
      decodedFrame={surface.decodedFrame}
      frameId={surface.frameId}
      focused={focused}
      onClaimFocus={() => {
        const live = host.session.getState();
        if (live.panelId !== panelId) {
          host.session.setState({ panelId });
        }
      }}
    />
  );
}
