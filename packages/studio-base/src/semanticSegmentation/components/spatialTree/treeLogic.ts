// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { WindowedView } from "@foxglove/studio-base/components/Events/WindowedList";

import { polygonsOf } from "../../maskGeometry";
import type { SegmentationSurface } from "../../runtime";
import type { SegmentationDocument, SegmentationFrame, SegmentationNodeRef } from "../../types";
import { canDropNode, compactSelection, nodeInstances, polygonInstance } from "../editorTree";
import type { TreeDialog } from "./treeTypes";

/** Instance and class merges need service support; polygons can always move between instances. */
export function canMergeNodes(
  nodes: readonly SegmentationNodeRef[],
  support: { supportsInstanceMerge: boolean },
): boolean {
  return (
    nodes.length > 0 &&
    (support.supportsInstanceMerge || nodes.every((node) => node.type === "polygon"))
  );
}

export function nodeExists(document: SegmentationDocument, node: SegmentationNodeRef): boolean {
  if (node.type === "class") {
    return document.classes.some((item) => item.id === node.id);
  }
  if (node.type === "instance") {
    return document.instances.some((item) => item.id === node.id);
  }
  return Object.values(document.annotations).some((annotation) =>
    polygonsOf(annotation).some((polygon) => polygon.id === node.id),
  );
}

/**
 * The frames the tree lists: every camera surface of an open session (or the preview frames),
 * else the current frame alone.
 */
export function treeFrameIdsOf(input: {
  sessionOpen: boolean;
  surfaces: Record<string, Pick<SegmentationSurface, "frameId">>;
  previewFrames: Record<string, string | undefined>;
  frameById: ReadonlyMap<string, SegmentationFrame> | undefined;
  currentFrameId: string | undefined;
}): string[] {
  const { sessionOpen, surfaces, previewFrames, frameById, currentFrameId } = input;
  const listed = [
    ...new Set(
      (sessionOpen
        ? Object.values(surfaces).map((surface) => surface.frameId)
        : Object.values(previewFrames)
      ).filter((id): id is string => id != undefined),
    ),
  ].filter((id) => frameById?.has(id) === true);
  if (listed.length > 0) {
    return listed;
  }
  if (!sessionOpen && Object.keys(previewFrames).length > 0) {
    return [];
  }
  return currentFrameId ? [currentFrameId] : [];
}

/** Everything a dialog acts on, whatever its kind. */
export function dialogNodesOf(dialog: TreeDialog | undefined): SegmentationNodeRef[] {
  if (!dialog) {
    return [];
  }
  if (dialog.type === "delete-class") {
    return [{ type: "class", id: dialog.id }];
  }
  return dialog.type === "merge" || dialog.type === "delete" ? dialog.nodes : [dialog.node];
}

/** Instances a delete or merge touches, directly, through polygons, or through their class. */
export function affectedInstancesOf(
  document: SegmentationDocument,
  affected: ReturnType<typeof compactSelection>,
): string[] {
  return [
    ...new Set([
      ...affected.instances,
      ...affected.polygons.flatMap((id) => {
        const owner = polygonInstance(document, id);
        return owner ? [owner] : [];
      }),
      ...document.instances
        .filter((instance) => affected.classes.includes(instance.classId))
        .map((instance) => instance.id),
    ]),
  ];
}

/** Instance ids a set of nodes stands for: its instances plus those of its classes. */
export function instancesOfCompact(
  document: SegmentationDocument,
  compact: ReturnType<typeof compactSelection>,
): string[] {
  return [
    ...compact.instances,
    ...document.instances
      .filter((instance) => compact.classes.includes(instance.classId))
      .map((instance) => instance.id),
  ];
}

/** The instance merges and polygon merges one merge into `targetInstanceId` needs. */
export function mergePlan(
  document: SegmentationDocument,
  nodes: SegmentationNodeRef[],
  targetInstanceId: string,
): { instances: string[]; polygons: string[] } {
  const compact = compactSelection(document, nodes);
  return {
    instances: instancesOfCompact(document, compact).filter((id) => id !== targetInstanceId),
    polygons: compact.polygons.filter((id) => polygonInstance(document, id) !== targetInstanceId),
  };
}

/** Instances a merge dialog may merge into: not the sources, and reachable by the dragged node. */
export function mergeTargetsOf(
  document: SegmentationDocument | undefined,
  dialog: TreeDialog | undefined,
  dragSource: SegmentationNodeRef | undefined,
  focus: SegmentationNodeRef | undefined,
): SegmentationDocument["instances"] {
  if (!document || dialog?.type !== "merge") {
    return [];
  }
  return document.instances.filter(
    (instance) =>
      !dialog.nodes.some((node) => node.type === "instance" && node.id === instance.id) &&
      (!dragSource ||
        canDropNode(document, dragSource, { type: "instance", id: instance.id }, focus)),
  );
}

