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
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import type { SegmentationDocument, SemanticSegmentationStore } from "../types";

export type SpatialReference = {
  recordId: string;
  videoId?: string;
  targetType: "class" | "instance";
  targetId: string;
};

export function encodeSpatialReference(
  recordId: string,
  targetType: "class" | "instance",
  targetId: string,
  videoId?: string,
): string {
  const scope = videoId
    ? `${encodeURIComponent(recordId)}/${encodeURIComponent(videoId)}`
    : encodeURIComponent(recordId);
  return `spatial://${scope}/${targetType}/${encodeURIComponent(targetId)}`;
}

export function parseSpatialReference(value: string): SpatialReference | undefined {
  const match = /^spatial:\/\/([^/]+)\/(?:([^/]+)\/)?(class|instance)\/([^/]+)$/.exec(value);
  if (!match) {
    return undefined;
  }
  try {
    return {
      recordId: decodeURIComponent(match[1]!),
      videoId: match[2] ? decodeURIComponent(match[2]) : undefined,
      targetType: match[3] as "class" | "instance",
      targetId: decodeURIComponent(match[4]!),
    };
  } catch {
    return undefined;
  }
}

export function resolveSpatialReference(
  value: string,
  document: SegmentationDocument | undefined,
): string | undefined {
  const reference = parseSpatialReference(value);
  if (!reference) {
    return undefined;
  }
  const { recordId, videoId, targetType, targetId } = reference;
  if (
    document?.record.id !== recordId ||
    (videoId && !document.videos.some((video) => video.id === videoId))
  ) {
    return `空间引用 · ${targetType} ${targetId}（记录未打开）`;
  }
  const target = (targetType === "class" ? document.classes : document.instances).find(
    (item) => item.id === targetId,
  );
  return target
    ? `${targetType === "class" ? "类别" : "实例"} · ${target.name || "未命名"} · ${targetId}`
    : `空间引用 · ${targetId}（已删除）`;
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
  store: StoreApi<SemanticSegmentationStore>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
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
    label: item.name || "未命名",
  }));
  const instanceOptions = (document?.instances ?? []).map((item) => ({
    key: `instance/${item.id}`,
    type: "instance" as const,
    id: item.id,
    label: `${classOf(item.classId)?.name ?? "未分类"} ${item.name || "未命名"}`,
  }));
  const options = [...classOptions, ...instanceOptions];
  const display = resolveSpatialReference(value, document);
  const blocked = disabled || unavailable || !document || !currentVideoId;
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <Tooltip title={display ?? "引用已标注类别或实例"}>
        <span>
          <IconButton
            size="small"
            edge="end"
            aria-label="引用空间类别或实例"
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
          aria-label="引用已标注类别或实例"
          onKeyDown={(event) => {
            // Keep Escape inside the dialog: the surrounding Moment form must stay open.
            if (event.key === "Escape") {
              event.stopPropagation();
            }
          }}
        >
          <DialogTitle>引用已标注类别或实例</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {document?.record.name} · 引用保存稳定 ID，改名后仍指向同一目标
            </Typography>
            {options.length === 0 ? (
              <Typography variant="body2" role="status">
                暂无可引用目标，请先在空间侧栏创建类别或实例。
              </Typography>
            ) : (
              <TextField
                select
                autoFocus
                fullWidth
                size="small"
                variant="filled"
                label="类别或实例"
                value={target}
                slotProps={{
                  select: { native: true },
                  htmlInput: { "aria-label": "选择类别或实例" },
                }}
                onChange={(event) => {
                  setTarget(event.target.value);
                }}
              >
                <option value="" disabled>
                  请选择…
                </option>
                {classOptions.length > 0 && (
                  <optgroup label="类别">
                    {classOptions.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {instanceOptions.length > 0 && (
                  <optgroup label="实例">
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
            <Button onClick={close}>取消</Button>
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
                    encodeSpatialReference(
                      openedScope.recordId,
                      selected.type,
                      selected.id,
                      openedScope.videoId,
                    ),
                  );
                  close();
                }
              }}
            >
              插入引用
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
