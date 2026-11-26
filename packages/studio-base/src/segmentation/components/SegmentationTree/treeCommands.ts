// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  canMergeNodes,
  dialogNodesOf,
  dialogStillValid,
  instancesOfCompact,
  mergePlan,
} from "./treeLogic";
import type { TreeEnv } from "./treeState";
import { dialogOperationLabels } from "./treeTypes";
import type { TreeDialogState } from "./useTreeDialog";
import {
  canDropNode,
  compactSelection,
  nodeInstances,
  nodeWithinFocus,
  toggleNodeSelection,
} from "../../editorTree";
import { segmentationErrorText } from "../../errors";
import { polygonsOf } from "../../maskGeometry";
import type { SegmentationNodeRef } from "../../types";

/** Frame switch a polygon press or double-click needs; false when it must not happen. */
export function claimFrame(env: TreeEnv, node: SegmentationNodeRef): boolean {
  const { document, state, surfaces } = env;
  if (node.type !== "polygon" || !document) {
    return true;
  }
  const owner = Object.values(document.annotations).find((item) =>
    polygonsOf(item).some((polygon) => polygon.id === node.id),
  );
  if (!owner || owner.frameId === state.currentFrameId) {
    return true;
  }
  if (state.drawing != undefined) {
    env.setError(env.t("finishDrawingBeforeSwitch"));
    return false;
  }
  const panelId = Object.entries(surfaces).find(
    ([, surface]) => surface.frameId === owner.frameId,
  )?.[0];
  state.setCurrentFrame(owner.frameId);
  if (panelId != undefined) {
    env.host.session.setState({ panelId });
  }
  return true;
}

export function chooseNode(env: TreeEnv, node: SegmentationNodeRef): void {
  if (env.disabled || !claimFrame(env, node)) {
    return;
  }
  const { state, document } = env;
  if (env.selecting) {
    if (document) {
      state.setSelection(toggleNodeSelection(document, node, env.selection, state.currentFrameId));
    }
  } else {
    state.setSelection([node]);
    state.setFocus(node);
  }
}

export function annotateInstance(env: TreeEnv, instanceId: string): void {
  env.run(() => {
    env.state.setFocus({ type: "instance", id: instanceId });
    env.state.setSelection([{ type: "instance", id: instanceId }]);
    env.state.startDrawing(instanceId);
  });
}

export function mergeNodes(
  env: TreeEnv,
  nodes: SegmentationNodeRef[],
  targetInstanceId: string,
): void {
  const { document, state } = env;
  if (!document) {
    return;
  }
  const plan = mergePlan(document, nodes, targetInstanceId);
  if (plan.instances.length > 0) {
    state.mergeInstances(plan.instances, targetInstanceId);
  }
  if (plan.polygons.length > 0) {
    state.mergePolygons(plan.polygons, targetInstanceId);
  }
  state.setSelection([{ type: "instance", id: targetInstanceId }]);
  state.setFocus({ type: "instance", id: targetInstanceId });
  state.setEditing(false);
}

export function removeNodes(
  env: TreeEnv,
  nodes: SegmentationNodeRef[],
  scope: "frame" | "all",
): void {
  const { document, state } = env;
  if (!document) {
    return;
  }
  const compact = compactSelection(document, nodes);
  for (const id of compact.polygons) {
    state.deletePolygon(id);
  }
  for (const id of instancesOfCompact(document, compact)) {
    state.deleteInstance(id, scope);
  }
  state.setEditing(false);
  state.setSelection([]);
}

export function dropReason(
  env: TreeEnv,
  source: SegmentationNodeRef,
  destination: SegmentationNodeRef,
): string {
  const { document, state } = env;
  return document &&
    (!nodeWithinFocus(document, source, state.focus) ||
      !nodeWithinFocus(document, destination, state.focus))
    ? env.t("dragOutsideFocus")
    : env.t("dragNoChange");
}

/** Drops a dragged node: instances and classes ask in a dialog, polygons move at once. */
export function dropNode(
  env: TreeEnv,
  dragContext: string | undefined,
  dialog: Pick<TreeDialogState, "open" | "setTarget">,
  source: SegmentationNodeRef,
  destination: SegmentationNodeRef,
): void {
  const { document, state } = env;
  if (dragContext !== env.contextKey) {
    env.setError(env.t("dragViewChanged"));
    return;
  }
  if (env.locked || !document || !canDropNode(document, source, destination, state.focus)) {
    env.setError(dropReason(env, source, destination));
    return;
  }
  if (source.type !== "polygon") {
    if (destination.type === "class") {
      dialog.open({ type: "move", node: source }, source);
      dialog.setTarget(destination.id);
    } else {
      const destinationId = nodeInstances(document, destination)[0];
      if (destinationId && canMergeNodes([source], state)) {
        dialog.open({ type: "merge", nodes: [source] }, source);
        dialog.setTarget(destinationId);
      }
    }
    return;
  }
  env.run(() => {
    state.setEditing(false);
    if (destination.type === "class") {
      const id = state.addInstance(destination.id);
      state.mergePolygons([source.id], id);
    } else {
      const instanceId = nodeInstances(document, destination)[0];
      if (instanceId) {
        mergeNodes(env, [source], instanceId);
      }
    }
  });
}

/** Applies the open dialog. Rejects it when the view or its targets changed meanwhile. */
export function confirmDialog(env: TreeEnv, dlg: TreeDialogState): void {
  const { dialog, name, target, scope } = dlg;
  const { document, state } = env;
  if (!dialog || env.locked) {
    return;
  }
  try {
    // The document object is replaced by background reads and frame registration even when
    // nothing the user sees changes; only the frame, view and focus, and the targets, matter.
    if (
      dlg.dialogContext.current?.key !== env.contextKey ||
      !document ||
      !dialogStillValid(document, dialog, dialogNodesOf(dialog), target)
    ) {
      throw new Error(env.t("actionViewChanged"));
    }
    if (dlg.dialogDragSource.current && (dialog.type === "merge" || dialog.type === "move")) {
      const destination: SegmentationNodeRef = {
        type: dialog.type === "merge" ? "instance" : "class",
        id: target,
      };
      if (!canDropNode(document, dlg.dialogDragSource.current, destination, state.focus)) {
        throw new Error(env.t("destinationOutsideFocus"));
      }
    }
    state.runTransaction(dialogOperationLabels[dialog.type], () => {
      if (dialog.type === "rename") {
        if (!name.trim() || name.trim().length > 100) {
          throw new Error(env.t("nameLength"));
        }
        (dialog.node.type === "instance" ? state.renameInstance : state.renameClass)(
          dialog.node.id,
          name.trim(),
        );
      }
      if (dialog.type === "merge") {
        mergeNodes(env, dialog.nodes, target);
      }
      if (dialog.type === "move") {
        for (const id of nodeInstances(document, dialog.node)) {
          state.moveInstance(id, target);
        }
        state.setEditing(false);
      }
      if (dialog.type === "delete") {
        removeNodes(env, dialog.nodes, scope);
      }
      if (dialog.type === "delete-class") {
        state.deleteClass(dialog.id);
      }
    });
    dlg.setDialog(undefined);
    env.setError(undefined);
  } catch (err) {
    env.setError(segmentationErrorText(err));
  }
}
