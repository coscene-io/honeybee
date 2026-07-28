// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TIMELINE_MIN_HEIGHT_PX } from "@foxglove/studio-base/components/PlaybackControls/constants";

import {
  SHARE_MANIFEST_PANEL_DEFAULTS,
  SHARE_MANIFEST_WORKSPACE_PERSIST_KEY,
} from "./shareManifestWorkspaceDefaults";

describe("share-manifest workspace defaults", () => {
  it("uses a persistence key distinct from the normal-mode workspace store", () => {
    expect(SHARE_MANIFEST_WORKSPACE_PERSIST_KEY).toBe("fox.workspace.shareManifest");
    expect(SHARE_MANIFEST_WORKSPACE_PERSIST_KEY).not.toBe("fox.workspace");
  });

  it("hides both sidebars and pins the timeline to its minimum height", () => {
    expect(SHARE_MANIFEST_PANEL_DEFAULTS.sidebars?.left?.open).toBe(false);
    expect(SHARE_MANIFEST_PANEL_DEFAULTS.sidebars?.right?.open).toBe(false);
    expect(SHARE_MANIFEST_PANEL_DEFAULTS.sidebars?.left?.size).toBeUndefined();
    expect(SHARE_MANIFEST_PANEL_DEFAULTS.sidebars?.right?.size).toBeUndefined();
    expect(SHARE_MANIFEST_PANEL_DEFAULTS.playbackControls?.timelineHeight).toBe(
      TIMELINE_MIN_HEIGHT_PX,
    );
  });

  it("does not override sidebar tab selection", () => {
    expect(SHARE_MANIFEST_PANEL_DEFAULTS.sidebars?.left?.item).toBeUndefined();
    expect(SHARE_MANIFEST_PANEL_DEFAULTS.sidebars?.right?.item).toBeUndefined();
  });
});
