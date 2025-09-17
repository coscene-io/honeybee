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

  const options: { label: string; value: string; isNewFolder: boolean }[] = useMemo(() => {
    return [
      ...(layout.folder
        ? [
            {
              label:
                layout.permission === "PERSONAL_WRITE" ? t("personalLayout") : t("projectLayout"),
              value: "",
              isNewFolder: false,
            },
          ]
        : []),
      ...folders
        .filter((folder) => folder !== layout.folder)
        .map((folder) => ({ label: folder, value: folder, isNewFolder: false })),
      { label: t("createNewFolder"), value: "", isNewFolder: true },
    ];
  }, [t, folders, layout.folder, layout.permission]);

  const [selectedOption, setSelectedOption] = useState<
    { label: string; value: string; isNewFolder: boolean } | undefined
  >();

  const [newFolderValue, setNewFolderValue] = useState("");

  const onSubmit = () => {
    console.log("submit", selectedOption, newFolderValue);

    if (!selectedOption) {
      return;
    }

    const finalValue = selectedOption.isNewFolder ? newFolderValue : selectedOption.value;
    console.log("submit", finalValue);
    onMoveLayout(layout, finalValue.trim());
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t("moveToFolder")}</DialogTitle>
      <DialogContent className={classes.dialogContent}>
        <Stack gap={2}>
          <Autocomplete
            options={options}
            value={selectedOption}
            onChange={(_, option) => {
              setSelectedOption(option ?? undefined);
              // If switching to an existing folder, update the new folder value to match
              if (option?.isNewFolder === false) {
                setNewFolderValue("");
              }
            }}
            renderInput={(params) => <TextField {...params} label={t("folder")} />}
          />
          {selectedOption?.isNewFolder === true && (
            <TextField
              label={t("folder")}
              value={newFolderValue}
              onChange={(e) => {
                setNewFolderValue(e.target.value);
              }}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>
          {t("cancel", { ns: "cosGeneral" })}
        </Button>
        <Button
          disabled={
            selectedOption == undefined ||
            (selectedOption.isNewFolder && newFolderValue.trim() === "")
          }
          variant="contained"
          onClick={onSubmit}
        >
          {t("ok", { ns: "cosGeneral" })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
