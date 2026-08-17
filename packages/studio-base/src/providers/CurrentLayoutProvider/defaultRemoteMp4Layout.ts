// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import type { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import { resolveRemoteMp4Topic } from "@foxglove/studio-base/players/IterablePlayer/Mp4/Mp4IterableSource";

export { resolveRemoteMp4Topic };

export const REMOTE_MP4_DEFAULT_LAYOUT_ID = "remote-mp4-default" as LayoutID;
export const REMOTE_MP4_DEFAULT_LAYOUT_NAME = "MP4";
export const REMOTE_MP4_IMAGE_PANEL_ID = "Image!remoteMp4";

/**
 * Build the only layout for `ds=remote-mp4`. The Image panel must subscribe
 * to the topic the source actually publishes (`ds.topic` / “Video topic”).
 */
export function createDefaultRemoteMp4Layout(topic?: string): LayoutData {
  return {
    configById: {
      [REMOTE_MP4_IMAGE_PANEL_ID]: {
        imageMode: {
          imageTopic: resolveRemoteMp4Topic(topic),
        },
      },
    },
    globalVariables: {},
    userNodes: {},
    layout: REMOTE_MP4_IMAGE_PANEL_ID,
  };
}

export const defaultRemoteMp4Layout: LayoutData = createDefaultRemoteMp4Layout();
