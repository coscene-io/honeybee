// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import { v4 as uuidv4 } from "uuid";

import {
  FrameSchema,
  type Frame,
} from "@foxglove/studio-base/services/api/spatial-annotation/generated/coscene/dataplatform/v1alpha3/resources/annotation_pb";
import {
  AnnotationService,
  type ListFramesRequest,
  type PropagateAnnotationRequest,
  type SaveAnnotationRequest,
} from "@foxglove/studio-base/services/api/spatial-annotation/generated/coscene/dataplatform/v1alpha3/services/annotation_pb";

import {
  FrameTimeIndex,
  microsToTimestamp,
  timestampToMicros,
  truncateToMicros,
} from "./frameTime";
import { createLiveAnnotationService } from "./liveService";
import { encodeCounts } from "./maskCodec";
import { maskOf, polygonsOf } from "./maskGeometry";
import { frameInstanceKey } from "./service";
import type { PropagationResult, SegmentationDocument, StagedOperation } from "./types";

const R = "warehouses/w/projects/p/records/r";
const TOPIC = "/cam/h264";
const START_NS = 1_774_926_543_719_000_000n;
// Log times carry sub-microsecond digits, as the H.264 topic does; 33.333 ms apart.
const LOG_TIMES = [0, 1, 2, 3].map(
  (index) => START_NS + 1_000_000_000n + BigInt(index) * 33_333_789n,
);
const CLASS_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function sourceDocument(logTimes = LOG_TIMES): SegmentationDocument {
  return {
    record: { id: "source-key", name: "CJ" },
    videos: [
      {
        id: "video",
        recordId: "source-key",
        name: TOPIC,
        topic: TOPIC,
        width: 640,
        height: 480,
        durationSec: 60,
        fps: 0,
        sizeBytes: 0,
        mediaUrl: "",
      },
    ],
    frames: logTimes.map((ns, index) => ({
      id: `video:${ns}`,
      videoId: "video",
      index,
      timestampSec: Number(ns - START_NS) / 1e9,
      logTimeNs: ns.toString(),
      imageUrl: "",
    })),
    classes: [],
    instances: [],
    annotations: {},
    annotationSummaries: {},
    momentReferences: [],
  };
}

type Server = {
  classes: Map<string, { name: string; displayName: string; color: string }>;
  instances: Map<string, { name: string; class: string; displayName: string }>;
  frames: Frame[];
  calls: string[];
  listFrames: ListFramesRequest[];
  saves: SaveAnnotationRequest[];
  propagate?: (request: PropagateAnnotationRequest) => AsyncIterable<unknown>;
  timelineError?: ConnectError;
};

