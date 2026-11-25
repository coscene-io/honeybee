// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { TreeEnv } from "./treeState";
import type { TreeContext, TreeDialog, TreeMenu } from "./treeTypes";
import { segmentationErrorText } from "../../errors";
import type { SegmentationDocument, SegmentationNodeRef } from "../../types";

export type TreeDialogState = {
  menu: TreeMenu | undefined;
  setMenu: Dispatch<SetStateAction<TreeMenu | undefined>>;
  dialog: TreeDialog | undefined;
  setDialog: Dispatch<SetStateAction<TreeDialog | undefined>>;
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  target: string;
  setTarget: Dispatch<SetStateAction<string>>;
  scope: "frame" | "all";
  setScope: Dispatch<SetStateAction<"frame" | "all">>;
  dialogDragSource: RefObject<SegmentationNodeRef | undefined>;
  dialogContext: RefObject<TreeContext | undefined>;
  open: (next: TreeDialog, dragged?: SegmentationNodeRef) => void;
  reset: () => void;
};

/** Context menu, confirmation dialog and the form values the dialog edits. */
export function useTreeDialog(
  env: Pick<TreeEnv, "document" | "contextKey" | "setError">,
): TreeDialogState {
  const [menu, setMenu] = useState<TreeMenu>();
  const [dialog, setDialog] = useState<TreeDialog>();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [scope, setScope] = useState<"frame" | "all">("frame");
  const dialogDragSource = useRef<SegmentationNodeRef | undefined>(undefined);
  const dialogContext = useRef<TreeContext | undefined>(undefined);

  function open(next: TreeDialog, dragged?: SegmentationNodeRef): void {
    dialogDragSource.current = dragged;
    dialogContext.current = { key: env.contextKey, document: env.document };
    setDialog(next);
    setTarget("");
    setName("");
    env.setError(undefined);
    setMenu(undefined);
  }
  function reset(): void {
    setMenu(undefined);
    setDialog(undefined);
    setName("");
    setTarget("");
    setScope("frame");
    dialogDragSource.current = undefined;
    dialogContext.current = undefined;
  }
  return {
    menu,
    setMenu,
    dialog,
    setDialog,
    name,
    setName,
    target,
    setTarget,
    scope,
    setScope,
    dialogDragSource,
    dialogContext,
    open,
    reset,
  };
}

export type TreeDragState = {
  dragSource: SegmentationNodeRef | undefined;
  setDragSource: Dispatch<SetStateAction<SegmentationNodeRef | undefined>>;
  dropTarget: string | undefined;
  setDropTarget: Dispatch<SetStateAction<string | undefined>>;
  dropMessage: string | undefined;
  setDropMessage: Dispatch<SetStateAction<string | undefined>>;
  dragContext: RefObject<TreeContext | undefined>;
  reset: () => void;
};

/** The drag in flight and the drop target and message it shows. */
export function useTreeDrag(): TreeDragState {
  const [dragSource, setDragSource] = useState<SegmentationNodeRef>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [dropMessage, setDropMessage] = useState<string>();
  const dragContext = useRef<TreeContext | undefined>(undefined);
  function reset(): void {
    setDragSource(undefined);
    setDropTarget(undefined);
    setDropMessage(undefined);
    dragContext.current = undefined;
  }
  return {
    dragSource,
    setDragSource,
    dropTarget,
    setDropTarget,
    dropMessage,
    setDropMessage,
    dragContext,
    reset,
  };
}

export type ClassCreationState = {
  creating: boolean;
  newName: string;
  setNewName: Dispatch<SetStateAction<string>>;
  creationError: string | undefined;
  setCreationError: Dispatch<SetStateAction<string | undefined>>;
  begin: (document: SegmentationDocument | undefined) => void;
  cancel: () => void;
  create: () => void;
  reset: () => void;
};

/** The inline "new class" row. */
export function useClassCreation(env: TreeEnv): ClassCreationState {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [creationError, setCreationError] = useState<string>();
  const creationRecordId = useRef<string | undefined>(undefined);
  const creationStore = useRef(env.store);

  function cancel(): void {
    setCreating(false);
    setNewName("");
    setCreationError(undefined);
  }
  function begin(document: SegmentationDocument | undefined): void {
    creationRecordId.current = document?.record.id;
    creationStore.current = env.store;
    setNewName("");
    setCreationError(undefined);
    setCreating(true);
  }
  function create(): void {
    if (env.locked) {
      return;
    }
    try {
      if (creationStore.current !== env.store) {
        throw new Error(env.t("sessionChanged"));
      }
      if (creationRecordId.current !== env.document?.record.id) {
        throw new Error(env.t("recordChanged"));
      }
      const trimmed = newName.trim();
      if (trimmed.length === 0 || trimmed.length > 100) {
        setCreationError(env.t("classNameLength"));
        return;
      }
      env.state.runTransaction("opLabelCreateClass", () => {
        env.state.addClass(trimmed);
      });
      cancel();
    } catch (err) {
      setCreationError(segmentationErrorText(err));
    }
  }
  function reset(): void {
    setCreating(false);
    setNewName("");
    setCreationError(undefined);
    creationRecordId.current = undefined;
  }
  return {
    creating,
    newName,
    setNewName,
    creationError,
    setCreationError,
    begin,
    cancel,
    create,
    reset,
  };
}
