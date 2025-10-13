// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import { Dialog, DialogTitle, DialogContent, Stack, IconButton } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { ProjectLayoutList } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/ProjectLayoutList";
import { ProjectSelector } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/ProjectSelector";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext";
import { CreateLayoutParams } from "@foxglove/studio-base/services/CoSceneILayoutManager";

const useStyles = makeStyles()({
  dialogContent: {
    minWidth: 600,
  },
});

export function CopyFromOtherProjectDialog({
  open,
  onClose,
  onCreateLayout,
  supportsProjectWrite,
}: {
  open: boolean;
  onClose: () => void;
  onCreateLayout: (params: CreateLayoutParams) => void;
  supportsProjectWrite: boolean;
}): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const { classes } = useStyles();
  const [projectName, setProjectName] = useState("");

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
      <DialogTitle
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        {t("copyFromOtherProject")}
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent className={classes.dialogContent}>
        <Stack gap={2}>
          <ProjectSelector value={projectName} onChange={setProjectName} />

          <ProjectLayoutList
            projectName={projectName}
            supportsProjectWrite={supportsProjectWrite}
            onChange={(layout, permission) => {
              onCreateLayout({
                folder: "",
                name: layout.displayName,
                permission,
                data: layout.data?.toJson() as LayoutData,
              });

              onClose();
            }}
          />
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