function setup(document = sourceDocument()) {
  const server: Server = {
    classes: new Map(),
    instances: new Map(),
    frames: [],
    calls: [],
    listFrames: [],
    saves: [],
  };
  const transport = createRouterTransport(({ service }) => {
    service(AnnotationService, {
      listClasses: () => ({ classes: [...server.classes.values()] }),
      listInstances: () => ({ instances: [...server.instances.values()] }),
      listTimelineRanges: (request) => {
        if (server.timelineError) {
          throw server.timelineError;
        }
        const ranges = server.frames
          .filter(
            (frame) => request.instances.length === 0 || request.instances.includes(frame.instance),
          )
          .map((frame) => ({
            instance: frame.instance,
            topic: TOPIC,
            startTime: frame.frameTime,
            endTime: frame.frameTime,
          }));
        return { timelineRanges: ranges };
      },
      listFrames: (request) => {
        server.listFrames.push(request);
        const from = timestampToMicros(request.startTime!);
        const to = timestampToMicros(request.endTime!);
        if (to - from > 10_000_000n) {
          throw new ConnectError("window too long", Code.InvalidArgument);
        }
        return {
          frames: server.frames.filter((frame) => {
            const micros = timestampToMicros(frame.frameTime!);
            return micros >= from && micros < to;
          }),
        };
      },
      createClass: (request) => {
        server.calls.push(`createClass:${request.classId}`);
        const item = {
          name: `${R}/classes/${request.classId}`,
          displayName: request.class!.displayName,
          color: request.class!.color || "#123456",
        };
        server.classes.set(item.name, item);
        return item;
      },
      updateClass: (request) => {
        server.calls.push(`updateClass:${request.updateMask!.paths.join(",")}`);
        const item = {
          ...server.classes.get(request.class!.name)!,
          displayName: request.class!.displayName,
        };
        server.classes.set(item.name, item);
        return item;
      },
      deleteClass: (request) => {
        server.calls.push(`deleteClass:${request.force}`);
        server.classes.delete(request.name);
        return {};
      },
      createInstance: (request) => {
        server.calls.push(`createInstance:${request.instanceId}`);
        const item = {
          name: `${R}/instances/${request.instanceId}`,
          class: request.instance!.class,
          displayName: request.instance!.displayName,
        };
        server.instances.set(item.name, item);
        return item;
      },
      updateInstance: (request) => {
        server.calls.push(`updateInstance:${request.updateMask!.paths.join(",")}`);
        return request.instance!;
      },
      deleteInstance: (request) => {
        server.calls.push(`deleteInstance:${request.name}`);
        server.instances.delete(request.name);
        server.frames = server.frames.filter((frame) => frame.instance !== request.name);
        return {};
      },
      saveAnnotation: (request) => {
        server.calls.push("saveAnnotation");
        server.saves.push(request);
        for (const snapshot of request.frames) {
          const micros = timestampToMicros(snapshot.frameTime!);
          server.frames = server.frames.filter(
            (frame) => timestampToMicros(frame.frameTime!) !== micros,
          );
          server.frames.push(...snapshot.annotations);
        }
        return {};
      },
      async *propagateAnnotation(request) {
        yield* server.propagate!(request) as AsyncIterable<never>;
      },
    });
  });
  const service = createLiveAnnotationService({
    client: createClient(AnnotationService, transport),
    recordName: R,
    startNs: START_NS,
    document,
  });
  return { server, service, document };
}

function wireFrame(init: MessageInitShape<typeof FrameSchema>): Frame {
  return create(FrameSchema, init);
}

function frameTimeOf(ns: bigint) {
  return microsToTimestamp(truncateToMicros(ns));
}

function seedServer(server: Server) {
  server.classes.set(`${R}/classes/${CLASS_ID}`, {
    name: `${R}/classes/${CLASS_ID}`,
    displayName: "cup",
    color: "#ff0000",
  });
  server.instances.set(`${R}/instances/${OTHER_ID}`, {
    name: `${R}/instances/${OTHER_ID}`,
    class: `${R}/classes/${CLASS_ID}`,
    displayName: "cup 1",
  });
  server.frames.push(
    wireFrame({
      instance: `${R}/instances/${OTHER_ID}`,
      frameTime: frameTimeOf(LOG_TIMES[1]!),
      occluded: true,
      geometry: {
        case: "polygons",
        value: {
          polygons: [
            {
              id: uuidv4(),
              points: [
                { x: 64, y: 48 },
                { x: 320, y: 48 },
                { x: 320, y: 240 },
              ],
            },
          ],
        },
      },
    }),
  );
}

describe("frame time", () => {
  it("truncates log time to microseconds and never rounds", () => {
    expect(truncateToMicros(1_000_999_999n)).toBe(1_000_999n);
    expect(microsToTimestamp(1_000_999n)).toEqual({ seconds: 1n, nanos: 999_000 });
  });

  it("rejects a timestamp that is not microsecond aligned", () => {
    expect(() => timestampToMicros({ seconds: 1n, nanos: 500 })).toThrow(/microseconds/);
  });

  it("refuses frames of one topic that truncate to the same microsecond", () => {
    const index = new FrameTimeIndex();
    index.add({ id: "a", logTimeNs: "1000000100" });
    index.add({ id: "b", logTimeNs: "1000000900" });
    expect(index.resolve(1_000_000n)).toEqual({ missing: "collision", micros: 1_000_000n });
    expect(() => index.frameTimeOf("a")).toThrow(/同一微秒/);
  });
});

