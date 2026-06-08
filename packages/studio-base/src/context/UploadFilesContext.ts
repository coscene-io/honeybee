// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this

import { Project } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/project_pb";
import { Record as RecordProto } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/record_pb";
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
    record: RecordProto;
    project: Project;
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
