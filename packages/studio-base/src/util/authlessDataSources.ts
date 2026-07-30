// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { SHARE_MANIFEST_DATA_SOURCE_ID } from "@foxglove/studio-base/util/shareManifest";

const AUTHLESS_DATA_SOURCE_IDS = new Set([
  SHARE_MANIFEST_DATA_SOURCE_ID,
  "remote-file",
  "mcap-remote-file",
  "ros1-remote-bagfile",
  "remote-mp4",
]);

/** Data sources whose URLs provide all authorization needed for playback. */
export function isAuthlessDataSourceId(id: string | undefined): boolean {
  return id != undefined && AUTHLESS_DATA_SOURCE_IDS.has(id);
}
