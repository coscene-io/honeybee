// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import StopIcon from "@mui/icons-material/Stop";
import { Button, LinearProgress, Paper, Typography } from "@mui/material";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import { useSegmentationSession } from "../segmentationHostContext";
import type { SegmentationStore } from "../types";

const useStyles = makeStyles()((theme) => ({
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: theme.zIndex.modal + 1,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: theme.spacing(2),
    backgroundColor: theme.palette.action.disabledBackground,
  },
  bar: {
    position: "relative",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(2),
    maxWidth: 640,
    padding: theme.spacing(1.5, 2),
  },
  text: { display: "flex", flexDirection: "column", minWidth: 0 },
  progress: { position: "absolute", left: 0, right: 0, bottom: 0 },
  stop: { flexShrink: 0, whiteSpace: "nowrap" },
}));

function ActiveLock({
  store,
}: {
  store: StoreApi<SegmentationStore>;
}): React.JSX.Element | undefined {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  const propagation = useStore(store, (state) => state.propagation);
  const overlayRef = useRef<HTMLDivElement>(ReactNull);
  const stopRef = useRef<HTMLButtonElement>(ReactNull);
  const locked = ["running", "stopping"].includes(propagation.status);
  const stopping = propagation.status === "stopping";
  const stopDisabled = stopping && propagation.cancellationPending !== false;
  useEffect(() => {
    if (!locked) {
      return;
    }
    const previousFocus = document.activeElement;
    const inertState = new Map<HTMLElement, boolean>();
    const makeInert = () => {
      for (const element of document.body.children) {
        if (!(element instanceof HTMLElement) || element === overlayRef.current) {
          continue;
        }
        if (!inertState.has(element)) {
          inertState.set(element, element.inert);
        }
        element.inert = true;
      }
    };
    makeInert();
    const observer = new MutationObserver(makeInert);
    observer.observe(document.body, { childList: true });
    const blockShortcuts = (event: KeyboardEvent) => {
      if (event.target === stopRef.current && ["Enter", " ", "Tab"].includes(event.key)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", blockShortcuts, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", blockShortcuts, true);
      for (const [element, wasInert] of inertState) {
        element.inert = wasInert;
      }
      if (previousFocus instanceof HTMLElement) {
        previousFocus.focus();
      }
    };
  }, [locked]);
  useEffect(() => {
    if (locked && !stopDisabled) {
      stopRef.current?.focus();
    }
  }, [locked, stopDisabled]);
  return locked
    ? createPortal(
        <div
          ref={overlayRef}
          className={classes.overlay}
          role="dialog"
          aria-modal="true"
          aria-label={t("propagationLock")}
        >
          <Paper elevation={12} className={classes.bar} role="status">
            <div className={classes.text}>
              <Typography variant="subtitle2">
                {t(stopping ? "lockStopping" : "lockRunning", {
                  count: propagation.processedFrames,
                })}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {!stopping && propagation.processedFrames === 0
                  ? t("lockPreparing")
                  : t("lockFollowing")}
              </Typography>
              {stopping && propagation.error && (
                <Typography variant="caption" color="error" role="alert">
                  {propagation.error}
                </Typography>
              )}
            </div>
            <Button
              ref={stopRef}
              className={classes.stop}
              variant="contained"
              color="error"
              disableElevation
              startIcon={<StopIcon />}
              disabled={stopDisabled}
              onKeyDown={(event) => {
                if (!stopDisabled && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  event.stopPropagation();
                  store.getState().stopPropagation();
                }
              }}
              onClick={() => {
                store.getState().stopPropagation();
              }}
            >
              {stopping ? (stopDisabled ? t("stopping") : t("retryStop")) : t("stopPropagation")}
            </Button>
            <LinearProgress className={classes.progress} color={stopping ? "warning" : "primary"} />
          </Paper>
        </div>,
        document.body,
      )
    : undefined;
}

/** Protects the real player, source controls, sidebar and portal menus during a live stream. */
export function GlobalPropagationLock(): React.JSX.Element | undefined {
  const runtime = useSegmentationSession((state) => state.runtime);
  return runtime ? <ActiveLock store={runtime.store} /> : undefined;
}
