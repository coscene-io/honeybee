// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Project } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/project_pb";
import { Record } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/record_pb";
import { Button, Dialog, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { ChooserComponent } from "@foxglove/studio-base/components/CoSceneChooser/ChooserComponent";

const useStyles = makeStyles()(() => ({
  dialogPaper: {
    height: "80vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    flexShrink: 0,
  },
  contentWrapper: {
    minHeight: 0,
  },
  chooserContainer: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    "& > *": {
      flex: 1,
      minHeight: 0,
    },
  },
  footer: {
    flexShrink: 0,
  },
}));

export function ChoiceRecordDialog({
  open,
  onClose,
  onConfirm,
  defaultRecordDisplayName,
  mode = "create-record",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (record: Record, project: Project) => void;
  defaultRecordDisplayName?: string;
  mode?: "select-record" | "create-record";
}): React.JSX.Element {
  const { t } = useTranslation("appBar");
  const { classes } = useStyles();
  const [targetRecord, setTargetRecord] = useState<Record | undefined>(undefined);
  const [targetProject, setTargetProject] = useState<Project | undefined>(undefined);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          className: classes.dialogPaper,
        },
      }}
    >
      <Stack pt={2} px={2} className={classes.header}>
        <Typography variant="h6">{t("uploadTo")}</Typography>
      </Stack>
      <Stack flex={1} className={classes.contentWrapper}>
        <Stack className={classes.chooserContainer}>
          <ChooserComponent
            mode={mode}
            checkFileSupportedFunc={() => true}
            setTargetInfo={({ record, project, isCreating }) => {
              if (isCreating === true && record != undefined && project != undefined) {
                onConfirm(record, project);
                onClose();
              } else {
                setTargetRecord(record);
                setTargetProject(project);
              }
            }}
            files={[]}
            setFiles={() => {}}
            defaultRecordDisplayName={defaultRecordDisplayName}
            createRecordConfirmText={t("createRecordAndUpload")}
          />
        </Stack>
        <Stack
          direction="row"
          justifyContent="flex-end"
          paddingX={2}
          paddingBottom={2}
          gap={1}
          className={classes.footer}
        >
          <Button variant="outlined" size="large" color="inherit" onClick={onClose}>
            {t("cancel", {
              ns: "general",
            })}
          </Button>
          <Button
            onClick={() => {
              if (targetRecord != undefined && targetProject != undefined) {
                onConfirm(targetRecord, targetProject);
                onClose();
              }
            }}
            variant="contained"
            size="large"
            disabled={targetRecord == undefined || targetProject == undefined}
          >
            {t("ok", {
              ns: "general",
            })}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
