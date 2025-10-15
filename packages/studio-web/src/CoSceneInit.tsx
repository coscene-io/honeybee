// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { useMemo } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useFavicon } from "react-use";

import { getAppConfig, getDomainConfig } from "@foxglove/studio-base/util/appConfig";

export function useCoSceneInit(): void {
  const url = new URL(window.location.href);

  const { t } = useTranslation("cosError");

  const urlFiles = url.searchParams.get("ds.files");

  const appConfig = getAppConfig();

  if (urlFiles) {
    toast.error(t("currentUrlNotSupported"));
    throw new Error(t("currentUrlNotSupported"));
  }

  const favicon = useMemo(() => {
    const logo = getDomainConfig().logo;
    if (logo === "supor") {
      return "/viz/supor.ico";
    } else if (logo === "agibot") {
      return "/viz/agibot_favicon.svg";
    } else {
      switch (appConfig.VITE_APP_PROJECT_ENV) {
        case "local":
          return "/logo-light.svg";
        case "keenon":
          return "/viz/keenon_favicon.svg";
        default:
          return "/viz/logo-light.svg";
      }
    }
  }, [appConfig.VITE_APP_PROJECT_ENV]);

  useFavicon(favicon);
}
