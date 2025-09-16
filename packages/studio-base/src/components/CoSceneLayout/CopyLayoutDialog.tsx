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
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import {
  CreateLayoutForm,
  CreateLayoutParams,
} from "@foxglove/studio-base/services/CoSceneILayoutManager";
import { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

import { SelectFolder } from "./createLayout/SelectFolder";

const useStyles = makeStyles()({
  dialogContent: {
    minWidth: 400,
  },
});

export function CopyLayoutDialog({
  open,
  onClose,
  onCreateLayout,
  personalFolders,
  projectFolders,
  layout,
  supportsProjectWrite,
}: {
  open: boolean;
  onClose: () => void;
  onCreateLayout: (params: CreateLayoutParams) => void;
  personalFolders: string[];
  projectFolders: string[];
  layout: Layout;
  supportsProjectWrite: boolean;
}): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const { classes } = useStyles();

  const form = useForm<CreateLayoutForm>({
    defaultValues: {
      name: "",
      folder: { value: "", isNewFolder: false },
      permission: "PERSONAL_WRITE",
    },
  });

  const onSubmit = (data: CreateLayoutForm) => {
    onCreateLayout({
      folder: data.folder.value,
      name: data.name,
      permission: data.permission,
      data: layout.working?.data ?? layout.baseline.data,
    });
    onClose();
  };

  const permission = form.watch("permission");

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t("copyLayout")}</DialogTitle>
      <DialogContent className={classes.dialogContent}>
        <Stack gap={2}>
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
                  <MenuItem value="PERSONAL_WRITE">{t("personalLayout")}</MenuItem>
                  <MenuItem value="PROJECT_WRITE" disabled={!supportsProjectWrite}>
                    {t("projectLayout")}
                  </MenuItem>
                </Select>
              )}
            />
          </Stack>

          <Controller
            control={form.control}
            name="folder"
            render={({ field }) => (
              <SelectFolder
                folders={permission === "PERSONAL_WRITE" ? personalFolders : projectFolders}
                value={field.value}
                onChange={field.onChange}
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
