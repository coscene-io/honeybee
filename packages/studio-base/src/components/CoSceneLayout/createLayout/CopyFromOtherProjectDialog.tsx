// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  Button,
  DialogActions,
  Stack,
  Select,
  MenuItem,
  FormLabel,
} from "@mui/material";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { ProjectSelector } from "@foxglove/studio-base/panels/DataCollection/components/ProjectSelector";
import { MAX_PROJECTS_PAGE_SIZE } from "@foxglove/studio-base/panels/DataCollection/constants";
import { CreateLayoutParams } from "@foxglove/studio-base/services/CoSceneILayoutManager";
import { LayoutPermission } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

import { SelectFolder } from "./SelectFolder";

export type CreateProjectLayoutParams = {
  folder: string;
  name: string;
  permission: LayoutPermission;
  data?: LayoutData;
  projectName: string;
  template: string;
};

const useStyles = makeStyles()({
  dialogContent: {
    minWidth: 400,
  },
});

export function CopyFromOtherProjectDialog({
  open,
  onClose,
  onCreateLayout,
  personalFolders,
  projectFolders,
}: {
  open: boolean;
  onClose: () => void;
  onCreateLayout: (params: CreateLayoutParams) => void;
  personalFolders: string[];
  projectFolders: string[];
}): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const { classes } = useStyles();

  // Access console API and user info
  const consoleApi = useConsoleApi();
  const currentUser = useCurrentUser((store) => store.user);

  // Project options state
  const [projectOptions, setProjectOptions] = useState<{ label: string; value: string }[]>([]);

  const form = useForm<CreateProjectLayoutParams>({
    defaultValues: { name: "", folder: "", permission: "CREATOR_WRITE", projectName: "" },
  });

  // Fetch projects when dialog opens
  useEffect(() => {
    if (open && currentUser?.userId) {
      const fetchProjects = async () => {
        try {
          const response = await consoleApi.listUserProjects({
            userId: currentUser.userId,
            pageSize: MAX_PROJECTS_PAGE_SIZE,
            currentPage: 0,
          });

          const options = response.userProjects
            .filter((project) => !project.isArchived)
            .map((project) => ({
              label: project.displayName,
              value: project.name,
            }));
          setProjectOptions(options);
        } catch (error) {
          console.error("Failed to fetch projects:", error);
        }
      };

      void fetchProjects();
    }
  }, [open, currentUser?.userId, consoleApi]);

  const onSubmit = (data: CreateProjectLayoutParams) => {
    onCreateLayout({
      folder: data.folder,
      name: data.name,
      permission: data.permission,
    });
    onClose();
  };

  const permission = form.watch("permission");

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t("copyFromOtherProject")}</DialogTitle>
      <DialogContent className={classes.dialogContent}>
        <Stack gap={2}>
          <Controller
            control={form.control}
            name="projectName"
            render={({ field }) => (
              <ProjectSelector
                projectName={field.value}
                projectOptions={projectOptions}
                onProjectChange={(projectName) => {
                  field.onChange(projectName);
                }}
                onClearFocusedTask={() => {
                  // No focused task functionality needed in this context
                }}
                label={t("projectName")}
              />
            )}
          />

          {/* todo: selct layout data */}

          <Controller
            control={form.control}
            name="name"
            rules={{
              required: true,
            }}
            render={({ field, fieldState }) => (
              <TextField
                error={!!fieldState.error}
                helperText={fieldState.error?.message}
                required
                label={t("layoutName")}
                {...field}
              />
            )}
          />

          <Stack>
            <FormLabel>
              <Stack direction="row" alignItems="center" gap={0.5}>
                {t("type")}
              </Stack>
            </FormLabel>
            <Controller
              control={form.control}
              name="permission"
              render={({ field }) => (
                <Select label={t("type")} {...field}>
                  <MenuItem value="CREATOR_WRITE">{t("personalLayout")}</MenuItem>
                  <MenuItem value="ORG_WRITE">{t("projectLayout")}</MenuItem>
                </Select>
              )}
            />
          </Stack>

          <Controller
            control={form.control}
            name="folder"
            render={({ field }) => (
              <SelectFolder
                folders={permission === "CREATOR_WRITE" ? personalFolders : projectFolders}
                onChange={(value) => {
                  field.onChange(value ?? "");
                }}
              />
            )}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>
          {t("cancel", { ns: "cosGeneral" })}
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            void form.handleSubmit(onSubmit)();
          }}
        >
          {t("ok", { ns: "cosGeneral" })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
