// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { Layout, layoutIsProject } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

const useStyles = makeStyles()({
  dialogContent: {
    minWidth: 400,
  },
});

interface MoveToFolderDialogProps {
  open: boolean;
  layout: Layout;
  personalFolders: string[];
  projectFolders: string[];
  onClose: () => void;
  onMoveLayout: (layout: Layout, newFolder: string) => void;
}

export function MoveToFolderDialog({
  open,
  layout,
  personalFolders,
  projectFolders,
  onClose,
  onMoveLayout,
}: MoveToFolderDialogProps): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const { classes } = useStyles();

  const isProject = layoutIsProject(layout);
  const folders = useMemo(() => {
    return isProject ? projectFolders : personalFolders;
  }, [isProject, projectFolders, personalFolders]);

  const [value, setValue] = useState({ value: "", isNewFolder: false });
  const options: { label: string; value: string; isNewFolder: boolean }[] = useMemo(() => {
    return [
      { label: t("personalLayout"), value: "", isNewFolder: false },
      ...folders.map((folder) => ({ label: folder, value: folder, isNewFolder: false })),
      { label: t("createNewFolder"), value: "", isNewFolder: true },
    ];
  }, [t, folders]);

  const selectedOption = options.find(
    (option) => option.isNewFolder === value.isNewFolder && option.value === value.value,
  );

  const onSubmit = () => {
    onMoveLayout(layout, value.value);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t("moveToFolder")}</DialogTitle>
      <DialogContent className={classes.dialogContent}>
        <Stack gap={2}>
          <Autocomplete
            options={options}
            value={selectedOption ?? null} // eslint-disable-line no-restricted-syntax
            onChange={(_, option) => {
              setValue({
                value: option?.value ?? "",
                isNewFolder: option?.isNewFolder ?? false,
              });
            }}
            renderInput={(params) => <TextField {...params} label={t("folder")} />}
          />
          {value.isNewFolder && (
            <TextField
              label={t("folder")}
              value={value.value}
              onChange={(e) => {
                setValue({
                  value: e.target.value,
                  isNewFolder: true,
                });
              }}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>
          {t("cancel", { ns: "cosGeneral" })}
        </Button>
        <Button disabled={value.value === ""} variant="contained" onClick={onSubmit}>
          {t("ok", { ns: "cosGeneral" })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
