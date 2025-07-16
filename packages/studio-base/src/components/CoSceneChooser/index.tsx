// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { Record } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/record_pb";
import CloseIcon from "@mui/icons-material/Close";
import { Dialog, Typography, IconButton, Button } from "@mui/material";
import { useCallback, useState, useMemo, useEffect } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import Snow from "@foxglove/studio-base/components/DataSourceDialog/Snow";
import Stack from "@foxglove/studio-base/components/Stack";
import { checkBagFileSupported } from "@foxglove/studio-base/util/coscene";

// Import sub-components
import { ChooserComponent } from "./ChooserComponent";
import { FilesList } from "./FilesList";
import { ChooserDialogProps, SelectedFile } from "./types";

const useStyles = makeStyles()((theme) => ({
  closeButton: {
    position: "absolute",
    right: 0,
    top: 0,
    margin: theme.spacing(3),
  },
  main: {
    padding: theme.spacing(3),
  },
  selecter: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    marginTop: theme.spacing(2),
    height: theme.spacing(65),
  },
}));

function CoSceneChooser(props: ChooserDialogProps): React.JSX.Element {
  const {
    checkFileSupportedFunc,
    backdropAnimation,
    open,
    closeDialog,
    mode,
    onConfirm,
    maxFilesNumber,
    defaultProject,
  } = props;

  const { classes } = useStyles();
  const { t } = useTranslation("cosPlaylist");

  const [targetRecord, setTargetRecord] = useState<Record | undefined>(undefined);
  const [targetProject, setTargetProject] = useState<Project | undefined>(undefined);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);

  // Memoized backdrop calculation
  const backdrop = useMemo(() => {
    if (backdropAnimation === false) {
      return undefined;
    }

    const now = new Date();
    const currentYear = now.getFullYear();

    if (now >= new Date(currentYear, 11, 25)) {
      return <Snow effect="snow" />;
    } else if (now < new Date(currentYear, 0, 2)) {
      return <Snow effect="confetti" />;
    }
    return undefined;
  }, [backdropAnimation]);

  // Handle file number limit
  useEffect(() => {
    if (maxFilesNumber != undefined && selectedFiles.length > maxFilesNumber) {
      toast.error(t("maxFilesNumber", { maxFilesNumber, ns: "cosEvent" }));
      setSelectedFiles((prev) => prev.slice(0, maxFilesNumber));
    }
  }, [maxFilesNumber, selectedFiles.length, t]);

  // Memoized handlers
  const handleModalClose = useCallback(() => {
    setSelectedFiles([]);
    closeDialog();
  }, [closeDialog]);

  const handleTargetInfoChange = useCallback(
    ({ record, project }: { record?: Record; project?: Project }) => {
      setTargetRecord(record);
      setTargetProject(project);
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    const isFileMode = mode === "select-files-from-record" || mode === "select-files-from-project";

    if (isFileMode) {
      (onConfirm as (files: SelectedFile[]) => void)(selectedFiles);
      setSelectedFiles([]);
      closeDialog();
      return;
    }

    if (targetRecord && targetProject) {
      (onConfirm as (record: Record, project: Project) => void)(targetRecord, targetProject);
      closeDialog();
    }
  }, [mode, selectedFiles, targetRecord, targetProject, onConfirm, closeDialog]);

  const isConfirmDisabled = useMemo(() => {
    const isFileMode = mode === "select-files-from-record" || mode === "select-files-from-project";

    if (isFileMode) {
      return selectedFiles.length === 0;
    }
    return !targetRecord || !targetProject;
  }, [mode, selectedFiles.length, targetRecord, targetProject]);

  const dialogTitle = useMemo(() => {
    switch (mode) {
      case "select-record":
        return t("selectRecord");
      case "create-record":
        return t("createRecord");
      case "select-files-from-record":
        return t("selecteFilesFromRecord");
      case "select-files-from-project":
        return t("selectRecordFromProjectResources");
      default:
        return "";
    }
  }, [mode, t]);

  const showFilesList = mode === "select-files-from-record" || mode === "select-files-from-project";

  return (
    <Dialog
      data-testid="DataSourceDialog"
      open={open}
      onClose={handleModalClose}
      fullWidth
      maxWidth="lg"
      slotProps={{
        backdrop: { children: backdrop },
        paper: {
          square: false,
          elevation: 4,
        },
      }}
    >
      <IconButton className={classes.closeButton} onClick={handleModalClose} edge="end">
        <CloseIcon />
      </IconButton>
      <Stack flexGrow={1} fullHeight justifyContent="space-between" className={classes.main}>
        <Typography variant="h3" gutterBottom>
          {dialogTitle}
        </Typography>

        <Stack className={classes.selecter} direction="row">
          <ChooserComponent
            setTargetInfo={handleTargetInfoChange}
            files={selectedFiles}
            setFiles={setSelectedFiles}
            mode={mode}
            checkFileSupportedFunc={checkFileSupportedFunc ?? checkBagFileSupported}
            defaultProject={defaultProject}
          />
          {showFilesList && <FilesList files={selectedFiles} setFiles={setSelectedFiles} />}
        </Stack>

        <Stack direction="row" justifyContent="flex-end" paddingTop={2} gap={1}>
          <Button variant="outlined" size="large" color="inherit" onClick={handleModalClose}>
            {t("cancel", { ns: "cosGeneral" })}
          </Button>
          <Button
            onClick={handleConfirm}
            variant="contained"
            size="large"
            disabled={isConfirmDisabled}
          >
            {t("ok", { ns: "cosGeneral" })}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}

export default CoSceneChooser;
