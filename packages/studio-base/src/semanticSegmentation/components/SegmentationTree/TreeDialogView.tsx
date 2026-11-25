// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import {
  affectedInstancesOf,
  dialogNodesOf,
  dialogTitleKey,
  mergeTargetsOf,
  moveTargetsOf,
} from "./treeLogic";
import type { TreeDialog } from "./treeTypes";
import { compactSelection } from "../../editorTree";
import type { SegmentationDocument, SegmentationNodeRef } from "../../types";

const useStyles = makeStyles()((theme) => ({
  dialogField: { marginTop: theme.spacing(1) },
  affectedIds: {
    margin: 0,
    marginBottom: theme.spacing(2),
    wordBreak: "break-word",
    "& dd": { margin: 0, fontFamily: "monospace" },
  },
  scope: { marginTop: theme.spacing(2) },
}));

type Affected = {
  compact: ReturnType<typeof compactSelection>;
  instances: string[];
};

function AffectedSummary({
  dialog,
  document,
  affected,
}: {
  dialog: TreeDialog;
  document: SegmentationDocument | undefined;
  affected: Affected;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  const { compact, instances } = affected;
  const names = (ids: string[], items: readonly { id: string; name: string }[]) =>
    ids.map((id) => items.find((item) => item.id === id)?.name ?? id).join("、");
  return (
    <>
      {dialog.type !== "rename" && document && (
        <Typography variant="body2" data-testid="affected-summary">
          {[
            compact.classes.length > 0 &&
              `${t("classes")}：${names(compact.classes, document.classes)}`,
            instances.length > 0 && `${t("instances")}：${names(instances, document.instances)}`,
            compact.polygons.length > 0 && `${t("polygonsFrame")}：${compact.polygons.length}`,
          ]
            .filter(Boolean)
            .join("；")}
        </Typography>
      )}
      {dialog.type !== "rename" && (
        <Box component="details" className={classes.affectedIds}>
          <summary>{t("idDetails")}</summary>
          <Box component="dl">
            <Typography component="dt" variant="caption">
              {t("classScopeIds")}
            </Typography>
            <Typography component="dd" variant="caption" aria-label={t("affectedClassIds")}>
              {compact.classes.join(", ") || "—"}
            </Typography>
            <Typography component="dt" variant="caption">
              {t("affectedInstanceIds")}
            </Typography>
            <Typography component="dd" variant="caption" aria-label={t("affectedInstanceIds")}>
              {instances.join(", ") || "—"}
            </Typography>
            <Typography component="dt" variant="caption">
              {t("selectedPolygonIds")}
            </Typography>
            <Typography component="dd" variant="caption" aria-label={t("affectedPolygonIds")}>
              {compact.polygons.join(", ") || "—"}
            </Typography>
          </Box>
        </Box>
      )}
    </>
  );
}

type FieldsProps = {
  dialog: TreeDialog | undefined;
  document: SegmentationDocument | undefined;
  focus: SegmentationNodeRef | undefined;
  dragged: SegmentationNodeRef | undefined;
  name: string;
  target: string;
  scope: "frame" | "all";
  onName: (value: string) => void;
  onTarget: (value: string) => void;
  onScope: (value: "frame" | "all") => void;
};

type TargetSelectProps = Pick<
  FieldsProps,
  "document" | "focus" | "dragged" | "target" | "onTarget"
> & { dialog: TreeDialog };

function TargetSelect({
  dialog,
  document,
  focus,
  dragged,
  target,
  onTarget,
}: TargetSelectProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  const merge = dialog.type === "merge";
  const label = merge ? t("targetInstance") : t("targetClass");
  return (
    <FormControl fullWidth className={classes.dialogField}>
      <InputLabel id="seg-target-label">{label}</InputLabel>
      <Select
        labelId="seg-target-label"
        label={label}
        value={target}
        onChange={(event) => {
          onTarget(event.target.value);
        }}
      >
        {merge
          ? mergeTargetsOf(document, dialog, dragged, focus).map((instance) => (
              <MenuItem key={instance.id} value={instance.id}>
                {document?.classes.find((category) => category.id === instance.classId)?.name} /{" "}
                {instance.name} ({instance.id})
              </MenuItem>
            ))
          : document != undefined && dialog.type === "move"
            ? moveTargetsOf(document, dialog.node, dragged, focus).map((category) => (
                <MenuItem key={category.id} value={category.id}>
                  {category.name} ({category.id})
                </MenuItem>
              ))
            : []}
      </Select>
    </FormControl>
  );
}

function DialogFields(props: FieldsProps): React.JSX.Element {
  const { dialog, document, focus, dragged, name, scope, onName, onScope } = props;
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  return (
    <>
      {dialog?.type === "rename" && (
        <TextField
          autoFocus
          fullWidth
          label={dialog.node.type === "instance" ? t("instanceName") : t("className")}
          value={name}
          slotProps={{ htmlInput: { maxLength: 100 } }}
          onChange={(event) => {
            onName(event.target.value);
          }}
          className={classes.dialogField}
        />
      )}
      {(dialog?.type === "merge" || dialog?.type === "move") && (
        <TargetSelect {...props} dialog={dialog} />
      )}
      {dialog?.type === "merge" && (
        <Typography variant="body2" className={classes.dialogField}>
          {t("mergeHint")}
        </Typography>
      )}
      {dialog?.type === "move" && (
        <Typography variant="body2" className={classes.dialogField}>
          {t("moveHint")}
        </Typography>
      )}
      {dialog?.type === "merge" &&
        mergeTargetsOf(document, dialog, dragged, focus).length === 0 && (
          <Typography color="text.secondary">{t("mergeNeedsAnotherInstance")}</Typography>
        )}
      {dialog?.type === "delete-class" && <Typography>{t("deleteClassHint")}</Typography>}
      {dialog?.type === "delete" && (
        <>
          <Typography>{t("deleteSelectionHint")}</Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={scope}
            onChange={(_event, value: "frame" | "all" | ReactNull) => {
              if (value) {
                onScope(value);
              }
            }}
            className={classes.scope}
          >
            <ToggleButton value="frame">{t("currentFrame")}</ToggleButton>
            <ToggleButton value="all">{t("allFrames")}</ToggleButton>
          </ToggleButtonGroup>
        </>
      )}
    </>
  );
}

type TreeDialogViewProps = FieldsProps & {
  error: string | undefined;
  locked: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

/** The rename, merge, move and delete confirmation dialog. */
export const TreeDialogView = memo(function TreeDialogView(
  props: TreeDialogViewProps,
): React.JSX.Element {
  const { dialog, document, error, name, target, locked, onClose, onConfirm } = props;
  const { t } = useTranslation("segmentation");
  const compact = document
    ? compactSelection(document, dialogNodesOf(dialog))
    : { classes: [], instances: [], polygons: [] };
  const instances = document
    ? affectedInstancesOf(document, compact).filter(
        (id) => dialog?.type !== "merge" || id !== target,
      )
    : [];
  return (
    <Dialog open={dialog != undefined} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t(dialogTitleKey(dialog))}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error">{error}</Alert>}
        {dialog && (
          <AffectedSummary dialog={dialog} document={document} affected={{ compact, instances }} />
        )}
        <DialogFields {...props} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("cancel")}</Button>
        <Button
          disabled={
            locked ||
            ((dialog?.type === "merge" || dialog?.type === "move") && !target) ||
            (dialog?.type === "rename" && !name.trim())
          }
          onClick={onConfirm}
        >
          {dialog?.type === "delete" || dialog?.type === "delete-class"
            ? t("delete")
            : t("confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
});
