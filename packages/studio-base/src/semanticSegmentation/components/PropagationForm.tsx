// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Alert,
  Button,
  Checkbox,
  Divider,
  MenuItem,
  Select,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import { segmentationErrorText } from "../errors";
import type { CanvasPropagationScope } from "../propagationSeeds";
import { useSegmentationHost } from "../segmentationHostContext";
import type { PropagationRequest, SegmentationFrame, SemanticSegmentationStore } from "../types";

/**
 * How far one click propagates. The API needs an end time (there is no open-ended stream) and
 * the backend loads the whole range into memory, so the range is bounded; STOP ends it early and
 * keeps every frame received so far.
 */
export const PROPAGATION_RANGES_SEC = [1, 3, 10] as const;
const DEFAULT_RANGE_SEC = 10;

export type PropagationDirection = "forward" | "backward" | "both";
const DIRECTION_KEYS = {
  forward: "directionForward",
  backward: "directionBackward",
  both: "directionBoth",
} as const satisfies Record<PropagationDirection, string>;
const DIRECTIONS = Object.keys(DIRECTION_KEYS) as PropagationDirection[];

const STATUS_KEYS = {
  running: "propagationRunning",
  stopping: "propagationStopping",
  completed: "propagationCompleted",
  cancelled: "propagationCancelled",
  failed: "propagationFailed",
} as const;

const useStyles = makeStyles()((theme) => ({
  root: { display: "flex", flexDirection: "column", gap: theme.spacing(1.5) },
  alert: { paddingTop: 0, paddingBottom: 0 },
  header: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  fieldLabel: {
    display: "block",
    marginBottom: theme.spacing(0.5),
    color: theme.palette.text.secondary,
    fontWeight: 600,
  },
  instances: {
    maxHeight: 176,
    overflowY: "auto",
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    paddingBottom: theme.spacing(0.25),
  },
  /** Select-all row: stays at the top while the list scrolls. */
  selectAll: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    backgroundColor: theme.palette.background.paper,
    backgroundImage: `linear-gradient(${theme.palette.action.hover}, ${theme.palette.action.hover})`,
    borderBottom: `1px solid ${theme.palette.divider}`,
    "&:hover": {
      backgroundImage: `linear-gradient(${theme.palette.action.selected}, ${theme.palette.action.selected})`,
    },
  },
  hint: { display: "block", marginTop: theme.spacing(0.5) },
  instance: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.75),
    minHeight: 30,
    padding: theme.spacing(0, 1, 0, 0.25),
    cursor: "pointer",
    "&:hover": { backgroundColor: theme.palette.action.hover },
  },
  checkbox: { padding: theme.spacing(0.5) },
  dot: { width: 10, height: 10, flexShrink: 0, borderRadius: 2 },
  instanceName: { flex: 1, minWidth: 0 },
  toggle: {
    textTransform: "none",
    padding: theme.spacing(0.25, 1),
    fontSize: theme.typography.body2.fontSize,
  },
}));

/**
 * One-click propagation for one canvas: the checked seeded instances on the canvas's current
 * frame go forward, backward or both from that frame for the chosen range, starting at once. "Both" runs forward, then backward if forward completed.
 */
