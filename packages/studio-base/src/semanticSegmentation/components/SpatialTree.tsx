// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Alert, Box, Stack, Typography } from "@mui/material";
import { makeStyles } from "tss-react/mui";
import type { StoreApi } from "zustand";

import type { SemanticSegmentationStore } from "../types";
import { ClassCreationRow } from "./spatialTree/ClassCreationRow";
import { TreeContextMenu } from "./spatialTree/TreeContextMenu";
import { TreeDialogView } from "./spatialTree/TreeDialogView";
import { TreeList } from "./spatialTree/TreeList";
import { TreeToolbar } from "./spatialTree/TreeToolbar";
import { flatTreeRows } from "./spatialTree/flatTreeRows";
import { confirmDialog } from "./spatialTree/treeCommands";
import { canMergeNodes } from "./spatialTree/treeLogic";
import { forwardCanvasShortcut } from "./spatialTree/treeShortcuts";
import { useMenuActions, useRowActions, useToolbarActions } from "./spatialTree/useTreeActions";
import { useClassCreation, useTreeDialog, useTreeDrag } from "./spatialTree/useTreeDialog";
import { useInteractionReset, useStripPreload } from "./spatialTree/useTreeIndex";
import { useTreeShell } from "./spatialTree/useTreeShell";
import { useStableCallback } from "./useStableCallback";

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
  tree: { display: "flex", flexDirection: "column", overflow: "hidden", flex: 1, minHeight: 80 },
}));

export type SpatialTreeProps = {
  store: StoreApi<SemanticSegmentationStore>;
  disabled?: boolean;
  onPointerActivate?: () => void;
};

export function SpatialTree({
  store,
  disabled = false,
  onPointerActivate,
}: SpatialTreeProps): React.JSX.Element {
  const { classes } = useStyles();
  const shell = useTreeShell({ store, disabled });
  const { env, hintId, collapsed, setCollapsed, setSelecting, error, setError } = shell;
  const { state, document, selection, selecting, locked, t } = env;
  const dlg = useTreeDialog(env);
  const drag = useTreeDrag();
  const creation = useClassCreation(env);
  useInteractionReset(store, state.interactionResetVersion, () => {
    setSelecting(false);
    dlg.reset();
    creation.reset();
    setError(undefined);
    drag.reset();
  });
  useStripPreload({ document, overview: shell.overview, treeFrameIds: shell.treeFrameIds });

  const deps = { env, dlg, drag, creation, setCollapsed, setSelecting, onPointerActivate };
  const rowActions = useRowActions(deps);
  const toolbarActions = useToolbarActions(deps);
  const menuActions = useMenuActions(deps);
  const rows = flatTreeRows({
    document,
    sourceFrames: env.host.sourceFrames,
    index: shell.index,
    t,
    treeFrameIds: shell.treeFrameIds,
    overview: shell.overview,
    collapsed,
    currentFrameId: state.currentFrameId,
    drawing: state.drawing != undefined,
    disabled,
    locked,
    selection,
    focus: state.focus,
    selecting,
    dragSource: drag.dragSource,
    dropTarget: drag.dropTarget,
    hintId,
    actions: rowActions,
  });
  const confirm = useStableCallback(() => {
    confirmDialog(env, dlg);
  });
  const closeDialog = useStableCallback(() => {
    dlg.setDialog(undefined);
  });
  const dismissError = useStableCallback(() => {
    setError(undefined);
  });

  return (
    <Stack spacing={1} className={classes.root} onKeyDown={forwardCanvasShortcut}>
      <TreeToolbar
        instanceCount={document?.instances.length ?? 0}
        viewMode={state.viewMode}
        hasFocus={state.focus != undefined}
        editing={state.editing}
        selecting={selecting}
        disabled={disabled}
        locked={locked}
        newDisabled={locked || !document || creation.creating}
        mergeDisabled={locked || !canMergeNodes(selection, state)}
        deleteDisabled={locked || selection.length === 0}
        hintId={hintId}
        actions={toolbarActions}
      />
      {drag.dropMessage && (
        <Typography role="status" variant="caption">
          {drag.dropMessage}
        </Typography>
      )}
      {error && !dlg.dialog && (
        <Alert severity="error" onClose={dismissError}>
          {error}
        </Alert>
      )}
      <Box role="tree" aria-label={t("treeLabel")} className={classes.tree}>
        {!document ? (
          <Typography color="text.secondary">
            {state.loading ? t("loadingAnnotations") : t("noAnnotationRecordAvailable")}
          </Typography>
        ) : document.classes.length === 0 ? (
          <Typography color="text.secondary">{t("noClasses")}</Typography>
        ) : (
          <TreeList rows={rows} />
        )}
        {creation.creating && (
          <ClassCreationRow
            name={creation.newName}
            error={creation.creationError}
            locked={locked}
            cancelDisabled={disabled || ["running", "stopping"].includes(state.propagationStatus)}
            onName={(value) => {
              creation.setNewName(value);
              creation.setCreationError(undefined);
            }}
            onConfirm={creation.create}
            onCancel={creation.cancel}
          />
        )}
      </Box>
      <TreeContextMenu
        menu={dlg.menu}
        canMerge={dlg.menu != undefined && canMergeNodes([dlg.menu.node], state)}
        actions={menuActions}
      />
      <TreeDialogView
        dialog={dlg.dialog}
        document={document}
        focus={state.focus}
        dragged={dlg.dialogDragSource.current}
        error={error}
        name={dlg.name}
        target={dlg.target}
        scope={dlg.scope}
        locked={locked}
        onName={dlg.setName}
        onTarget={dlg.setTarget}
        onScope={dlg.setScope}
        onClose={closeDialog}
        onConfirm={confirm}
      />
    </Stack>
  );
}
