// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";
import { Record } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/record_pb";
import { File } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/file_pb";

// Chooser mode definitions
export type ChooserMode =
  | "select-files-from-record" // Project → Record → Files (select)
  | "select-record" // Project → Record (select)
  | "create-record" // Project → Record (create)
  | "select-files-from-project"; // Project → Files (cross-record selection)

export interface SelectedFile {
  file: File;
  projectDisplayName: string;
  recordDisplayName: string;
  isRepeatFile?: boolean;
}

export type ListType = "projects" | "records" | "files";

export interface PaginationState {
  page: number;
  pageSize: number;
  filter: string;
}

// Base chooser properties
export interface BaseChooserProps {
  mode: ChooserMode;
  setTargetInfo: (params: { record?: Record; project?: Project; isCreating?: boolean }) => void;
  files: SelectedFile[];
  setFiles: (files: SelectedFile[]) => void;
  checkFileSupportedFunc?: (file: File) => boolean;
  defaultRecordName?: string;
  createRecordConfirmText?: string;
}

// Base dialog properties
interface BaseDialogProps {
  open: boolean;
  closeDialog: () => void;
  backdropAnimation?: boolean;
}

// Dialog properties - internal properties are optional, managed by dialog internally
export type ChooserDialogProps = BaseDialogProps & {
  checkFileSupportedFunc?: (file: File) => boolean;
  dialogTitle?: string;
} & (
    | {
        mode: "select-record" | "create-record";
        onConfirm: (record: Record, project: Project) => void;
        maxFilesNumber?: undefined;
      }
    | {
        mode: "select-files-from-record" | "select-files-from-project";
        onConfirm: (files: SelectedFile[]) => void;
        maxFilesNumber?: number;
      }
  );

// Breadcrumb navigation properties
export interface CustomBreadcrumbsProps {
  project?: Project;
  clearProject: () => void;
  record?: Record;
  clearRecord: () => void;
  mode: ChooserMode;
  setRecordType: (type: "create" | "select") => void;
  // expand breadcrumb to support folder navigation
  currentFolderPath?: readonly string[];
  onNavigateToFolder?: (path: readonly string[]) => void;
  listType: ListType;
}
