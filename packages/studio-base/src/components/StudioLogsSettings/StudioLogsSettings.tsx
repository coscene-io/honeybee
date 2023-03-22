// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useTranslation } from "react-i18next";

import SettingsTreeEditor from "@foxglove/studio-base/components/SettingsTreeEditor";
import { SidebarContent } from "@foxglove/studio-base/components/SidebarContent";

import { useStudioLogsSettingsTree } from "./useStudioLogsSettingsTree";

export function StudioLogsSettings(): JSX.Element {
  const logSettings = useStudioLogsSettingsTree();

  return <SettingsTreeEditor settings={logSettings} />;
}

export function StudioLogsSettingsSidebar(): JSX.Element {
  const { t } = useTranslation("studioLogsSettings");
  return (
    <SidebarContent overflow="auto" title={t("studioLogsSettings")} disablePadding>
      <StudioLogsSettings />
    </SidebarContent>
  );
}
