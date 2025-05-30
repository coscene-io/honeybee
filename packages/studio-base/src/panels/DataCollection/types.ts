// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Project } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/project_pb";

export type ButtonType = "startCollection" | "endCollection" | "cancelCollection";

type State = {
  status: "requesting" | "error" | "success";
  value: string;
};

export type CollectionStage = "ready" | "collecting";

export type ButtonsState = {
  [key in ButtonType]: State | undefined;
};

export type Config = {
  projectName?: string;
  recordLabels?: string[];
  buttons: {
    [key in ButtonType]: {
      serviceName?: string;
      requestPayload: string;
      showRequest: boolean;
      color: string;
    };
  };
  displayCollectionLog: boolean;
};

export type StartCollectionResponse = {
  success: boolean;
  message: string;
};

export type EndCollectionResponse = {
  success: boolean;
  message: string;
  type: "NORMAL" | "SKIP_CAPTURE";
  record_name?: string;
  tags: string[];
  files: string[];
};

export type CancelCollectionResponse = {
  success: boolean;
  message: string;
};

export type TaskInfoSnapshot = {
  project: Project;
  recordLabels: string[];
  startTime: string;
};

export type PanelState = "SOURCE_TYPE_NOT_SUPPORTED" | "NOT_LOGIN" | "LOADING" | "NOMAL";
