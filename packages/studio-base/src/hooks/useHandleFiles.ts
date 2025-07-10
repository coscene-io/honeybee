// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useSnackbar } from "notistack";
import { extname } from "path";
import React, { useCallback, useLayoutEffect, useRef } from "react";

import Logger from "@foxglove/log";
import {
  FOXGLOVE_EXTENSION_SUFFIX,
  COSCENE_EXTENSION_SUFFIX,
} from "@foxglove/studio-base/constants/extensionKeys";
import { useExtensionCatalog } from "@foxglove/studio-base/context/ExtensionCatalogContext";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";

const log = Logger.getLogger(__filename);

// Extension file types
const EXTENSION_FILE_TYPES = [FOXGLOVE_EXTENSION_SUFFIX, COSCENE_EXTENSION_SUFFIX] as const;

export function useHandleFiles(): {
  openHandle: (handle: FileSystemFileHandle) => Promise<void>;
  openFiles: (files: File[]) => Promise<void>;
  dropHandler: (event: { files?: File[]; handles?: FileSystemFileHandle[] }) => void;
  handleFilesRef: React.MutableRefObject<(files: File[]) => Promise<void>>;
} {
  const { enqueueSnackbar } = useSnackbar();
  const { availableSources, selectSource } = usePlayerSelection();
  const installExtension = useExtensionCatalog((state) => state.installExtension);

  // Check if file is an extension file
  const isExtensionFile = useCallback((fileName: string): boolean => {
    return EXTENSION_FILE_TYPES.some((ext) => fileName.endsWith(ext));
  }, []);

  // Handle extension file installation
  const handleExtensionFile = useCallback(
    async (file: File): Promise<void> => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const extension = await installExtension("local", data);
        enqueueSnackbar(`Installed extension ${extension.id}`, { variant: "success" });
      } catch (err) {
        log.error(err);
        enqueueSnackbar(`Failed to install extension ${file.name}: ${err.message}`, {
          variant: "error",
        });
      }
    },
    [enqueueSnackbar, installExtension],
  );

  // Find matching data source
  const findMatchingSource = useCallback(
    (fileName: string) => {
      const ext = extname(fileName);
      return availableSources.find((source) => source.supportedFileTypes?.includes(ext));
    },
    [availableSources],
  );

  // Handle single data file (for handle method)
  const handleSingleDataFile = useCallback(
    (file: File, handle: FileSystemFileHandle) => {
      const matchedSource = findMatchingSource(file.name);
      if (matchedSource) {
        selectSource(matchedSource.id, { type: "file", handle });
      }
    },
    [findMatchingSource, selectSource],
  );

  // Handle multiple data files (for files method)
  const handleMultipleDataFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      for (const source of availableSources) {
        const filteredFiles = files.filter((file) => {
          const ext = extname(file.name);
          return source.supportedFileTypes?.includes(ext);
        });

        if (filteredFiles.length > 0) {
          selectSource(source.id, { type: "file", files });
          break;
        }
      }
    },
    [availableSources, selectSource],
  );

  const openHandle = useCallback(
    async (
      handle: FileSystemFileHandle /* foxglove-depcheck-used: @types/wicg-file-system-access */,
    ) => {
      log.debug("open handle", handle);
      const file = await handle.getFile();

      if (isExtensionFile(file.name)) {
        await handleExtensionFile(file);
        return;
      }

      // Handle data file
      handleSingleDataFile(file, handle);
    },
    [handleSingleDataFile, handleExtensionFile, isExtensionFile],
  );

  const openFiles = useCallback(
    async (files: File[]) => {
      const otherFiles: File[] = [];
      log.debug("open files", files);

      // Process all files
      for (const file of files) {
        if (isExtensionFile(file.name)) {
          await handleExtensionFile(file);
        } else {
          otherFiles.push(file);
        }
      }

      // Handle non-extension files
      handleMultipleDataFiles(otherFiles);
    },
    [handleExtensionFile, handleMultipleDataFiles, isExtensionFile],
  );

  const dropHandler = useCallback(
    (event: { files?: File[]; handles?: FileSystemFileHandle[] }) => {
      log.debug("drop event", event);
      const handle = event.handles?.[0];
      // When selecting sources with handles we can only select with a single handle since we haven't
      // written the code to store multiple handles for recents. When there are multiple handles, we
      // fall back to opening regular files.
      if (handle && event.handles?.length === 1) {
        void openHandle(handle);
      } else if (event.files) {
        void openFiles(event.files);
      }
    },
    [openFiles, openHandle],
  );

  // Store stable reference to avoid re-running effects unnecessarily
  const handleFilesRef = useRef<typeof openFiles>(openFiles);
  useLayoutEffect(() => {
    handleFilesRef.current = openFiles;
  }, [openFiles]);

  return {
    openHandle,
    openFiles,
    dropHandler,
    handleFilesRef,
  };
}