/** The class a node belongs to (the node itself for a class). */
export function classOfNode(
  document: SegmentationDocument,
  node: SegmentationNodeRef,
): string | undefined {
  return node.type === "class"
    ? node.id
    : document.instances.find((instance) => instance.id === nodeInstances(document, node)[0])
        ?.classId;
}

/** Classes a move dialog offers: not the current one, and reachable by the dragged node. */
export function moveTargetsOf(
  document: SegmentationDocument,
  node: SegmentationNodeRef,
  dragSource: SegmentationNodeRef | undefined,
  focus: SegmentationNodeRef | undefined,
): SegmentationDocument["classes"] {
  return document.classes.filter(
    (category) =>
      classOfNode(document, node) !== category.id &&
      (!dragSource || canDropNode(document, dragSource, { type: "class", id: category.id }, focus)),
  );
}

/** Whether the dialog's targets still exist in the (possibly replaced) document. */
export function dialogStillValid(
  document: SegmentationDocument,
  dialog: TreeDialog,
  nodes: readonly SegmentationNodeRef[],
  target: string,
): boolean {
  return (
    nodes.every((node) => nodeExists(document, node)) &&
    !(dialog.type === "merge" && !nodeExists(document, { type: "instance", id: target })) &&
    !(dialog.type === "move" && !nodeExists(document, { type: "class", id: target }))
  );
}

export type DialogTitleKey =
  | "renameClass"
  | "renameInstance"
  | "mergeIntoInstanceTitle"
  | "moveClassTitle"
  | "deleteClassAllInstances"
  | "deleteSelectedAnnotations";

export function dialogTitleKey(dialog: TreeDialog | undefined): DialogTitleKey {
  switch (dialog?.type) {
    case "rename":
      return dialog.node.type === "class" ? "renameClass" : "renameInstance";
    case "merge":
      return "mergeIntoInstanceTitle";
    case "move":
      return "moveClassTitle";
    case "delete-class":
      return "deleteClassAllInstances";
    default:
      return "deleteSelectedAnnotations";
  }
}

/** Indentation and level guide lines for a row at `level` (1 = no indentation). */
export function indentStyle(level: number, guideColor: string): React.CSSProperties | undefined {
  if (level <= 1) {
    return undefined;
  }
  const depths = Array.from({ length: level - 1 }, (_, depth) => depth);
  return {
    paddingLeft: 25 * (level - 1),
    backgroundRepeat: "no-repeat",
    backgroundSize: "1px 100%",
    backgroundPosition: depths.map((depth) => `${12 + 25 * depth}px 0`).join(", "),
    backgroundImage: depths.map(() => `linear-gradient(${guideColor}, ${guideColor})`).join(", "),
  };
}

type PinnableRow = { classRow: number; instanceRow?: number };

/** The class and instance rows owning the first visible row, which stay pinned while scrolled. */
export function pinnedRowsOf(rows: readonly PinnableRow[], view: WindowedView): number[] {
  const pinned: number[] = [];
  const { scrollOffset, offsetOf } = view;
  if (scrollOffset <= 0 || rows.length === 0) {
    return pinned;
  }
  let firstVisible = Math.min(view.startIndex, rows.length - 1);
  while (firstVisible < rows.length - 1 && offsetOf(firstVisible + 1) <= scrollOffset) {
    firstVisible++;
  }
  const owner = rows[firstVisible]!;
  if (offsetOf(owner.classRow) < scrollOffset) {
    pinned.push(owner.classRow);
  }
  const classHeight = offsetOf(owner.classRow + 1) - offsetOf(owner.classRow);
  if (owner.instanceRow != undefined && offsetOf(owner.instanceRow) < scrollOffset + classHeight) {
    pinned.push(owner.instanceRow);
  }
  return pinned;
}

/** One character per frame around the current one: `.` outside the video, `1` present, `0` absent. */
export function presenceCellsOf(
  currentIndex: number,
  frameAt: (index: number) => { id: string } | undefined,
  hasGeometry: (frameId: string) => boolean,
): string {
  return Array.from({ length: 41 }, (_, cell) => {
    const adjacent = frameAt(currentIndex + cell - 20);
    if (!adjacent) {
      return ".";
    }
    return hasGeometry(adjacent.id) ? "1" : "0";
  }).join("");
}
