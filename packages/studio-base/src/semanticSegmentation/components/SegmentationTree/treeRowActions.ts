// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { DragEvent, KeyboardEvent, MouseEvent } from "react";

import type { SegmentationNodeRef } from "../../types";

/** Handlers a tree row calls. The object and its members keep their identity across renders. */
export type TreeRowActions = {
  choose: (node: SegmentationNodeRef) => void;
  toggleCollapsed: (key: string) => void;
  /** The "+" button: adds an instance to a class, or starts annotating an instance. */
  add: (node: SegmentationNodeRef) => void;
  deletePolygon: (id: string) => void;
  openMenu: (node: SegmentationNodeRef, x: number, y: number) => void;
  dragStart: (event: DragEvent<HTMLElement>, node: SegmentationNodeRef) => void;
  dragEnd: (event: DragEvent<HTMLElement>) => void;
  dragOver: (event: DragEvent<HTMLElement>, node: SegmentationNodeRef, label: string) => void;
  dragLeave: (event: DragEvent<HTMLElement>) => void;
  drop: (event: DragEvent<HTMLElement>, node: SegmentationNodeRef) => void;
  editPolygon: (event: MouseEvent<HTMLElement>, node: SegmentationNodeRef) => void;
  enterKey: (event: KeyboardEvent<HTMLElement>, node: SegmentationNodeRef) => void;
  activate: () => void;
};
