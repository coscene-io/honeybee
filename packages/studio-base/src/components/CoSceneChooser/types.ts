// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { Record } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/record_pb";
import { File } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/file_pb";

export type ChooserDialogProps =
  | {
      open: boolean;
      closeDialog: () => void;
      onConfirm: (record: Record, project: Project) => void;
      backdropAnimation?: boolean;
      type: "record";
      checkFileSupportedFunc?: undefined;
      maxFilesNumber?: undefined;
    }
  | {
      open: boolean;
      closeDialog: () => void;
      onConfirm: (files: SelectedFile[]) => void;
      backdropAnimation?: boolean;
      checkFileSupportedFunc?: (file: File) => boolean;
      type: "files";
      maxFilesNumber?: number;
    };

export interface SelectedFile {
  file: File;
  projectDisplayName: string;
  recordDisplayName: string;
  isRepeatFile?: boolean;
}

export type ListType = "projects" | "records" | "files";
export type RecordType = "create" | "select";

export interface PaginationState {
  page: number;
  pageSize: number;
  filter: string;
}

export interface ChooserComponentProps {
  setTargetInfo: (params: { record?: Record; project?: Project; recordType?: RecordType }) => void;
  files: SelectedFile[];
  setFiles: (files: SelectedFile[]) => void;
  type: "record" | "files";
  checkFileSupportedFunc: (file: File) => boolean;
  defaultRecordType?: RecordType;
  defaultRecordName?: string;
  createRecordConfirmText?: string;
}

export interface FilesListProps {
  files: SelectedFile[];
  setFiles: (files: SelectedFile[]) => void;
}

export interface CustomBreadcrumbsProps {
  project?: Project;
  clearProject: () => void;
  record?: Record;
  clearRecord: () => void;
  type: "record" | "files";
  recordType: RecordType;
  setRecordType: (recordType: RecordType) => void;
}