describe("live annotation service", () => {
  it("reads the catalog and keeps the session usable when the timeline fails", async () => {
    const { server, service } = setup();
    seedServer(server);
    server.timelineError = new ConnectError(
      "Source media metadata is not configured",
      Code.FailedPrecondition,
    );
    const document = await service.loadDocument();
    expect(document.classes).toEqual([{ id: CLASS_ID, name: "cup", color: "#ff0000" }]);
    expect(document.instances).toEqual([{ id: OTHER_ID, classId: CLASS_ID, name: "cup 1" }]);
    expect(service.diagnostics().timelineErrors[TOPIC]).toMatch(/^FailedPrecondition/);
  });

  it("marks unloaded frames from timeline ranges", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    await service.loadDocument();
    const key = frameInstanceKey(document.frames[1]!.id, OTHER_ID);
    expect(service.timelineSummaries()[key]).toEqual({
      polygonCount: 0,
      pointCount: 0,
      fromTimeline: true,
    });
  });

  it("reads a window in aligned [start, end) pieces of at most ten seconds", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    await service.loadDocument();
    const frameWindow = await service.loadFrameWindow("video", 0, 10);
    for (const request of server.listFrames) {
      expect(request.startTime!.nanos % 1000).toBe(0);
      expect(request.endTime!.nanos % 1000).toBe(0);
    }
    expect(server.listFrames).toHaveLength(2);
    const observation = frameWindow.annotations[frameInstanceKey(document.frames[1]!.id, OTHER_ID)];
    expect(polygonsOf(observation)[0]?.points[0]).toEqual({ x: 0.1, y: 0.1 });
    expect(polygonsOf(observation)[0]?.topic).toBe(TOPIC);
    // Loaded geometry replaces timeline presence.
    expect(service.timelineSummaries()).toEqual({});
  });

  it("binds a mask to the topic's source size and reports counts of another size as unreadable", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    server.frames = [
      wireFrame({
        instance: `${R}/instances/${OTHER_ID}`,
        frameTime: frameTimeOf(LOG_TIMES[0]!),
        geometry: { case: "mask", value: { counts: encodeCounts([1000, 10, 640 * 480 - 1010]) } },
      }),
      wireFrame({
        instance: `${R}/instances/${OTHER_ID}`,
        frameTime: frameTimeOf(LOG_TIMES[2]!),
        geometry: { case: "mask", value: { counts: encodeCounts([10, 10, 80]) } },
      }),
    ];
    await service.loadDocument();
    const frameWindow = await service.loadFrameWindow("video", 0, 5);
    expect(
      maskOf(frameWindow.annotations[frameInstanceKey(document.frames[0]!.id, OTHER_ID)]),
    ).toMatchObject({
      width: 640,
      height: 480,
    });
    const mismatched = frameInstanceKey(document.frames[2]!.id, OTHER_ID);
    expect(frameWindow.annotations[mismatched]).toBeUndefined();
    expect(frameWindow.unreadable?.[mismatched]).toMatchObject({
      frameId: document.frames[2]!.id,
      instanceId: OTHER_ID,
      reason: expect.stringContaining("640×480"),
    });
    expect(service.diagnostics().maskSizeMismatches).toBe(1);
  });

  it("re-sends an unreadable observation verbatim until the user replaces that instance there", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    const foreign = encodeCounts([10, 10, 80]);
    server.frames = [
      wireFrame({
        instance: `${R}/instances/${OTHER_ID}`,
        frameTime: frameTimeOf(LOG_TIMES[1]!),
        occluded: true,
        geometry: { case: "mask", value: { counts: foreign } },
      }),
    ];
    await service.loadDocument();
    const frameId = document.frames[1]!.id;
    const frameWindow = await service.loadFrameWindow("video", 0, 5);
    const otherKey = frameInstanceKey(frameId, OTHER_ID);
    expect(frameWindow.unreadable?.[otherKey]).toBeDefined();
    const newInstance = uuidv4();
    const mineKey = frameInstanceKey(frameId, newInstance);
    const triangle = [
      { x: 0.5, y: 0.5 },
      { x: 0.75, y: 0.5 },
      { x: 0.75, y: 0.75 },
    ];
    await service.submit({
      id: uuidv4(),
      message: "",
      operations: [
        {
          id: uuidv4(),
          label: "draw",
          patch: {
            instances: { [newInstance]: { id: newInstance, classId: CLASS_ID, name: "mug 2" } },
            annotations: {
              [mineKey]: {
                frameId,
                instanceId: newInstance,
                kind: "polygons",
                polygons: [{ id: "p1", points: triangle }],
              },
            },
          },
        },
      ],
    });
    const kept = server.saves[0]!.frames[0]!.annotations.find((item) =>
      item.instance.endsWith(OTHER_ID),
    );
    // The frame snapshot would otherwise delete what the editor could not show.
    expect(kept?.geometry).toEqual({
      case: "mask",
      value: expect.objectContaining({ counts: foreign }),
    });
    expect(kept?.occluded).toBe(true);
    await service.submit({
      id: uuidv4(),
      message: "",
      operations: [
        {
          id: uuidv4(),
          label: "replace",
          patch: {
            annotations: {
              [otherKey]: {
                frameId,
                instanceId: OTHER_ID,
                kind: "polygons",
                polygons: [{ id: "p2", points: triangle }],
              },
            },
          },
        },
      ],
    });
    const replaced = server.saves[1]!.frames[0]!.annotations.filter((item) =>
      item.instance.endsWith(OTHER_ID),
    );
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.geometry.case).toBe("polygons");
  });

  it("refuses a mask whose counts do not cover the source frame before any write", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    await service.loadDocument();
    const frameId = document.frames[1]!.id;
    await expect(
      service.submit({
        id: uuidv4(),
        message: "",
        operations: [
          {
            id: uuidv4(),
            label: "paint",
            patch: {
              annotations: {
                [frameInstanceKey(frameId, OTHER_ID)]: {
                  frameId,
                  instanceId: OTHER_ID,
                  kind: "mask",
                  mask: { counts: encodeCounts([10, 10, 80]), width: 640, height: 480 },
                },
              },
            },
          },
        ],
      }),
    ).rejects.toThrow(/640×480/);
    expect(server.calls).not.toContain("saveAnnotation");
  });

  it("creates the catalog, then saves the complete snapshot of each changed frame", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    await service.loadDocument();
    const newClass = uuidv4();
    const newInstance = uuidv4();
    const frameId = document.frames[1]!.id;
    const key = frameInstanceKey(frameId, newInstance);
    const operation: StagedOperation = {
      id: uuidv4(),
      label: "draw",
      patch: {
        classes: { [newClass]: { id: newClass, name: "[it] mug", color: "#00ff00" } },
        instances: { [newInstance]: { id: newInstance, classId: newClass, name: "mug 1" } },
        polygonChanges: {
          [key]: {
            frameId,
            instanceId: newInstance,
            polygons: {
              p1: {
                id: "p1",
                points: [
                  { x: 0.5, y: 0.5 },
                  { x: 0.75, y: 0.5 },
                  { x: 0.75, y: 0.75 },
                ],
              },
              draft: { id: "draft", points: [{ x: 0.1, y: 0.1 }] },
            },
          },
        },
      },
    };
    await service.submit({ id: uuidv4(), message: "", operations: [operation] });
    expect(server.calls).toEqual([
      `createClass:${newClass}`,
      `createInstance:${newInstance}`,
      "saveAnnotation",
    ]);
    const [snapshot] = server.saves[0]!.frames;
    expect(snapshot!.topic).toBe(TOPIC);
    // Truncated, not rounded: ...789 ns → ...033 µs.
    expect(timestampToMicros(snapshot!.frameTime!)).toBe(truncateToMicros(LOG_TIMES[1]!));
    // The unloaded frame was read first, so the other instance (and its occlusion) is kept.
    expect(snapshot!.annotations.map((item) => item.instance).sort()).toEqual(
      [`${R}/instances/${OTHER_ID}`, `${R}/instances/${newInstance}`].sort(),
    );
    expect(snapshot!.annotations.find((item) => item.instance.endsWith(OTHER_ID))?.occluded).toBe(
      true,
    );
    const mine = snapshot!.annotations.find((item) => item.instance.endsWith(newInstance))!;
    expect(mine.geometry.case).toBe("polygons");
    // The one-vertex polygon is dropped before the wire (drafts never enter the document).
    expect(mine.geometry.case === "polygons" && mine.geometry.value.polygons).toHaveLength(1);
    expect(
      mine.geometry.case === "polygons" && mine.geometry.value.polygons[0]!.points[0],
    ).toMatchObject({ x: 320, y: 240 });
  });

  it("names a polygon the server would reject and writes nothing", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    await service.loadDocument();
    const newClass = uuidv4();
    const newInstance = uuidv4();
    const frameId = document.frames[1]!.id;
    const polygon = (points: { x: number; y: number }[]): StagedOperation => ({
      id: uuidv4(),
      label: "draw",
      patch: {
        classes: { [newClass]: { id: newClass, name: "[it] mug", color: "#00ff00" } },
        instances: { [newInstance]: { id: newInstance, classId: newClass, name: "mug 1" } },
        polygonChanges: {
          [frameInstanceKey(frameId, newInstance)]: {
            frameId,
            instanceId: newInstance,
            polygons: { p1: { id: "p1", points } },
          },
        },
      },
    });
    // A keyhole ring (det_seg's way of carving a hole) repeats its bridge vertices.
    await expect(
      service.submit({
        id: uuidv4(),
        message: "",
        operations: [
          polygon([
            { x: 0.1, y: 0.1 },
            { x: 0.5, y: 0.1 },
            { x: 0.3, y: 0.3 },
            { x: 0.35, y: 0.4 },
            { x: 0.3, y: 0.3 },
            { x: 0.5, y: 0.5 },
            { x: 0.1, y: 0.5 },
          ]),
        ],
      }),
    ).rejects.toThrow(/第 1 个多边形.*有重复的顶点.*Duplicate polygon vertex/);
    expect(server.calls).toEqual([]);
    // A vertex clicked twice in a row is the same outline; it is sent once.
    await service.submit({
      id: uuidv4(),
      message: "",
      operations: [
        polygon([
          { x: 0.5, y: 0.5 },
          { x: 0.75, y: 0.5 },
          { x: 0.75, y: 0.5 },
          { x: 0.75, y: 0.75 },
        ]),
      ],
    });
    const mine = server.saves[0]!.frames[0]!.annotations.find((item) =>
      item.instance.endsWith(newInstance),
    )!;
    expect(
      mine.geometry.case === "polygons" && mine.geometry.value.polygons[0]!.points,
    ).toHaveLength(3);
  });

  it("writes nothing when a changed frame cannot be read first", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    await service.loadDocument();
    // The dev backend today: every frame read fails.
    server.listFrames.push = () => {
      throw new ConnectError(
        "Source media metadata is not configured for annotation",
        Code.FailedPrecondition,
      );
    };
    const newClass = uuidv4();
    const frameId = document.frames[2]!.id;
    await expect(
      service.submit({
        id: uuidv4(),
        message: "",
        operations: [
          {
            id: uuidv4(),
            label: "new class and draw",
            patch: {
              classes: { [newClass]: { id: newClass, name: "x", color: "#000000" } },
              polygonChanges: {
                [frameInstanceKey(frameId, OTHER_ID)]: {
                  frameId,
                  instanceId: OTHER_ID,
                  polygons: {
                    p: {
                      id: "p",
                      points: [
                        { x: 0.1, y: 0.1 },
                        { x: 0.2, y: 0.1 },
                        { x: 0.2, y: 0.2 },
                      ],
                    },
                  },
                },
              },
            },
          },
        ],
      }),
    ).rejects.toThrow(/not configured/);
    // No catalog write ran ahead of the failed read.
    expect(server.calls).toEqual([]);
  });

  it("refuses an instance merge before any write", async () => {
    const { server, service } = setup();
    seedServer(server);
    await service.loadDocument();
    const target = uuidv4();
    await expect(
      service.submit({
        id: uuidv4(),
        message: "",
        operations: [
          {
            id: uuidv4(),
            label: "merge",
            patch: {
              instances: { [target]: { id: target, classId: CLASS_ID, name: "t" } },
              instanceMerges: { [OTHER_ID]: target },
            },
          },
        ],
      }),
    ).rejects.toThrow(/不支持合并实例/);
    expect(server.calls).toEqual([]);
  });

  it("deletes an instance with one RPC and does not resend its frames", async () => {
    const { server, service } = setup();
    seedServer(server);
    const document = await service.loadDocument();
    await service.loadFrameWindow("video", 0, 5);
    await service.submit({
      id: uuidv4(),
      message: "",
      operations: [
        { id: uuidv4(), label: "delete", patch: { instances: { [OTHER_ID]: undefined } } },
      ],
    });
    expect(server.calls).toEqual([`deleteInstance:${R}/instances/${OTHER_ID}`]);
    expect(document.classes).toHaveLength(1);
  });

  it("deletes a class and all its instances atomically", async () => {
    const { server, service } = setup();
    seedServer(server);
    await service.loadDocument();
    await service.submit({
      id: uuidv4(),
      message: "",
      operations: [
        {
          id: uuidv4(),
          label: "delete class",
          patch: { classes: { [CLASS_ID]: undefined }, instances: { [OTHER_ID]: undefined } },
        },
      ],
    });
    expect(server.calls).toEqual(["deleteClass:true"]);
  });

  it("streams propagation and clears selected instances a frame omits", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    await service.loadDocument();
    await service.loadFrameWindow("video", 0, 5);
    const requests: PropagateAnnotationRequest[] = [];
    server.propagate = async function* (request) {
      requests.push(request);
      yield { event: { case: "ready", value: { totalFrames: 2n } } };
      yield {
        event: {
          case: "frame",
          value: {
            frameTime: frameTimeOf(LOG_TIMES[2]!),
            annotations: [
              {
                instance: `${R}/instances/${OTHER_ID}`,
                frameTime: frameTimeOf(LOG_TIMES[2]!),
                geometry: {
                  case: "polygons",
                  value: {
                    polygons: [
                      {
                        id: uuidv4(),
                        points: [
                          { x: 1, y: 1 },
                          { x: 10, y: 1 },
                          { x: 10, y: 10 },
                        ],
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      };
      yield {
        event: { case: "frame", value: { frameTime: frameTimeOf(LOG_TIMES[3]!), annotations: [] } },
      };
      yield { event: { case: "done", value: { processedFrames: 2n, totalFrames: 2n } } };
    };
    const results: PropagationResult[] = [];
    for await (const result of service.propagate(
      {
        instanceId: OTHER_ID,
        fromFrameId: document.frames[1]!.id,
        endTimeNs: LOG_TIMES[3]!.toString(),
      },
      new AbortController().signal,
    )) {
      results.push(result);
    }
    expect(requests[0]!.propagation!.seeds[0]!.frameTime).toEqual(
      expect.objectContaining(frameTimeOf(LOG_TIMES[1]!)),
    );
    expect(requests[0]!.propagation!.endTime!.nanos % 1000).toBe(0);
    // An instance missing from a frame event clears it there.
    expect(results.map((item) => [item.frameId, item.kind])).toEqual([
      [document.frames[2]!.id, "polygons"],
      [document.frames[3]!.id, "empty"],
    ]);
  });

  it("fails a stream that ends without done or reports an error event", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    await service.loadDocument();
    await service.loadFrameWindow("video", 0, 5);
    server.propagate = async function* () {
      yield { event: { case: "ready", value: {} } };
      yield { event: { case: "error", value: { code: 14, message: "GPU unavailable" } } };
    };
    const run = async () => {
      const received: unknown[] = [];
      for await (const result of service.propagate(
        {
          instanceId: OTHER_ID,
          fromFrameId: document.frames[1]!.id,
          endTimeNs: LOG_TIMES[3]!.toString(),
        },
        new AbortController().signal,
      )) {
        received.push(result);
      }
      return received;
    };
    await expect(run()).rejects.toThrow(/GPU unavailable/);
    server.propagate = async function* () {
      yield { event: { case: "ready", value: {} } };
    };
    await expect(run()).rejects.toThrow(/断开/);
  });
});
