// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AppSetting } from "@foxglove/studio-base";
import { Storage } from "@foxglove/studio-desktop/src/common/types";
import { main as rendererMain } from "@foxglove/studio-desktop/src/renderer/index";
import NativeStorageAppConfiguration from "@foxglove/studio-desktop/src/renderer/services/NativeStorageAppConfiguration";
import { initializeCosConfig } from "@foxglove/studio-desktop/src/renderer/services/RemoteConfigLoader";

const isDevelopment = process.env.NODE_ENV === "development";

async function main() {
  const appConfiguration = await NativeStorageAppConfiguration.Initialize(
    (global as { storageBridge?: Storage }).storageBridge!,
    {
      defaults: {
        [AppSetting.SHOW_DEBUG_PANELS]: isDevelopment,
      },
    },
  );

  const remoteConfigUrl = appConfiguration.get(AppSetting.REMOTE_CONFIG_URL) as string | undefined;

  if (remoteConfigUrl) {
    await initializeCosConfig({
      remoteUrl: remoteConfigUrl,
      timeout: 5000,
    });
  }

  await rendererMain({ appConfiguration });
}

void main();
