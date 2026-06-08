// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Avatar as MuiAvatar } from "@mui/material";
import { Meta, StoryObj } from "@storybook/react";

export default {
  component: MuiAvatar,
  title: "Theme/Data Display/Avatar",
  args: {},
  decorators: [
    (Story) => (
      <div style={{ padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} as Meta<typeof MuiAvatar>;

export const Default: StoryObj = {};
