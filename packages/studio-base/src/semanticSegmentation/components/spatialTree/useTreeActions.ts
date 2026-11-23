// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Dispatch, SetStateAction } from "react";

import { canDropNode, nodeWithinFocus, polygonInstance } from "../editorTree";
import { beginPolygonEdit } from "../polygonEdit";
import { useStableActions } from "../useStableCallback";
import type { TreeMenuActions } from "./TreeContextMenu";
import type { TreeToolbarActions } from "./TreeToolbar";
import { annotateInstance, chooseNode, claimFrame, dropNode, dropReason } from "./treeCommands";
import type { TreeRowActions } from "./treeRowActions";
import { ownsRowEvent } from "./treeShortcuts";
import type { TreeEnv } from "./treeState";
import type { ClassCreationState, TreeDialogState, TreeDragState } from "./useTreeDialog";

type Deps = {
  env: TreeEnv;
  dlg: TreeDialogState;
  drag: TreeDragState;
  creation: ClassCreationState;
  setCollapsed: Dispatch<SetStateAction<string[]>>;
  setSelecting: Dispatch<SetStateAction<boolean>>;
  onPointerActivate: (() => void) | undefined;
};

function dragActionsOf({ env, dlg, drag }: Deps) {
  return {
    dragStart: (
      event: Parameters<TreeRowActions["dragStart"]>[0],
      node: Parameters<TreeRowActions["dragStart"]>[1],
    ) => {
      event.stopPropagation();
      const { document, state } = env;
      if (env.locked || !document || !nodeWithinFocus(document, node, state.focus)) {
        event.preventDefault();
        env.setError(env.t("selectBeforeDrag"));
        return;
      }
      drag.dragContext.current = { key: env.contextKey, document: env.document };
      drag.setDragSource(node);
      event.dataTransfer.setData("application/x-segmentation-node", JSON.stringify(node) ?? "");
      event.dataTransfer.effectAllowed = "move";
    },
    dragEnd: (event: Parameters<TreeRowActions["dragEnd"]>[0]) => {
      event.stopPropagation();
      drag.setDragSource(undefined);
      drag.setDropTarget(undefined);
      drag.setDropMessage(undefined);
    },
    dragOver: (
      event: Parameters<TreeRowActions["dragOver"]>[0],
      node: Parameters<TreeRowActions["dragOver"]>[1],
      label: string,
    ) => {
      event.stopPropagation();
      const { document, state } = env;
      if (
        document &&
        drag.dragSource &&
        !env.locked &&
        canDropNode(document, drag.dragSource, node, state.focus)
      ) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        drag.setDropTarget(`${node.type}:${node.id}`);
        drag.setDropMessage(env.t("dropOntoLabel", { label }));
      } else if (drag.dragSource) {
        drag.setDropTarget(undefined);
        drag.setDropMessage(dropReason(env, drag.dragSource, node));
      }
    },
    dragLeave: (event: Parameters<TreeRowActions["dragLeave"]>[0]) => {
      event.stopPropagation();
      drag.setDropTarget(undefined);
    },
    drop: (
      event: Parameters<TreeRowActions["drop"]>[0],
      node: Parameters<TreeRowActions["drop"]>[1],
    ) => {
      event.stopPropagation();
      event.preventDefault();
      if (drag.dragSource) {
        dropNode(env, drag.dragContext.current, dlg, drag.dragSource, node);
      }
      drag.setDragSource(undefined);
      drag.setDropTarget(undefined);
    },
  };
}

