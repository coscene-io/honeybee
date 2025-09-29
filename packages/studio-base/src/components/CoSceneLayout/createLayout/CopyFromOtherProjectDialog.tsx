// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Stack,
  Select,
  MenuItem,
  FormLabel,
  IconButton,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { CreateLayoutParams } from "@foxglove/studio-base/services/CoSceneILayoutManager";
import { LayoutPermission } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

import { ProjectSelector } from "./ProjectSselector";

export type CreateProjectLayoutParams = {
  folder: { value: string; isNewFolder: boolean };
  name: string;
  permission: LayoutPermission;
  data?: LayoutData;
  projectName: string;
  templateName: string;
};

const useStyles = makeStyles()({
  dialogContent: {
    minWidth: 600,
  },
});

export function CopyFromOtherProjectDialog({
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

  const [projectName, setProjectName] = useState("");

  // const onSubmit = (data: CreateProjectLayoutParams) => {
  //   onCreateLayout({
  //     folder: data.folder.value,
  //     name: data.name,
  //     permission: data.permission,
  //     data: data.data,
  //   });
  //   onClose();
  // };

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
      <DialogTitle>
        {t("copyFromOtherProject")}
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent className={classes.dialogContent}>
        <Stack gap={2}>
          <ProjectSelector value={projectName} onChange={setProjectName} />

          {/* <Controller
            control={form.control}
            name="data"
            rules={{
              required: true,
            }}
            render={({ field, fieldState }) => (
              <ProjectLayoutSelector
                key={projectName}
                projectName={projectName}
                onChange={(data, name) => {
                  // field.onChange(data);
                  // form.setValue("name", name ?? "");
                }}
                error={!!fieldState.error}
              />
            )}
          /> */}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
