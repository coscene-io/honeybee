// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/** IDs are opaque and remain stable across edits, propagation, revisions and references. */
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
  imageUrl: string;
};
export type FrameInstance = {
  frameId: string;
  instanceId: string;
  polygons: SegmentationPolygon[];
  version: number;
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
  annotationSummaries: Record<string, { polygonCount: number; pointCount: number }>;
  /** Includes tombstones so deleting/recreating an annotation cannot bypass CAS. */
  versions: Record<string, number>;
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
  /** Polygon-ID deltas preserve independent later edits when an earlier batch is rejected. */
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
  /** Synchronous user commands share one Undo boundary while retaining independent CAS deltas. */
  groupId?: string;
  id: string;
  label: string;
  patch: SegmentationPatch;
  expectedVersions: Record<string, number>;
};
export type SubmissionBatch = {
  id: string;
  message: string;
  operations: StagedOperation[];
  status: "preparing" | "queued" | "submitting" | "succeeded" | "conflict" | "failed";
  preparationProgress?: number;
  error?: string;
  conflicts?: string[];
  revisionId?: string;
};
export type SegmentationRevision = {
  id: string;
  message: string;
  createdAt: number;
  author?: string;
};
export type SubmitRequest = {
  id: string;
  message: string;
  operations: StagedOperation[];
  expectedVersions: Record<string, number>;
};
export type SubmitResult = {
  status: "succeeded" | "conflict";
  document: SegmentationDocument;
  conflicts: string[];
  revision?: SegmentationRevision;
  warning?: string;
};
export type FrameWindow = {
  videoId: string;
  startSec: number;
  endSec: number;
  annotations: Record<string, FrameInstance>;
  versions: Record<string, number>;
};
export type GpuState = {
  status: "stopped" | "starting" | "connecting" | "ready" | "disconnected" | "error";
  allocated: number;
  quota: number;
  connected: boolean;
  lastActivityAt: number;
  idleTimeoutMs: number;
  error?: string;
  /** Optional local mock capabilities; existing production adapters remain compatible. */
  userId?: string;
  sessionId?: string;
  mock?: boolean;
  identitySource?: "injected" | "demo";
  statusChannel?: "connecting" | "connected" | "disconnected" | "reconnecting" | "closed";
  activeUsers?: number;
  maxUsers?: number;
};
export type MediaCache = {
  limitBytes: number;
  usedBytes: number;
  entries: {
    videoId: string;
    sizeBytes: number;
    uploadedAt: number;
    userId?: string;
    recordId?: string;
    sourceKey?: string;
    cacheKey?: string;
  }[];
};
export type PropagationContext = {
  requestId: string;
  recordId: string;
  videoId: string;
  instanceId: string;
  instanceIds: string[];
  seedSnapshotId: string;
  fromFrameId: string;
  /** Absent for legacy adapters without a labeled revision; never inferred from arrival order. */
  revisionId?: string;
  generation: number;
};
export type PropagationResult = FrameInstance & { context?: PropagationContext };
export type PropagationCancellation = { requestId: string; status: "cancelled" };
export type PropagationSeed = { instanceId: string; polygons: SegmentationPolygon[] };
export type MediaCacheSource = { recordId: string; videoId: string; sourceKey?: string };
export type PropagationCapabilities = {
  models: string[];
  resolutions: number[];
};
export type PropagationRequest = {
  instanceId: string;
  fromFrameId: string;
  /** Propagation only follows later frames after the seed frame. */
  frameCount: number;
  polygonIds?: string[];
  model?: string;
  resolution?: number;
  /** Current local seed, including unsubmitted edits. */
  seedPolygons?: SegmentationPolygon[];
  /** Optional echo contract; existing untagged adapters retain structural-only validation. */
  context?: PropagationContext;
  seeds?: PropagationSeed[];
  cacheKey?: string;
  cacheSource?: MediaCacheSource;
};
export type PropagationState = {
  status: "idle" | "running" | "stopping" | "completed" | "cancelled" | "failed";
  processedFrames: number;
  error?: string;
  cancellationPending?: boolean;
};
/** Optional frontend boundary, independent of inference/transport acknowledgement. */
export type FramePresentationRequest = {
  context: PropagationContext;
  frame: SegmentationFrame;
  signal: AbortSignal;
};
export type FramePresenter = (request: FramePresentationRequest) => Promise<void>;
export type SegmentationTaskRequest = {
  /** Immutable committed export scope; older adapters may omit these fields. */
  revisionId?: string;
  videoId?: string;
  kind: "offline-propagation" | "export-annotations" | "export-video";
  propagation?: PropagationRequest;
  beforeFrames?: number;
  afterFrames?: number;
};
export type SegmentationTask = {
  id: string;
  request: SegmentationTaskRequest;
  status: "queued" | "running" | "completed" | "cancelled" | "failed";
  progress: number;
  error?: string;
  downloadUrl?: string;
  artifact?: {
    kind: "annotations" | "video-manifest";
    mimeType: string;
    fileName: string;
    url: string;
    description: string;
  };
  resultAnnotations?: FrameInstance[];
};
export type MockControls = {
  /** Local revision-author fixture only; real identity comes from the injected session. */
  revisionAuthor?: string;
  cancelDelayMs?: number;
  failCancelNext?: boolean;
  delayMs: number;
  streamDelayMs: number;
  failNext: boolean;
  conflictNext: boolean;
  failTaskNext: boolean;
  connected: boolean;
};

