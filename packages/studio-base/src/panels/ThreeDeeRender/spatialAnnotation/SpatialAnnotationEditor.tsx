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
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { fromNanoSec } from "@foxglove/rostime";
import { BuiltinPanelExtensionContext } from "@foxglove/studio-base/components/PanelExtensionAdapter";

import { IRenderer } from "../IRenderer";
import { useRendererEvent } from "../RendererContext";
import { AnnotationSession } from "./AnnotationSession";
import { mockAnnotationService } from "./MockAnnotationService";
import { CanvasTool, PolygonCanvas } from "./PolygonCanvas";
import {
  annotationTime,
  clampAnnotationFrame,
  isAnnotationFrameReady,
  nearestAnnotationFrame,
} from "./model";
import { ImageAnnotationViewport } from "./viewport";

export const SPATIAL_ANNOTATION_SOURCE_KEY = "spatialAnnotationSource";
export const SPATIAL_ANNOTATION_PLAYING_KEY = "spatialAnnotationPlaying";
const sessions = new Map<string, AnnotationSession>();
function getSession(scope: string): AnnotationSession {
  let session = sessions.get(scope);
  if (session == undefined) {
    session = new AnnotationSession(mockAnnotationService, scope);
    sessions.set(scope, session);
  }
  return session;
}
const COLORS = ["#50c7f2", "#ffbd69", "#a4dd70", "#d4a0ff", "#ff8aa8"];

type Props = {
  renderer: IRenderer;
  canvas: HTMLCanvasElement;
  context: BuiltinPanelExtensionContext;
  scope: string;
  topic: string;
  isPlaying: boolean;
  onActiveChange: (state: "active" | "inactive") => void;
};

