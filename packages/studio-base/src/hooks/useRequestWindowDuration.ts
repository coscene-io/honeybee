// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useContext, useEffect, useMemo, useState } from "react";

import { fromSec, type Time } from "@foxglove/rostime";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { getRequestWindowDefaultTime } from "@foxglove/studio-base/constants/appSettingsDefaults";
import AppConfigurationContext, {
  type AppConfigurationValue,
} from "@foxglove/studio-base/context/AppConfigurationContext";

function getPositiveRequestWindow(value: AppConfigurationValue): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}

export function useRequestWindowDuration(): Time {
  const appConfiguration = useContext(AppConfigurationContext);
  const [requestWindow, setRequestWindow] = useState<number | undefined>(() =>
    getPositiveRequestWindow(appConfiguration?.get(AppSetting.REQUEST_WINDOW)),
  );

  useEffect(() => {
    if (appConfiguration == undefined) {
      setRequestWindow(undefined);
      return;
    }

    const onRequestWindowChange = (value: AppConfigurationValue) => {
      setRequestWindow(getPositiveRequestWindow(value));
    };
    setRequestWindow(getPositiveRequestWindow(appConfiguration.get(AppSetting.REQUEST_WINDOW)));
    appConfiguration.addChangeListener(AppSetting.REQUEST_WINDOW, onRequestWindowChange);
    return () => {
      appConfiguration.removeChangeListener(AppSetting.REQUEST_WINDOW, onRequestWindowChange);
    };
  }, [appConfiguration]);

  return useMemo((): Time => {
    return requestWindow != undefined ? fromSec(requestWindow) : getRequestWindowDefaultTime();
  }, [requestWindow]);
}
