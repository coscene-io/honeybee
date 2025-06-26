// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { File } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/file_pb";
import FolderIcon from "@mui/icons-material/Folder";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import { List, ListItem, ListItemButton, Checkbox, ListItemText, Tooltip } from "@mui/material";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import Stack from "@foxglove/studio-base/components/Stack";
import { checkBagFileSupported } from "@foxglove/studio-base/util/coscene";

import { SelectedFile } from "./types";

interface FileNavigationPanelProps {
  files: File[];
  selectedFiles: SelectedFile[];
  onFileToggle: (file: File) => void;
  checkFileSupportedFunc?: (file: File) => boolean;
  currentFolderPath?: readonly string[];
  onNavigateToFolder: (path: readonly string[]) => void;
}

export function SelectFilesList({
  files,
  selectedFiles,
  onFileToggle,
  checkFileSupportedFunc = checkBagFileSupported,
  currentFolderPath = [],
  onNavigateToFolder,
}: FileNavigationPanelProps): React.JSX.Element {
  const { t } = useTranslation("cosPlaylist");

  const navigateToFolder = useCallback(
    (folderName: string) => {
      onNavigateToFolder([...currentFolderPath, folderName]);
    },
    [currentFolderPath, onNavigateToFolder],
  );

  const renderFolderItem = useCallback(
    (folder: File) => {
      const folderName = folder.filename.split("/").slice(-2, -1)[0] ?? folder.filename;
      return (
        <ListItem key={folder.name} disablePadding>
          <ListItemButton
            onClick={() => {
              navigateToFolder(folderName);
            }}
            dense
          >
            <Stack direction="row" alignItems="center" gap={1}>
              <FolderIcon color="action" fontSize="small" />
              <ListItemText primary={folderName} />
            </Stack>
          </ListItemButton>
        </ListItem>
      );
    },
    [navigateToFolder],
  );

  const renderFileItem = useCallback(
    (fileItem: File) => {
      const supportedImport = checkFileSupportedFunc(fileItem);

      const isSelected = selectedFiles.some((f) => f.file.name === fileItem.name);
      const repeatFile = selectedFiles.find(
        (f) => f.file.sha256 === fileItem.sha256 && f.file.name !== fileItem.name,
      );
      const fileName = fileItem.filename.split("/").pop() ?? fileItem.filename;

      return (
        <ListItem key={fileItem.name} disablePadding>
          <ListItemButton
            disabled={!supportedImport || repeatFile != undefined}
            onClick={() => {
              onFileToggle(fileItem);
            }}
            dense
          >
            <Stack direction="row" alignItems="center" gap={1}>
              <Checkbox
                edge="start"
                checked={isSelected}
                style={{ padding: 0, marginLeft: 0 }}
                disabled={!supportedImport}
                tabIndex={-1}
                disableRipple
                inputProps={{ "aria-labelledby": fileItem.filename }}
              />
              <InsertDriveFileIcon color="action" fontSize="small" />
              <ListItemText
                id={fileItem.name}
                primary={fileName}
                secondary={supportedImport ? undefined : "不支持的文件格式"}
              />
              {repeatFile && (
                <Tooltip
                  title={t("duplicateFile", {
                    ns: "cosPlaylist",
                    filename: repeatFile.file.name,
                  })}
                >
                  <HelpOutlineIcon fontSize="small" color="error" />
                </Tooltip>
              )}
            </Stack>
          </ListItemButton>
        </ListItem>
      );
    },
    [selectedFiles, onFileToggle, checkFileSupportedFunc, t],
  );

  return (
    <Stack fullHeight overflowY="scroll">
      <List>
        {files.map((file) => (
          <>{file.filename.endsWith("/") ? renderFolderItem(file) : renderFileItem(file)}</>
        ))}
      </List>
    </Stack>
  );
}
