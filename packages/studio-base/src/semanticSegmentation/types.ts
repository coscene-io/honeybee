// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/** IDs are opaque and remain stable across edits, propagation and references. */
export type SegmentationId = string;
/** Coordinates are floating point values in [0, 1], relative to the original image. */
export type NormalizedPoint = { x: number; y: number };
export type SegmentationClass = { id: string; name: string; color: string };
export type SegmentationInstance = { id: string; classId: string; name: string };
export type SegmentationPolygon = {
  id: string;
  points: NormalizedPoint[];
  /** Image topic this polygon was drawn on. Omitted until the frame's video is known. */
  topic?: string;
};
export type SegmentationVideo = {
  id: string;
  recordId: string;
  name: string;
  durationSec: number;
  fps: number;
  sizeBytes: number;
  mediaUrl: string;
  /** Media-layer topic. Polygons on this video use its original pixel size. */
  topic?: string;
  /** Original frame size in pixels. Annotation points are normalized until the contract boundary. */
  width?: number;
  height?: number;
};
export type SegmentationFrame = {
  id: string;
  videoId: string;
  index: number;
  timestampSec: number;
  /** Absolute MCAP log_time in nanoseconds (decimal string). With the topic, this is the frame's identity on the wire. */
  logTimeNs: string;
  imageUrl: string;
};
/**
 * Pixel geometry for one observation, bound to the decoded source frame of its topic.
 * The wire `Mask` carries only `counts`; width/height come from the topic's decoded frame and are
 * kept here so a mask can never be decoded against the wrong size.
 */
export type SegmentationMask = {
  /** COCO compressed RLE counts, column-major (Fortran) order. Authoritative pixels. */
  counts: string;
  width: number;
  height: number;
  /** Provenance for labelling only. "mock" is synthetic local data, never inference output. */
  source?: "mock" | "propagation" | "merge" | "import";
};
export type FrameInstance = {
  frameId: string;
  instanceId: string;
  /**
   * One authoritative representation per observation (backend `Frame.geometry` oneof). When
   * `mask` is set, `polygons` is empty; editing a mask into polygons removes `mask`.
   */
  polygons: SegmentationPolygon[];
  mask?: SegmentationMask;
};
/** Lightweight presence metadata; `maskArea` counts foreground pixels of a mask observation. */
export type AnnotationSummary = {
  polygonCount: number;
  pointCount: number;
  maskArea?: number;
  /**
   * Presence known only from the service timeline (ListTimelineRanges): the frame has foreground
   * geometry, but its geometry is not loaded, so the counts are unknown (zero).
   */
  fromTimeline?: true;
};
export type MomentReference = {
  id: string;
  momentId: string;
  recordId: string;
  videoId: string;
  targetType: "class" | "instance";
  targetId: string;
};
export type SegmentationDocument = {
  record: { id: string; name: string };
  videos: SegmentationVideo[];
  classes: SegmentationClass[];
  instances: SegmentationInstance[];
  /** Frame metadata is lightweight; geometry is loaded only for requested windows. */
  frames: SegmentationFrame[];
  annotations: Record<string, FrameInstance>;
  /** Lightweight presence metadata for tree counts without fetching all frame geometry. */
  annotationSummaries: Record<string, AnnotationSummary>;
  momentReferences: MomentReference[];
};
/** A patch is immutable once staged. Undefined values remove entities. */
export type SegmentationPatch = {
  classes?: Record<string, SegmentationClass | undefined>;
  instances?: Record<string, SegmentationInstance | undefined>;
  annotations?: Record<string, FrameInstance | undefined>;
  momentReferences?: Record<string, MomentReference | undefined>;
  /** Applies across unloaded frames too. Sources are removed after their polygons are moved. */
  instanceMerges?: Record<string, string>;
  /** Polygon-ID deltas, so a save rewrites only the polygons this command changed. */
  polygonChanges?: Record<
    string,
    {
      frameId: string;
      instanceId: string;
      polygons: Record<string, SegmentationPolygon | undefined>;
    }
  >;
};
export type StagedOperation = {
  /** Synchronous user commands share one Undo boundary. */
  groupId?: string;
  id: string;
  label: string;
  patch: SegmentationPatch;
};
/** The service saves current state; there is no version history or conflict check. */
export type SubmissionBatch = {
  id: string;
  message: string;
  operations: StagedOperation[];
  status: "queued" | "submitting" | "succeeded" | "failed";
  error?: string;
};
export type SubmitRequest = {
  id: string;
  message: string;
  operations: StagedOperation[];
};
export type SubmitResult = {
  document: SegmentationDocument;
  warning?: string;
};
export type FrameWindow = {
  videoId: string;
  startSec: number;
  endSec: number;
  annotations: Record<string, FrameInstance>;
};
export type PropagationContext = {
  requestId: string;
  recordId: string;
  videoId: string;
  instanceId: string;
  instanceIds: string[];
  seedSnapshotId: string;
  fromFrameId: string;
  generation: number;
};
export type PropagationResult = FrameInstance & { context?: PropagationContext };
export type PropagationCancellation = { requestId: string; status: "cancelled" };
/** A seed is either polygons or a mask, matching the backend seed oneof. */
export type PropagationSeed = {
  instanceId: string;
  polygons: SegmentationPolygon[];
  mask?: SegmentationMask;
};
export type PropagationCapabilities = {
  models: string[];
};
export type PropagationRequest = {
  instanceId: string;
  fromFrameId: string;
  /** Propagation only follows later frames. Inclusive end: the last frame's log_time (decimal ns). */
  endTimeNs: string;
  polygonIds?: string[];
  model?: string;
  /** Current local seed, including unsubmitted edits. */
  seedPolygons?: SegmentationPolygon[];
  /** Current local mask seed, when the seed observation is a mask. */
  seedMask?: SegmentationMask;
  /** Optional echo contract; existing untagged adapters retain structural-only validation. */
  context?: PropagationContext;
  seeds?: PropagationSeed[];
};
export type PropagationState = {
  status: "idle" | "running" | "stopping" | "completed" | "cancelled" | "failed";
  processedFrames: number;
  error?: string;
  cancellationPending?: boolean;
};
export type MockControls = {
  cancelDelayMs?: number;
  failCancelNext?: boolean;
  delayMs: number;
  streamDelayMs: number;
  failNext: boolean;
};

