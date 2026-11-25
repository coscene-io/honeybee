// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import LinkIcon from "@mui/icons-material/Link";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import type { SegmentationDocument, SegmentationStore } from "../types";

/**
 * A reference to a class or instance, as stored in Moment metadata: \`spatial://<record>/<class|instance>/<id>\`.
 * This format is persisted outside the editor, so it carries only what identifies the target: the
 * record, the kind and the id (a UUID within the record). It names no camera, quality or player,
 * which can change without the target changing.
 */
export type SpatialReference = {
  recordId: string;
  targetType: "class" | "instance";
  targetId: string;
};

export function encodeSpatialReference(
  recordId: string,
  targetType: "class" | "instance",
  targetId: string,
): string {
  return `spatial://${encodeURIComponent(recordId)}/${targetType}/${encodeURIComponent(targetId)}`;
}

export function parseSpatialReference(value: string): SpatialReference | undefined {
  // A camera segment, written by earlier builds, is read and ignored.
  const match = /^spatial:\/\/([^/]+)\/(?:[^/]+\/)?(class|instance)\/([^/]+)$/.exec(value);
  if (!match) {
    return undefined;
  }
  try {
    return {
      recordId: decodeURIComponent(match[1]!),
      targetType: match[2] as "class" | "instance",
      targetId: decodeURIComponent(match[3]!),
    };
  } catch {
    return undefined;
  }
}

/** A readable label for a `spatial://` reference, or undefined when `value` is not one. */
export function resolveSpatialReference(
  value: string,
  document: SegmentationDocument | undefined,
  t: TFunction<"segmentation">,
): string | undefined {
  const reference = parseSpatialReference(value);
  if (!reference) {
    return undefined;
  }
  const { recordId, targetType, targetId } = reference;
  if (document?.record.id !== recordId) {
    return t(targetType === "class" ? "referenceClassClosed" : "referenceInstanceClosed", {
      id: targetId,
    });
  }
  const target = (targetType === "class" ? document.classes : document.instances).find(
    (item) => item.id === targetId,
  );
  if (!target) {
    return t("referenceDeleted", { id: targetId });
  }
  return t(targetType === "class" ? "referenceClass" : "referenceInstance", {
    name: target.name || t("unnamed"),
    id: targetId,
  });
}

/**
 * A small link icon meant to sit inside the attribute value field (end adornment). It opens a
 * dialog that inserts a stable reference to a class or instance of the open record.
 */
export function MomentReferencePicker({
  store,
  value,
  onChange,
  disabled = false,
}: {
  store: StoreApi<SegmentationStore>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation("segmentation");
  const document = useStore(store, (state) => state.document);
  const currentFrameId = useStore(store, (state) => state.currentFrameId);
  const unavailable = useStore(
    store,
    (state) => state.loading || ["running", "stopping"].includes(state.propagation.status),
  );
  const recordId = document?.record.id;
  const currentVideoId =
    document?.frames.find((frame) => frame.id === currentFrameId)?.videoId ??
    document?.videos[0]?.id;
  const [openedScope, setOpenedScope] = useState<{ recordId: string; videoId: string }>();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  useEffect(() => {
    setOpen(false);
  }, [store, recordId, currentVideoId, disabled, unavailable]);
  const classOf = (classId: string) => document?.classes.find((item) => item.id === classId);
  const classOptions = (document?.classes ?? []).map((item) => ({
    key: `class/${item.id}`,
    type: "class" as const,
    id: item.id,
    label: item.name || t("unnamed"),
  }));
  const instanceOptions = (document?.instances ?? []).map((item) => ({
    key: `instance/${item.id}`,
    type: "instance" as const,
    id: item.id,
    label: `${classOf(item.classId)?.name ?? t("unclassified")} ${item.name || t("unnamed")}`,
  }));
  const options = [...classOptions, ...instanceOptions];
  const display = resolveSpatialReference(value, document, t);
  const blocked = disabled || unavailable || !document || !currentVideoId;
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <Tooltip title={display ?? t("referenceTarget")}>
        <span>
          <IconButton
            size="small"
            edge="end"
            aria-label={t("referenceButton")}
            color={display ? "primary" : "default"}
            disabled={blocked}
            onClick={() => {
              if (!recordId || !currentVideoId) {
                return;
              }
              setTarget("");
              setOpenedScope({ recordId, videoId: currentVideoId });
              setOpen(true);
            }}
          >
            <LinkIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      {/* Unmounted at once on close: a context change must leave no stale picker behind. */}
      {open && (
        <Dialog
          open
          onClose={close}
          fullWidth
          maxWidth="xs"
          aria-label={t("referenceTarget")}
          onKeyDown={(event) => {
            // Keep Escape inside the dialog: the surrounding Moment form must stay open.
            if (event.key === "Escape") {
              event.stopPropagation();
            }
          }}
        >
          <DialogTitle>{t("referenceTarget")}</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t("referenceHint", { record: document?.record.name ?? "" })}
            </Typography>
            {options.length === 0 ? (
              <Typography variant="body2" role="status">
                {t("referenceNoTargets")}
              </Typography>
            ) : (
              <TextField
                select
                autoFocus
                fullWidth
                size="small"
                variant="filled"
                label={t("referenceField")}
                value={target}
                slotProps={{
                  select: { native: true },
                  htmlInput: { "aria-label": t("referenceSelect") },
                }}
                onChange={(event) => {
                  setTarget(event.target.value);
                }}
              >
                <option value="" disabled>
                  {t("chooseOption")}
                </option>
                {classOptions.length > 0 && (
                  <optgroup label={t("classes")}>
                    {classOptions.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {instanceOptions.length > 0 && (
                  <optgroup label={t("instances")}>
                    {instanceOptions.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </TextField>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>{t("cancel")}</Button>
            <Button
              variant="contained"
              disabled={!target || unavailable || disabled}
              onClick={() => {
                const selected = options.find((item) => item.key === target);
                if (
                  openedScope?.recordId !== recordId ||
                  openedScope?.videoId !== currentVideoId ||
                  unavailable ||
                  disabled
                ) {
                  close();
                  return;
                }
                if (selected && document && openedScope) {
                  onChange(
                    encodeSpatialReference(openedScope.recordId, selected.type, selected.id),
                  );
                  close();
                }
              }}
            >
              {t("insertReference")}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
