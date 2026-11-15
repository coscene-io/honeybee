// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SegmentationDocument, SegmentationNodeRef } from "../types";

export function polygonInstance(
  document: SegmentationDocument,
  polygonId: string,
): string | undefined {
  return Object.values(document.annotations).find((annotation) =>
    annotation.polygons.some((polygon) => polygon.id === polygonId),
  )?.instanceId;
}

export function nodeInstances(document: SegmentationDocument, node: SegmentationNodeRef): string[] {
  if (node.type === "class") {
    return document.instances
      .filter((instance) => instance.classId === node.id)
      .map((instance) => instance.id);
  }
  if (node.type === "instance") {
    return document.instances.some((instance) => instance.id === node.id) ? [node.id] : [];
  }
  const instanceId = polygonInstance(document, node.id);
  return instanceId ? [instanceId] : [];
}

export function nodeWithinFocus(
  document: SegmentationDocument,
  node: SegmentationNodeRef,
  focus?: SegmentationNodeRef,
): boolean {
  if (!focus) {
    return true;
  }
  if (focus.type === "polygon") {
    return node.type === "polygon" && node.id === focus.id;
  }
  if (focus.type === "instance") {
    return node.type !== "class" && nodeInstances(document, node).every((id) => id === focus.id);
  }
  return node.type === "class"
    ? node.id === focus.id
    : nodeInstances(document, node).every(
        (id) => document.instances.find((instance) => instance.id === id)?.classId === focus.id,
      );
}

/** Reject identity, missing nodes and drops into the source's own subtree. */
export function canDropNode(
  document: SegmentationDocument,
  source: SegmentationNodeRef,
  target: SegmentationNodeRef,
  focus?: SegmentationNodeRef,
): boolean {
  if (!nodeWithinFocus(document, source, focus) || !nodeWithinFocus(document, target, focus)) {
    return false;
  }
  if (source.type === target.type && source.id === target.id) {
    return false;
  }
  const exists = (node: SegmentationNodeRef) =>
    node.type === "class"
      ? document.classes.some((item) => item.id === node.id)
      : node.type === "instance"
        ? document.instances.some((item) => item.id === node.id)
        : polygonInstance(document, node.id) != undefined;
  if (!exists(source) || !exists(target)) {
    return false;
  }
  const sourceIds = nodeInstances(document, source);
  const targetIds = nodeInstances(document, target);
  if (source.type === "class" && sourceIds.length === 0) {
    return false;
  }
  if (target.type !== "class" && targetIds.some((id) => sourceIds.includes(id))) {
    return false;
  }
  if (
    target.type === "class" &&
    source.type !== "class" &&
    sourceIds.every(
      (id) => document.instances.find((item) => item.id === id)?.classId === target.id,
    )
  ) {
    return false;
  }
  return true;
}

/** Parent selections subsume children so one bulk operation never deletes or merges twice. */
export function compactSelection(
  document: SegmentationDocument,
  selection: SegmentationNodeRef[],
): { classes: string[]; instances: string[]; polygons: string[] } {
  const classes = [
    ...new Set(selection.filter((node) => node.type === "class").map((node) => node.id)),
  ];
  const instances = [
    ...new Set(selection.filter((node) => node.type === "instance").map((node) => node.id)),
  ].filter(
    (id) =>
      !document.instances.some(
        (instance) => instance.id === id && classes.includes(instance.classId),
      ),
  );
  const inherited = new Set([
    ...instances,
    ...document.instances
      .filter((instance) => classes.includes(instance.classId))
      .map((instance) => instance.id),
  ]);
  const polygons = [
    ...new Set(selection.filter((node) => node.type === "polygon").map((node) => node.id)),
  ].filter((id) => !inherited.has(polygonInstance(document, id) ?? ""));
  return { classes, instances, polygons };
}

function sameNode(a: SegmentationNodeRef, b: SegmentationNodeRef): boolean {
  return a.type === b.type && a.id === b.id;
}

function nodeChildren(
  document: SegmentationDocument,
  node: SegmentationNodeRef,
  frameId: string | undefined,
): SegmentationNodeRef[] {
  if (node.type === "class") {
    return document.instances
      .filter((instance) => instance.classId === node.id)
      .map((instance) => ({ type: "instance", id: instance.id }));
  }
  if (node.type === "instance") {
    return (
      Object.values(document.annotations)
        .find((annotation) => annotation.frameId === frameId && annotation.instanceId === node.id)
        ?.polygons.map((polygon) => ({ type: "polygon", id: polygon.id })) ?? []
    );
  }
  return [];
}

function nodeParent(
  document: SegmentationDocument,
  node: SegmentationNodeRef,
): SegmentationNodeRef | undefined {
  if (node.type === "class") {
    return undefined;
  }
  if (node.type === "instance") {
    const classId = document.instances.find((instance) => instance.id === node.id)?.classId;
    return classId ? { type: "class", id: classId } : undefined;
  }
  const instanceId = polygonInstance(document, node.id);
  return instanceId ? { type: "instance", id: instanceId } : undefined;
}

export function selectionStatus(
  document: SegmentationDocument,
  node: SegmentationNodeRef,
  selection: SegmentationNodeRef[],
  frameId: string | undefined,
): { checked: boolean; indeterminate: boolean } {
  if (selection.length === 0) {
    return { checked: false, indeterminate: false };
  }
  let ancestor: SegmentationNodeRef | undefined = node;
  while (ancestor) {
    const current = ancestor;
    if (selection.some((item) => sameNode(item, current))) {
      return { checked: true, indeterminate: false };
    }
    ancestor = nodeParent(document, ancestor);
  }
  const children = nodeChildren(document, node, frameId).map((child) =>
    selectionStatus(document, child, selection, frameId),
  );
  return {
    checked: children.length > 0 && children.every((child) => child.checked),
    indeterminate:
      children.some((child) => child.checked || child.indeterminate) &&
      !children.every((child) => child.checked),
  };
}

export function toggleNodeSelection(
  document: SegmentationDocument,
  node: SegmentationNodeRef,
  selection: SegmentationNodeRef[],
  frameId: string | undefined,
): SegmentationNodeRef[] {
  const { checked } = selectionStatus(document, node, selection, frameId);
  const isInside = (candidate: SegmentationNodeRef): boolean => {
    let current: SegmentationNodeRef | undefined = candidate;
    while (current) {
      if (sameNode(current, node)) {
        return true;
      }
      current = nodeParent(document, current);
    }
    return false;
  };
  if (!checked) {
    return [...selection.filter((item) => !isInside(item)), node];
  }
  // Split a selected ancestor into siblings before unchecking just one descendant.
  let result = [...selection];
  const ancestors: SegmentationNodeRef[] = [];
  let current = nodeParent(document, node);
  while (current) {
    ancestors.unshift(current);
    current = nodeParent(document, current);
  }
  for (const ancestor of ancestors) {
    if (result.some((item) => sameNode(item, ancestor))) {
      result = [
        ...result.filter((item) => !sameNode(item, ancestor)),
        ...nodeChildren(document, ancestor, frameId),
      ];
    }
  }
  return result.filter((item) => !isInside(item));
}
