// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { makeStyles } from "tss-react/mui";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";

import { polygonsOf, summaryHasGeometry } from "../maskGeometry";
import { segmentationSession } from "../runtime";
import { segmentationCanvasLabel } from "../segmentationChrome";
import { frameInstanceKey } from "../service";
import { filterSegmentationSelection } from "../store";
import type {
  SegmentationDocument,
  SemanticSegmentationStore,
  SegmentationNodeRef,
} from "../types";
import { CameraFrameStrip, cameraStripVisible, preloadCameraStrip } from "./CameraFrameStrip";
import { useEditorText } from "./editorMessages";
import {
  canDropNode,
  compactSelection,
  nodeInstances,
  nodeWithinFocus,
  polygonInstance,
  selectionStatus,
  toggleNodeSelection,
} from "./editorTree";
import { beginPolygonEdit } from "./polygonEdit";
import { frameIndexOf, instancesByClass } from "./spatialTreeIndex";
import { useVirtualRows } from "./useVirtualRows";

const useStyles = makeStyles()((theme) => ({
  root: {
    height: "100%",
    minWidth: 250,
    overflow: "hidden",
    padding: theme.spacing(1),
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(0.5),
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing(1),
  },
  headerCount: {
    color: theme.palette.text.secondary,
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  viewModes: {
    width: "100%",
    display: "flex",
    gap: theme.spacing(0.75),
    "& .MuiToggleButton-root": {
      flex: 1,
      minHeight: 0,
      height: 26,
      margin: 0,
      padding: theme.spacing(0, 1),
      border: 0,
      borderRadius: "4px !important",
      backgroundColor: theme.palette.action.hover,
      fontSize: 12,
      textTransform: "none",
      fontWeight: 500,
      color: theme.palette.text.secondary,
      "&.Mui-selected": {
        backgroundColor: theme.palette.primary.main,
        color: theme.palette.primary.contrastText,
        "&:hover": { backgroundColor: theme.palette.primary.dark },
      },
    },
  },
  toolRow: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: theme.spacing(0.75),
    "& .MuiButton-root": {
      textTransform: "none",
      minWidth: 0,
      minHeight: 0,
      height: 26,
      padding: theme.spacing(0, 0.5),
      fontSize: 12,
      borderColor: theme.palette.divider,
      color: theme.palette.text.secondary,
    },
  },
  secondaryTools: {
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing(0.75),
    "& .MuiButton-root": { minHeight: 0, height: 24, fontSize: 12 },
  },
  row: {
    display: "flex",
    alignItems: "center",
    minHeight: 36,
    border: "1px solid transparent",
    borderRadius: 4,
    transition: "background-color 120ms, opacity 120ms",
  },
  disclosure: {
    width: 28,
    flexShrink: 0,
    display: "flex",
    justifyContent: "center",
  },
  // The rows are windowed, so nesting cannot carry the sticky headers. The class and instance
  // rows that own the first visible row are drawn again in this zero-height sticky layer, with
  // opaque backgrounds so scrolled rows do not show through; their list slots stay empty.
  pinned: {
    position: "sticky",
    top: 0,
    height: 0,
    zIndex: 3,
  },
  pinnedRow: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: theme.palette.background.paper,
    boxShadow: `0 1px 0 ${theme.palette.divider}`,
  },
  selected: { backgroundColor: theme.palette.action.selected },
  drop: { backgroundColor: theme.palette.action.hover },
  // Design uses small color squares on class/polygon rows; keep dots for compact density.
  dot: {
    width: 10,
    height: 10,
    flexShrink: 0,
    borderRadius: 2,
    marginRight: 6,
  },
  presenceText: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  rowButton: {
    minWidth: 0,
    flex: 1,
    textTransform: "none",
    justifyContent: "flex-start",
    overflow: "hidden",
  },
  labelStack: { minWidth: 0, alignItems: "flex-start" },
  label: { maxWidth: 160 },
  tree: { overflowY: "auto", flex: 1, minHeight: 80 },
  emptyClass: { paddingLeft: theme.spacing(3) },
  emptyInstance: { paddingLeft: theme.spacing(5) },
  presence: { marginTop: theme.spacing(0.25) },
  presenceCell: {
    width: 3,
    backgroundColor: theme.palette.action.disabledBackground,
  },
  addButton: {
    width: 24,
    height: 24,
    borderRadius: 4,
    border: `1px solid ${theme.palette.primary.main}`,
    color: theme.palette.primary.main,
    backgroundColor:
      theme.palette.mode === "light" ? "rgba(59, 102, 245, 0.08)" : "rgba(82, 140, 255, 0.16)",
    "&:hover": {
      backgroundColor:
        theme.palette.mode === "light" ? "rgba(59, 102, 245, 0.16)" : "rgba(82, 140, 255, 0.28)",
    },
  },
  dialogField: { marginTop: theme.spacing(1) },
  affectedIds: {
    margin: 0,
    marginBottom: theme.spacing(2),
    wordBreak: "break-word",
    "& dd": { margin: 0, fontFamily: "monospace" },
  },
  scope: { marginTop: theme.spacing(2) },
  creationRow: {
    marginTop: theme.spacing(1),
    padding: theme.spacing(1),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 4,
  },
}));

type FlatTreeRow = {
  key: string;
  kind: "class" | "instance" | "polygon" | "strip" | "note";
  level: number;
  /** Rows of the owning class and instance, which stay pinned while this row is at the top. */
  classRow: number;
  instanceRow?: number;
  render: () => ReactNode;
};

/** Heights used until a row has been measured once. */
const ROW_ESTIMATE: Record<FlatTreeRow["kind"], number> = {
  class: 46,
  instance: 46,
  polygon: 46,
  strip: 16,
  note: 20,
};

export type SpatialTreeProps = {
  store: StoreApi<SemanticSegmentationStore>;
  disabled?: boolean;
  onPointerActivate?: () => void;
};
type TreeDialog =
  | { type: "rename"; node: SegmentationNodeRef }
  | { type: "merge"; nodes: SegmentationNodeRef[] }
  | { type: "move"; node: SegmentationNodeRef }
  | { type: "delete"; nodes: SegmentationNodeRef[] }
  | { type: "delete-class"; id: string };

/**
 * Whether a keyboard/mouse event belongs to this tree row itself (not a nested row) and was
 * raised by the row or its main button rather than by another control such as a checkbox.
 */
