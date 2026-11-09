// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { v4 as uuidv4 } from "uuid";

import { CreateCommitBody, projectStoredDocument, recordResourceName } from "./annotationContract";
import {
  MockGpuPool,
  MOCK_GPU_IDLE_TIMEOUT_MS,
  MOCK_MEDIA_CACHE_LIMIT_BYTES,
  sharedMockGpuPool,
} from "./mockGpuPool";
import { MockGpuSession } from "./mockGpuSession";
import {
  applySegmentationPatch,
  cloneSegmentation,
  frameInstanceKey,
  mergeSourceMetadata,
  patchAnnotationKeys,
  resolvePropagationSeeds,
  SemanticSegmentationService,
  validateFrameWindow,
  validatePropagationCapabilities,
} from "./service";
import {
  FrameInstance,
  MockControls,
  NormalizedPoint,
  PropagationCapabilities,
  SegmentationDocument,
  SegmentationRevision,
  SubmitResult,
} from "./types";

export const GPU_IDLE_TIMEOUT_MS = MOCK_GPU_IDLE_TIMEOUT_MS;
export const MEDIA_CACHE_LIMIT_BYTES = MOCK_MEDIA_CACHE_LIMIT_BYTES;

const MOCK_FRAME_WIDTH_PX = 960;
const MOCK_FRAME_HEIGHT_PX = 540;
const MOCK_PROPAGATION_STEP_PX = 10;

/** Mock propagation: shifts points right and down by 10px for each frame away from the seed. */
function shiftPolygonPoints(points: NormalizedPoint[], steps: number): NormalizedPoint[] {
  const dx = (steps * MOCK_PROPAGATION_STEP_PX) / MOCK_FRAME_WIDTH_PX;
  const dy = (steps * MOCK_PROPAGATION_STEP_PX) / MOCK_FRAME_HEIGHT_PX;
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

/** Entirely local SVG images; no network requests or production API are required. */
export function createSeedDocument(): SegmentationDocument {
  const frames = Array.from({ length: 120 }, (_, index) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#182737"/><path d="M0 410L960 300V540H0" fill="#30465b"/><rect x="${160 + index * 2}" y="155" width="180" height="240" rx="30" fill="#5e9cad"/><circle cx="650" cy="300" r="75" fill="#cb935b"/><text x="30" y="50" fill="white" font-size="24">Local workshop · frame ${index + 1}</text></svg>`;
    return {
      id: `frame-${index}`,
      videoId: "video-1",
      index,
      timestampSec: index / 5,
      imageUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    };
  });
  const annotations: Record<string, FrameInstance> = {};
  const versions: Record<string, number> = {};
  for (const frame of frames) {
    for (const [instanceId, x] of [
      ["instance-1", 0.17 + frame.index * 0.002],
      ["instance-2", 0.6],
    ] as const) {
      const key = frameInstanceKey(frame.id, instanceId);
      annotations[key] = {
        frameId: frame.id,
        instanceId,
        version: 1,
        polygons: [
          {
            id: `${instanceId}-polygon-${frame.index}`,
            points: [
              { x, y: 0.3 },
              { x: x + 0.15, y: 0.3 },
              { x: x + 0.15, y: 0.7 },
              { x, y: 0.7 },
            ],
          },
        ],
      };
      versions[key] = 1;
    }
  }
  const sideFrames = Array.from({ length: 4 }, (_, index) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#243044"/><text x="30" y="50" fill="white" font-size="24">Side camera · frame ${index + 1}</text></svg>`;
    return {
      id: `side-${index}`,
      videoId: "video-side",
      index,
      timestampSec: index / 5,
      imageUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    };
  });
  for (const frame of sideFrames) {
    const key = frameInstanceKey(frame.id, "instance-side");
    annotations[key] = {
      frameId: frame.id,
      instanceId: "instance-side",
      version: 1,
      polygons: [
        {
          id: `instance-side-polygon-${frame.index}`,
          points: [
            { x: 0.2, y: 0.2 },
            { x: 0.45, y: 0.2 },
            { x: 0.45, y: 0.55 },
          ],
        },
      ],
    };
    versions[key] = 1;
  }
  return {
    record: { id: "record-1", name: "Workshop sample" },
    videos: [
      {
        id: "video-1",
        recordId: "record-1",
        name: "Front camera",
        durationSec: 24,
        fps: 5,
        sizeBytes: 64 * 1024 ** 2,
        mediaUrl: frames[0]!.imageUrl,
        topic: "/camera/front",
        width: MOCK_FRAME_WIDTH_PX,
        height: MOCK_FRAME_HEIGHT_PX,
      },
      {
        id: "video-side",
        recordId: "record-1",
        name: "Side camera",
        durationSec: 0.8,
        fps: 5,
        sizeBytes: 8 * 1024 ** 2,
        mediaUrl: sideFrames[0]!.imageUrl,
        topic: "/camera/side",
        width: 1280,
        height: 720,
      },
    ],
    frames: [...frames, ...sideFrames],
    classes: [
      { id: "class-1", name: "Person", color: "#55b8de" },
      { id: "class-2", name: "Object", color: "#edaa59" },
      { id: "class-empty", name: "Unassigned", color: "#b28ee8" },
    ],
    instances: [
      { id: "instance-1", classId: "class-1", name: "Person 1" },
      { id: "instance-2", classId: "class-2", name: "Object 1" },
      { id: "instance-empty", classId: "class-1", name: "Empty instance" },
      { id: "instance-side", classId: "class-1", name: "Person side" },
    ],
    annotations,
    versions,
    annotationSummaries: Object.fromEntries(
      Object.keys(annotations).map((key) => [key, { polygonCount: 1, pointCount: 4 }]),
    ),
    momentReferences: [],
  };
}

