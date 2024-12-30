// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useFavicon } from "react-use";

import Logger from "@foxglove/log";
import { APP_CONFIG, getDomainConfig } from "@foxglove/studio-base/util/appConfig";

const log = Logger.getLogger(__filename);

export function useCoSceneInit({ baseUrl, jwt }: { baseUrl: string; jwt: string }): boolean {
  const [isLoading, setIsLoading] = useState(true);

  const url = new URL(window.location.href);

  const urlKey = url.searchParams.get("ds.key");

  useEffect(() => {
    fetch(`${baseUrl}/v1/data/sync`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: jwt,
      },
      body: JSON.stringify({ id: urlKey }),
    })
      .then(() => {
        setIsLoading(false);
      })
      .catch(() => {
        log.error("Failed sync data to honeybee server");
        setIsLoading(false);
      });
  }, [baseUrl, jwt, urlKey]);

  const { t } = useTranslation("cosError");

  const urlFiles = url.searchParams.get("ds.files");

  if (urlFiles) {
    toast.error(t("currentUrlNotSupported"));
    throw new Error(t("currentUrlNotSupported"));
  }

  const favicon = useMemo(() => {
    const logo = getDomainConfig().logo;
    if (logo === "supor") {
      return "/viz/supor.ico";
    } else {
      switch (APP_CONFIG.VITE_APP_PROJECT_ENV) {
        case "local":
          return "/logo-light.svg";
        case "keenon":
          return "/viz/keenon_favicon.svg";
        default:
          return "/viz/logo-light.svg";
      }
    }
  }, []);

  useFavicon(favicon);

  return isLoading;
}
