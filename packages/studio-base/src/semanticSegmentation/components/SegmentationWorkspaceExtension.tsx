// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { useSemanticSegmentationFlag } from "../featureFlag";
import { SegmentationHostContext } from "../segmentationHostContext";
import type { SegmentationHost } from "../segmentationHostContext";

// The editor is loaded only once the rollout flag is on, so with it off nothing of it is
// downloaded or parsed.
const SegmentationWorkspaceSlots = lazy(async () => ({
  default: (await import("./SegmentationWorkspaceSlots")).SegmentationWorkspaceSlots,
}));

/**
 * Owns the spatial annotation host of a workspace and plugs the editor into the shared chrome
 * through WorkspaceSlots, so shared components never import this feature. The Workspace mounts it
 * around everything that may need the editor: the app bar, the sidebars and the Image panels.
 *
 * With the `honeybee_semantic_segmentation` rollout flag off nothing is created, registered,
 * mounted or downloaded: the context holds no host, and there is no app bar entry, no 空间 tab, no
 * camera step override and no propagation lock. With it on, the host is built (loading the editor's
 * core on demand), provided through `SegmentationHostContext`, and disposed with this component.
 * The context element itself stays in place when the flag changes, so `children` are never
 * remounted by it.
 */
export function SegmentationWorkspaceExtension({
  children,
}: {
  children?: ReactNode;
}): React.JSX.Element {
  const flagOn = useSemanticSegmentationFlag();
  const [host, setHost] = useState<SegmentationHost>();
  useEffect(() => {
    if (!flagOn) {
      return;
    }
    let cancelled = false;
    let created: SegmentationHost | undefined;
    void import("../segmentationHost").then(({ createSegmentationHost }) => {
      if (!cancelled) {
        created = createSegmentationHost();
        setHost(created);
      }
    });
    return () => {
      cancelled = true;
      created?.dispose();
      setHost(undefined);
    };
  }, [flagOn]);
  return (
    <SegmentationHostContext.Provider value={host}>
      {host != undefined && (
        <Suspense fallback={ReactNull}>
          <SegmentationWorkspaceSlots />
        </Suspense>
      )}
      {children}
    </SegmentationHostContext.Provider>
  );
}
