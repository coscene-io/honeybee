// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import ClearIcon from "@mui/icons-material/Clear";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import { Typography, IconButton } from "@mui/material";
import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import Stack from "@foxglove/studio-base/components/Stack";

import { SelectedFile } from "./types";

const useStyles = makeStyles()((theme) => ({
  filesListContainer: {
    borderLeft: `1px solid ${theme.palette.divider}`,
  },
}));

interface FilesListProps {
  files: SelectedFile[];
  setFiles: (files: SelectedFile[]) => void;
}

export const FilesList = memo<FilesListProps>(({ files, setFiles }) => {
  const { t } = useTranslation("playList");
  const { classes } = useStyles();

  const handleRemoveFile = useCallback(
    (fileToRemove: SelectedFile) => {
      setFiles(files.filter((file) => file !== fileToRemove));
    },
    [files, setFiles],
  );

  return (
    <Stack flex={1} padding={2} className={classes.filesListContainer}>
      <Stack paddingBottom={1}>
        <Typography gutterBottom>{t("selectedFilesCount", { count: files.length })}</Typography>
      </Stack>

      {files.map((file) => (
        <Stack
          key={file.file.name}
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          gap={1}
        >
          <Stack flex={1}>
            <Stack gap={1} direction="row" alignItems="center">
              <InsertDriveFileIcon fontSize="small" />
              <Typography variant="body2" noWrap>
                {file.file.filename}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" noWrap>
              {file.projectDisplayName} / {file.recordDisplayName}
            </Typography>
          </Stack>

          <IconButton
            edge="end"
            onClick={() => {
              handleRemoveFile(file);
            }}
            size="small"
            aria-label={`Remove ${file.file.filename}`}
          >
            <ClearIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
    </Stack>
  );
});

FilesList.displayName = "FilesList";
