// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this

import { createContext } from "react";
import { StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";

// file, You can obtain one at http://mozilla.org/MPL/2.0/
export type UploadStatus = "canceled" | "failed" | "queued" | "succeeded" | "uploading";

export type UploadFileInfo = {
  abortController?: AbortController;
  fileBlob: File;
  progress?: number;
  status: UploadStatus;
  target: {
    recordTitle: string;
  };
  url: string;
};

export type UploadFilesStore = {
  currentFile: File | undefined;

  uploadingFiles: Record<string, UploadFileInfo>;

  setCurrentFile: (file: File | undefined) => void;

  setUpdateUploadingFiles: (name: string, info: UploadFileInfo) => void;
};

export const UploadFilesContext = createContext<undefined | StoreApi<UploadFilesStore>>(undefined);

export function useUploadFiles<T>(selector: (store: UploadFilesStore) => T): T {
  const context = useGuaranteedContext(UploadFilesContext);

  return useStore(context, selector);
}
