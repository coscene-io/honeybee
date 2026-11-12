// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useState } from "react";

import type { SegmentationDocument, StagedOperation } from "../types";

export function OperationScope({
  operation,
  document,
}: {
  operation: StagedOperation;
  document?: SegmentationDocument;
}): React.JSX.Element {
  const scopes = new Set<string>();
  const addFrame = (frameId: string, instanceId: string) => {
    const frame = document?.frames.find((item) => item.id === frameId);
    scopes.add(`帧 ${frame ? `${frame.index + 1} [${frameId}]` : frameId} · 实例 ${instanceId}`);
  };
  for (const key of Object.keys(operation.expectedVersions)) {
    try {
      const value: unknown = JSON.parse(key);
      if (Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "string") {
        addFrame(value[0], value[1]);
      }
    } catch {
      /* Legacy keys have no decoded frame identity. */
    }
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
    scopes.add(`类别 ${id} · 记录范围`);
  }
  for (const id of Object.keys(operation.patch.instances ?? {})) {
    scopes.add(`实例 ${id} · 记录范围`);
  }
  for (const reference of Object.values(operation.patch.momentReferences ?? {})) {
    if (reference) {
      scopes.add(`一刻 ${reference.momentId} · ${reference.targetType} ${reference.targetId}`);
    }
  }
  return (
    <div>
      <strong>类型：{operation.label}</strong>
      {[...scopes].map((scope) => (
        <p className="seg-muted" key={scope}>
          {scope}
        </p>
      ))}
      {scopes.size === 0 && <p className="seg-muted">记录 {document?.record.id ?? "未打开"}</p>}
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
    <details
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>查看批次修改范围</summary>
      {open && (
        <>
          <ol>
            {operations.map((operation) => (
              <li key={operation.id}>
                <OperationScope operation={operation} document={document} />
              </li>
            ))}
          </ol>
          <details>
            <summary>查看冻结操作快照</summary>
            <pre>{JSON.stringify(operations, undefined, 2)}</pre>
          </details>
        </>
      )}
    </details>
  );
}
