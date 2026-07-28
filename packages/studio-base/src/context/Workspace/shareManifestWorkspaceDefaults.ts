// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { DeepPartial } from "ts-essentials";

import { TIMELINE_MIN_HEIGHT_PX } from "@foxglove/studio-base/components/PlaybackControls/constants";

import { WorkspaceContextStore } from "./WorkspaceContext";

/**
 * Persistence key for the workspace store when running in share-manifest mode.
 * Distinct from the normal-mode `fox.workspace` key so a share viewer's panel
 * adjustments persist independently and never mutate normal-mode state.
 */
export const SHARE_MANIFEST_WORKSPACE_PERSIST_KEY = "fox.workspace.shareManifest";

/**
 * Panel state overrides applied on top of the base workspace defaults when opening
 * in share-manifest mode: left sidebar hidden, right sidebar hidden, timeline panel
 * at minimum height. Also the single source of truth for the `resetPanels` action so
 * first-load defaults and reset can never diverge.
 *
 * Scope: panel visibility + size only. Sidebar tab selection (`item`) and other
 * playback settings are intentionally left untouched.
 */
export const SHARE_MANIFEST_PANEL_DEFAULTS: DeepPartial<WorkspaceContextStore> = {
  sidebars: {
    left: {
      open: false,
      size: undefined,
    },
    right: {
      open: false,
      size: undefined,
    },
  },
  playbackControls: {
    timelineHeight: TIMELINE_MIN_HEIGHT_PX,
  },
};