function abortError(): Error {
  return new DOMException("Operation cancelled", "AbortError");
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) {
    throw abortError();
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type MockSemanticSegmentationService = SemanticSegmentationService & {
  controls: MockControls;
  setControls: (controls: Partial<MockControls>) => void;
  reset: () => void;
  advanceTime: (ms: number) => void;
  evictMedia: (videoId: string) => void;
  /** Simulate another editor updating a frame-instance without changing the local baseline. */
  simulateExternalEdit: (frameId: string, instanceId: string) => void;
  /** CreateCommit bodies recorded for the seed and each successful save, newest first. */
  contractCommits: CreateCommitBody[];
};

export function createMockSemanticSegmentationService(
  options: {
    document?: SegmentationDocument;
    controls?: Partial<MockControls>;
    now?: () => number;
    /** Trusted local context from the current-user adapter; never a real auth credential. */
    identity?: { userId: string; sessionId?: string };
    gpuPool?: MockGpuPool;
    capabilities?: Partial<PropagationCapabilities>;
    /** Opt in for browser reload persistence; memory-only by default. */
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    storageKey?: string;
  } = {},
): MockSemanticSegmentationService {
  const seed = cloneSegmentation(options.document ?? createSeedDocument());
  const controls: MockControls = {
    delayMs: 60,
    streamDelayMs: 100,
    failNext: false,
    conflictNext: false,
    failTaskNext: false,
    connected: true,
    ...options.controls,
  };
  const capabilities = cloneSegmentation<PropagationCapabilities>({
    directions: ["forward"],
    models: ["sam2.1-motion", "sam3.1"],
    resolutions: [],
    directionReasons: { backward: "标注契约只从种子帧向后续帧传播" },
    ...options.capabilities,
  });
  let document = cloneSegmentation(seed);
  let clockOffset = 0;
  const now = () => (options.now?.() ?? Date.now()) + clockOffset;
  const pool = options.gpuPool ?? (options.identity ? sharedMockGpuPool : new MockGpuPool(now));
  const gpuSession = new MockGpuSession(pool, {
    userId: options.identity?.userId ?? `demo:${uuidv4()}`,
    sessionId: options.identity?.sessionId ?? uuidv4(),
  });
  let sequence = 0;
  const contractCommits: CreateCommitBody[] = [];
  let headCommitName = "";
  let revisions: SegmentationRevision[];
  let snapshots: Map<string, SegmentationDocument>;
  let receipts: Map<string, SubmitResult>;
  let persistenceError: string | undefined;
  const baseStorageKey = options.storageKey ?? "semantic-segmentation-mock-v1";
  const storageKey = options.identity
    ? JSON.stringify([baseStorageKey, options.identity.userId])!
    : baseStorageKey;
  let saved: string | undefined;
  try {
    saved = options.storage?.getItem(storageKey) ?? undefined;
  } catch {
    persistenceError =
      "Local storage is unavailable; changes remain in memory. Export annotations before closing.";
  }
  function persist(): string | undefined {
    try {
      options.storage?.setItem(
        storageKey,
        JSON.stringify({
          document,
          sequence,
          revisions,
          snapshots: [...snapshots],
          receipts: [...receipts],
        })!,
      );
      persistenceError = undefined;
    } catch {
      persistenceError =
        "Local storage is full or unavailable; commit saved in memory only. Export annotations or reset the local demo cache.";
    }
    return persistenceError;
  }
  function reset() {
    document = cloneSegmentation(seed);
    clockOffset = 0;
    sequence = 0;
    controls.revisionAuthor = options.controls?.revisionAuthor;
    revisions = [
      {
        id: "revision-0",
        message: "Initial annotations",
        createdAt: now(),
        author: revisionAuthor(),
      },
    ];
    snapshots = new Map([["revision-0", cloneSegmentation(document)]]);
    receipts = new Map();
    const record = recordResourceName(document.record.id);
    headCommitName = `${record}/commits/genesis`;
    contractCommits.length = 0;
    rememberContract("Initial annotations", "00000000-0000-4000-8000-000000000001");
    Object.assign(controls, {
      failNext: false,
      conflictNext: false,
      failTaskNext: false,
      failCancelNext: false,
      connected: true,
    });
  }
  reset();
  Object.assign(controls, options.controls);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as {
        document: SegmentationDocument;
        sequence: number;
        revisions: SegmentationRevision[];
        snapshots: [string, SegmentationDocument][];
        receipts: [string, SubmitResult][];
      };
      if (parsed.document.record.id === seed.record.id && Array.isArray(parsed.revisions)) {
        document = parsed.document;
        sequence = parsed.sequence;
        revisions = parsed.revisions;
        snapshots = new Map(parsed.snapshots);
        receipts = new Map(parsed.receipts);
      }
    } catch {
      // A corrupt local demo cache must not prevent opening a fresh workbench.
      try {
        options.storage?.removeItem(storageKey);
      } catch {
        /* Storage may be disabled by the browser. */
      }
    }
  }

  async function before(signal?: AbortSignal) {
    await delay(controls.delayMs, signal);
    if (controls.failNext) {
      controls.failNext = false;
      throw new Error("Simulated service failure");
    }
  }
  function mediaIdentity(videoId: string) {
    const video = document.videos.find((item) => item.id === videoId);
    if (!video) {
      throw new Error("Unknown video");
    }
    return {
      recordId: document.record.id,
      videoId,
      sourceKey: JSON.stringify([video.mediaUrl, video.sizeBytes])!,
    };
  }
  function revisionAuthor(): string {
    const author = controls.revisionAuthor?.trim();
    return author != undefined && author.length > 0 ? author : gpuSession.identity.userId;
  }
  function revision(message: string): SegmentationRevision {
    const item = {
      id: `revision-${++sequence}`,
      message,
      createdAt: now(),
      author: revisionAuthor(),
    };
    revisions.unshift(item);
    snapshots.set(item.id, cloneSegmentation(document));
    return item;
  }
  function rememberContract(description: string, requestId: string) {
    const record = recordResourceName(document.record.id);
    const projection = projectStoredDocument(document, {
      baseCommit: headCommitName,
      requestId,
      description,
    });
    headCommitName = `${record}/commits/${revisions[0]?.id ?? "genesis"}`;
    contractCommits.unshift(projection.request);
  }
  function externalEdit(frameId: string, instanceId: string) {
    const key = frameInstanceKey(frameId, instanceId);
    document.versions[key] = (document.versions[key] ?? 0) + 1;
    if (document.annotations[key]) {
      document.annotations[key].version = document.versions[key];
    }
  }
  const service: MockSemanticSegmentationService = {
    controls,
    setControls: (next) => {
      Object.assign(controls, next);
      if (next.connected === false) {
        gpuSession.disconnect();
      }
    },
    reset() {
      gpuSession.stop();
      pool.clearMedia(gpuSession.identity.userId);
      reset();
      persistenceError = undefined;
      try {
        options.storage?.removeItem(storageKey);
      } catch {
        persistenceError =
          "Local storage could not be cleared; enable storage before resetting the saved demo.";
      }
    },
    getPersistenceError: () => persistenceError,
    evictMedia: (videoId) => {
      pool.evictMedia(gpuSession.identity.userId, mediaIdentity(videoId));
    },
    supportsPropagationContext: true,
    supportsMultiInstanceSeeds: true,
    getPropagationCapabilities: async () => await Promise.resolve(cloneSegmentation(capabilities)),
    async cancelPropagation(context) {
      await delay(controls.cancelDelayMs ?? controls.delayMs);
      if (controls.failCancelNext === true) {
        controls.failCancelNext = false;
        throw new Error("Mock cancellation acknowledgement failed; retry stopping this request");
      }
      return { requestId: context.requestId, status: "cancelled" };
    },
    advanceTime: (ms) => {
      clockOffset += ms;
      pool.reportIdle(now());
    },
    simulateExternalEdit: externalEdit,
    contractCommits,
    updateSourceMetadata(metadata) {
      document = mergeSourceMetadata(document, metadata);
      persist();
    },
    async loadDocument(signal) {
      await before(signal);
      return { ...cloneSegmentation(document), annotations: {} };
    },
    async loadFrameWindow(videoId, startSec, endSec, signal) {
      validateFrameWindow(startSec, endSec);
      if (!document.videos.some((video) => video.id === videoId)) {
        throw new Error("Unknown video");
      }
      await before(signal);
      const frameIds = new Set(
        document.frames
          .filter(
            (frame) =>
              frame.videoId === videoId &&
              frame.timestampSec >= startSec &&
              frame.timestampSec <= endSec,
          )
          .map((frame) => frame.id),
      );
      return {
        videoId,
        startSec,
        endSec,
        annotations: cloneSegmentation(
          Object.fromEntries(
            Object.entries(document.annotations).filter(([, annotation]) =>
              frameIds.has(annotation.frameId),
            ),
          ),
        ),
        versions: cloneSegmentation(document.versions),
      };
    },
    async submit(request) {
      await before();
      const receipt = receipts.get(request.id);
      if (receipt) {
        // An acknowledged retry must not roll the client back over unrelated later commits.
        return { ...cloneSegmentation(receipt), document: cloneSegmentation(document) };
      }
      // Compute against the sequential candidate so creates followed by a merge in the same
      // submission still CAS-check the existing destination frame-instance.
      let candidate = document;
      const touchedKeys = new Set<string>();
      for (const operation of request.operations) {
        for (const key of patchAnnotationKeys(candidate, operation.patch)) {
          touchedKeys.add(key);
        }
        candidate = applySegmentationPatch(candidate, operation.patch);
      }
      const touched = [...touchedKeys];
      if (controls.conflictNext && touched.length > 0) {
        controls.conflictNext = false;
        const key = touched[0]!;
        document.versions[key] = (document.versions[key] ?? 0) + 1;
        if (document.annotations[key]) {
          document.annotations[key].version = document.versions[key];
        }
      }
      const conflicts = touched.filter(
        (key) => request.expectedVersions[key] !== (document.versions[key] ?? 0),
      );
      if (conflicts.length > 0) {
        return { status: "conflict", conflicts, document: cloneSegmentation(document) };
      }
      projectStoredDocument(candidate, {
        baseCommit: headCommitName,
        requestId: request.id,
        description: request.message,
      });
      document = candidate;
      for (const key of touched) {
        document.versions[key] = (document.versions[key] ?? 0) + 1;
        if (document.annotations[key]) {
          document.annotations[key].version = document.versions[key];
        }
      }
      const savedRevision = revision(request.message);
      rememberContract(request.message, request.id);
      const result: SubmitResult = {
        status: "succeeded",
        conflicts: [],
        revision: savedRevision,
        document: cloneSegmentation(document),
      };
      receipts.set(request.id, result);
      result.warning = persist();
      return cloneSegmentation(result);
    },
    async listRevisions() {
      await before();
      return cloneSegmentation(revisions);
    },
    async loadRevision(id) {
      await before();
      const snapshot = snapshots.get(id);
      if (!snapshot) {
        throw new Error("Unknown revision");
      }
      return cloneSegmentation(snapshot);
    },
    async rollbackRevision(id, expectedHeadRevisionId = revisions[0]?.id) {
      await before();
      if (expectedHeadRevisionId !== revisions[0]?.id) {
        throw new Error("版本并发冲突：最新版本已变化，请刷新后重新确认回退。");
      }
      const snapshot = snapshots.get(id);
      if (!snapshot) {
        throw new Error("Unknown revision");
      }
      const versions = { ...document.versions };
      const keys = new Set([
        ...Object.keys(document.annotations),
        ...Object.keys(snapshot.annotations),
      ]);
      document = cloneSegmentation(snapshot);
      document.versions = versions;
      for (const key of keys) {
        document.versions[key] = (versions[key] ?? 0) + 1;
        if (document.annotations[key]) {
          document.annotations[key].version = document.versions[key];
        }
      }
      const savedRevision = revision(`Rollback to ${id}`);
      rememberContract(`Rollback to ${id}`, `rollback-${id}-${savedRevision.id}`);
      const result: SubmitResult = {
        status: "succeeded",
        conflicts: [],
        document: cloneSegmentation(document),
        revision: savedRevision,
      };
      result.warning = persist();
      return result;
    },
    async *propagate(request, signal) {
      const context = cloneSegmentation(request.context);
      await before(signal);
      if (request.direction !== "forward") {
        throw new Error("Propagation only follows later source frames");
      }
      validatePropagationCapabilities(request, capabilities);
      const source = document.frames.find((frame) => frame.id === request.fromFrameId);
      if (!source) {
        throw new Error("Unknown source frame");
      }
      const seedAnnotation = document.annotations[frameInstanceKey(source.id, request.instanceId)];
      const seeds = resolvePropagationSeeds(request, seedAnnotation?.polygons);
      if (!Number.isInteger(request.frameCount) || request.frameCount < 1) {
        throw new Error("Frame count must be a positive integer");
      }
      const ordered = document.frames
        .filter((frame) => frame.videoId === source.videoId && frame.index > source.index)
        .sort((a, b) => a.index - b.index)
        .slice(0, request.frameCount);
      for (const [frameOffset, frame] of ordered.entries()) {
        await delay(controls.streamDelayMs, signal);
        pool.touch(gpuSession.identity);
        for (const seed of seeds) {
          yield {
            ...(context ? { context: cloneSegmentation(context) } : {}),
            frameId: frame.id,
            instanceId: seed.instanceId,
            version: document.versions[frameInstanceKey(frame.id, seed.instanceId)] ?? 0,
            polygons: seed.polygons.map((polygon) => ({
              id: `${polygon.id}@${frame.id}`,
              points: shiftPolygonPoints(polygon.points, frameOffset + 1),
            })),
          };
        }
      }
    },
  };
  return service;
}