/** Handlers for the rows. Stable identity, so memoized rows skip renders. */
export function useRowActions(deps: Deps): TreeRowActions {
  const { env, dlg, setCollapsed, onPointerActivate } = deps;
  const drag = dragActionsOf(deps);
  return useStableActions<TreeRowActions>({
    ...drag,
    choose: (node) => {
      chooseNode(env, node);
    },
    toggleCollapsed: (key) => {
      setCollapsed((items) =>
        items.includes(key) ? items.filter((id) => id !== key) : [...items, key],
      );
    },
    add: (node) => {
      if (node.type === "class") {
        env.run(() => {
          env.state.addInstance(node.id);
        });
      } else {
        annotateInstance(env, node.id);
      }
    },
    deletePolygon: (id) => {
      // One polygon on this frame: undoable, so no confirmation dialog.
      env.run(() => {
        env.state.deletePolygon(id);
        env.state.setSelection([]);
      });
    },
    openMenu: (node, x, y) => {
      dlg.setMenu({ node, x, y });
    },
    editPolygon: (event, node) => {
      if (node.type === "polygon" && ownsRowEvent(event.target, event.currentTarget)) {
        event.stopPropagation();
        if (!claimFrame(env, node)) {
          return;
        }
        env.run(() => {
          beginPolygonEdit(env.store.getState(), node.id);
        });
      }
    },
    enterKey: (event, node) => {
      const { state } = env;
      if (
        event.key !== "Enter" ||
        event.defaultPrevented ||
        env.locked ||
        !ownsRowEvent(event.target, event.currentTarget)
      ) {
        return;
      }
      if (state.editing && state.drawing == undefined) {
        // Enter confirms the edit in progress; every change is already staged.
        event.preventDefault();
        event.stopPropagation();
        env.run(() => {
          state.setEditing(false);
        });
      } else if (!state.editing && node.type === "polygon") {
        event.preventDefault();
        event.stopPropagation();
        env.run(() => {
          beginPolygonEdit(env.store.getState(), node.id);
        });
      }
    },
    activate: () => {
      onPointerActivate?.();
    },
  });
}

/** Handlers for the tree-wide buttons. */
export function useToolbarActions(deps: Deps): TreeToolbarActions {
  const { env, dlg, creation, setSelecting, onPointerActivate } = deps;
  return useStableActions<TreeToolbarActions>({
    setViewMode: (mode) => {
      env.state.setViewMode(mode);
    },
    beginCreation: () => {
      creation.begin(env.document);
    },
    openMerge: () => {
      dlg.open({ type: "merge", nodes: env.selection });
    },
    openDelete: () => {
      dlg.open({ type: "delete", nodes: env.selection });
    },
    toggleSelecting: () => {
      setSelecting((value) => !value);
      env.state.setSelection([]);
    },
    toggleEditing: (event) => {
      env.state.setEditing(!env.state.editing);
      if (event.detail > 0) {
        onPointerActivate?.();
      }
    },
    clearFocus: () => {
      env.state.setFocus(undefined);
    },
  });
}

/** Handlers for the per-node context menu. */
export function useMenuActions({ env, dlg }: Deps): TreeMenuActions {
  return useStableActions<TreeMenuActions>({
    close: () => {
      dlg.setMenu(undefined);
    },
    focus: (menu) => {
      env.state.setFocus(menu.node);
      env.state.setViewMode("instance");
      dlg.setMenu(undefined);
    },
    rename: (menu) => {
      dlg.open({ type: "rename", node: menu.node });
      dlg.setName(
        (menu.node.type === "class" ? env.document?.classes : env.document?.instances)?.find(
          (item) => item.id === menu.node.id,
        )?.name ?? "",
      );
    },
    merge: (menu) => {
      dlg.open({ type: "merge", nodes: [menu.node] });
    },
    move: (menu) => {
      dlg.open({ type: "move", node: menu.node });
    },
    drawAnother: (menu) => {
      const owner = env.document ? polygonInstance(env.document, menu.node.id) : undefined;
      env.run(() => {
        if (owner) {
          env.state.setViewMode("instance");
          env.state.startDrawing(owner, "polygon");
        }
      });
      dlg.setMenu(undefined);
    },
    deleteNode: (menu, scope) => {
      dlg.setScope(scope);
      dlg.open({ type: "delete", nodes: [menu.node] });
    },
    deleteClass: (menu) => {
      dlg.open({ type: "delete-class", id: menu.node.id });
    },
  });
}
