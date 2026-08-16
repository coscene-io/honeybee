// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import type { LayoutID } from "@foxglove/studio-base/context/CurrentLayoutContext";
import type { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import { DEFAULT_MP4_VIDEO_TOPIC } from "@foxglove/studio-base/players/IterablePlayer/Mp4/Mp4IterableSource";

export const REMOTE_MP4_DEFAULT_LAYOUT_ID = "remote-mp4-default" as LayoutID;
export const REMOTE_MP4_DEFAULT_LAYOUT_NAME = "MP4";
export const REMOTE_MP4_IMAGE_PANEL_ID = "Image!remoteMp4";

/**
 * The only layout for `ds=remote-mp4`. The source always publishes this
 * single topic, so there is nothing to pick or restore.
 */
export const defaultRemoteMp4Layout: LayoutData = {
  configById: {
    [REMOTE_MP4_IMAGE_PANEL_ID]: {
      imageMode: {
        imageTopic: DEFAULT_MP4_VIDEO_TOPIC,
      },
    },
  },
  globalVariables: {},
  userNodes: {},
  layout: REMOTE_MP4_IMAGE_PANEL_ID,
};
