// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Label } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/label_pb";

export type FileCandidate = {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: string; // ISO string
  kind: "recorded" | "other";
  note?: string; // 记录故障点时的备注（recorded 才会带）
};

// 新增：Bag文件信息
export type BagFile = {
  mode: string; // "imd" | "signal" | ""
  action_name: string; // action名称，可能为空
  path: string; // 文件路径
  type: "file" | "folder"; // 文件类型，必需字段，后端明确标识
};

// 新增：获取Bag列表的请求
export type GetBagListReq = {
  mode: string; // "" | "imd" | "signal"
  action_name: string; // "" 或具体的action名称
};

// 新增：获取Bag列表的响应
export type GetBagListRsp = {
  code: number;
  msg: string;
  bags: BagFile[];
};

// 新增：提交文件的请求
export type SubmitFilesReq = {
  paths: string[];
};

// 新增：通用响应
export type CommonRsp = {
  code: number;
  msg: string;
};

// 新增：获取上传状态响应
export type GetUploadAllowedRsp = {
  upload_allowed: boolean;
  msg: string;
};

export type UploadConfig = {
  projectId: string | null;
  addTags: boolean;
  tags: Label[];
  device?: { name: string; [key: string]: any } | string;
};

export type LogLine = { id: string; ts: string; level: "info" | "warn" | "error"; msg: string };

export interface CoSceneClient {
  listProjects(): Promise<{ id: string; name: string }[]>;
  listTags(projectId: string): Promise<Label[]>;
  upload(
    files: FileCandidate[],
    cfg: Partial<UploadConfig> & { projectId: string | null },
    onProgress?: (p: number) => void,
  ): Promise<{ taskName?: string; recordName?: string; success: boolean }>;
}
