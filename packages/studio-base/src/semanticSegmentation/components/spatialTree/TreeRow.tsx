// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Box, Button, Checkbox, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { PresenceStrip } from "./PresenceStrip";
import type { TreeRowActions } from "./treeRowActions";
import type { SegmentationNodeRef } from "../../types";

const useStyles = makeStyles()((theme) => ({
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
}));

export type TreeRowProps = {
  node: SegmentationNodeRef;
  label: string;
  color: string;
  detail: string;
  level: number;
  selected: boolean;
  indeterminate: boolean;
  focused: boolean;
  collapsed: boolean;
  /** The row a drag would drop onto. */
  isDrop: boolean;
  /** Fades the row being dragged. */
  opacity: number;
  withinFocus: boolean;
  selecting: boolean;
  locked: boolean;
  disabled: boolean;
  presence?: "present" | "absent";
  /** Cells of the single-video presence strip, for instance rows, and the name it announces. */
  strip?: string;
  stripName?: string;
  hintId: string;
  actions: TreeRowActions;
};

type RowLabelProps = Pick<TreeRowProps, "node" | "label" | "presence">;

function RowLabel({ node, label, presence }: RowLabelProps): React.JSX.Element {
  const { theme } = useStyles();
  if (presence == undefined) {
    return <>{label}</>;
  }
  return (
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
  );
}

type RowButtonsProps = Pick<TreeRowProps, "node" | "label" | "locked" | "actions">;

function RowButtons({ node, label, locked, actions }: RowButtonsProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  return (
    <>
      {node.type !== "polygon" && (
        <Tooltip title={node.type === "class" ? t("addInstanceTooltip") : t("annotateInstance")}>
          <IconButton
            size="small"
            disabled={locked}
            className={classes.addButton}
            aria-label={
              node.type === "class"
                ? t("addInstanceTo", { name: label })
                : t("annotateNode", { name: label })
            }
            onClick={() => {
              actions.add(node);
            }}
          >
            +
          </IconButton>
        </Tooltip>
      )}
      {node.type === "polygon" && (
        <IconButton
          size="small"
          disabled={locked}
          aria-label={t("deleteNode", { label })}
          title={t("deleteUndoable")}
          onClick={() => {
            actions.deletePolygon(node.id);
          }}
        >
          ×
        </IconButton>
      )}
      <IconButton
        size="small"
        disabled={locked}
        aria-label={t("nodeActions", { label })}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          actions.openMenu(node, rect.left, rect.bottom);
        }}
      >
        ⋮
      </IconButton>
    </>
  );
}

type RowBodyProps = Pick<
  TreeRowProps,
  | "node"
  | "label"
  | "color"
  | "detail"
  | "presence"
  | "strip"
  | "stripName"
  | "hintId"
  | "disabled"
  | "actions"
>;

function RowBody({
  node,
  label,
  color,
  detail,
  presence,
  strip,
  stripName,
  hintId,
  disabled,
  actions,
}: RowBodyProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  const aux =
    strip == undefined ? undefined : (
      <PresenceStrip instanceName={stripName ?? ""} color={color} cells={strip} />
    );
  return (
    <>
      <Box className={classes.dot} style={{ backgroundColor: color }} />
      <Button
        size="small"
        color="inherit"
        disabled={disabled}
        data-tree-primary=""
        aria-label={presence != undefined ? label : undefined}
        aria-describedby={presence != undefined ? `${hintId}-presence-${node.id}` : undefined}
        onClick={(event) => {
          actions.choose(node);
          if (event.detail > 0) {
            actions.activate();
          }
        }}
        className={classes.rowButton}
      >
        <Stack className={classes.labelStack}>
          <Typography variant="body2" noWrap className={classes.label}>
            <RowLabel node={node} label={label} presence={presence} />
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {detail}
          </Typography>
          {aux}
        </Stack>
      </Button>
      {presence != undefined && (
        <Box component="span" id={`${hintId}-presence-${node.id}`} className={classes.presenceText}>
          {presence === "present" ? t("presentCurrentFrame") : t("absentCurrentFrame")}
        </Box>
      )}
    </>
  );
}

/** One class, instance or polygon row. All props are primitives, so unchanged rows skip renders. */
export const TreeRow = memo(function TreeRow({
  node,
  label,
  color,
  detail,
  level,
  selected,
  indeterminate,
  focused,
  collapsed,
  isDrop,
  opacity,
  withinFocus,
  selecting,
  locked,
  disabled,
  presence,
  strip,
  stripName,
  hintId,
  actions,
}: TreeRowProps): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("segmentation");
  const key = `${node.type}:${node.id}`;
  return (
    <Box
      role="treeitem"
      aria-level={level}
      aria-selected={selected}
      aria-expanded={node.type === "polygon" ? undefined : !collapsed}
      aria-label={label}
      title={withinFocus ? node.id : t("selectBeforeDrag")}
      data-node-type={node.type}
      data-node-id={node.id}
      draggable={!locked && withinFocus}
      onDragStart={(event) => {
        actions.dragStart(event, node);
      }}
      onDragEnd={actions.dragEnd}
      onDragOver={(event) => {
        actions.dragOver(event, node, label);
      }}
      onDragLeave={actions.dragLeave}
      onDrop={(event) => {
        actions.drop(event, node);
      }}
      onContextMenu={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if (!locked) {
          actions.openMenu(node, event.clientX, event.clientY);
        }
      }}
      onDoubleClick={(event) => {
        actions.editPolygon(event, node);
      }}
      onKeyDown={(event) => {
        actions.enterKey(event, node);
      }}
    >
      <Box data-tree-level={level}>
        <Box
          className={cx(classes.row, selected && classes.selected, isDrop && classes.drop)}
          data-tree-row=""
          style={{
            borderColor: isDrop || focused ? color : "transparent",
            borderWidth: isDrop ? "0.5px" : "1px",
            opacity,
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
                actions.choose(node);
              }}
            />
          )}
          <Box className={classes.disclosure}>
            {node.type !== "polygon" && (
              <IconButton
                size="small"
                aria-label={t(collapsed ? "expandNode" : "collapseNode", { label })}
                onClick={() => {
                  actions.toggleCollapsed(key);
                }}
              >
                {collapsed ? "▸" : "▾"}
              </IconButton>
            )}
          </Box>
          <RowBody
            node={node}
            label={label}
            color={color}
            detail={detail}
            presence={presence}
            strip={strip}
            stripName={stripName}
            hintId={hintId}
            disabled={disabled}
            actions={actions}
          />
          <RowButtons node={node} label={label} locked={locked} actions={actions} />
        </Box>
      </Box>
    </Box>
  );
});
