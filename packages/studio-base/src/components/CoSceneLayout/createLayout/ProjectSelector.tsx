// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Star as StarIcon, StarOutline as StarOutlineIcon } from "@mui/icons-material";
import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAsync } from "react-use";

import { ProjectVisibilityChip } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/ProjectVisibility";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { MAX_PROJECTS_PAGE_SIZE } from "@foxglove/studio-base/panels/DataCollection/constants";
import { BinaryOperator, CosQuery } from "@foxglove/studio-base/util/coscene/cosel";

interface ProjectSelectorProps {
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
  showLabel?: boolean;
}

export function ProjectSelector({
  error,
  value,
  onChange,
  showLabel = true,
}: ProjectSelectorProps): React.JSX.Element {
  const { t } = useTranslation(["cosLayout", "cosProject", "general"]);
  const consoleApi = useConsoleApi();
  const currentUser = useCurrentUser((store) => store.user);
  const userId = currentUser?.userId;

  const options = useAsync(async () => {
    if (!userId) {
      return [];
    }

    const filter = CosQuery.Companion.empty();
    filter.setListField("id", BinaryOperator.EQ, [userId]);

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
        project,
      }))
      .sort((a, _b) => (a.project.isStarred ? -1 : 1));
  }, [consoleApi, userId]);

  return (
    <Autocomplete
      disableClearable
      options={options.value ?? []}
      renderOption={(props, option) => (
        <li
          {...props}
          key={option.value}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <Typography variant="body2" noWrap textOverflow="ellipsis">
            {option.label}
          </Typography>
          <Box display="flex" alignItems="center" gap={0.5}>
            {option.project.isStarred ? (
              <StarIcon style={{ color: "#fbbf24" }} />
            ) : (
              <StarOutlineIcon style={{ color: "#9ca3af" }} />
            )}
            <ProjectVisibilityChip visibility={option.project.visibility} />
          </Box>
        </li>
      )}
      value={options.value?.find((option) => option.value === value)}
      groupBy={(option) =>
        option.project.isStarred
          ? t("starredProject", { ns: "cosProject" })
          : t("activeProject", { ns: "cosProject" })
      }
      onChange={(_event, value) => {
        onChange(value.value);
      }}
      renderInput={(params) => (
        <TextField
          required
          {...params}
          style={{ minWidth: "240px" }}
          label={showLabel ? t("projectName") : undefined}
          error={error}
          placeholder={t("pleaseSelect", { ns: "general" })}
        />
      )}
    />
  );
}
