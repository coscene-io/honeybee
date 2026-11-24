// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { lazy, Suspense } from "react";

import { useSemanticSegmentationFlag } from "../featureFlag";

// The editor is loaded only once the rollout flag is on, so with it off nothing of it is
// downloaded or parsed.
const SegmentationWorkspaceSlots = lazy(async () => ({
  default: (await import("./SegmentationWorkspaceSlots")).SegmentationWorkspaceSlots,
}));

/**
 * Plugs the segmentation editor into the shared workspace chrome through WorkspaceSlots, so
 * shared components never import this feature. Mount it once, in the Workspace.
 *
 * With the `honeybee_semantic_segmentation` rollout flag off nothing is registered, mounted or
 * downloaded: no app bar entry, no 空间 tab, no camera step override, no propagation lock.
 */
export function SegmentationWorkspaceExtension(): React.JSX.Element | ReactNull {
  const flagOn = useSemanticSegmentationFlag();
  return flagOn ? (
    <Suspense fallback={ReactNull}>
      <SegmentationWorkspaceSlots />
    </Suspense>
  ) : (
    ReactNull
  );
}
