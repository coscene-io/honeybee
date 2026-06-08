// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const incompatibleLayoutVersion: Partial<
  TypeOptions["resources"]["incompatibleLayoutVersion"]
> = {
  desktopText:
    "このレイアウトはCoScene Studioの新しいバージョンで作成されました。最新バージョンに更新してください ",
  title: "互換性のないレイアウトバージョン",
  webText:
    "このレイアウトはCoScene Studioの新しいバージョンで作成されました。ブラウザを更新してください。",
};
