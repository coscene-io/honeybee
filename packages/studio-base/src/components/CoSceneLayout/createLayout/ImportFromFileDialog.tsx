// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { JsonObject } from "@bufbuild/protobuf";
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
  Box,
} from "@mui/material";
import { useSnackbar } from "notistack";
import path from "path";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext";
import useCallbackWithToast from "@foxglove/studio-base/hooks/useCallbackWithToast";
import {
  CreateLayoutParams,
  CreateLayoutForm,
} from "@foxglove/studio-base/services/CoSceneILayoutManager";
import { replaceNullWithUndefined } from "@foxglove/studio-base/util/coscene";

import { SelectFolder } from "./SelectFolder";

const useStyles = makeStyles()({
  dialogContent: {
    minWidth: 400,
  },
});

export function ImportFromFileDialog({
  open,
  onClose,
  onCreateLayout,
  personalFolders,
  projectFolders,
  supportsProjectWrite,
}: {
  open: boolean;
  onClose: () => void;
  onCreateLayout: (params: CreateLayoutParams) => void;
  personalFolders: string[];
  projectFolders: string[];
  supportsProjectWrite: boolean;
}): React.JSX.Element {
  const { t } = useTranslation(["cosLayout", "general"]);
  const { classes } = useStyles();

  const form = useForm<CreateLayoutForm & { selectedFile: string }>({
    defaultValues: {
      name: "",
      folder: { value: "", isNewFolder: false },
      permission: "PERSONAL_WRITE",
      selectedFile: "",
    },
  });

  const onSubmit = (data: CreateLayoutForm) => {
    onCreateLayout({
      folder: data.folder.value,
      name: data.name,
      permission: data.permission,
      data: data.data,
    });
    onClose();
  };

  const permission = form.watch("permission");

  const { enqueueSnackbar } = useSnackbar();

  const importLayout = useCallbackWithToast(async () => {
    const fileHandles = await showOpenFilePicker({
      excludeAcceptAllOption: false,
      types: [
        {
          description: "JSON Files",
          accept: {
            "application/json": [".json"],
          },
        },
      ],
    });

    const file = await fileHandles[0].getFile();
    const layoutName = path.basename(file.name, path.extname(file.name));
    const content = await file.text();

    let parsedState: unknown;
    try {
      parsedState = JSON.parse(content);
    } catch (err) {
      enqueueSnackbar(`${file.name} is not a valid layout: ${err.message}`, {
        variant: "error",
      });
      return;
    }

    if (typeof parsedState !== "object" || !parsedState) {
      enqueueSnackbar(`${file.name} is not a valid layout`, { variant: "error" });
      return;
    }
    const data = replaceNullWithUndefined(parsedState as JsonObject) as LayoutData;
    form.setValue("selectedFile", file.name);
    form.setValue("name", layoutName);
    form.setValue("data", data);
  }, [enqueueSnackbar, form]);

  return (
    <Dialog
      open={open}
      onClose={(_event, reason) => {
        if (reason === "backdropClick") {
          return;
        }
        onClose();
      }}
    >
      <DialogTitle>{t("importFromFile")}</DialogTitle>
      <DialogContent className={classes.dialogContent}>
        <Stack gap={2}>
          <input
            style={{ display: "none" }}
            {...form.register("selectedFile", { required: true })}
          />
          <Box>
            <Button variant="outlined" onClick={importLayout}>
              {form.watch("selectedFile") || t("importFromFile")}
            </Button>
          </Box>

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
                placeholder={t("pleaseEnter", { ns: "general" })}
                slotProps={{ htmlInput: { maxLength: 60 } }}
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
