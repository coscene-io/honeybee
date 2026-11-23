// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SegmentationNodeRef } from "../../types";

export type FlatTreeRow = {
  key: string;
  kind: "class" | "instance" | "polygon" | "strip" | "note";
  level: number;
  /** Rows of the owning class and instance, which stay pinned while this row is at the top. */
  classRow: number;
  instanceRow?: number;
  render: () => React.ReactNode;
};

/** Heights used until a row has been measured once. */
export const ROW_ESTIMATE: Record<FlatTreeRow["kind"], number> = {
  class: 46,
  instance: 46,
  polygon: 46,
  strip: 16,
  note: 20,
};

export type TreeDialog =
  | { type: "rename"; node: SegmentationNodeRef }
  | { type: "merge"; nodes: SegmentationNodeRef[] }
  | { type: "move"; node: SegmentationNodeRef }
  | { type: "delete"; nodes: SegmentationNodeRef[] }
  | { type: "delete-class"; id: string };

/** Operation labels shown in the submission queue for each tree dialog. */
export const dialogOperationLabels: Record<TreeDialog["type"], string> = {
  rename: "Rename",
  merge: "Merge instances",
  move: "Move instances",
  delete: "Delete",
  "delete-class": "Delete class",
};

export type TreeMenu = { node: SegmentationNodeRef; x: number; y: number };

/** Remembers the view a drag or dialog started in, so a stale one can be rejected. */
export type TreeContext = { key: string; document: unknown };
