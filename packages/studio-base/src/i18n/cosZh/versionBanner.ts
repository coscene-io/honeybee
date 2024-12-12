// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

export const cosVersionBanner: Partial<TypeOptions["resources"]["cosVersionBanner"]> = {
  download: "下载",
  browserVersionError:
    "建议使用 Chrome V104 及以上版本的浏览器，其他浏览器可能功能不全，请切换以获得最佳体验。",
  chromeVersionError: "当前使用的 Chrome 版本过低，建议升级至最新版本以获得最佳体验",
};
