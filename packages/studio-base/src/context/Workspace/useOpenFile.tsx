// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import path from "path";
import { useCallback, useMemo } from "react";

import type { IDataSourceFactory } from "@foxglove/studio-base/context/PlayerSelectionContext";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";
import showOpenFilePicker from "@foxglove/studio-base/util/showOpenFilePicker";

/** Read-only selection works even when File System Access is unavailable. */
async function pickInputFile(extensions: readonly string[]): Promise<File | undefined> {
  return await new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = extensions.join(",");
    input.style.display = "none";
    const finish = (file: File | undefined) => {
      input.remove();
      resolve(file);
    };
    input.onchange = () => {
      finish(input.files?.[0]);
    };
    input.oncancel = () => {
      finish(undefined);
    };
    document.body.appendChild(input);
    try {
      input.click();
    } catch (error) {
      input.remove();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function useOpenFile(sources: readonly IDataSourceFactory[]): () => Promise<void> {
  const { selectSource } = usePlayerSelection();

  const allExtensions = useMemo(() => {
    const extensions = sources.reduce<string[]>((all, source) => {
      if (!source.supportedFileTypes) {
        return all;
      }
      return [...all, ...source.supportedFileTypes];
    }, []);
    return [...new Set(extensions)].filter(
      (extension): extension is `.${string}` => extension.startsWith(".") && extension.length > 1,
    );
  }, [sources]);

  return useCallback(async () => {
    let fileHandle: FileSystemFileHandle | undefined;
    let file: File | undefined;
    if (typeof window.showOpenFilePicker === "function") {
      [fileHandle] = await showOpenFilePicker({
        types: [
          {
            description: allExtensions.join(", "),
            accept: { "application/octet-stream": allExtensions },
          },
        ],
      });
      file = await fileHandle?.getFile();
    } else {
      file = await pickInputFile(allExtensions);
    }
    if (!file) {
      return;
    }

    const extension = path.extname(file.name);
    // Find the first _file_ source which can load our extension
    const matchingSources = sources.filter((source) => {
      // Only consider _file_ type sources that have a list of supported file types
      if (!source.supportedFileTypes || source.type !== "file") {
        return false;
      }

      return source.supportedFileTypes.includes(extension);
    });

    if (matchingSources.length > 1) {
      throw new Error(`Multiple source matched ${file.name}. This is not supported.`);
    }

    const foundSource = matchingSources[0];
    if (!foundSource) {
      throw new Error(`Cannot find source to handle ${file.name}`);
    }

    selectSource(
      foundSource.id,
      fileHandle ? { type: "file", handle: fileHandle } : { type: "file", files: [file] },
    );
  }, [allExtensions, selectSource, sources]);
}