/** Prototype intentionally lives inside its Image panel; production can move the tree to Workspace. */
export function SpatialAnnotationEditor({
  renderer,
  canvas,
  context,
  scope,
  topic,
  isPlaying,
  onActiveChange,
}: Props): React.JSX.Element {
  const session = useMemo(() => getSession(scope), [scope]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [active, setActive] = useState(false);
  const [viewport, setViewport] = useState<ImageAnnotationViewport | undefined>();
  const [frame, setFrame] = useState(0);
  const [onGrid, setOnGrid] = useState(false);
  const [playbackTimeNs, setPlaybackTimeNs] = useState(renderer.currentTime);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [focus, setFocus] = useState<"all" | "instance" | "image">("all");
  const [instanceId, setInstanceId] = useState<string | undefined>();
  const [polygonId, setPolygonId] = useState<string | undefined>();
  const [className, setClassName] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [confirmation, setConfirmation] = useState<
    { title: string; run: () => void } | undefined
  >();
  const [localError, setLocalError] = useState<string | undefined>();
  const [navigationPending, setNavigationPending] = useState(false);
  const [navigationError, setNavigationError] = useState<string | undefined>();
  const seekTarget = useRef<bigint | undefined>();

  useEffect(() => {
    onActiveChange(active ? "active" : "inactive");
    return () => {
      onActiveChange("inactive");
    };
  }, [active, onActiveChange]);

  const updateViewport = useCallback(() => {
    if (!active) {
      return;
    }
    const start = renderer.startTime;
    if (start == undefined) {
      return;
    }
    const nextViewport = renderer.getImageAnnotationViewport?.();
    // Container duration can extend beyond the last decoded image (for example B-frame tails).
    // At EOF, return to a tick covered by an image we actually displayed.
    const limit =
      renderer.endTime != undefined &&
      renderer.currentTime >= renderer.endTime &&
      nextViewport != undefined
        ? nextViewport.displayedTimeNs
        : renderer.endTime;
    const index = clampAnnotationFrame(
      nearestAnnotationFrame(renderer.currentTime, start),
      start,
      limit,
    );
    setPlaybackTimeNs(renderer.currentTime);
    setFrame(index);
    setOnGrid(renderer.currentTime === annotationTime(index, start));
    setViewport(nextViewport);
    if (seekTarget.current == undefined || renderer.currentTime === seekTarget.current) {
      seekTarget.current = undefined;
      setNavigationPending(false);
    }
  }, [active, renderer]);
  useRendererEvent("endFrame", updateViewport, renderer);
  useEffect(() => {
    if (active) {
      void session.load();
      updateViewport();
    }
  }, [active, session, updateViewport]);

  const seek = useCallback(
    (index: number) => {
      if (renderer.startTime == undefined || context.seekPlayback == undefined) {
        return;
      }
      const target = annotationTime(
        clampAnnotationFrame(index, renderer.startTime, renderer.endTime),
        renderer.startTime,
      );
      context.unstable_pausePlayback?.();
      setNavigationError(undefined);
      seekTarget.current = target;
      setNavigationPending(true);
      context.seekPlayback(fromNanoSec(target));
    },
    [context, renderer],
  );

  // Playback and the main timeline can stop off-grid without another decoded frame arriving.
  // Subscribe to player state separately from endFrame, then explicitly seek the annotation tick.
  useEffect(() => {
    if (
      active &&
      !isPlaying &&
      !(context.unstable_getPlaybackIsPlaying?.() ?? false) &&
      !onGrid &&
      !navigationPending &&
      navigationError == undefined
    ) {
      seek(frame);
    }
  }, [
    active,
    isPlaying,
    onGrid,
    navigationPending,
    navigationError,
    playbackTimeNs,
    frame,
    seek,
    context,
  ]);

  useEffect(() => {
    if (!navigationPending) {
      return;
    }
    const timer = setTimeout(() => {
      seekTarget.current = undefined;
      setNavigationError(
        "The video frame did not finish loading. Retry this frame or choose another timestamp.",
      );
      setNavigationPending(false);
    }, 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [navigationPending]);
  const ready =
    !navigationPending &&
    onGrid &&
    viewport?.topic === topic &&
    renderer.startTime != undefined &&
    isAnnotationFrameReady(annotationTime(frame, renderer.startTime), viewport.displayedTimeNs) &&
    !isPlaying &&
    !(context.unstable_getPlaybackIsPlaying?.() ?? false);
  const blocked = !state.ready || state.busy || !ready;
  const pending = state.jobs.some((job) => job.status === "queued" || job.status === "submitting");
  const failed = state.jobs.some((job) => job.status === "failed");
  const selectedInstance = state.document.instances.find((item) => item.id === instanceId);
  const validMergeTarget = state.document.instances.some(
    (item) => item.id === mergeTarget && item.id !== instanceId,
  );
  const framePolygons = state.document.frames[String(frame)] ?? [];

  useEffect(() => {
    if (
      instanceId != undefined &&
      !state.document.instances.some((item) => item.id === instanceId)
    ) {
      setInstanceId(undefined);
      setPolygonId(undefined);
      setTool("select");
    }
  }, [instanceId, state.document.instances]);

  if (!active) {
    return (
      <Button
        variant="contained"
        size="small"
        style={{ position: "absolute", bottom: 12, left: 12, zIndex: 4 }}
        onClick={() => {
          renderer.measurementTool.stopMeasuring();
          renderer.publishClickTool.stop();
          context.unstable_pausePlayback?.();
          setActive(true);
          // Snap once; future navigation uses explicit 100 ms controls.
          seek(nearestAnnotationFrame(renderer.currentTime, renderer.startTime ?? 0n));
        }}
      >
        Annotate · mock
      </Button>
    );
  }

  const changeInstance = (id: string) => {
    context.unstable_pausePlayback?.();
    setInstanceId(id);
    setPolygonId(undefined);
    setTool("select");
  };
  const removeInstance = (id: string) => {
    session.edit((document) => {
      document.instances = document.instances.filter((item) => item.id !== id);
      for (const key of Object.keys(document.frames)) {
        document.frames[key] = document.frames[key]!.filter((polygon) => polygon.instanceId !== id);
      }
    });
  };
  const simulateExternalRevision = async () => {
    try {
      const current = await mockAnnotationService.read(scope);
      await mockAnnotationService.commit({
        scope,
        expectedRevision: current.revision,
        requestId: crypto.randomUUID(),
        document: current.document,
        message: "Simulated external editor",
      });
      setLocalError(
        "Mock server advanced. Your next submit will conflict; drafts will be retained.",
      );
    } catch (error) {
      setLocalError(String(error));
    }
  };

  return (
    <>
      {viewport != undefined && (
        <PolygonCanvas
          key={`${frame}:${tool}:${instanceId ?? ""}:${focus}`}
          session={session}
          document={state.document}
          viewport={viewport}
          frame={frame}
          instanceId={instanceId}
          selectedPolygonId={polygonId}
          onSelect={(polygon) => {
            setInstanceId(polygon.instanceId);
            setPolygonId(polygon.id);
          }}
          tool={tool}
          focus={focus}
          disabled={blocked}
          canEdit={() => {
            if (renderer.startTime == undefined) {
              return false;
            }
            const target = annotationTime(frame, renderer.startTime);
            const current = renderer.getImageAnnotationViewport?.();
            return (
              renderer.currentTime === target &&
              current?.topic === topic &&
              isAnnotationFrameReady(target, current.displayedTimeNs) &&
              !(context.unstable_getPlaybackIsPlaying?.() ?? false)
            );
          }}
          onWheel={(event) => {
            canvas.dispatchEvent(
              new WheelEvent("wheel", {
                deltaY: event.deltaY,
                clientX: event.clientX,
                clientY: event.clientY,
                bubbles: false,
              }),
            );
          }}
        />
      )}
      <Paper
        style={{
          position: "absolute",
          zIndex: 4,
          top: 10,
          left: 12,
          right: 70,
          padding: 4,
          overflowX: "auto",
        }}
      >
        <Stack
          direction="row"
          spacing={0.5}
          alignItems="center"
          style={{ minWidth: "max-content" }}
        >
          <Typography variant="caption" style={{ padding: "0 8px" }}>
            Spatial · local mock · 10 FPS
          </Typography>
          <Button
            size="small"
            onClick={() => {
              seek(frame - 1);
            }}
            disabled={frame === 0 || navigationPending}
          >
            −0.1s
          </Button>
          <Button
            size="small"
            onClick={() => {
              seek(frame);
            }}
            disabled={navigationPending}
          >
            Frame {frame} · {(frame / 10).toFixed(1)}s
          </Button>
          <Button
            size="small"
            onClick={() => {
              seek(frame + 1);
            }}
            disabled={navigationPending}
          >
            +0.1s
          </Button>
          {(["select", "draw", "pan"] as const).map((item) => (
            <Button
              key={item}
              size="small"
              variant={tool === item ? "contained" : "text"}
              disabled={item === "draw" && (selectedInstance == undefined || blocked)}
              onClick={() => {
                context.unstable_pausePlayback?.();
                setTool(item);
              }}
            >
              {item}
            </Button>
          ))}
          <Button
            size="small"
            onClick={() => {
              session.undo();
            }}
            disabled={!state.canUndo || state.busy}
          >
            Undo
          </Button>
          <Button
            size="small"
            onClick={() => {
              session.redo();
            }}
            disabled={!state.canRedo || state.busy}
          >
            Redo
          </Button>
          <Button
            size="small"
            variant="contained"
            color={state.dirty ? "warning" : "primary"}
            disabled={!state.dirty || state.busy || failed}
            onClick={() => {
              session.submit();
            }}
          >
            Submit
          </Button>
          <Button
            size="small"
            onClick={() => {
              setActive(false);
            }}
          >
            Close
          </Button>
        </Stack>
      </Paper>
      <Paper
        style={{
          position: "absolute",
          zIndex: 4,
          right: 12,
          top: 58,
          bottom: 12,
          width: 288,
          maxWidth: "45%",
          padding: 12,
          overflowY: "auto",
        }}
      >
        <Stack spacing={1}>
          <Typography variant="subtitle2">
            Space / instances · r{state.saved.revision}
            {state.dirty ? " · draft" : " · saved"}
          </Typography>
          {!ready && (
            <Alert
              severity={navigationError == undefined ? "info" : "warning"}
              action={
                <Button
                  size="small"
                  disabled={navigationPending}
                  onClick={() => {
                    seek(frame);
                  }}
                >
                  {isPlaying ? "Pause & edit" : "Retry frame"}
                </Button>
              }
            >
              {navigationError ??
                (isPlaying
                  ? "Playback is running. Pause to edit."
                  : navigationPending
                    ? "Aligning the video to the 10 FPS annotation grid…"
                    : "Waiting for the displayed video frame. Retry the frame if it does not appear.")}
            </Alert>
          )}
          <Typography variant="caption">
            Memory only. No annotation network requests. Closing retains drafts; refreshing the app
            clears this mock.
          </Typography>
          {(state.error ?? localError) != undefined && (
            <Alert severity="warning">{state.error ?? localError}</Alert>
          )}
          <TextField
            select
            label="Visibility"
            size="small"
            value={focus}
            onChange={(event) => {
              setFocus(event.target.value as typeof focus);
            }}
          >
            <MenuItem value="all">All instances</MenuItem>
            <MenuItem value="instance">Selected instance</MenuItem>
            <MenuItem value="image">Original image</MenuItem>
          </TextField>
          <Stack direction="row" spacing={0.5}>
            <TextField
              label="Class name"
              size="small"
              value={className}
              onChange={(event) => {
                setClassName(event.target.value);
              }}
            />
            <Button
              size="small"
              disabled={!className.trim() || !state.ready || state.busy}
              onClick={() => {
                session.edit((document) => {
                  document.classes.push({
                    id: crypto.randomUUID(),
                    name: className.trim(),
                    color: COLORS[document.classes.length % COLORS.length]!,
                  });
                });
                setClassName("");
              }}
            >
              Add class
            </Button>
          </Stack>
          {state.document.classes.map((annotationClass) => (
            <Box
              key={annotationClass.id}
              style={{ borderLeft: `3px solid ${annotationClass.color}`, paddingLeft: 8 }}
            >
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Typography variant="body2" style={{ flex: 1 }}>
                  {annotationClass.name}
                </Typography>
                <Button
                  size="small"
                  disabled={state.busy}
                  onClick={() => {
                    const id = crypto.randomUUID();
                    session.edit((document) => {
                      document.instances.push({
                        id,
                        classId: annotationClass.id,
                        name: `Instance ${document.instances.length + 1}`,
                      });
                    });
                    changeInstance(id);
                  }}
                >
                  + instance
                </Button>
              </Stack>
              {state.document.instances
                .filter((instance) => instance.classId === annotationClass.id)
                .map((instance) => (
                  <Box key={instance.id} style={{ paddingLeft: 4 }}>
                    <Button
                      size="small"
                      variant={instance.id === instanceId ? "outlined" : "text"}
                      onClick={() => {
                        changeInstance(instance.id);
                      }}
                    >
                      {instance.name} (
                      {framePolygons.filter((polygon) => polygon.instanceId === instance.id).length}
                      )
                    </Button>
                    {framePolygons
                      .filter((polygon) => polygon.instanceId === instance.id)
                      .map((polygon, index) => (
                        <Button
                          key={polygon.id}
                          size="small"
                          fullWidth
                          style={{ justifyContent: "flex-start", paddingLeft: 16 }}
                          onClick={() => {
                            changeInstance(instance.id);
                            setPolygonId(polygon.id);
                          }}
                        >
                          ↳ Polygon {index + 1} · {polygon.points.length} points
                          {polygon.id === polygonId ? " · selected" : ""}
                        </Button>
                      ))}
                  </Box>
                ))}
            </Box>
          ))}
          {selectedInstance != undefined && (
            <>
              <Divider />
              <Typography variant="caption">
                {selectedInstance.name} · polygon edits affect this frame
              </Typography>
              <Button
                size="small"
                disabled={blocked}
                onClick={() => {
                  setPolygonId(undefined);
                  setTool("draw");
                }}
              >
                + polygon
              </Button>
              <Button
                size="small"
                disabled={polygonId == undefined || blocked}
                onClick={() => {
                  session.edit((document) => {
                    document.frames[String(frame)] = framePolygons.filter(
                      (polygon) => polygon.id !== polygonId,
                    );
                  });
                }}
              >
                Delete selected polygon
              </Button>
              <Button
                size="small"
                disabled={blocked}
                onClick={() => {
                  session.edit((document) => {
                    document.frames[String(frame)] = framePolygons.filter(
                      (polygon) => polygon.instanceId !== instanceId,
                    );
                  });
                }}
              >
                Clear instance on this frame
              </Button>
              <TextField
                label="Class"
                select
                size="small"
                value={selectedInstance.classId}
                disabled={state.busy}
                onChange={(event) => {
                  session.edit((document) => {
                    document.instances.find((item) => item.id === instanceId)!.classId =
                      event.target.value;
                  });
                }}
              >
                {state.document.classes.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Merge into"
                select
                size="small"
                value={validMergeTarget ? mergeTarget : ""}
                onChange={(event) => {
                  setMergeTarget(event.target.value);
                }}
              >
                <MenuItem value="">Choose target</MenuItem>
                {state.document.instances
                  .filter((item) => item.id !== instanceId)
                  .map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.name}
                    </MenuItem>
                  ))}
              </TextField>
              <Button
                size="small"
                disabled={!validMergeTarget || state.busy}
                onClick={() => {
                  setConfirmation({
                    title:
                      "Merge selected instance into target across all frames? Target ID and class are retained.",
                    run: () => {
                      session.edit((document) => {
                        for (const polygons of Object.values(document.frames)) {
                          for (const polygon of polygons) {
                            if (polygon.instanceId === instanceId) {
                              polygon.instanceId = mergeTarget;
                            }
                          }
                        }
                        document.instances = document.instances.filter(
                          (item) => item.id !== instanceId,
                        );
                      });
                      setInstanceId(mergeTarget);
                      setMergeTarget("");
                    },
                  });
                }}
              >
                Merge instances
              </Button>
              <Button
                size="small"
                color="error"
                disabled={state.busy}
                onClick={() => {
                  setConfirmation({
                    title: "Delete this instance on all frames? You can undo before submitting.",
                    run: () => {
                      removeInstance(selectedInstance.id);
                    },
                  });
                }}
              >
                Delete instance on all frames
              </Button>
            </>
          )}
          <Divider />
          <Typography variant="subtitle2">Draft / submit queue</Typography>
          <Typography variant="caption">
            {Object.keys(state.document.frames).length} frame entries ·{" "}
            {state.jobs.filter((job) => job.status === "succeeded").length} completed submits
          </Typography>
          {state.jobs.map((job, index) => (
            <Typography variant="caption" key={job.id}>
              #{index + 1} {job.status}
              {job.error != undefined ? ` · ${job.error}` : ""}
            </Typography>
          ))}
          {failed && (
            <Button
              size="small"
              onClick={() => {
                session.retry();
              }}
            >
              Retry failed submit
            </Button>
          )}
          <Button
            size="small"
            disabled={pending || state.busy}
            onClick={() => {
              setConfirmation({
                title: "Discard local drafts and queued snapshots, then reload the mock service?",
                run: () => {
                  setLocalError(undefined);
                  void session.discard();
                },
              });
            }}
          >
            Discard drafts / reload saved
          </Button>
          <Divider />
          <Typography variant="subtitle2">Committed history</Typography>
          {state.history
            .slice()
            .reverse()
            .map((revision) => (
              <Stack direction="row" alignItems="center" spacing={0.5} key={revision.revision}>
                <Typography variant="caption" style={{ flex: 1 }}>
                  r{revision.revision} · {revision.message}
                </Typography>
                <Button
                  size="small"
                  disabled={
                    state.dirty ||
                    pending ||
                    failed ||
                    state.busy ||
                    revision.revision === state.saved.revision
                  }
                  onClick={() => {
                    setConfirmation({
                      title: `Restore r${revision.revision} as a new committed revision?`,
                      run: () => {
                        void session.rollback(revision.revision);
                      },
                    });
                  }}
                >
                  Restore
                </Button>
              </Stack>
            ))}
          <Divider />
          <Typography variant="subtitle2">Mock fault controls</Typography>
          <Button
            size="small"
            onClick={() => {
              mockAnnotationService.failNextWrite = true;
              setLocalError("Next mock write will fail. Retry keeps the original snapshot.");
            }}
          >
            Fail next write
          </Button>
          <Button
            size="small"
            disabled={pending || state.busy}
            onClick={() => {
              void simulateExternalRevision();
            }}
          >
            Simulate external revision
          </Button>
        </Stack>
      </Paper>
      <Dialog
        open={confirmation != undefined}
        onClose={() => {
          setConfirmation(undefined);
        }}
      >
        <DialogTitle>Confirm annotation change</DialogTitle>
        <DialogContent>{confirmation?.title}</DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setConfirmation(undefined);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              confirmation?.run();
              setConfirmation(undefined);
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
