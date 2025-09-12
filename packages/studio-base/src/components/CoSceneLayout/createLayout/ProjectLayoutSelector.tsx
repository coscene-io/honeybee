// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Autocomplete, TextField } from "@mui/material";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAsync } from "react-use";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext";

interface LayoutSelectorProps {
  projectName: string;
  onChange: (data?: LayoutData) => void;
  error?: boolean;
}

export function ProjectLayoutSelector({
  projectName,
  onChange,
  error,
}: LayoutSelectorProps): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const consoleApi = useConsoleApi();

  const options = useAsync(async () => {
    if (!projectName) {
      return [];
    }
    const result = await consoleApi.listProjectLayouts({ parent: projectName });
    return result.projectLayouts.map((layout) => ({
      label: layout.displayName,
      value: layout.name,
    }));
  }, [projectName, consoleApi]);

  const getProjectLayout = useCallback(
    async (layoutName?: string) => {
      if (!layoutName) {
        onChange(undefined);
        return;
      }

      try {
        const result = await consoleApi.getProjectLayout({ name: layoutName });
        const data = result.data?.toJson() as LayoutData;
        onChange(data);
      } catch (error) {
        console.error(error);
        onChange(undefined);
      }

      return;
    },
    [consoleApi, onChange],
  );

  return (
    <Autocomplete
      options={options.value ?? []}
      onChange={(_event, option) => {
        void getProjectLayout(option?.value as string | undefined);
      }}
      renderInput={(params) => (
        <TextField required {...params} label={t("layoutToCopy")} error={error} />
      )}
    />
  );
}