export function PropagationForm({
  store,
  scope,
  sourceReady = true,
  onStarted,
}: {
  store: StoreApi<SemanticSegmentationStore>;
  scope: CanvasPropagationScope | undefined;
  sourceReady?: boolean;
  /** Called once the run starts: progress and STOP then live in the global lock bar. */
  onStarted?: () => void;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("segmentation");
  const host = useSegmentationHost();
  // Narrow subscriptions: the form stays open while frames stream in.
  const document = useStore(store, (state) => state.document);
  const interactionResetVersion = useStore(store, (state) => state.interactionResetVersion);
  const capabilities = useStore(store, (state) => state.propagationCapabilities);
  const capabilitiesError = useStore(store, (state) => state.propagationCapabilitiesError);
  const capabilitiesLoading = useStore(store, (state) => state.propagationCapabilitiesLoading);
  const selection = useStore(store, (state) => state.selection);
  const propagationStatus = useStore(store, (state) => state.propagation.status);
  const processedFrames = useStore(store, (state) => state.propagation.processedFrames);
  const [rangeSec, setRangeSec] = useState<number>(DEFAULT_RANGE_SEC);
  const [model, setModel] = useState("sam2.1-motion");
  const [direction, setDirection] = useState<PropagationDirection>("forward");
  /** Instances the user checked; undefined follows the default (tree selection, else all). */
  const [checked, setChecked] = useState<string[] | undefined>();
  const [localError, setLocalError] = useState<string>();
  const [busy, setBusy] = useState<"idle" | "preparing" | "starting">("idle");
  useEffect(() => {
    setLocalError(undefined);
  }, [store, document?.record.id, interactionResetVersion]);
  // Another frame or canvas has other seeds: return to the default choice.
  useEffect(() => {
    setChecked(undefined);
  }, [scope?.frameId]);
  const frame = document?.frames.find((item) => item.id === scope?.frameId);
  const allowedModels = capabilities?.models ?? [model];
  const supportedParameters =
    allowedModels.includes(model) && !capabilitiesError && capabilitiesLoading !== true;
  useEffect(() => {
    if (!capabilities) {
      return;
    }
    if (!capabilities.models.includes(model) && capabilities.models[0]) {
      setModel(capabilities.models[0]);
    }
  }, [capabilities, model]);
  const allSeeds = scope?.seeds ?? [];
  const treeSelected = new Set(
    selection.filter((node) => node.type === "instance").map((node) => node.id),
  );
  const defaultChoice = allSeeds.some((seed) => treeSelected.has(seed.instanceId))
    ? allSeeds.filter((seed) => treeSelected.has(seed.instanceId)).map((seed) => seed.instanceId)
    : allSeeds.map((seed) => seed.instanceId);
  const chosen = new Set(checked ?? defaultChoice);
  const seeds = allSeeds.filter((seed) => chosen.has(seed.instanceId));
  const firstSeed = seeds[0];
  const hasSeed = seeds.length > 0;
  /** Class color and name plus instance name, as the instance tree shows them. */
  const instanceLabel = (id: string) => {
    const instance = document?.instances.find((item) => item.id === id);
    const category = document?.classes.find((item) => item.id === instance?.classId);
    return {
      color: category?.color ?? "transparent",
      className: category?.name,
      name: instance?.name ?? id,
    };
  };
  const toggleInstance = (id: string, change: "check" | "uncheck") => {
    const next = new Set(chosen);
    if (change === "check") {
      next.add(id);
    } else {
      next.delete(id);
    }
    setChecked(allSeeds.map((item) => item.instanceId).filter((item) => next.has(item)));
  };
  const polygonCount = seeds.reduce(
    (count, seed) => count + (seed.kind === "polygons" ? seed.polygons.length : 0),
    0,
  );
  const maskCount = seeds.filter((seed) => seed.kind === "mask").length;
  const allChosen = allSeeds.length > 0 && seeds.length === allSeeds.length;
  /** Everything checked clears all; none or some checks all, keeping what the user picked. */
  const toggleAll = () => {
    setChecked(allChosen ? [] : allSeeds.map((seed) => seed.instanceId));
  };
  const seedSummary = [
    t("seedInstances", { count: seeds.length }),
    ...(polygonCount > 0 ? [t("seedPolygons", { count: polygonCount })] : []),
    ...(maskCount > 0 ? [t("seedMasks", { count: maskCount })] : []),
  ].join(" · ");
  const running = ["running", "stopping"].includes(propagationStatus);

  /** Frames of the seed's video within the range on one side of the seed, in time order. */
  const framesTowards = (side: "forward" | "backward"): SegmentationFrame[] => {
    if (!frame) {
      return [];
    }
    const seedNs = BigInt(frame.logTimeNs);
    const rangeNs = BigInt(rangeSec) * 1_000_000_000n;
    return (store.getState().document?.frames ?? [])
      .filter((item) => {
        if (item.videoId !== frame.videoId) {
          return false;
        }
        const time = BigInt(item.logTimeNs);
        return side === "forward"
          ? time > seedNs && time <= seedNs + rangeNs
          : time < seedNs && time >= seedNs - rangeNs;
      })
      .sort((a, b) => (BigInt(a.logTimeNs) < BigInt(b.logTimeNs) ? -1 : 1));
  };

  const start = () => {
    if (!frame || !firstSeed) {
      return;
    }
    setLocalError(undefined);
    setBusy("preparing");
    void (async () => {
      // The document lists only the frames read so far: read the whole range first, so every
      // propagated frame has a local frame to land on.
      const loader = host.sourceFrames.get(frame.videoId);
      const seedNs = BigInt(frame.logTimeNs);
      const rangeNs = BigInt(rangeSec) * 1_000_000_000n;
      const sides: ("forward" | "backward")[] =
        direction === "both" ? ["forward", "backward"] : [direction];
      await loader?.ensureRange(
        sides.includes("backward") ? seedNs - rangeNs : seedNs,
        sides.includes("forward") ? seedNs + rangeNs : seedNs,
      );
      // The end of each run: the last frame forward, the earliest frame backward.
      const runs = sides.flatMap((side) => {
        const targets = framesTowards(side);
        const end = side === "forward" ? targets.at(-1) : targets[0];
        return end ? [{ side, endTimeNs: end.logTimeNs }] : [];
      });
      if (runs.length === 0) {
        throw new Error(
          direction === "backward"
            ? t("noFramesBefore")
            : direction === "forward"
              ? t("noFramesAfter")
              : t("noFramesAround"),
        );
      }
      setBusy("starting");
      for (const [index, run] of runs.entries()) {
        // A stopped or failed run ends the sequence; its received frames stay as drafts.
        if (index > 0 && store.getState().propagation.status !== "completed") {
          break;
        }
        const request: PropagationRequest = {
          instanceId: firstSeed.instanceId,
          fromFrameId: frame.id,
          endTimeNs: run.endTimeNs,
          model,
          seeds,
        };
        const running = store.getState().startPropagation(request);
        if (index === 0) {
          onStarted?.();
        }
        await running;
      }
    })()
      .catch((error: unknown) => {
        setLocalError(segmentationErrorText(error));
      })
      .finally(() => {
        setBusy("idle");
      });
  };

  return (
    <section className={classes.root} aria-label={t("propagationParameters")}>
      <div className={classes.header}>
        <Typography variant="subtitle2" component="h2">
          {t("instancePropagation")}
        </Typography>
        {frame && (
          <Typography variant="caption" color="text.secondary" aria-label={t("effectiveRange")}>
            {t("sourceFrameDirection", {
              frame: frame.index + 1,
              direction: t(DIRECTION_KEYS[direction]),
            })}
          </Typography>
        )}
      </div>
      {localError && (
        <Alert severity="error" variant="outlined" className={classes.alert}>
          {localError}
        </Alert>
      )}
      {capabilitiesLoading === true && (
        <Typography variant="caption" color="text.secondary" role="status">
          {t("loadingCapabilities")}
        </Typography>
      )}
      {capabilitiesError && (
        <Alert
          severity="warning"
          variant="outlined"
          className={classes.alert}
          action={
            <Button
              size="small"
              color="inherit"
              disabled={capabilitiesLoading}
              onClick={() => {
                void store.getState().refreshPropagationCapabilities();
              }}
            >
              {t("retryCapabilities")}
            </Button>
          }
        >
          {t("capabilitiesFailed", { error: capabilitiesError })}
        </Alert>
      )}

      <div>
        <div className={classes.header}>
          <Typography variant="caption" className={classes.fieldLabel}>
            {t("instances")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {allSeeds.length === 0 ? t("noSeedsOnFrame") : hasSeed ? seedSummary : ""}
          </Typography>
        </div>
        {allSeeds.length > 0 && (
          <div className={classes.instances} role="group" aria-label={t("propagationInstances")}>
            {allSeeds.length > 1 && (
              <label className={`${classes.instance} ${classes.selectAll}`}>
                <Checkbox
                  size="small"
                  className={classes.checkbox}
                  checked={allChosen}
                  indeterminate={hasSeed && !allChosen}
                  slotProps={{ input: { "aria-label": t("selectAllInstances") } }}
                  onChange={toggleAll}
                />
                <Typography variant="body2" className={classes.instanceName}>
                  {t("selectAll")}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {seeds.length} / {allSeeds.length}
                </Typography>
              </label>
            )}
            {allSeeds.map((seed) => {
              const label = instanceLabel(seed.instanceId);
              return (
                <label key={seed.instanceId} className={classes.instance}>
                  <Checkbox
                    size="small"
                    className={classes.checkbox}
                    checked={chosen.has(seed.instanceId)}
                    onChange={(event) => {
                      toggleInstance(seed.instanceId, event.target.checked ? "check" : "uncheck");
                    }}
                  />
                  <span className={classes.dot} style={{ backgroundColor: label.color }} />
                  <Typography variant="body2" noWrap className={classes.instanceName}>
                    {label.className != undefined && (
                      <Typography component="span" variant="body2" color="text.secondary">
                        {label.className}{" "}
                      </Typography>
                    )}
                    {label.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {seed.kind === "mask"
                      ? t("geometryMask")
                      : t("seedPolygons", { count: seed.polygons.length })}
                  </Typography>
                </label>
              );
            })}
          </div>
        )}
        {allSeeds.length > 0 && !hasSeed && (
          <Typography variant="caption" color="warning.main" className={classes.hint} role="status">
            {t("selectAtLeastOne")}
          </Typography>
        )}
      </div>

      <div>
        <Typography variant="caption" className={classes.fieldLabel}>
          {t("direction")}
        </Typography>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          color="primary"
          value={direction}
          role="radiogroup"
          aria-label={t("propagationDirection")}
          onChange={(_event, value: PropagationDirection | ReactNull) => {
            if (value) {
              setDirection(value);
            }
          }}
        >
          {DIRECTIONS.map((value) => (
            <ToggleButton
              key={value}
              value={value}
              role="radio"
              aria-checked={direction === value}
              className={classes.toggle}
            >
              {t(DIRECTION_KEYS[value])}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>

      <div>
        <Typography variant="caption" className={classes.fieldLabel}>
          {t("range")}
        </Typography>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          color="primary"
          value={rangeSec}
          role="radiogroup"
          aria-label={t("propagationRange")}
          onChange={(_event, value: number | ReactNull) => {
            if (value != undefined) {
              setRangeSec(value);
            }
          }}
        >
          {PROPAGATION_RANGES_SEC.map((value) => (
            <ToggleButton
              key={value}
              value={value}
              role="radio"
              aria-checked={rangeSec === value}
              className={classes.toggle}
            >
              {t("seconds", { count: value })}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>

      {allowedModels.length > 1 && (
        <div>
          <Typography variant="caption" className={classes.fieldLabel}>
            {t("model")}
          </Typography>
          <Select
            size="small"
            fullWidth
            value={model}
            inputProps={{ "aria-label": t("propagationModel") }}
            onChange={(event) => {
              setModel(event.target.value);
            }}
          >
            {allowedModels.map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </Select>
        </div>
      )}

      <Divider />
      <Button
        variant="contained"
        fullWidth
        disabled={!sourceReady || !hasSeed || !supportedParameters || busy !== "idle" || running}
        onClick={start}
      >
        {busy === "preparing" ? t("readingFrames") : t("startPropagation")}
      </Button>
      <Typography variant="caption" color="text.secondary">
        {t("propagationHint", { direction: t(DIRECTION_KEYS[direction]), count: rangeSec })}
      </Typography>
      {propagationStatus !== "idle" && (
        <Typography variant="caption" color="text.secondary" aria-live="polite">
          {t("propagationProgress", {
            status: t(STATUS_KEYS[propagationStatus]),
            count: processedFrames,
          })}
        </Typography>
      )}
    </section>
  );
}
