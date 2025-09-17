// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack } from "@mui/material";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { SelectFolder } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/SelectFolder";
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
  const availableFolders = isProject ? projectFolders : personalFolders;

  const form = useForm({
    defaultValues: {
      folder: {
        value: layout.folder,
        isNewFolder: !availableFolders.includes(layout.folder),
      },
    },
  });

  const onSubmit = (data: { folder: { value: string; isNewFolder: boolean } }) => {
    onMoveLayout(layout, data.folder.value);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Move to Folder</DialogTitle>
      <DialogContent className={classes.dialogContent}>
        <Stack gap={2}>
          <Controller
            control={form.control}
            name="folder"
            render={({ field }) => (
              <SelectFolder
                folders={availableFolders}
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
