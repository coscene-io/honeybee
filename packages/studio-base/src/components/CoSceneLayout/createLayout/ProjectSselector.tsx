// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Autocomplete, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAsync } from "react-use";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { MAX_PROJECTS_PAGE_SIZE } from "@foxglove/studio-base/panels/DataCollection/constants";

interface ProjectSelectorProps {
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
}

export function ProjectSelector({
  error,
  value,
  onChange,
}: ProjectSelectorProps): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const consoleApi = useConsoleApi();
  const currentUser = useCurrentUser((store) => store.user);
  const userId = currentUser?.userId;

  const options = useAsync(async () => {
    if (!userId) {
      return [];
    }

    const response = await consoleApi.listUserProjects({
      userId,
      pageSize: MAX_PROJECTS_PAGE_SIZE,
      currentPage: 0,
    });

    return response.userProjects
      .filter((project) => !project.isArchived)
      .map((project) => ({
        label: project.displayName,
        value: project.name,
      }));
  }, [consoleApi, userId]);

  return (
    <Autocomplete
      options={options.value ?? []}
      value={options.value?.find((option) => option.value === value)}
      onChange={(_event, value) => {
        onChange(value?.value ?? "");
      }}
      renderInput={(params) => (
        <TextField required {...params} label={t("projectName")} error={error} />
      )}
    />
  );
}
