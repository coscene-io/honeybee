// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import dayjs from "dayjs";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import "dayjs/locale/zh-cn";
import "dayjs/locale/en";

export function useDayjsLocale(): void {
  const { i18n } = useTranslation();

  useEffect(() => {
    if (i18n.language === "zh") {
      dayjs.locale("zh-cn");
    } else if (i18n.language === "en") {
      dayjs.locale("en");
    }
  }, [i18n.language]);
}
