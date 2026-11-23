// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Button, Collapse, Typography } from "@mui/material";
import { useState } from "react";

import { patchAnnotationKeys } from "../service";
import type { SegmentationDocument, StagedOperation } from "../types";

export function OperationScope({
  operation,
  document,
}: {
  operation: StagedOperation;
  document?: SegmentationDocument;
}): React.JSX.Element {
  const scopes = new Set<string>();
  // Names for people; the hover title keeps the stable IDs for support.
  const instanceName = (id: string) => {
    const instance = document?.instances.find((item) => item.id === id);
    const category = document?.classes.find((item) => item.id === instance?.classId);
    return instance ? `${category ? `${category.name} ` : ""}${instance.name}` : id;
  };
  const className = (id: string) => document?.classes.find((item) => item.id === id)?.name ?? id;
  const titles = new Map<string, string>();
  const add = (scope: string, title: string) => {
    scopes.add(scope);
    titles.set(scope, title);
  };
  const addFrame = (frameId: string, instanceId: string) => {
    const frame = document?.frames.find((item) => item.id === frameId);
    add(
      `帧 ${frame ? frame.index + 1 : "?"} · ${instanceName(instanceId)}`,
      `${frameId} · ${instanceId}`,
    );
  };
  // Record-wide deletes and merges also touch frames whose geometry is not loaded.
  for (const key of document ? patchAnnotationKeys(document, operation.patch) : []) {
    const [frameId, instanceId] = JSON.parse(key) as [string, string];
    addFrame(frameId, instanceId);
  }
  for (const annotation of Object.values(operation.patch.annotations ?? {})) {
    if (annotation) {
      addFrame(annotation.frameId, annotation.instanceId);
    }
  }
  for (const change of Object.values(operation.patch.polygonChanges ?? {})) {
    addFrame(change.frameId, change.instanceId);
  }
  for (const id of Object.keys(operation.patch.classes ?? {})) {
    add(`类别 ${className(id)} · 全部帧`, id);
  }
  for (const id of Object.keys(operation.patch.instances ?? {})) {
    add(`实例 ${instanceName(id)} · 全部帧`, id);
  }
  for (const reference of Object.values(operation.patch.momentReferences ?? {})) {
    if (reference) {
      add(
        `一刻引用 · ${reference.targetType === "class" ? className(reference.targetId) : instanceName(reference.targetId)}`,
        `${reference.momentId} · ${reference.targetId}`,
      );
    }
  }
  return (
    <div>
      <Typography variant="body2">类型：{operation.label}</Typography>
      {[...scopes].map((scope) => (
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          key={scope}
          title={titles.get(scope)}
        >
          {scope}
        </Typography>
      ))}
      {scopes.size === 0 && (
        <Typography variant="caption" color="text.secondary" component="p">
          记录 {document?.record.id ?? "未打开"}
        </Typography>
      )}
    </div>
  );
}

/** Large snapshots stay out of the render path until their audit scope is opened. */
export function OperationList({
  operations,
  document,
}: {
  operations: StagedOperation[];
  document?: SegmentationDocument;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button
        size="small"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {open ? "收起修改范围" : "查看批次修改范围"}
      </Button>
      {/* Mounted only while open: large snapshots stay out of the render path. */}
      <Collapse in={open} unmountOnExit>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          {operations.map((operation) => (
            <li key={operation.id}>
              <OperationScope operation={operation} document={document} />
            </li>
          ))}
        </ol>
      </Collapse>
    </div>
  );
}
