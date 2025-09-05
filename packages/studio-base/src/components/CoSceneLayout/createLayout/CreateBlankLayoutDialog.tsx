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

import { CreateLayoutParams } from "@foxglove/studio-base/services/CoSceneILayoutManager";

import { SelectFolder } from "./SelectFolder";

const useStyles = makeStyles()({
  dialogContent: {
    minWidth: 400,
  },
});

export function CreateBlankLayoutDialog({
  open,
  onClose,
  onCreateLayout,
}: {
  open: boolean;
  onClose: () => void;
  onCreateLayout: (params: CreateLayoutParams) => void;
}): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const { classes } = useStyles();

  const form = useForm<CreateLayoutParams>({
    defaultValues: { displayName: "", folder: "", permission: "CREATOR_WRITE" },
  });

  const onSubmit = (data: CreateLayoutParams) => {
    onCreateLayout({
      folder: data.folder,
      displayName: data.displayName,
      permission: data.permission,
    });
    onClose();
  };

  const permission = form.watch("permission");

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t("createBlankLayout")}</DialogTitle>
      <DialogContent className={classes.dialogContent}>
        <Stack gap={2}>
          <Controller
            control={form.control}
            name="displayName"
            rules={{
              required: true,
            }}
            render={({ field }) => <TextField required label={t("layoutName")} {...field} />}
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
                value={field.value}
                type={permission === "CREATOR_WRITE" ? "personal" : "project"}
                onChange={(value) => {
                  field.onChange(value ?? "");
                }}
              />
            )}
          />

          {/* <Controller
            control={form.control}
            name="folder"
            render={({ field }) => <TextField label={t("folder")} {...field} />}
          /> */}
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