function nodeExists(document: SegmentationDocument, node: SegmentationNodeRef): boolean {
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
 * Canvas shortcuts that also apply with focus in the tree: view (F, Shift+F, 0, +/-, hold O),
 * history (Cmd/Ctrl+Z, Shift+Z, Y), help (?) and Esc while drawing. They act on the canvas that
 * holds the edit. Tree-only keys (Enter, typing in a name field) and keys with a different meaning
 * here (Space plays, arrows step frames, Delete) stay with the tree and the app.
 */
const TREE_FORWARDED_KEYS = new Set(["f", "F", "0", "+", "=", "-", "o", "O", "?"]);

function activeCanvasViewport(): HTMLElement | undefined {
  return (
    globalThis.document.querySelector<HTMLElement>(
      '.seg-canvas-focused [data-testid="segmentation-viewport"]',
    ) ??
    globalThis.document.querySelector<HTMLElement>('[data-testid="segmentation-viewport"]') ??
    undefined
  );
}

function forwardCanvasShortcut(event: ReactKeyboardEvent<HTMLElement>): void {
  const target = event.target;
  if (
    event.defaultPrevented ||
    (target instanceof Element &&
      target.closest(
        'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]',
      ))
  ) {
    return;
  }
  const history =
    (event.ctrlKey || event.metaKey) && ["z", "Z", "y", "Y"].includes(event.key) && !event.altKey;
  const view =
    !event.ctrlKey && !event.metaKey && !event.altKey && TREE_FORWARDED_KEYS.has(event.key);
  const escape = event.key === "Escape";
  if (!history && !view && !escape) {
    return;
  }
  const viewport = activeCanvasViewport();
  if (!viewport) {
    return;
  }
  const forwarded = new KeyboardEvent("keydown", {
    key: event.key,
    code: event.code,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    repeat: event.repeat,
    bubbles: true,
    cancelable: true,
  });
  viewport.dispatchEvent(forwarded);
  if (forwarded.defaultPrevented) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function ownsRowEvent(target: EventTarget, row: Element): boolean {
  if (!(target instanceof Element) || target.closest('[role="treeitem"]') !== row) {
    return false;
  }
  const control = target.closest("button, input, textarea, select");
  return control == undefined || control.hasAttribute("data-tree-primary");
}

export function SpatialTree({
  store,
  disabled = false,
  onPointerActivate,
}: SpatialTreeProps): React.JSX.Element {
  const { classes, cx, theme } = useStyles();
  const state = useStore(store);
  const surfaces = useStore(segmentationSession, (session) => session.surfaces);
  const sessionOpen = useStore(segmentationSession, (session) => session.open);
  const previewFrames = useStore(segmentationSession, (session) => session.previewFrames);
  const strokeFrameId = useStore(segmentationSession, (session) => session.strokeFrameId);
  const text = useEditorText();
  const document = state.document;
  const index = document ? frameIndexOf(document) : undefined;
  const listedFrameIds = [
    ...new Set(
      (sessionOpen
        ? Object.values(surfaces).map((surface) => surface.frameId)
        : Object.values(previewFrames)
      ).filter((id): id is string => id != undefined),
    ),
  ].filter((id) => index?.frameById.has(id) === true);
  const treeFrameIds =
    listedFrameIds.length > 0
      ? listedFrameIds
      : !sessionOpen && Object.keys(previewFrames).length > 0
        ? []
        : state.currentFrameId
          ? [state.currentFrameId]
          : [];
  /** The global multi-camera tree, as opposed to the standalone single-video workbench. */
  const overview = sessionOpen || Object.keys(previewFrames).length > 0;
  const selection = document
    ? filterSegmentationSelection(document, state.selection, state.currentFrameId)
    : [];
  const instanceHintId = useId();
  const locked = disabled || ["running", "stopping"].includes(state.propagation.status);
  const [selecting, setSelecting] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [menu, setMenu] = useState<{
    node: SegmentationNodeRef;
    x: number;
    y: number;
  }>();
  const [dialog, setDialog] = useState<TreeDialog>();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [creationError, setCreationError] = useState<string>();
  const creationRecordId = useRef<string | undefined>(undefined);
  const creationStore = useRef(store);
  const [target, setTarget] = useState("");
  const [scope, setScope] = useState<"frame" | "all">("frame");
  const [error, setError] = useState<string>();
  const [dragSource, setDragSource] = useState<SegmentationNodeRef>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [dropMessage, setDropMessage] = useState<string>();
  const dragContext = useRef<{ key: string; document: typeof document } | undefined>(undefined);
  const dialogDragSource = useRef<SegmentationNodeRef | undefined>(undefined);
  const dialogContext = useRef<{ key: string; document: typeof document } | undefined>(undefined);
  const videoId =
    state.currentFrameId == undefined
      ? undefined
      : index?.frameById.get(state.currentFrameId)?.videoId;
  const contextKey = `${document?.record.id}:${videoId}:${state.currentFrameId}:${state.viewMode}:${state.focus?.type}:${state.focus?.id}`;
  const previousReset = useRef({
    store,
    version: state.interactionResetVersion,
  });
  const treeRef = useRef<HTMLDivElement>(ReactNull);

  useEffect(() => {
    const previous = previousReset.current;
    previousReset.current = { store, version: state.interactionResetVersion };
    // A store switch retains the existing stale-session rejection UI. Only an explicit reset
    // within the same store discards component-owned transient work.
    if (previous.store !== store || previous.version === state.interactionResetVersion) {
      return;
    }
    setSelecting(false);
    setMenu(undefined);
    setDialog(undefined);
    setName("");
    setCreating(false);
    setNewName("");
    setCreationError(undefined);
    setTarget("");
    setScope("frame");
    setError(undefined);
    setDragSource(undefined);
    setDropTarget(undefined);
    setDropMessage(undefined);
    dragContext.current = undefined;
    dialogDragSource.current = undefined;
    dialogContext.current = undefined;
    creationRecordId.current = undefined;
  }, [store, state.interactionResetVersion]);

  function run(action: () => undefined): void {
    if (locked) {
      return;
    }
    try {
      state.runTransaction("Edit spatial tree", action);
      setError(undefined);
    } catch (err) {
      setError(String(err));
    }
  }
  function open(next: TreeDialog, dragged?: SegmentationNodeRef): void {
    dialogDragSource.current = dragged;
    dialogContext.current = { key: contextKey, document };
    setDialog(next);
    setTarget("");
    setName("");
    setError(undefined);
    setMenu(undefined);
  }
  function cancelCreation(): void {
    setCreating(false);
    setNewName("");
    setCreationError(undefined);
  }
  function createClass(): void {
    if (locked) {
      return;
    }
    try {
      if (creationStore.current !== store) {
        throw new Error(
          text(
            "The annotation session changed. Cancel and start again.",
            "标注会话已改变，请取消后重新新建。",
          ),
        );
      }
      if (creationRecordId.current !== document?.record.id) {
        throw new Error(
          text("The record changed. Cancel and start again.", "记录已改变，请取消后重新新建。"),
        );
      }
      const trimmed = newName.trim();
      if (trimmed.length === 0 || trimmed.length > 100) {
        setCreationError(
          text("Enter a class name of 1–100 characters.", "请输入 1–100 个字符的类别名称。"),
        );
        return;
      }
      state.runTransaction("Create class", () => {
        state.addClass(trimmed);
      });
      cancelCreation();
    } catch (err) {
      setCreationError(String(err));
    }
  }
  function claimFrame(node: SegmentationNodeRef): boolean {
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
      setError(
        text(
          "Finish or cancel the drawing on the current canvas before switching.",
          "先完成或取消当前画布上的绘制，再标注另一路。",
        ),
      );
      return false;
    }
    const panelId = Object.entries(surfaces).find(
      ([, surface]) => surface.frameId === owner.frameId,
    )?.[0];
    state.setCurrentFrame(owner.frameId);
    if (panelId != undefined) {
      segmentationSession.setState({ panelId });
    }
    return true;
  }
  function choose(node: SegmentationNodeRef): void {
    if (disabled) {
      return;
    }
    if (!claimFrame(node)) {
      return;
    }
    if (selecting) {
      if (document) {
        state.setSelection(toggleNodeSelection(document, node, selection, state.currentFrameId));
      }
    } else {
      state.setSelection([node]);
      state.setFocus(node);
    }
  }
  function addPolygon(instanceId: string): void {
    run(() => {
      state.setFocus({ type: "instance", id: instanceId });
      state.setSelection([{ type: "instance", id: instanceId }]);
      state.startDrawing(instanceId);
    });
  }
  function merge(nodes: SegmentationNodeRef[], targetInstanceId: string): void {
    if (!document) {
      return;
    }
    const compact = compactSelection(document, nodes);
    const instances = [
      ...compact.instances,
      ...document.instances
        .filter((instance) => compact.classes.includes(instance.classId))
        .map((instance) => instance.id),
    ].filter((id) => id !== targetInstanceId);
    if (instances.length > 0) {
      state.mergeInstances(instances, targetInstanceId);
    }
    const polygons = compact.polygons.filter(
      (id) => polygonInstance(document, id) !== targetInstanceId,
    );
    if (polygons.length > 0) {
      state.mergePolygons(polygons, targetInstanceId);
    }
    state.setSelection([{ type: "instance", id: targetInstanceId }]);
    state.setFocus({ type: "instance", id: targetInstanceId });
    state.setEditing(false);
  }
  function dropReason(source: SegmentationNodeRef, destination: SegmentationNodeRef): string {
    return document &&
      (!nodeWithinFocus(document, source, state.focus) ||
        !nodeWithinFocus(document, destination, state.focus))
      ? text(
          "Source or destination is outside the active focus. Clear focus before moving between scopes.",
          "拖动源或目标超出当前聚焦范围，请取消聚焦后再跨范围移动。",
        )
      : text(
          "No change: choose a different destination outside this object's own subtree.",
          "无需更改：请选择对象自身层级之外的其他目标。",
        );
  }
  function drop(source: SegmentationNodeRef, destination: SegmentationNodeRef): void {
    if (dragContext.current?.key !== contextKey || dragContext.current.document !== document) {
      setError(
        text(
          "The frame or view changed during the drag. Start a new drag.",
          "拖动期间帧或视图已改变，请重新拖动。",
        ),
      );
      return;
    }
    if (!document || !canDropNode(document, source, destination, state.focus)) {
      setError(dropReason(source, destination));
      return;
    }
    if (source.type !== "polygon") {
      if (destination.type === "class") {
        open({ type: "move", node: source }, source);
        setTarget(destination.id);
      } else {
        const destinationId = nodeInstances(document, destination)[0];
        if (destinationId) {
          open({ type: "merge", nodes: [source] }, source);
          setTarget(destinationId);
        }
      }
      return;
    }
    run(() => {
      state.setEditing(false);
      if (destination.type === "class") {
        const id = state.addInstance(destination.id);
        state.mergePolygons([source.id], id);
      } else {
        const instanceId = nodeInstances(document, destination)[0];
        if (instanceId) {
          merge([source], instanceId);
        }
      }
    });
  }

  function remove(nodes: SegmentationNodeRef[]): void {
    if (!document) {
      return;
    }
    const compact = compactSelection(document, nodes);
    for (const id of compact.polygons) {
      state.deletePolygon(id);
    }
    for (const id of [
      ...compact.instances,
      ...document.instances
        .filter((instance) => compact.classes.includes(instance.classId))
        .map((instance) => instance.id),
    ]) {
      state.deleteInstance(id, scope);
    }
    state.setEditing(false);
    state.setSelection([]);
  }
  function confirm(): void {
    if (!dialog || locked) {
      return;
    }
    try {
      // The document object is replaced by background reads and frame registration even when
      // nothing the user sees changes; only the frame, view and focus, and the targets, matter.
      if (
        dialogContext.current?.key !== contextKey ||
        !document ||
        !dialogNodes.every((node) => nodeExists(document, node)) ||
        (dialog.type === "merge" && !nodeExists(document, { type: "instance", id: target })) ||
        (dialog.type === "move" && !nodeExists(document, { type: "class", id: target }))
      ) {
        throw new Error(
          text(
            "The frame or view changed. Reopen this action.",
            "帧或视图已改变，请重新打开此操作。",
          ),
        );
      }
      if (dialogDragSource.current && (dialog.type === "merge" || dialog.type === "move")) {
        const destination: SegmentationNodeRef = {
          type: dialog.type === "merge" ? "instance" : "class",
          id: target,
        };
        if (!canDropNode(document, dialogDragSource.current, destination, state.focus)) {
          throw new Error(
            text(
              "The destination is outside the active focus or is no longer eligible. Clear focus to reorganize other objects.",
              "目标超出当前聚焦范围或已不可用，请取消聚焦后再整理其他对象。",
            ),
          );
        }
      }
      state.runTransaction(dialog.type, () => {
        if (dialog.type === "rename") {
          if (!name.trim() || name.trim().length > 100) {
            throw new Error("Enter a name of 1–100 characters.");
          }
          (dialog.node.type === "instance" ? state.renameInstance : state.renameClass)(
            dialog.node.id,
            name.trim(),
          );
        }
        if (dialog.type === "merge") {
          merge(dialog.nodes, target);
        }
        if (dialog.type === "move") {
          for (const id of nodeInstances(document, dialog.node)) {
            state.moveInstance(id, target);
          }
          state.setEditing(false);
        }
        if (dialog.type === "delete") {
          remove(dialog.nodes);
        }
        if (dialog.type === "delete-class") {
          state.deleteClass(dialog.id);
        }
      });
      setDialog(undefined);
      setError(undefined);
    } catch (err) {
      setError(String(err));
    }
  }
  function row(
    node: SegmentationNodeRef,
    label: string,
    color: string,
    detail: string,
    level: number,
    add?: () => void,
    auxiliary?: ReactNode,
    presence?: "present" | "absent",
    children?: ReactNode,
  ): React.JSX.Element {
    const { checked: selected, indeterminate } = document
      ? selectionStatus(document, node, selection, state.currentFrameId)
      : { checked: false, indeterminate: false };
    const focused = state.focus?.id === node.id && state.focus.type === node.type;
    const key = `${node.type}:${node.id}`;
    const isCollapsed = collapsed.includes(key);
    const isDrop = dropTarget === key;
    const withinFocus = document ? nodeWithinFocus(document, node, state.focus) : false;
    return (
      <Box
        role="treeitem"
        aria-level={level}
        aria-selected={selected}
        aria-expanded={node.type === "polygon" ? undefined : !isCollapsed}
        key={key}
        aria-label={label}
        title={
          withinFocus
            ? node.id
            : text(
                "Select this object to focus it before dragging.",
                "请先选择此对象以切换聚焦，再进行拖动。",
              )
        }
        data-node-type={node.type}
        data-node-id={node.id}
        draggable={!locked && withinFocus}
        onDragStart={(event) => {
          event.stopPropagation();
          if (locked || !withinFocus) {
            event.preventDefault();
            setError(
              text(
                "Select this object to focus it before dragging.",
                "请先选择此对象以切换聚焦，再进行拖动。",
              ),
            );
            return;
          }
          dragContext.current = { key: contextKey, document };
          setDragSource(node);
          event.dataTransfer.setData("application/x-segmentation-node", JSON.stringify(node) ?? "");
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={(event) => {
          event.stopPropagation();
          setDragSource(undefined);
          setDropTarget(undefined);
          setDropMessage(undefined);
        }}
        onDragOver={(event) => {
          event.stopPropagation();
          if (
            document &&
            dragSource &&
            !locked &&
            canDropNode(document, dragSource, node, state.focus)
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropTarget(key);
            setDropMessage(text(`Drop onto ${label}`, `拖放到 ${label}`));
          } else if (dragSource) {
            setDropTarget(undefined);
            setDropMessage(dropReason(dragSource, node));
          }
        }}
        onDragLeave={(event) => {
          event.stopPropagation();
          setDropTarget(undefined);
        }}
        onDrop={(event) => {
          event.stopPropagation();
          event.preventDefault();
          if (dragSource) {
            drop(dragSource, node);
          }
          setDragSource(undefined);
          setDropTarget(undefined);
        }}
        onContextMenu={(event) => {
          event.stopPropagation();
          event.preventDefault();
          if (!locked) {
            setMenu({ node, x: event.clientX, y: event.clientY });
          }
        }}
        onDoubleClick={(event) => {
          if (node.type === "polygon" && ownsRowEvent(event.target, event.currentTarget)) {
            event.stopPropagation();
            if (!claimFrame(node)) {
              return;
            }
            run(() => {
              beginPolygonEdit(state, node.id);
            });
          }
        }}
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" ||
            event.defaultPrevented ||
            locked ||
            !ownsRowEvent(event.target, event.currentTarget)
          ) {
            return;
          }
          if (state.editing && state.drawing == undefined) {
            // Enter confirms the edit in progress; every change is already staged.
            event.preventDefault();
            event.stopPropagation();
            run(() => {
              state.setEditing(false);
            });
          } else if (!state.editing && node.type === "polygon") {
            event.preventDefault();
            event.stopPropagation();
            run(() => {
              beginPolygonEdit(state, node.id);
            });
          }
        }}
      >
        <Box data-tree-level={level}>
          <Box
            className={cx(classes.row, selected && classes.selected, isDrop && classes.drop)}
            data-tree-row=""
            style={{
              borderColor: isDrop || focused ? color : "transparent",
              borderWidth: isDrop ? "0.5px" : "1px",
              opacity: dragSource?.id === node.id ? (dropTarget ? 0.25 : 0.55) : 1,
              outline: isDrop ? `2px solid ${color}` : undefined,
            }}
          >
            {selecting && (
              <Checkbox
                size="small"
                checked={selected}
                indeterminate={indeterminate}
                disabled={locked}
                slotProps={{ input: { "aria-label": `Select ${label}` } }}
                onChange={() => {
                  choose(node);
                }}
              />
            )}
            <Box className={classes.disclosure}>
              {node.type !== "polygon" && (
                <IconButton
                  size="small"
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${label}`}
                  onClick={() => {
                    setCollapsed((items) =>
                      isCollapsed ? items.filter((id) => id !== key) : [...items, key],
                    );
                  }}
                >
                  {isCollapsed ? "▸" : "▾"}
                </IconButton>
              )}
            </Box>
            <Box className={classes.dot} style={{ backgroundColor: color }} />
            <Button
              size="small"
              color="inherit"
              disabled={disabled}
              data-tree-primary=""
              aria-label={presence != undefined ? label : undefined}
              aria-describedby={
                presence != undefined ? `${instanceHintId}-presence-${node.id}` : undefined
              }
              onClick={(event) => {
                choose(node);
                if (event.detail > 0) {
                  onPointerActivate?.();
                }
              }}
              className={classes.rowButton}
            >
              <Stack className={classes.labelStack}>
                <Typography variant="body2" noWrap className={classes.label}>
                  {presence == undefined ? (
                    label
                  ) : (
                    <>
                      <Box
                        component="span"
                        aria-hidden="true"
                        data-testid={`instance-presence-${node.id}`}
                        style={{ color: theme.palette.success.main }}
                      >
                        {presence === "present" ? "●" : "○"}
                      </Box>{" "}
                      {label.slice(2)}
                    </>
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {detail}
                </Typography>
                {auxiliary}
              </Stack>
            </Button>
            {presence != undefined && (
              <Box
                component="span"
                id={`${instanceHintId}-presence-${node.id}`}
                className={classes.presenceText}
              >
                {presence === "present"
                  ? text("Present in current frame", "当前帧存在")
                  : text("Absent in current frame", "当前帧缺席")}
              </Box>
            )}
            {add && (
              <Tooltip title={node.type === "class" ? "Add instance" : "Add polygon"}>
                <IconButton
                  size="small"
                  disabled={locked}
                  className={classes.addButton}
                  aria-label={`Add ${node.type === "class" ? "instance" : "polygon"} to ${label}`}
                  onClick={add}
                >
                  +
                </IconButton>
              </Tooltip>
            )}
            {node.type === "polygon" && (
              <IconButton
                size="small"
                disabled={locked}
                aria-label={`Delete ${label}`}
                title={text("Delete (Ctrl+Z undoes)", "删除（Ctrl+Z 可撤销）")}
                onClick={() => {
                  // One polygon on this frame: undoable, so no confirmation dialog.
                  run(() => {
                    state.deletePolygon(node.id);
                    state.setSelection([]);
                  });
                }}
              >
                ×
              </IconButton>
            )}
            <IconButton
              size="small"
              disabled={locked}
              aria-label={`Actions for ${label}`}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setMenu({ node, x: rect.left, y: rect.bottom });
              }}
            >
              ⋮
            </IconButton>
          </Box>
        </Box>
        {children}
      </Box>
    );
  }

  const mergeTargets =
    document?.instances.filter(
      (instance) =>
        dialog?.type === "merge" &&
        !dialog.nodes.some((node) => node.type === "instance" && node.id === instance.id) &&
        (!dialogDragSource.current ||
          canDropNode(
            document,
            dialogDragSource.current,
            { type: "instance", id: instance.id },
            state.focus,
          )),
    ) ?? [];
  const dialogNodes: SegmentationNodeRef[] = !dialog
    ? []
    : dialog.type === "delete-class"
      ? [{ type: "class", id: dialog.id }]
      : dialog.type === "merge" || dialog.type === "delete"
        ? dialog.nodes
        : [dialog.node];
  const affected = document
    ? compactSelection(document, dialogNodes)
    : { classes: [], instances: [], polygons: [] };
  const affectedInstances = document
    ? [
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
      ].filter((id) => dialog?.type !== "merge" || id !== target)
    : [];
  const classFor = (node: SegmentationNodeRef) => {
    if (!document) {
      return undefined;
    }
    return node.type === "class"
      ? node.id
      : document.instances.find((instance) => instance.id === nodeInstances(document, node)[0])
          ?.classId;
  };
  const instanceCount = document?.instances.length ?? 0;
  /**
   * The tree as a flat list. Only the rows in or near the viewport call `render`, so building the
   * list stays cheap: per-row work is lookups in the frame index and cached strip cells.
   */
  const flatRows: FlatTreeRow[] = [];
  if (document && index && document.classes.length > 0) {
    const grouped = instancesByClass(document.instances);
    const currentFrame =
      state.currentFrameId == undefined ? undefined : index.frameById.get(state.currentFrameId);
    const videoFrames = currentFrame ? (index.framesOfVideo.get(currentFrame.videoId) ?? []) : [];
    const hasGeometry = (frameId: string, instanceId: string) =>
      summaryHasGeometry(document.annotationSummaries[frameInstanceKey(frameId, instanceId)]);
    for (const category of document.classes) {
      const instances = grouped.get(category.id) ?? [];
      const classRow = flatRows.length;
      const classKey = `class:${category.id}`;
      const present = instances.filter((instance) =>
        treeFrameIds.some((id) => hasGeometry(id, instance.id)),
      ).length;
      flatRows.push({
        key: classKey,
        kind: "class",
        level: 1,
        classRow,
        render: () =>
          row(
            { type: "class", id: category.id },
            category.name,
            category.color,
            text(
              `${present} present / ${instances.length} total`,
              `当前画面 ${present} / 共 ${instances.length} 个实例`,
            ),
            1,
            () => {
              run(() => {
                state.addInstance(category.id);
              });
            },
          ),
      });
      if (collapsed.includes(classKey)) {
        continue;
      }
      if (instances.length === 0) {
        flatRows.push({
          key: `empty:${category.id}`,
          kind: "note",
          level: 2,
          classRow,
          render: () => (
            <Typography variant="caption" color="text.secondary" className={classes.emptyClass}>
              {text("No instances. Use + to add one.", "暂无实例，点击 + 添加。")}
            </Typography>
          ),
        });
      }
      for (const instance of instances) {
        const instanceRow = flatRows.length;
        const instanceKey = `instance:${instance.id}`;
        const visibleAnnotations = treeFrameIds.flatMap((id) => {
          const item = document.annotations[frameInstanceKey(id, instance.id)];
          return item ? [item] : [];
        });
        const polygonCount = visibleAnnotations.reduce(
          (sum, item) => sum + polygonsOf(item).length,
          0,
        );
        const camerasPresent = visibleAnnotations.length;
        const isPresent = treeFrameIds.some((id) => hasGeometry(id, instance.id));
        flatRows.push({
          key: instanceKey,
          kind: "instance",
          level: 2,
          classRow,
          instanceRow,
          render: () => {
            if (overview) {
              return row(
                { type: "instance", id: instance.id },
                `${isPresent ? "●" : "○"} ${instance.name || instance.id}`,
                category.color,
                text(
                  `${camerasPresent} visible cameras · ${polygonCount} polygons`,
                  `当前 ${camerasPresent} 路相机 · ${polygonCount} 块`,
                ),
                2,
                () => {
                  addPolygon(instance.id);
                },
                undefined,
                isPresent ? "present" : "absent",
              );
            }
            // The standalone workbench: one video, with a presence row around the current frame.
            const annotation =
              state.currentFrameId == undefined
                ? undefined
                : document.annotations[frameInstanceKey(state.currentFrameId, instance.id)];
            const framesPresent = videoFrames.filter((item) =>
              hasGeometry(item.id, instance.id),
            ).length;
            const byIndex = currentFrame
              ? index.frameByVideoIndex.get(currentFrame.videoId)
              : undefined;
            const presence = (
              <Stack
                direction="row"
                spacing="1px"
                aria-label={`Presence around current frame for ${instance.name}`}
                className={classes.presence}
              >
                {Array.from({ length: 41 }, (_, cell) => {
                  const offset = cell - 20;
                  const adjacent = byIndex?.get((currentFrame?.index ?? 0) + offset);
                  const presentAt = hasGeometry(adjacent?.id ?? "", instance.id);
                  return (
                    <Box
                      key={offset}
                      component="span"
                      title={`${offset === 0 ? "Current frame" : `Frame ${offset > 0 ? "+" : ""}${offset}`}: ${!adjacent ? "outside video" : presentAt ? "present" : "absent"}`}
                      className={classes.presenceCell}
                      style={{
                        height: offset === 0 ? 9 : 6,
                        backgroundColor: presentAt
                          ? category.color
                          : theme.palette.action.disabledBackground,
                        opacity: adjacent ? 1 : 0.25,
                        outline: offset === 0 ? `1px solid ${category.color}` : undefined,
                      }}
                    />
                  );
                })}
              </Stack>
            );
            return row(
              { type: "instance", id: instance.id },
              `${isPresent ? "●" : "○"} ${instance.name || instance.id}`,
              category.color,
              text(
                `${framesPresent}/${videoFrames.length} frames · ${annotation?.kind === "mask" ? "mask" : `${polygonsOf(annotation).length} polygons`}`,
                `${framesPresent}/${videoFrames.length} 帧 · ${annotation?.kind === "mask" ? "mask" : `${polygonsOf(annotation).length} 块`}`,
              ),
              2,
              () => {
                addPolygon(instance.id);
              },
              presence,
              isPresent ? "present" : "absent",
            );
          },
        });
        if (collapsed.includes(instanceKey)) {
          continue;
        }
        for (const id of treeFrameIds) {
          const frame = index.frameById.get(id);
          const video = frame ? index.videoById.get(frame.videoId) : undefined;
          const camera = segmentationCanvasLabel(video?.topic ?? video?.name);
          const polygons = polygonsOf(document.annotations[frameInstanceKey(id, instance.id)]);
          polygons.forEach((polygon, position) => {
            flatRows.push({
              key: `polygon:${instance.id}:${id}:${polygon.id}`,
              kind: "polygon",
              level: 3,
              classRow,
              instanceRow,
              render: () =>
                row(
                  { type: "polygon", id: polygon.id },
                  treeFrameIds.length > 1 && (polygon.points.length > 0 || strokeFrameId === id)
                    ? text(
                        `${camera} · Polygon ${position + 1}`,
                        `${camera} · 多边形 ${position + 1}`,
                      )
                    : text(`Polygon ${position + 1}`, `多边形 ${position + 1}`),
                  category.color,
                  polygon.points.length === 0
                    ? text("Empty polygon · add vertices", "空多边形 · 待绘制")
                    : text(`${polygon.points.length} vertices`, `${polygon.points.length} 个顶点`),
                  3,
                ),
            });
          });
          if (overview && cameraStripVisible(document, instance.id, id)) {
            flatRows.push({
              key: `strip:${instance.id}:${id}`,
              kind: "strip",
              level: 3,
              classRow,
              instanceRow,
              render: () => (
                <CameraFrameStrip
                  document={document}
                  instanceId={instance.id}
                  frameId={id}
                  camera={camera}
                  color={category.color}
                  disabled={disabled || state.drawing != undefined}
                />
              ),
            });
          }
        }
        // A mask is presence too; only an instance with neither on any shown frame is absent.
        if (camerasPresent === 0) {
          flatRows.push({
            key: `absent:${instance.id}`,
            kind: "note",
            level: 3,
            classRow,
            instanceRow,
            render: () => (
              <Typography
                variant="caption"
                color="text.secondary"
                className={classes.emptyInstance}
              >
                {text("Absent in current frame", "当前帧缺席")}
              </Typography>
            ),
          });
        }
      }
    }
  }
  const rowKeys = flatRows.map((item) => item.key);
  const virtual = useVirtualRows({
    container: treeRef,
    keys: rowKeys,
    estimate: (position) => ROW_ESTIMATE[flatRows[position]!.kind],
  });
  // Strips decide whether to show from the frames read around the shown frame, so every camera
  // the tree lists is read, including strips that are scrolled out of view.
  const stripFramesKey =
    overview && document && document.instances.length > 0 ? treeFrameIds.join("\u0000") : "";
  const latestDocument = useRef(document);
  latestDocument.current = document;
  useEffect(() => {
    const current = latestDocument.current;
    if (!current || stripFramesKey === "") {
      return;
    }
    for (const id of stripFramesKey.split("\u0000")) {
      preloadCameraStrip(current, id);
    }
  }, [stripFramesKey]);
  // The class and instance owning the first visible row stay pinned, as the sticky rows did.
  const pinnedRows: number[] = [];
  if (virtual.viewportHeight > 0 && virtual.scrollTop > 0 && flatRows.length > 0) {
    let firstVisible = Math.min(virtual.start, flatRows.length - 1);
    while (
      firstVisible < flatRows.length - 1 &&
      virtual.offsets[firstVisible + 1]! <= virtual.scrollTop
    ) {
      firstVisible++;
    }
    const owner = flatRows[firstVisible]!;
    if (virtual.offsets[owner.classRow]! < virtual.scrollTop) {
      pinnedRows.push(owner.classRow);
    }
    const classHeight = virtual.offsets[owner.classRow + 1]! - virtual.offsets[owner.classRow]!;
    if (
      owner.instanceRow != undefined &&
      virtual.offsets[owner.instanceRow]! < virtual.scrollTop + classHeight
    ) {
      pinnedRows.push(owner.instanceRow);
    }
  }
  const indentStyle = (level: number): React.CSSProperties | undefined =>
    level <= 1
      ? undefined
      : {
          paddingLeft: 25 * (level - 1),
          backgroundRepeat: "no-repeat",
          backgroundSize: "1px 100%",
          backgroundPosition: Array.from(
            { length: level - 1 },
            (_, depth) => `${12 + 25 * depth}px 0`,
          ).join(", "),
          backgroundImage: Array.from(
            { length: level - 1 },
            () => `linear-gradient(${theme.palette.divider}, ${theme.palette.divider})`,
          ).join(", "),
        };
  return (
    <Stack spacing={1} className={classes.root} onKeyDown={forwardCanvasShortcut}>
      <Box className={classes.header}>
        <Typography variant="subtitle1">{text("Instances", "实例")}</Typography>
        <Typography className={classes.headerCount} component="span">
          {text(`${instanceCount} instances`, `${instanceCount} 实例`)}
        </Typography>
      </Box>
      <ToggleButtonGroup
        exclusive
        size="small"
        className={classes.viewModes}
        value={state.viewMode}
        aria-label="Annotation display"
        onChange={(_event, value: SemanticSegmentationStore["viewMode"] | ReactNull) => {
          if (value && !disabled) {
            state.setViewMode(value);
          }
        }}
        disabled={disabled}
      >
        <ToggleButton value="original">{text("Original", "原图")}</ToggleButton>
        <ToggleButton
          value="instance"
          disabled={!state.focus}
          aria-describedby={!state.focus ? instanceHintId : undefined}
        >
          {text("Instance", "实例")}
        </ToggleButton>
        <ToggleButton value="all">{text("All", "全部")}</ToggleButton>
      </ToggleButtonGroup>
      {!state.focus && (
        <Typography id={instanceHintId} variant="caption" color="text.secondary">
          {text(
            "Select or create an instance before using Instance view.",
            "请先选择或创建实例，再使用“实例”视图。",
          )}
        </Typography>
      )}
      <Box className={classes.toolRow}>
        <Button
          size="small"
          variant="outlined"
          disabled={locked || !document || creating}
          onClick={() => {
            creationRecordId.current = document?.record.id;
            creationStore.current = store;
            setNewName("");
            setCreationError(undefined);
            setCreating(true);
          }}
        >
          {text("New", "新建")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={locked || selection.length === 0}
          onClick={() => {
            open({ type: "merge", nodes: selection });
          }}
        >
          {text("Merge", "合并")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={locked || selection.length === 0}
          onClick={() => {
            open({ type: "delete", nodes: selection });
          }}
        >
          {text("Delete", "删除")}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={locked}
          aria-pressed={selecting}
          onClick={() => {
            setSelecting((value) => !value);
            state.setSelection([]);
          }}
        >
          {text("Select", "选择")}
        </Button>
      </Box>
      <Box className={classes.secondaryTools}>
        <Button
          size="small"
          variant={state.editing ? "contained" : "text"}
          disabled={locked || !state.focus}
          aria-pressed={state.editing}
          onClick={(event) => {
            state.setEditing(!state.editing);
            if (event.detail > 0) {
              onPointerActivate?.();
            }
          }}
        >
          {state.editing ? text("Done editing", "完成编辑") : text("Edit", "编辑")}
        </Button>
        {state.focus && (
          <Button
            size="small"
            disabled={disabled}
            onClick={() => {
              state.setFocus(undefined);
            }}
          >
            {text("Clear focus", "取消聚焦")}
          </Button>
        )}
      </Box>
      {dropMessage && (
        <Typography role="status" variant="caption">
          {dropMessage}
        </Typography>
      )}
      {error && !dialog && (
        <Alert
          severity="error"
          onClose={() => {
            setError(undefined);
          }}
        >
          {error}
        </Alert>
      )}
      <Box
        ref={treeRef}
        role="tree"
        aria-label="Classes, instances and polygons"
        className={classes.tree}
      >
        {!document ? (
          <Typography color="text.secondary">
            {state.loading
              ? text("Loading annotations…", "正在加载标注…")
              : text("No annotation record is available.", "暂无标注记录。")}
          </Typography>
        ) : document.classes.length === 0 ? (
          <Typography color="text.secondary">
            {text(
              "No classes yet. Create a class, add an instance, then add a polygon.",
              "暂无类别。先点「新建」创建类别，再添加实例和多边形。",
            )}
          </Typography>
        ) : (
          <>
            {pinnedRows.length > 0 && (
              <div className={classes.pinned}>
                {pinnedRows.map((position, layer) => (
                  <div
                    key={flatRows[position]!.key}
                    className={classes.pinnedRow}
                    style={{
                      top:
                        layer === 0
                          ? 0
                          : virtual.offsets[pinnedRows[0]! + 1]! - virtual.offsets[pinnedRows[0]!]!,
                      ...indentStyle(flatRows[position]!.level),
                    }}
                  >
                    {flatRows[position]!.render()}
                  </div>
                ))}
              </div>
            )}
            <div style={{ height: virtual.offsets[virtual.start] }} />
            {flatRows.slice(virtual.start, virtual.end).map((item, offset) => {
              const position = virtual.start + offset;
              return pinnedRows.includes(position) ? (
                // Shown in the pinned layer; the slot keeps the list's geometry.
                <div
                  key={item.key}
                  style={{
                    height: virtual.offsets[position + 1]! - virtual.offsets[position]!,
                  }}
                />
              ) : (
                <div key={item.key} ref={virtual.measure(item.key)} style={indentStyle(item.level)}>
                  {item.render()}
                </div>
              );
            })}
            <div
              style={{
                height: virtual.offsets[flatRows.length]! - virtual.offsets[virtual.end]!,
              }}
            />
          </>
        )}
        {creating && (
          <Stack
            role="group"
            aria-label="New class row"
            spacing={1}
            className={classes.creationRow}
          >
            <TextField
              autoFocus
              fullWidth
              disabled={locked}
              label={text("Class name", "类别名称")}
              value={newName}
              error={creationError != undefined}
              helperText={
                creationError ?? text("Enter confirms; Esc cancels.", "Enter 确认，Esc 取消。")
              }
              slotProps={{ htmlInput: { maxLength: 100 } }}
              onChange={(event) => {
                setNewName(event.target.value);
                setCreationError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  createClass();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelCreation();
                }
              }}
            />
            <Stack direction="row" spacing={1}>
              <Button size="small" disabled={locked} onClick={createClass}>
                {text("Confirm", "确认")}
              </Button>
              <Button
                size="small"
                disabled={disabled || ["running", "stopping"].includes(state.propagation.status)}
                onClick={cancelCreation}
              >
                {text("Cancel", "取消")}
              </Button>
            </Stack>
          </Stack>
        )}
      </Box>
      <Menu
        open={menu != undefined}
        onClose={() => {
          setMenu(undefined);
        }}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
      >
        <MenuItem
          onClick={() => {
            if (menu) {
              state.setFocus(menu.node);
              state.setViewMode("instance");
              setMenu(undefined);
            }
          }}
        >
          {text(
            `Focus this ${menu?.node.type}`,
            `聚焦此${menu?.node.type === "class" ? "类别" : menu?.node.type === "instance" ? "实例" : "多边形"}`,
          )}
        </MenuItem>
        {menu && menu.node.type !== "polygon" && (
          <MenuItem
            onClick={() => {
              open({ type: "rename", node: menu.node });
              setName(
                (menu.node.type === "class" ? document?.classes : document?.instances)?.find(
                  (item) => item.id === menu.node.id,
                )?.name ?? "",
              );
            }}
          >
            {text(
              `Rename ${menu.node.type}`,
              menu.node.type === "class" ? "修改类别名称" : "修改实例名称",
            )}
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            if (menu) {
              open({ type: "merge", nodes: [menu.node] });
            }
          }}
        >
          {text("Merge into instance…", "合并到其他实例…")}
        </MenuItem>
        {menu?.node.type !== "polygon" && (
          <MenuItem
            onClick={() => {
              if (menu) {
                open({ type: "move", node: menu.node });
              }
            }}
          >
            {text("Move to class…", "移动到其他类别…")}
          </MenuItem>
        )}
        {menu?.node.type === "polygon" && (
          <MenuItem
            onClick={() => {
              const owner = document ? polygonInstance(document, menu.node.id) : undefined;
              run(() => {
                if (owner) {
                  state.setViewMode("instance");
                  state.startDrawing(owner, "polygon");
                }
              });
              setMenu(undefined);
            }}
          >
            {text("Draw another polygon", "再画一个多边形")}
          </MenuItem>
        )}
        {menu?.node.type === "instance" ? (
          [
            <MenuItem
              key="delete-current-frame"
              onClick={() => {
                setScope("frame");
                open({ type: "delete", nodes: [menu.node] });
              }}
            >
              {text("Delete instance in current frame…", "删除此实例（本帧）…")}
            </MenuItem>,
            <MenuItem
              key="delete-all-frames"
              onClick={() => {
                setScope("all");
                open({ type: "delete", nodes: [menu.node] });
              }}
            >
              {text("Delete instance in all frames…", "删除此实例（全部帧）…")}
            </MenuItem>,
          ]
        ) : (
          <MenuItem
            onClick={() => {
              if (menu) {
                setScope("all");
                open({ type: "delete", nodes: [menu.node] });
              }
            }}
          >
            {menu?.node.type === "class"
              ? text("Delete all instances…", "删除全部实例…")
              : text("Delete polygon…", "删除多边形…")}
          </MenuItem>
        )}
        {menu?.node.type === "class" && (
          <MenuItem
            onClick={() => {
              open({ type: "delete-class", id: menu.node.id });
            }}
          >
            {text("Delete class and all instances", "删除类别及全部实例")}
          </MenuItem>
        )}
      </Menu>
      <Dialog
        open={dialog != undefined}
        onClose={() => {
          setDialog(undefined);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {dialog?.type === "rename"
            ? text(
                `Rename ${dialog.node.type}`,
                dialog.node.type === "class" ? "修改类别名称" : "修改实例名称",
              )
            : dialog?.type === "merge"
              ? text("Merge into instance", "合并到实例")
              : dialog?.type === "move"
                ? text("Move to class", "移动到类别")
                : dialog?.type === "delete-class"
                  ? text("Delete class and all instances", "删除类别及全部实例")
                  : text("Delete selected annotations", "删除选中标注")}
        </DialogTitle>
        <DialogContent>
          {error && <Alert severity="error">{error}</Alert>}
          {dialog && dialog.type !== "rename" && document && (
            <Typography variant="body2" data-testid="affected-summary">
              {[
                affected.classes.length > 0 &&
                  `${text("Classes", "类别")}：${affected.classes
                    .map((id) => document.classes.find((item) => item.id === id)?.name ?? id)
                    .join("、")}`,
                affectedInstances.length > 0 &&
                  `${text("Instances", "实例")}：${affectedInstances
                    .map((id) => document.instances.find((item) => item.id === id)?.name ?? id)
                    .join("、")}`,
                affected.polygons.length > 0 &&
                  `${text("Polygons on this frame", "本帧多边形")}：${affected.polygons.length}`,
              ]
                .filter(Boolean)
                .join("；")}
            </Typography>
          )}
          {dialog && dialog.type !== "rename" && (
            <Box component="details" className={classes.affectedIds}>
              <summary>{text("IDs", "ID 详情")}</summary>
              <Box component="dl">
                <Typography component="dt" variant="caption">
                  {text("Class scope IDs", "类别范围 ID")}
                </Typography>
                <Typography component="dd" variant="caption" aria-label="Affected class IDs">
                  {affected.classes.join(", ") || "—"}
                </Typography>
                <Typography component="dt" variant="caption">
                  {text("Affected instance IDs", "受影响实例 ID")}
                </Typography>
                <Typography component="dd" variant="caption" aria-label="Affected instance IDs">
                  {affectedInstances.join(", ") || "—"}
                </Typography>
                <Typography component="dt" variant="caption">
                  {text("Selected polygon IDs (current frame)", "选中多边形 ID（本帧）")}
                </Typography>
                <Typography component="dd" variant="caption" aria-label="Affected polygon IDs">
                  {affected.polygons.join(", ") || "—"}
                </Typography>
              </Box>
            </Box>
          )}

          {dialog?.type === "rename" && (
            <TextField
              autoFocus
              fullWidth
              label={
                dialog.node.type === "instance"
                  ? text("Instance name", "实例名称")
                  : text("Class name", "类别名称")
              }
              value={name}
              slotProps={{ htmlInput: { maxLength: 100 } }}
              onChange={(event) => {
                setName(event.target.value);
              }}
              className={classes.dialogField}
            />
          )}
          {(dialog?.type === "merge" || dialog?.type === "move") && (
            <FormControl fullWidth className={classes.dialogField}>
              <InputLabel id="seg-target-label">
                {dialog.type === "merge"
                  ? text("Target instance", "目标实例")
                  : text("Target class", "目标类别")}
              </InputLabel>
              <Select
                labelId="seg-target-label"
                label={
                  dialog.type === "merge"
                    ? text("Target instance", "目标实例")
                    : text("Target class", "目标类别")
                }
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                }}
              >
                {dialog.type === "merge"
                  ? mergeTargets.map((instance) => (
                      <MenuItem key={instance.id} value={instance.id}>
                        {
                          document?.classes.find((category) => category.id === instance.classId)
                            ?.name
                        }{" "}
                        / {instance.name} ({instance.id})
                      </MenuItem>
                    ))
                  : document?.classes
                      .filter(
                        (category) =>
                          classFor(dialog.node) !== category.id &&
                          (!dialogDragSource.current ||
                            canDropNode(
                              document,
                              dialogDragSource.current,
                              { type: "class", id: category.id },
                              state.focus,
                            )),
                      )
                      .map((category) => (
                        <MenuItem key={category.id} value={category.id}>
                          {category.name} ({category.id})
                        </MenuItem>
                      ))}
              </Select>
            </FormControl>
          )}
          {dialog?.type === "merge" && (
            <Typography variant="body2" className={classes.dialogField}>
              {text(
                "Instances merge across all frames and keep the destination ID. Selected polygons move only in the current frame.",
                "实例将合并全部帧并保留目标实例 ID；选中的多边形仅在本帧移动。",
              )}
            </Typography>
          )}
          {dialog?.type === "move" && (
            <Typography variant="body2" className={classes.dialogField}>
              {text(
                "This category move applies across all frames and keeps every instance ID.",
                "类别移动将应用于全部帧，并保留所有实例 ID。",
              )}
            </Typography>
          )}
          {dialog?.type === "merge" && mergeTargets.length === 0 && (
            <Typography color="text.secondary">
              {text("Add another instance before merging.", "请先创建另一个实例，再进行合并。")}
            </Typography>
          )}
          {dialog?.type === "delete-class" && (
            <Typography>
              {text(
                "This removes the class and retires all of its instances across all frames. Other classes remain unchanged.",
                "此操作将删除类别及其全部帧实例，其他类别不受影响。",
              )}
            </Typography>
          )}
          {dialog?.type === "delete" && (
            <>
              <Typography>
                {text(
                  "Selected polygons are deleted only in this frame. For classes and instances, choose the deletion scope. Empty classes remain available.",
                  "多边形仅在本帧删除；类别和实例请明确选择删除范围，空类别将保留。",
                )}
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={scope}
                onChange={(_event, value: "frame" | "all" | ReactNull) => {
                  if (value) {
                    setScope(value);
                  }
                }}
                className={classes.scope}
              >
                <ToggleButton value="frame">{text("Current frame", "本帧")}</ToggleButton>
                <ToggleButton value="all">{text("All frames", "全部帧")}</ToggleButton>
              </ToggleButtonGroup>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDialog(undefined);
            }}
          >
            {text("Cancel", "取消")}
          </Button>
          <Button
            disabled={
              locked ||
              ((dialog?.type === "merge" || dialog?.type === "move") && !target) ||
              (dialog?.type === "rename" && !name.trim())
            }
            onClick={confirm}
          >
            {dialog?.type === "delete" || dialog?.type === "delete-class"
              ? text("Delete", "删除")
              : text("Confirm", "确认")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

export default SpatialTree;
