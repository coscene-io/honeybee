// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { TFunction } from "i18next";

import { TreeNote } from "./PresenceStrip";
import { TreeRow } from "./TreeRow";
import { presenceCellsOf } from "./treeLogic";
import type { TreeRowActions } from "./treeRowActions";
import type { FlatTreeRow } from "./treeTypes";
import { nodeWithinFocus, selectionStatus } from "../../editorTree";
import { polygonsOf, summaryHasGeometry } from "../../maskGeometry";
import { segmentationCanvasLabel } from "../../segmentationChrome";
import { frameInstanceKey } from "../../service";
import type { SourceFrameLoaders } from "../../sourceFrames";
import type { FrameIndex } from "../../spatialTreeIndex";
import { instancesByClass } from "../../spatialTreeIndex";
import type {
  SegmentationClass,
  SegmentationDocument,
  SegmentationInstance,
  SegmentationNodeRef,
} from "../../types";
import { CameraFrameStrip, cameraStripVisible } from "../CameraFrameStrip";

/** Everything the flat row list reads. Only rows near the viewport actually render. */
export type RowContext = {
  document: SegmentationDocument;
  sourceFrames: SourceFrameLoaders;
  index: FrameIndex;
  t: TFunction<"segmentation">;
  treeFrameIds: string[];
  overview: boolean;
  collapsed: string[];
  currentFrameId: string | undefined;
  drawing: boolean;
  disabled: boolean;
  locked: boolean;
  selection: SegmentationNodeRef[];
  focus: SegmentationNodeRef | undefined;
  selecting: boolean;
  dragSource: SegmentationNodeRef | undefined;
  dropTarget: string | undefined;
  hintId: string;
  actions: TreeRowActions;
};

type RowSpec = {
  node: SegmentationNodeRef;
  label: string;
  color: string;
  detail: string;
  level: number;
  presence?: "present" | "absent";
  strip?: string;
  stripName?: string;
};

function rowElement(ctx: RowContext, spec: RowSpec): React.JSX.Element {
  const { node } = spec;
  const { checked, indeterminate } = selectionStatus(
    ctx.document,
    node,
    ctx.selection,
    ctx.currentFrameId,
  );
  const key = `${node.type}:${node.id}`;
  const isDrop = ctx.dropTarget === key;
  return (
    <TreeRow
      key={key}
      {...spec}
      selected={checked}
      indeterminate={indeterminate}
      focused={ctx.focus?.id === node.id && ctx.focus.type === node.type}
      collapsed={ctx.collapsed.includes(key)}
      isDrop={isDrop}
      opacity={ctx.dragSource?.id === node.id ? (ctx.dropTarget ? 0.25 : 0.55) : 1}
      withinFocus={nodeWithinFocus(ctx.document, node, ctx.focus)}
      selecting={ctx.selecting}
      locked={ctx.locked}
      disabled={ctx.disabled}
      hintId={ctx.hintId}
      actions={ctx.actions}
    />
  );
}

function hasGeometryOf(document: SegmentationDocument) {
  return (frameId: string, instanceId: string): boolean =>
    summaryHasGeometry(document.annotationSummaries[frameInstanceKey(frameId, instanceId)]);
}

/** The instance's geometry summary and the presence-around-this-frame strip (single video). */
function instanceSpec(
  ctx: RowContext,
  category: SegmentationClass,
  instance: SegmentationInstance,
): RowSpec {
  const { document, index, t, treeFrameIds, currentFrameId } = ctx;
  const hasGeometry = hasGeometryOf(document);
  const isPresent = treeFrameIds.some((id) => hasGeometry(id, instance.id));
  const base = {
    node: { type: "instance", id: instance.id } as const,
    label: `${isPresent ? "●" : "○"} ${instance.name || instance.id}`,
    color: category.color,
    level: 2,
    presence: isPresent ? ("present" as const) : ("absent" as const),
  };
  const visible = treeFrameIds.flatMap((id) => {
    const item = document.annotations[frameInstanceKey(id, instance.id)];
    return item ? [item] : [];
  });
  if (ctx.overview) {
    const polygonCount = visible.reduce((sum, item) => sum + polygonsOf(item).length, 0);
    const hasMask = visible.some((item) => item.kind === "mask");
    const geometry =
      polygonCount === 0 && hasMask
        ? t("geometryMask")
        : t(hasMask ? "geometryPolygonsAndMask" : "geometryPolygons", { count: polygonCount });
    return {
      ...base,
      detail: t("instanceOverviewSummary", { camerasPresent: visible.length, geometry }),
    };
  }
  // A single video, with a presence row around the current frame.
  const annotation =
    currentFrameId == undefined
      ? undefined
      : document.annotations[frameInstanceKey(currentFrameId, instance.id)];
  const currentFrame =
    currentFrameId == undefined ? undefined : index.frameById.get(currentFrameId);
  const videoFrames = currentFrame ? (index.framesOfVideo.get(currentFrame.videoId) ?? []) : [];
  const byIndex = currentFrame ? index.frameByVideoIndex.get(currentFrame.videoId) : undefined;
  return {
    ...base,
    detail: t("instanceFrameSummary", {
      framesPresent: videoFrames.filter((item) => hasGeometry(item.id, instance.id)).length,
      videoFramesCount: videoFrames.length,
      geometry:
        annotation?.kind === "mask"
          ? t("geometryMask")
          : t("geometryPolygons", { count: polygonsOf(annotation).length }),
    }),
    strip: presenceCellsOf(
      currentFrame?.index ?? 0,
      (position) => byIndex?.get(position),
      (frameId) => hasGeometry(frameId, instance.id),
    ),
    stripName: instance.name,
  };
}

