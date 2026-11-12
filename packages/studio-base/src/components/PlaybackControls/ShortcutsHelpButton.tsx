// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Keyboard20Regular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";

import HoverableIconButton from "@foxglove/studio-base/components/HoverableIconButton";

import { openKeyboardShortcuts } from "./keyboardShortcutsDialogStore";

export function ShortcutsHelpButton({ showLabel }: { showLabel?: boolean }): React.JSX.Element {
  const { t } = useTranslation("general");

  return (
    <HoverableIconButton
      size="small"
      title={t("keyboardShortcuts")}
      aria-label={t("keyboardShortcuts")}
      icon={<Keyboard20Regular />}
      onClick={openKeyboardShortcuts}
    >
      {showLabel === true && <span style={{ fontSize: 12 }}>{t("keyboardShortcuts")}</span>}
    </HoverableIconButton>
  );
}
