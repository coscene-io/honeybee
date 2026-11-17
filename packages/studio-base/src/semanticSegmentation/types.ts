// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

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
  source?: "mock" | "propagation" | "merge" | "import" | "quick" | "brush";
};
/** Editable polygon components; their union is the instance's geometry (no holes). */
export type PolygonGeometry = { kind: "polygons"; polygons: SegmentationPolygon[] };
/** Pixel geometry; the authoritative form for model output, brush strokes and merges. */
export type MaskGeometry = { kind: "mask"; mask: SegmentationMask };
/**
 * Exactly one representation, as the backend `Frame.geometry` oneof. A stored observation always
 * has foreground: a polygon observation holds at least one complete polygon (≥ 3 vertices) and a
 * mask has at least one foreground pixel. Clearing an observation removes it from the document.
 */
export type ObservationGeometry = PolygonGeometry | MaskGeometry;
export type FrameInstance = { frameId: string; instanceId: string } & ObservationGeometry;
/** A server observation the editor cannot show, e.g. a mask whose size does not match the frame. */
export type UnreadableObservation = { frameId: string; instanceId: string; reason: string };
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
  /**
   * Loaded server observations that cannot be displayed or edited, keyed like `annotations`. The
   * adapter keeps their original geometry and re-sends it, so saving a frame never drops them.
   */
  unreadableObservations?: Record<string, UnreadableObservation>;
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
  /** Server observations in the window that cannot be shown, keyed like `annotations`. */
  unreadable?: Record<string, UnreadableObservation>;
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
/** One inferred frame for one instance; `kind: "empty"` clears that instance on the frame. */
export type PropagationResult = (
  FrameInstance | { frameId: string; instanceId: string; kind: "empty" }
) & { context?: PropagationContext };
export type PropagationCancellation = { requestId: string; status: "cancelled" };
/** A seed is either polygons or a mask, matching the backend seed oneof. */
export type PropagationSeed = { instanceId: string } & ObservationGeometry;
export type PropagationCapabilities = {
  models: string[];
};
export type PropagationRequest = {
  instanceId: string;
  fromFrameId: string;
  /** Propagation only follows later frames. Inclusive end: the last frame's log_time (decimal ns). */
  endTimeNs: string;
  /** Without `seeds`: limit a polygon source observation to these polygons. */
  polygonIds?: string[];
  model?: string;
  /** Optional echo contract; existing untagged adapters retain structural-only validation. */
  context?: PropagationContext;
  /** Explicit seeds, including unsubmitted edits. Omitted: the source observation itself. */
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
/** How a drawing session creates geometry: vertex by vertex, or from model clicks (a mask). */
export type CreationTool = "polygon" | "quick";
/**
 * A creation in progress. The draft (vertices or clicks) lives in the canvas, never in the
 * document; finishing adds complete geometry in one staged command, cancelling changes nothing.
 */
export type DrawingSession = { instanceId: string; frameId: string };
/** What converting a mask to editable polygons loses; polygons cannot hold holes or slivers. */
export type MaskConversionLoss = {
  /** Intersection over union of the original mask and the rasterized polygons. */
  iou: number;
  /** Foreground pixels of the mask that the polygons do not cover. */
  lostPixels: number;
  /** Background pixels the polygons add. */
  addedPixels: number;
  /** Enclosed background regions (holes) the polygons fill in. */
  holes: number;
  /** Mask components too thin or small to become a polygon. */
  droppedComponents: number;
  polygonCount: number;
};
export type SemanticSegmentationStore = {
  document: SegmentationDocument | undefined;
  currentFrameId: string | undefined;
  viewMode: "original" | "instance" | "all";
  focus: SegmentationNodeRef | undefined;
  selection: SegmentationNodeRef[];
  editing: boolean;
  drawing: DrawingSession | undefined;
  /** The tool a new drawing session uses; remembered across sessions. */
  creationTool: CreationTool;
  /** Explicit local reset boundary for component-owned editor transients, independent of media. */
  interactionResetVersion: number;
  stagedOperations: StagedOperation[];
  canRedo: boolean;
  submissionQueue: SubmissionBatch[];
  loading: boolean;
  /** The failed geometry read is separate from GPU/task errors and can be retried in place. */
  frameWindowError:
    { videoId: string; startSec: number; endSec: number; message: string } | undefined;
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
  /** Start creating geometry for an instance on the current frame with the given (or last) tool. */
  startDrawing: (instanceId: string, tool?: CreationTool) => void;
  /** Move a drawing session that has no draft yet onto another (camera's) frame. */
  retargetDrawing: (frameId: string) => void;
  cancelDrawing: () => void;
  setCreationTool: (tool: CreationTool) => void;
  addClass: (name?: string) => string;
  renameClass: (id: string, name: string) => void;
  renameInstance: (id: string, name: string) => void;
  deleteClass: (id: string) => void;
  mergeClasses: (sourceIds: string[], targetClassId: string) => void;
  addInstance: (classId: string, name?: string) => string;
  moveInstance: (instanceId: string, classId: string) => void;
  deleteInstance: (instanceId: string, scope?: "frame" | "all") => void;
  /**
   * Add one complete polygon (≥ 3 vertices, nonzero area) to the instance on the current frame
   * and end any drawing session. On a mask observation the polygon is rasterized into the mask:
   * the observation keeps one representation and the mask stays lossless.
   */
  addPolygon: (instanceId: string, points: NormalizedPoint[]) => string;
  /** Union a mask into the instance's observation on the current frame (polygons are rasterized). */
  addMask: (instanceId: string, mask: SegmentationMask, label?: string) => void;
  /** Replace the instance's mask on the current frame (brush/eraser); an empty mask clears it. */
  replaceMask: (instanceId: string, mask: SegmentationMask, label?: string) => void;
  /** Rasterize a polygon observation on the current frame into a mask (sub-pixel precision only). */
  convertToMask: (instanceId: string) => void;
  /** Vectorize a mask observation on the current frame; holes and slivers are lost (see `maskConversionLoss`). */
  convertToPolygons: (instanceId: string) => void;
  setPolygonPoints: (polygonId: string, points: NormalizedPoint[]) => void;
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