/** Polygon rows and camera strips of one instance, per listed frame. */
function pushFrameRows(
  ctx: RowContext,
  rows: FlatTreeRow[],
  category: SegmentationClass,
  instance: SegmentationInstance,
  owner: { classRow: number; instanceRow: number },
): void {
  const { document, index, t, treeFrameIds } = ctx;
  for (const id of treeFrameIds) {
    const frame = index.frameById.get(id);
    const video = frame ? index.videoById.get(frame.videoId) : undefined;
    const camera = segmentationCanvasLabel(video?.topic ?? video?.name);
    const polygons = polygonsOf(document.annotations[frameInstanceKey(id, instance.id)]);
    polygons.forEach((polygon, position) => {
      rows.push({
        key: `polygon:${instance.id}:${id}:${polygon.id}`,
        kind: "polygon",
        level: 3,
        ...owner,
        render: () =>
          rowElement(ctx, {
            node: { type: "polygon", id: polygon.id },
            label:
              treeFrameIds.length > 1
                ? t("cameraPolygonLabel", { camera, positionNumber: position + 1 })
                : t("polygonLabel", { positionNumber: position + 1 }),
            color: category.color,
            detail: t("vertexCount", { pointsCount: polygon.points.length }),
            level: 3,
          }),
      });
    });
    if (ctx.overview && cameraStripVisible(document, instance.id, id, ctx.sourceFrames)) {
      rows.push({
        key: `strip:${instance.id}:${id}`,
        kind: "strip",
        level: 3,
        ...owner,
        render: () => (
          <CameraFrameStrip
            document={document}
            instanceId={instance.id}
            frameId={id}
            camera={camera}
            color={category.color}
            disabled={ctx.disabled || ctx.drawing}
            sourceFrames={ctx.sourceFrames}
          />
        ),
      });
    }
  }
}

function pushInstanceRows(
  ctx: RowContext,
  rows: FlatTreeRow[],
  category: SegmentationClass,
  instance: SegmentationInstance,
  classRow: number,
): void {
  const instanceRow = rows.length;
  const instanceKey = `instance:${instance.id}`;
  rows.push({
    key: instanceKey,
    kind: "instance",
    level: 2,
    classRow,
    instanceRow,
    render: () => rowElement(ctx, instanceSpec(ctx, category, instance)),
  });
  if (ctx.collapsed.includes(instanceKey)) {
    return;
  }
  pushFrameRows(ctx, rows, category, instance, { classRow, instanceRow });
  // A mask is presence too; only an instance with neither on any shown frame is absent.
  const camerasPresent = ctx.treeFrameIds.filter(
    (id) => ctx.document.annotations[frameInstanceKey(id, instance.id)] != undefined,
  ).length;
  if (camerasPresent === 0) {
    rows.push({
      key: `absent:${instance.id}`,
      kind: "note",
      level: 3,
      classRow,
      instanceRow,
      render: () => <TreeNote kind="emptyInstance" text={ctx.t("absentCurrentFrame")} />,
    });
  }
}

function pushClassRows(
  ctx: RowContext,
  rows: FlatTreeRow[],
  category: SegmentationClass,
  instances: readonly SegmentationInstance[],
): void {
  const { document, t, treeFrameIds } = ctx;
  const hasGeometry = hasGeometryOf(document);
  const classRow = rows.length;
  const classKey = `class:${category.id}`;
  const present = instances.filter((instance) =>
    treeFrameIds.some((id) => hasGeometry(id, instance.id)),
  ).length;
  rows.push({
    key: classKey,
    kind: "class",
    level: 1,
    classRow,
    render: () =>
      rowElement(ctx, {
        node: { type: "class", id: category.id },
        label: category.name,
        color: category.color,
        detail: t("classPresenceSummary", { present, instancesCount: instances.length }),
        level: 1,
      }),
  });
  if (ctx.collapsed.includes(classKey)) {
    return;
  }
  if (instances.length === 0) {
    rows.push({
      key: `empty:${category.id}`,
      kind: "note",
      level: 2,
      classRow,
      render: () => <TreeNote kind="emptyClass" text={t("noInstancesUseAddOne")} />,
    });
  }
  for (const instance of instances) {
    pushInstanceRows(ctx, rows, category, instance, classRow);
  }
}

/**
 * The tree as a flat list. Only the rows in or near the viewport call `render`, so building the
 * list stays cheap: per-row work is lookups in the frame index and cached strip cells.
 */
export function buildFlatRows(ctx: RowContext): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];
  const grouped = instancesByClass(ctx.document.instances);
  for (const category of ctx.document.classes) {
    pushClassRows(ctx, rows, category, grouped.get(category.id) ?? []);
  }
  return rows;
}
