// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useTranslation } from "react-i18next";

/** Keep editor-owned copy local while following the application's active language. */
export function useEditorText(): (english: string, chinese: string) => string {
  const { i18n } = useTranslation();
  return (english, chinese) =>
    (i18n.resolvedLanguage ?? i18n.language).startsWith("zh") ? chinese : english;
}