export type SegmentationNodeRef = { type: "class" | "instance" | "polygon"; id: string };
export type SemanticSegmentationStore = {
  document: SegmentationDocument | undefined;
  currentFrameId: string | undefined;
  viewMode: "original" | "instance" | "all";
  focus: SegmentationNodeRef | undefined;
  selection: SegmentationNodeRef[];
  editing: boolean;
  drawingPolygonId: string | undefined;
  /** Explicit local reset boundary for component-owned editor transients, independent of media. */
  interactionResetVersion: number;
  stagedOperations: StagedOperation[];
  canRedo: boolean;
  submissionQueue: SubmissionBatch[];
  revisions: SegmentationRevision[];
  viewingRevisionId: string | undefined;
  readonly: boolean;
  loading: boolean;
  /** The failed geometry read is separate from GPU/task errors and can be retried in place. */
  frameWindowError:
    | { videoId: string; startSec: number; endSec: number; message: string }
    | undefined;
  isFrameReady: (frameId: string) => boolean;
  retryCurrentFrameWindow: () => Promise<void>;
  error: string | undefined;
  gpu: GpuState;
  mediaCache: MediaCache;
  propagationCapabilities?: PropagationCapabilities;
  propagationCapabilitiesError?: string;
  propagationCapabilitiesLoading?: boolean;
  refreshPropagationCapabilities: () => Promise<void>;
  upload: {
    status: "idle" | "uploading" | "completed" | "failed";
    videoId?: string;
    progress: number;
    error?: string;
  };
  propagation: PropagationState;
  tasks: SegmentationTask[];
  initialize: () => Promise<void>;
  loadFrameWindow: (videoId: string, startSec: number, endSec: number) => Promise<void>;
  setCurrentFrame: (frameId: string) => void;
  setViewMode: (mode: "original" | "instance" | "all") => void;
  setFocus: (focus: SegmentationNodeRef | undefined) => void;
  setSelection: (selection: SegmentationNodeRef[]) => void;
  // eslint-disable-next-line @coscene-io/no-boolean-parameters -- Matches the existing UI toggle contract.
  setEditing: (editing: boolean) => void;
  setDrawingPolygonId: (id: string | undefined) => void;
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
  viewRevision: (id?: string) => Promise<void>;
  rollbackRevision: (id: string, expectedHeadRevisionId?: string) => Promise<void>;
  startGpu: (count?: number) => Promise<void>;
  stopGpu: () => Promise<void>;
  refreshGpu: () => Promise<void>;
  reconnectGpuStatus: () => Promise<void>;
  uploadMedia: (videoId: string) => Promise<void>;
  startPropagation: (request: PropagationRequest) => Promise<void>;
  /** A mounted native workspace can serialize streamed display; pure stores need no presenter. */
  registerFramePresenter: (presenter: FramePresenter) => () => void;
  stopPropagation: () => void;
  enqueueTask: (request: SegmentationTaskRequest) => Promise<void>;
  refreshTasks: () => Promise<void>;
  cancelTask: (id: string) => Promise<void>;
  applyTaskResult: (id: string) => void;
  addMomentReference: (
    momentId: string,
    targetType: "class" | "instance",
    targetId: string,
  ) => string;
  clearError: () => void;
  dispose: () => void;
};
