// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";

import { usePanelContext } from "@foxglove/studio-base/components/PanelContext";

import { createSegmentationPanelBridge, type SegmentationPanelBridge } from "../imageSource";
import { registerSegmentationCanvas } from "../segmentationChrome";
import { useSegmentationHost } from "../segmentationHostContext";
import {
  SegmentationImageEntry,
  type SegmentationImageEntryActions,
} from "./SegmentationImageEntry";
import { SegmentationPropagateButton } from "./SegmentationPropagateButton";
import { SegmentationWorkspace } from "./SegmentationWorkspace";

type Props = {
  imageTopic: string | undefined;
  /** Renders the Image panel itself, with the propagate button in its toolbar. */
  renderPanel: (extra: {
    additionalToolbarIcons: ReactNode;
    segmentation: SegmentationPanelBridge;
  }) => ReactNode;
};

/**
 * An Image panel with the annotation editor: the panel, its propagate button, the editor entry and
 * the workspace overlays. Loaded on demand by the Image panel once the rollout flag is on and a
 * cloud record is open.
 */
export function SegmentationImagePanelAdapter({
  imageTopic,
  renderPanel,
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(ReactNull);
  const panel = usePanelContext();
  const host = useSegmentationHost();
  // What this panel's renderer, in its own React root, shares with the editor.
  const bridge = useMemo(
    () =>
      createSegmentationPanelBridge({ maskOverlay: host.maskOverlay, maskPlanes: host.maskPlanes }),
    [host],
  );
  const registration = useRef<(() => void) | undefined>(undefined);
  const propagateIcon = useMemo(
    () => <SegmentationPropagateButton panelId={panel.id} />,
    [panel.id],
  );
  const onActionsChange = useCallback(
    (actions: SegmentationImageEntryActions | undefined) => {
      registration.current?.();
      registration.current = undefined;
      if (!actions) {
        return;
      }
      registration.current = registerSegmentationCanvas(host.chrome, {
        panelId: panel.id,
        topic: imageTopic,
        enterInline: actions.enterInline,
        enterMaximize: actions.enterMaximize,
        area: () => {
          const rect = containerRef.current?.getBoundingClientRect();
          return rect ? rect.width * rect.height : 0;
        },
      });
    },
    [host, imageTopic, panel.id],
  );
  useEffect(
    () => () => {
      registration.current?.();
    },
    [],
  );

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      {renderPanel({ additionalToolbarIcons: propagateIcon, segmentation: bridge })}
      <SegmentationImageEntry
        containerRef={containerRef}
        bridge={bridge}
        topic={imageTopic}
        panelId={panel.id}
        onMaximize={panel.enterFullscreen}
        onActionsChange={onActionsChange}
      />
      <SegmentationWorkspace panelId={panel.id} />
    </div>
  );
}