export type SegmentationNodeRef = { type: "class" | "instance" | "polygon"; id: string };
/**
 * One mask observation opened for vertex editing. Until the first real edit its polygons are a
 * view over the untouched mask; the first edit replaces the observation with polygons (the
 * backend oneof), and Undo restores the mask.
 */
export type MaskEditState = {
  key: string;
  frameId: string;
  instanceId: string;
  counts: string;
  original: FrameInstance;
  polygons: SegmentationPolygon[];
};
export type SemanticSegmentationStore = {
  document: SegmentationDocument | undefined;
  currentFrameId: string | undefined;
  viewMode: "original" | "instance" | "all";
  focus: SegmentationNodeRef | undefined;
  selection: SegmentationNodeRef[];
  editing: boolean;
  drawingPolygonId: string | undefined;
  maskEdit: MaskEditState | undefined;
  /** Explicit local reset boundary for component-owned editor transients, independent of media. */
  interactionResetVersion: number;
  stagedOperations: StagedOperation[];
  canRedo: boolean;
  submissionQueue: SubmissionBatch[];
  loading: boolean;
  /** The failed geometry read is separate from GPU/task errors and can be retried in place. */
  frameWindowError:
    | { videoId: string; startSec: number; endSec: number; message: string }
    | undefined;
  isFrameReady: (frameId: string) => boolean;
  retryCurrentFrameWindow: () => Promise<void>;
  error: string | undefined;
  propagationCapabilities?: PropagationCapabilities;
  propagationCapabilitiesError?: string;
  propagationCapabilitiesLoading?: boolean;
  refreshPropagationCapabilities: () => Promise<void>;
  propagation: PropagationState;
  initialize: () => Promise<void>;
  loadFrameWindow: (videoId: string, startSec: number, endSec: number) => Promise<void>;
  /**
   * Background read of a window for playback: never aborts the current window load, never shows
   * loading or errors, and only fills frames that are not loaded yet. Concurrent calls for the same
   * window share one request.
   */
  prefetchFrameWindow: (videoId: string, startSec: number, endSec: number) => Promise<void>;
  setCurrentFrame: (frameId: string) => void;
  setViewMode: (mode: "original" | "instance" | "all") => void;
  setFocus: (focus: SegmentationNodeRef | undefined) => void;
  setSelection: (selection: SegmentationNodeRef[]) => void;
  // eslint-disable-next-line @coscene-io/no-boolean-parameters -- Matches the existing UI toggle contract.
  setEditing: (editing: boolean) => void;
  setDrawingPolygonId: (id: string | undefined) => void;
  /** Convert exactly one mask observation (this instance, this frame) to editable polygons. */
  beginMaskEdit: (frameId: string, instanceId: string) => MaskEditState;
  addClass: (name?: string) => string;
  renameClass: (id: string, name: string) => void;
  renameInstance: (id: string, name: string) => void;
  deleteClass: (id: string) => void;
  mergeClasses: (sourceIds: string[], targetClassId: string) => void;
  addInstance: (classId: string, name?: string) => string;
  moveInstance: (instanceId: string, classId: string) => void;
  deleteInstance: (instanceId: string, scope?: "frame" | "all") => void;
  addPolygon: (instanceId: string, points?: NormalizedPoint[]) => string;
  /** Moves an empty in-progress polygon onto the frame that receives its first vertex. */
  retargetEmptyDrawing: (frameId: string) => void;
  setPolygonPoints: (polygonId: string, points: NormalizedPoint[]) => void;
  /** Replace the polygon being drawn with a mask (quick annotation), merged into the frame. */
  commitDrawingMask: (mask: SegmentationMask) => void;
  deletePolygon: (polygonId: string) => void;
  mergeInstances: (sourceIds: string[], targetInstanceId: string) => void;
  mergePolygons: (polygonIds: string[], targetInstanceId: string) => void;
  /** Group synchronous local mutations; rollback all staged changes if the command throws. */
  runTransaction: (label: string, command: () => undefined) => void;
  undo: () => void;
  /** Restore the last undone local command without submitting it. */
  redo: () => void;
  revertStaging: () => void;
  /** Returns immediately; network work is serialized separately. */
  submit: (message?: string) => string | undefined;
  waitForSubmissions: () => Promise<void>;
  retrySubmission: (id: string) => void;
  startPropagation: (request: PropagationRequest) => Promise<void>;
  /** A mounted native workspace can serialize streamed display; pure stores need no presenter. */
  stopPropagation: () => void;
  addMomentReference: (
    momentId: string,
    targetType: "class" | "instance",
    targetId: string,
  ) => string;
  clearError: () => void;
  dispose: () => void;
};
