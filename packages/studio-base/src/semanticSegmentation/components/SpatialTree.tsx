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
import type { ReactNode } from "react";
import { makeStyles } from "tss-react/mui";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";

import { segmentationSession } from "../runtime";
import { segmentationCanvasLabel } from "../segmentationChrome";
import { frameInstanceKey } from "../service";
import { filterSegmentationSelection } from "../store";
import type { SemanticSegmentationStore, SegmentationNodeRef } from "../types";
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
  headerCount: { color: theme.palette.text.secondary, fontSize: 12, whiteSpace: "nowrap" },
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
  children: {
    marginLeft: theme.spacing(1.5),
    paddingLeft: theme.spacing(1.5),
    borderLeft: `1px solid ${theme.palette.divider}`,
  },
  disclosure: { width: 28, flexShrink: 0, display: "flex", justifyContent: "center" },
  // Class and instance rows pin to the top of the scrolling tree while their children are in
  // view (the sticky element is bounded by its own treeitem). Instance rows pin just below the
  // class row, whose measured height is published as --seg-class-row-h. Backgrounds must be
  // opaque so scrolled content does not show through, so they live on a wrapper around the row,
  // letting the row keep its own translucent selection/drop tint.
  stickyClass: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    backgroundColor: theme.palette.background.paper,
  },
  stickyInstance: {
    position: "sticky",
    top: "var(--seg-class-row-h, 44px)",
    zIndex: 1,
    backgroundColor: theme.palette.background.paper,
  },
  selected: { backgroundColor: theme.palette.action.selected },
  drop: { backgroundColor: theme.palette.action.hover },
  // Design uses small color squares on class/polygon rows; keep dots for compact density.
  dot: { width: 10, height: 10, flexShrink: 0, borderRadius: 2, marginRight: 6 },
  presenceText: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
  },
  rowButton: {
    minWidth: 0,
    flex: 1,
    textTransform: "none",
    justifyContent: "flex-start",
    overflow: "hidden",
  },
  labelStack: { minWidth: 0 },
  label: { maxWidth: 160 },
  tree: { overflowY: "auto", flex: 1, minHeight: 80 },
  emptyClass: { paddingLeft: theme.spacing(3) },
  emptyInstance: { paddingLeft: theme.spacing(5) },
  presence: { marginTop: theme.spacing(0.25) },
  presenceCell: { width: 3, backgroundColor: theme.palette.action.disabledBackground },
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
  const strokeFrameId = useStore(segmentationSession, (session) => session.strokeFrameId);
  const text = useEditorText();
  const document = state.document;
  const treeFrameIds = state.currentFrameId ? [state.currentFrameId] : [];
  const selection = document
    ? filterSegmentationSelection(document, state.selection, state.currentFrameId)
    : [];
  const instanceHintId = useId();
  const locked =
    disabled || state.readonly || ["running", "stopping"].includes(state.propagation.status);
  const [selecting, setSelecting] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ node: SegmentationNodeRef; x: number; y: number }>();
  const [dialog, setDialog] = useState<TreeDialog>();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [creationError, setCreationError] = useState<string>();
  const creationRecordId = useRef<string>();
  const creationStore = useRef(store);
  const [target, setTarget] = useState("");
  const [scope, setScope] = useState<"frame" | "all">("frame");
  const [error, setError] = useState<string>();
  const [dragSource, setDragSource] = useState<SegmentationNodeRef>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [dropMessage, setDropMessage] = useState<string>();
  const dragContext = useRef<{ key: string; document: typeof document }>();
  const dialogDragSource = useRef<SegmentationNodeRef>();
  const dialogContext = useRef<{ key: string; document: typeof document }>();
  const videoId = document?.frames.find((frame) => frame.id === state.currentFrameId)?.videoId;
  const contextKey = `${document?.record.id}:${videoId}:${state.currentFrameId}:${state.viewingRevisionId}:${state.revisions[0]?.id}:${state.viewMode}:${state.readonly}:${state.focus?.type}:${state.focus?.id}`;
  const previousReset = useRef({ store, version: state.interactionResetVersion });
  const treeRef = useRef<HTMLDivElement>(ReactNull);

  // Publish the class row height so pinned instance rows sit directly beneath the pinned class.
  useEffect(() => {
    const tree = treeRef.current;
    const classRow = tree?.querySelector<HTMLElement>('[data-tree-level="1"]');
    if (tree && classRow && classRow.offsetHeight > 0) {
      tree.style.setProperty("--seg-class-row-h", `${classRow.offsetHeight}px`);
    }
  });

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
      item.polygons.some((polygon) => polygon.id === node.id),
    );
    if (!owner || owner.frameId === state.currentFrameId) {
      return true;
    }
    if (state.drawingPolygonId != undefined) {
      setError(
        text(
          "Finish the polygon on the current canvas before switching.",
          "先完成当前画布上的多边形，再标注另一路。",
        ),
      );
      return false;
    }
    // Editing never claims a frame from another camera through a tree row.
    const currentVideo = document.frames.find(
      (frame) => frame.id === state.currentFrameId,
    )?.videoId;
    if (document.frames.find((frame) => frame.id === owner.frameId)?.videoId !== currentVideo) {
      return false;
    }
    state.setCurrentFrame(owner.frameId);
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
      const id = state.addPolygon(instanceId);
      state.setViewMode(state.viewMode === "original" ? "all" : state.viewMode);
      state.setFocus({ type: "instance", id: instanceId });
      state.setSelection([{ type: "polygon", id }]);
      state.setEditing(true);
      state.setDrawingPolygonId(id);
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
      if (
        dialogContext.current?.key !== contextKey ||
        dialogContext.current.document !== document
      ) {
        throw new Error(
          text(
            "The frame or view changed. Reopen this action.",
            "帧或视图已改变，请重新打开此操作。",
          ),
        );
      }
      if (
        dialogDragSource.current &&
        document &&
        (dialog.type === "merge" || dialog.type === "move")
      ) {
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
          for (const id of document ? nodeInstances(document, dialog.node) : []) {
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
          if (state.editing && state.drawingPolygonId == undefined) {
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
        <Box
          className={cx(
            node.type === "class" && classes.stickyClass,
            node.type === "instance" && classes.stickyInstance,
          )}
          data-tree-level={level}
        >
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
              <Stack alignItems="flex-start" className={classes.labelStack}>
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
                onClick={() => {
                  open({ type: "delete", nodes: [node] });
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
  // Set when the focused node is a polygon in the current frame that has no vertices yet.
  const emptyFocusedPolygonId =
    document && state.focus?.type === "polygon"
      ? Object.values(document.annotations)
          .filter((item) => item.frameId === state.currentFrameId)
          .flatMap((item) => item.polygons)
          .find((polygon) => polygon.id === state.focus?.id && polygon.points.length === 0)?.id
      : undefined;
  return (
    <Stack spacing={1} className={classes.root}>
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
            if (!state.editing && emptyFocusedPolygonId != undefined) {
              // A polygon without vertices has nothing to edit yet: start drawing it.
              if (state.viewMode === "original") {
                state.setViewMode("all");
              }
              state.setDrawingPolygonId(emptyFocusedPolygonId);
            } else {
              state.setEditing(!state.editing);
              state.setDrawingPolygonId(undefined);
            }
            if (event.detail > 0) {
              onPointerActivate?.();
            }
          }}
        >
          {state.editing
            ? text("Done editing", "完成编辑")
            : emptyFocusedPolygonId != undefined
              ? text("Draw", "绘制")
              : text("Edit", "编辑")}
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
      {state.readonly && (
        <Alert severity="info">
          {text("Historical revision: editing is disabled.", "历史版本：编辑已禁用。")}
        </Alert>
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
          document.classes.map((category) => {
            const instances = document.instances.filter(
              (instance) => instance.classId === category.id,
            );
            const present = instances.filter(
              (instance) =>
                (document.annotationSummaries[
                  frameInstanceKey(state.currentFrameId ?? "", instance.id)
                ]?.pointCount ?? 0) > 0,
            ).length;
            return row(
              { type: "class", id: category.id },
              category.name,
              category.color,
              text(
                `${present} present / ${instances.length} total`,
                `本帧 ${present} / 共 ${instances.length} 个实例`,
              ),
              1,
              () => {
                run(() => {
                  state.addInstance(category.id);
                });
              },
              undefined,
              undefined,
              !collapsed.includes(`class:${category.id}`) && (
                <Box role="group" className={classes.children}>
                  {instances.length === 0 && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      className={classes.emptyClass}
                    >
                      {text("No instances. Use + to add one.", "暂无实例，点击 + 添加。")}
                    </Typography>
                  )}
                  {instances.map((instance) => {
                    const annotation = Object.values(document.annotations).find(
                      (item) =>
                        item.frameId === state.currentFrameId && item.instanceId === instance.id,
                    );

                    const currentFrame = document.frames.find(
                      (item) => item.id === state.currentFrameId,
                    );
                    const videoFrames = document.frames.filter(
                      (item) => item.videoId === currentFrame?.videoId,
                    );
                    const isPresent =
                      (document.annotationSummaries[
                        frameInstanceKey(state.currentFrameId ?? "", instance.id)
                      ]?.pointCount ?? 0) > 0;
                    const framesPresent = videoFrames.filter(
                      (item) =>
                        (document.annotationSummaries[frameInstanceKey(item.id, instance.id)]
                          ?.pointCount ?? 0) > 0,
                    ).length;
                    const presence = (
                      <Stack
                        direction="row"
                        spacing="1px"
                        aria-label={`Presence around current frame for ${instance.name}`}
                        className={classes.presence}
                      >
                        {Array.from({ length: 41 }, (_, index) => {
                          const offset = index - 20;
                          const adjacent = videoFrames.find(
                            (item) => item.index === (currentFrame?.index ?? 0) + offset,
                          );
                          const presentAt =
                            (document.annotationSummaries[
                              frameInstanceKey(adjacent?.id ?? "", instance.id)
                            ]?.pointCount ?? 0) > 0;
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
                        `${framesPresent}/${videoFrames.length} frames · ${annotation?.polygons.length ?? 0} polygons`,
                        `${framesPresent}/${videoFrames.length} 帧 · ${annotation?.polygons.length ?? 0} 块`,
                      ),
                      2,
                      () => {
                        addPolygon(instance.id);
                      },
                      presence,
                      isPresent ? "present" : "absent",
                      !collapsed.includes(`instance:${instance.id}`) && (
                        <Box role="group" className={classes.children}>
                          {treeFrameIds.flatMap((id) => {
                            const frame = document.frames.find((item) => item.id === id);
                            const video = document.videos.find(
                              (item) => item.id === frame?.videoId,
                            );
                            const camera = segmentationCanvasLabel(video?.topic ?? video?.name);
                            const polygons =
                              Object.values(document.annotations).find(
                                (item) => item.frameId === id && item.instanceId === instance.id,
                              )?.polygons ?? [];
                            return polygons.map((polygon, index) =>
                              row(
                                { type: "polygon", id: polygon.id },
                                treeFrameIds.length > 1 &&
                                  (polygon.points.length > 0 || strokeFrameId === id)
                                  ? text(
                                      `${camera} · Polygon ${index + 1}`,
                                      `${camera} · 多边形 ${index + 1}`,
                                    )
                                  : text(`Polygon ${index + 1}`, `多边形 ${index + 1}`),
                                category.color,
                                polygon.points.length === 0
                                  ? text("Empty polygon · add vertices", "空多边形 · 待绘制")
                                  : text(
                                      `${polygon.points.length} vertices`,
                                      `${polygon.points.length} 个顶点`,
                                    ),
                                3,
                              ),
                            );
                          })}
                          {treeFrameIds.every(
                            (id) =>
                              (Object.values(document.annotations).find(
                                (item) => item.frameId === id && item.instanceId === instance.id,
                              )?.polygons.length ?? 0) === 0,
                          ) && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              className={classes.emptyInstance}
                            >
                              {text("Absent in current frame", "当前帧缺席")}
                            </Typography>
                          )}
                        </Box>
                      ),
                    );
                  })}
                </Box>
              ),
            );
          })
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
              const node = menu.node;
              run(() => {
                state.setFocus(node);
                state.setViewMode("instance");
                state.setEditing(true);
                state.setDrawingPolygonId(node.id);
              });
              setMenu(undefined);
            }}
          >
            {text("Draw / replace polygon", "绘制 / 替换多边形")}
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
          {dialog && dialog.type !== "rename" && (
            <Box component="dl" className={classes.affectedIds}>
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
