// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { maskOf, summarizeObservation } from "../maskGeometry";
import {
  mockMaskCatalog,
  propagateMockMask,
  synthesizeMockObservations,
  type MockMaskProfile,
} from "./mockMasks";
import {
  applySegmentationPatch,
  cloneSegmentation,
  frameInstanceKey,
  mergeSourceMetadata,
  patchAnnotationKeys,
  propagationTargets,
  resolvePropagationSeeds,
  SegmentationService,
  validateFrameWindow,
  validatePropagationCapabilities,
} from "../service";
import {
  FrameInstance,
  MockControls,
  NormalizedPoint,
  PropagationCapabilities,
  SegmentationDocument,
  SubmitResult,
} from "../types";

const MOCK_FRAME_WIDTH_PX = 960;
const MOCK_FRAME_HEIGHT_PX = 540;
const MOCK_PROPAGATION_STEP_PX = 10;

/** Mock propagation: shifts points right and down by 10px for each frame away from the seed. */
function shiftPolygonPoints(points: NormalizedPoint[], steps: number): NormalizedPoint[] {
  const dx = Math.min(
    (steps * MOCK_PROPAGATION_STEP_PX) / MOCK_FRAME_WIDTH_PX,
    1 - Math.max(0, ...points.map((point) => point.x)),
  );
  const dy = Math.min(
    (steps * MOCK_PROPAGATION_STEP_PX) / MOCK_FRAME_HEIGHT_PX,
    1 - Math.max(0, ...points.map((point) => point.y)),
  );
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
      logTimeNs: String(1_700_000_000_000_000_000n + BigInt(index) * 200_000_000n),
      imageUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    };
  });
  const annotations: Record<string, FrameInstance> = {};
  for (const frame of frames) {
    for (const [instanceId, x] of [
      ["instance-1", 0.17 + frame.index * 0.002],
      ["instance-2", 0.6],
    ] as const) {
      const key = frameInstanceKey(frame.id, instanceId);
      annotations[key] = {
        frameId: frame.id,
        instanceId,
        kind: "polygons",
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
    }
  }
  const sideFrames = Array.from({ length: 4 }, (_, index) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#243044"/><text x="30" y="50" fill="white" font-size="24">Side camera · frame ${index + 1}</text></svg>`;
    return {
      id: `side-${index}`,
      videoId: "video-side",
      index,
      timestampSec: index / 5,
      logTimeNs: String(1_700_000_000_000_000_000n + BigInt(index) * 200_000_000n),
      imageUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    };
  });
  for (const frame of sideFrames) {
    const key = frameInstanceKey(frame.id, "instance-side");
    annotations[key] = {
      frameId: frame.id,
      instanceId: "instance-side",
      kind: "polygons",
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
    annotationSummaries: Object.fromEntries(
      Object.keys(annotations).map((key) => [key, { polygonCount: 1, pointCount: 4 }]),
    ),
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

export type MockSegmentationService = SegmentationService & {
  controls: MockControls;
  setControls: (controls: Partial<MockControls>) => void;
  reset: () => void;
};

/** Tests tune the local mock behind a runtime; any other service is a test setup error. */
export function setMockControls(
  service: SegmentationService,
  controls: Partial<MockControls>,
): void {
  if (!("setControls" in service)) {
    throw new Error("Not the local mock annotation service");
  }
  (service as MockSegmentationService).setControls(controls);
}

/**
 * In-memory annotation service for tests and fixtures. Saves keep current state in memory and,
 * when `storage` is given, in that storage.
 */
export function createMockSegmentationService(
  options: {
    document?: SegmentationDocument;
    controls?: Partial<MockControls>;
    /** Trusted local context from the current-user adapter; never a real auth credential. */
    identity?: { userId: string; sessionId?: string };
    capabilities?: Partial<PropagationCapabilities>;
    /** Opt in for browser reload persistence; memory-only by default. */
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    storageKey?: string;
    /**
     * MOCK masks for tests and fixtures. Untouched mock observations are synthesized
     * deterministically when their frame window loads and are never persisted; a saved edit or
     * delete of that frame-instance, or a missing instance, suppresses them.
     */
    mockMasks?: MockMaskProfile;
  } = {},
): MockSegmentationService {
  const seed = cloneSegmentation(options.document ?? createSeedDocument());
  const controls: MockControls = {
    delayMs: 60,
    streamDelayMs: 100,
    failNext: false,
    ...options.controls,
  };
  const capabilities = cloneSegmentation<PropagationCapabilities>({
    models: ["sam2.1-motion", "sam3.1"],
    ...options.capabilities,
  });
  let document = cloneSegmentation(seed);
  /** Frame-instance keys written by a save; their stored state, even absence, wins over mocks. */
  let saved = new Set<string>();
  /** Results of acknowledged saves, so a retried request id does not apply twice. */
  let receipts = new Map<string, SubmitResult>();
  let persistenceError: string | undefined;
  const baseStorageKey = options.storageKey ?? "semantic-segmentation-mock-v1";
  const storageKey = options.identity
    ? JSON.stringify([baseStorageKey, options.identity.userId])!
    : baseStorageKey;
  let stored: string | undefined;
  try {
    stored = options.storage?.getItem(storageKey) ?? undefined;
  } catch {
    persistenceError =
      "Local storage is unavailable; changes remain in memory and are lost when the page closes.";
  }
  function isUntouchedMock(doc: SegmentationDocument, key: string): boolean {
    const annotation = doc.annotations[key];
    return maskOf(annotation)?.source === "mock" && !saved.has(key);
  }
  function withoutUntouchedMocks(doc: SegmentationDocument): SegmentationDocument {
    if (!options.mockMasks) {
      return doc;
    }
    const keep = (key: string) => !isUntouchedMock(doc, key);
    return {
      ...doc,
      annotations: Object.fromEntries(Object.entries(doc.annotations).filter(([key]) => keep(key))),
      annotationSummaries: Object.fromEntries(
        Object.entries(doc.annotationSummaries).filter(([key]) => keep(key)),
      ),
    };
  }
  /** Adds MOCK masks for frame-instances that hold no stored geometry and were never saved. */
  function materializeMocks(frames: SegmentationDocument["frames"]): void {
    const profile = options.mockMasks;
    if (!profile) {
      return;
    }
    const instances = new Set(document.instances.map((instance) => instance.id));
    const created = synthesizeMockObservations(profile, document.videos, frames, (key) => {
      const [, instanceId] = JSON.parse(key) as [string, string];
      return !instances.has(instanceId) || document.annotations[key] != undefined || saved.has(key);
    });
    for (const [key, annotation] of Object.entries(created)) {
      document.annotations[key] = annotation;
      document.annotationSummaries[key] = summarizeObservation(annotation);
    }
  }
  function ensureMockCatalog(): void {
    const profile = options.mockMasks;
    if (!profile) {
      return;
    }
    const catalog = mockMaskCatalog(profile);
    // Added once; a later delete of a mock class or instance must stay deleted.
    if (!document.classes.some((item) => item.id === catalog.classes[0]!.id)) {
      document.classes = [...document.classes, ...catalog.classes];
      document.instances = [...document.instances, ...catalog.instances];
    }
  }
  function persist(): string | undefined {
    try {
      options.storage?.setItem(
        storageKey,
        JSON.stringify({
          document: withoutUntouchedMocks(document),
          saved: [...saved],
          receipts: [...receipts].map(([id, receipt]) => [
            id,
            { ...receipt, document: withoutUntouchedMocks(receipt.document) },
          ]),
        })!,
      );
      persistenceError = undefined;
    } catch {
      persistenceError = "Local storage is full or unavailable; saved in memory only.";
    }
    return persistenceError;
  }
  function reset() {
    document = cloneSegmentation(seed);
    saved = new Set();
    receipts = new Map();
    Object.assign(controls, { failNext: false, failCancelNext: false });
  }
  ensureMockCatalog();
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as {
        document: SegmentationDocument;
        saved?: string[];
        receipts?: [string, SubmitResult][];
      };
      if (parsed.document.record.id === seed.record.id) {
        document = parsed.document;
        saved = new Set(parsed.saved);
        receipts = new Map(parsed.receipts);
        ensureMockCatalog();
      }
    } catch {
      // A corrupt local cache must not prevent opening a fresh workbench.
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
  const service: MockSegmentationService = {
    controls,
    setControls: (next) => {
      Object.assign(controls, next);
    },
    reset() {
      reset();
      ensureMockCatalog();
      persistenceError = undefined;
      try {
        options.storage?.removeItem(storageKey);
      } catch {
        persistenceError =
          "Local storage could not be cleared; enable storage before resetting the saved demo.";
      }
    },
    supportsPropagationContext: true,
    supportsMultiInstanceSeeds: true,
    supportsInstanceMerge: true,
    getPropagationCapabilities: async () => await Promise.resolve(cloneSegmentation(capabilities)),
    async cancelPropagation(context) {
      await delay(controls.cancelDelayMs ?? controls.delayMs);
      if (controls.failCancelNext === true) {
        controls.failCancelNext = false;
        throw new Error("Mock cancellation acknowledgement failed; retry stopping this request");
      }
      return { requestId: context.requestId, status: "cancelled" };
    },
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
      const windowFrames = document.frames.filter(
        (frame) =>
          frame.videoId === videoId &&
          frame.timestampSec >= startSec &&
          frame.timestampSec <= endSec,
      );
      materializeMocks(windowFrames);
      const frameIds = new Set(windowFrames.map((frame) => frame.id));
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
      };
    },
    async submit(request) {
      await before();
      const receipt = receipts.get(request.id);
      if (receipt) {
        // An acknowledged retry must not roll the client back over unrelated later saves.
        return { ...cloneSegmentation(receipt), document: cloneSegmentation(document) };
      }
      for (const operation of request.operations) {
        for (const key of patchAnnotationKeys(document, operation.patch)) {
          saved.add(key);
        }
        document = applySegmentationPatch(document, operation.patch);
      }
      const result: SubmitResult = { document: cloneSegmentation(document) };
      receipts.set(request.id, result);
      result.warning = persist();
      return cloneSegmentation(result);
    },
    async *propagate(request, signal) {
      const context = cloneSegmentation(request.context);
      await before(signal);
      validatePropagationCapabilities(request, capabilities);
      const source = document.frames.find((frame) => frame.id === request.fromFrameId);
      if (!source) {
        throw new Error("Unknown source frame");
      }
      materializeMocks([source]);
      const seedAnnotation = document.annotations[frameInstanceKey(source.id, request.instanceId)];
      const seeds = resolvePropagationSeeds(request, seedAnnotation);
      const sourceVideo = document.videos.find((video) => video.id === source.videoId);
      const size =
        sourceVideo?.width != undefined && sourceVideo.height != undefined
          ? { width: sourceVideo.width, height: sourceVideo.height }
          : undefined;
      const ordered = propagationTargets(document.frames, source, request.endTimeNs);
      for (const [frameOffset, frame] of ordered.entries()) {
        await delay(controls.streamDelayMs, signal);
        for (const seed of seeds) {
          const common = {
            ...(context ? { context: cloneSegmentation(context) } : {}),
            frameId: frame.id,
            instanceId: seed.instanceId,
          };
          // MOCK: like the backend, propagation answers with masks once the topic size is bound
          // (or the seed is a mask, which carries its size). Without a size it stays polygons.
          if (seed.kind === "mask" || (options.mockMasks && size)) {
            yield {
              ...common,
              kind: "mask" as const,
              mask: propagateMockMask(
                seed,
                seed.kind === "mask" ? seed.mask : size!,
                frameOffset + 1,
              ),
            };
            continue;
          }
          yield {
            ...common,
            kind: "polygons" as const,
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
