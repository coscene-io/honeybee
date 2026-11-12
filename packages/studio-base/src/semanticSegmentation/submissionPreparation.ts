// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { frameInstanceKey } from "./service";
import type { SegmentationDocument, StagedOperation } from "./types";

/** Clone immutable staged data and enumerate CAS scope without a long input-task scan. */
export async function prepareSubmission(
  source: readonly StagedOperation[],
  base: SegmentationDocument,
  onProgress: (fraction: number) => void,
  cancelled: () => boolean,
): Promise<{ operations: StagedOperation[]; expectedVersions: Record<string, number> }> {
  let units = 0;
  let started = performance.now();
  const check = () => {
    if (cancelled()) {
      throw new Error("Submission preparation cancelled");
    }
  };
  const yieldIfNeeded = async (mode: "budget" | "force" = "budget") => {
    check();
    if (mode === "force" || ++units >= 512 || performance.now() - started >= 4) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      check();
      units = 0;
      started = performance.now();
    }
  };
  await yieldIfNeeded("force");
  const operations: StagedOperation[] = [];
  for (const operation of source) {
    const copy: StagedOperation = {
      id: operation.id,
      label: operation.label,
      patch: {},
      expectedVersions: {},
    };
    const pending: { source: object; target: object }[] = [{ source: operation, target: copy }];
    while (pending.length > 0) {
      const node = pending.pop()!;
      const entries: [string, unknown][] = Object.entries(node.source);
      for (const [key, value] of entries) {
        if (value != undefined && typeof value === "object") {
          if (
            !Array.isArray(value) &&
            Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== ReactNull
          ) {
            throw new Error("Unsupported staged data; submission preparation failed");
          }
          const child: object = Array.isArray(value) ? [] : {};
          Object.defineProperty(node.target, key, {
            value: child,
            writable: true,
            configurable: true,
            enumerable: true,
          });
          pending.push({ source: value, target: child });
        } else {
          if (["function", "symbol", "bigint"].includes(typeof value)) {
            throw new Error("Unsupported staged data; submission preparation failed");
          }
          // Keep explicit undefined tombstones; JSON serialization would drop them.
          Object.defineProperty(node.target, key, {
            value,
            writable: true,
            configurable: true,
            enumerable: true,
          });
        }
        await yieldIfNeeded();
      }
      Object.freeze(node.target);
    }
    operations.push(copy);
    if (operations.length % 32 === 0 || operations.length === source.length) {
      onProgress(source.length === 0 ? 1 : (operations.length / source.length) * 0.8);
    }
  }
  const expectedVersions: Record<string, number> = {};
  let baseKeys: string[] | undefined;
  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index]!;
    const keys = new Set([
      ...Object.keys(operation.patch.annotations ?? {}),
      ...Object.keys(operation.patch.polygonChanges ?? {}),
    ]);
    const hasGlobalTargets =
      Object.values(operation.patch.instances ?? {}).some((value) => value == undefined) ||
      Object.keys(operation.patch.instanceMerges ?? {}).length > 0;
    if (hasGlobalTargets) {
      baseKeys ??= [...new Set([...Object.keys(base.versions), ...Object.keys(base.annotations)])];
      for (const key of baseKeys) {
        const pair: unknown = JSON.parse(key);
        if (!Array.isArray(pair) || typeof pair[0] !== "string" || typeof pair[1] !== "string") {
          throw new Error("Invalid frame-instance key during submission preparation");
        }
        const [frameId, instanceId] = pair;
        if (
          (operation.patch.instances &&
            instanceId in operation.patch.instances &&
            !operation.patch.instances[instanceId]) ||
          operation.patch.instanceMerges?.[instanceId]
        ) {
          keys.add(key);
          const target = operation.patch.instanceMerges?.[instanceId];
          if (target) {
            keys.add(frameInstanceKey(frameId, target));
          }
        }
        await yieldIfNeeded();
      }
    }
    for (const key of keys) {
      expectedVersions[key] ??= operation.expectedVersions[key] ?? base.versions[key] ?? 0;
      await yieldIfNeeded();
    }
    if ((index + 1) % 32 === 0 || index + 1 === operations.length) {
      onProgress(0.8 + ((index + 1) / operations.length) * 0.2);
    }
  }
  check();
  Object.freeze(operations);
  return { operations, expectedVersions };
}
