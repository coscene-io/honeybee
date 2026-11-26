// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import { v4 as uuidv4 } from "uuid";

import {
  AnnotationService,
  FrameSchema,
  type Frame,
  type ListFramesRequest,
  type ListTimelineRangesResponse_TimelineRangeSchema,
  type PropagateAnnotationRequest,
  PropagateAnnotationRequest_PropagateAnnotation_Direction as PropagationDirection,
  type SaveAnnotationRequest,
} from "@foxglove/studio-base/services/api/spatial-annotation";

import {
  FrameTimeIndex,
  microsToTimestamp,
  timestampToMicros,
  truncateToMicros,
  windowBoundaryMicros,
} from "./frameTime";
import { createSegmentationServiceForClient, createLiveSegmentationService } from "./liveService";
import { encodeCounts } from "./maskCodec";
import { maskOf, polygonsOf } from "./maskGeometry";
import { frameInstanceKey } from "./service";
import { createSegmentationStore } from "./store";
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
  /** The next ListFrames answers from the state at call time, then waits for this before replying. */
  holdNextListFrames?: Promise<void>;
  /** Same for ListTimelineRanges. */
  holdNextTimeline?: Promise<void>;
  timelineReads: number;
  repeatClassPageToken?: boolean;
  /** SegmentFrame fails with this error. */
  segmentFrameError?: ConnectError;
  /** The next SaveAnnotation fails with this error. */
  failNextSave?: ConnectError;
  /** Sent with every ListFrames page / ListTimelineRanges response, unfiltered. */
  rawFrames: Frame[];
  rawRanges: MessageInitShape<typeof ListTimelineRangesResponse_TimelineRangeSchema>[];
};

function setup(document = sourceDocument()) {
  const server: Server = {
    classes: new Map(),
    instances: new Map(),
    frames: [],
    calls: [],
    listFrames: [],
    saves: [],
    rawFrames: [],
    rawRanges: [],
    timelineReads: 0,
  };
  const transport = createRouterTransport(({ service }) => {
    service(AnnotationService, {
      listClasses: () => ({
        classes: [...server.classes.values()],
        nextPageToken: server.repeatClassPageToken === true ? "again" : "",
      }),
      listInstances: () => ({ instances: [...server.instances.values()] }),
      listTimelineRanges: async (request) => {
        server.timelineReads++;
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
        const hold = server.holdNextTimeline;
        server.holdNextTimeline = undefined;
        await hold;
        return { timelineRanges: [...ranges, ...server.rawRanges] };
      },
      listFrames: async (request) => {
        server.listFrames.push(request);
        const from = timestampToMicros(request.startTime!);
        const to = timestampToMicros(request.endTime!);
        if (to - from > 10_000_000n) {
          throw new ConnectError("window too long", Code.InvalidArgument);
        }
        const response = {
          frames: [
            ...server.frames.filter((frame) => {
              const micros = timestampToMicros(frame.frameTime!);
              return micros >= from && micros < to;
            }),
            ...server.rawFrames,
          ],
        };
        const hold = server.holdNextListFrames;
        server.holdNextListFrames = undefined;
        await hold;
        return response;
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
        const failure = server.failNextSave;
        server.failNextSave = undefined;
        if (failure) {
          throw failure;
        }
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
      segmentFrame: () => {
        throw server.segmentFrameError ?? new ConnectError("not set up", Code.Unimplemented);
      },
      async *propagateAnnotation(request) {
        yield* server.propagate!(request) as AsyncIterable<never>;
      },
    });
  });
  const service = createSegmentationServiceForClient({
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

  it("puts a window boundary on the nanosecond its float offset came from", () => {
    // 32.000001 * 1e9 is 32000000999.999996 in floating point; flooring lost the last microsecond.
    const durationNs = 32_000_001_000n;
    const offsetSec = Number(durationNs) / 1e9;
    expect(windowBoundaryMicros(START_NS, offsetSec)).toBe(truncateToMicros(START_NS + durationNs));
    expect(() => windowBoundaryMicros(START_NS, Number.NaN)).toThrow(/Invalid window offset/);
  });

  it("refuses frames of one topic that truncate to the same microsecond", () => {
    const index = new FrameTimeIndex();
    index.add({ id: "a", logTimeNs: "1000000100" });
    index.add({ id: "b", logTimeNs: "1000000900" });
    expect(index.resolve(1_000_000n)).toEqual({ missing: "collision", micros: 1_000_000n });
    expect(() => index.frameTimeOf("a")).toThrow(/truncate to the same microsecond/);
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
    expect(service.diagnostics().timelineErrors[TOPIC]).toMatch(/^FAILED_PRECONDITION: /);
    // Shown to the user, not only kept in diagnostics.
    expect(service.timelineWarning()).toBe(
      `${TOPIC}: FAILED_PRECONDITION: Source media metadata is not configured`,
    );
    const listener = jest.fn();
    service.subscribeTimeline(listener);
    server.timelineError = undefined;
    await service.loadDocument();
    expect(service.timelineWarning()).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
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

  it("loads the last frame of a window that ends at the recording's float duration", async () => {
    // A frame exactly at the end, on a microsecond whose float offset floors 1 ns low.
    const lastNs = START_NS + 32_000_001_000n;
    const { server, service, document } = setup(sourceDocument([...LOG_TIMES, lastNs]));
    seedServer(server);
    server.frames.push(
      wireFrame({
        instance: `${R}/instances/${OTHER_ID}`,
        frameTime: frameTimeOf(lastNs),
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
    await service.loadDocument();
    const endSec = Number(lastNs - START_NS) / 1e9;
    const frameWindow = await service.loadFrameWindow("video", 30, endSec);
    const lastFrame = document.frames[document.frames.length - 1]!;
    expect(frameWindow.annotations[frameInstanceKey(lastFrame.id, OTHER_ID)]).toBeDefined();
  });

  it("skips an observation or range whose frame_time is not microsecond aligned", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    const misalignedTime = { seconds: frameTimeOf(LOG_TIMES[2]!).seconds, nanos: 500 };
    server.rawRanges.push({
      instance: `${R}/instances/${OTHER_ID}`,
      topic: TOPIC,
      startTime: misalignedTime,
      endTime: misalignedTime,
    });
    await service.loadDocument();
    expect(service.diagnostics().misalignedRanges).toBe(1);
    // The good range still marks its frame.
    expect(
      service.timelineSummaries()[frameInstanceKey(document.frames[1]!.id, OTHER_ID)],
    ).toBeDefined();
    server.rawFrames.push(
      wireFrame({
        instance: `${R}/instances/${OTHER_ID}`,
        frameTime: misalignedTime,
        geometry: { case: "mask", value: { counts: encodeCounts([640 * 480]) } },
      }),
    );
    const frameWindow = await service.loadFrameWindow("video", 0, 5);
    expect(
      frameWindow.annotations[frameInstanceKey(document.frames[1]!.id, OTHER_ID)],
    ).toBeDefined();
    expect(service.diagnostics().misalignedTimes).toBeGreaterThan(0);
  });

  it("does not let a window read that raced a save restore the frame's older state", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    await service.loadDocument();
    const frameId = document.frames[1]!.id;
    let release!: () => void;
    server.holdNextListFrames = new Promise((resolve) => {
      release = resolve;
    });
    // The read is answered from the state before the save below, and arrives after it.
    const racing = service.loadFrameWindow("video", 0, 5);
    const mine = uuidv4();
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
          labelKey: "opLabelEditPolygon",
          patch: {
            instances: { [mine]: { id: mine, classId: CLASS_ID, name: "mug 2" } },
            annotations: {
              [frameInstanceKey(frameId, mine)]: {
                frameId,
                instanceId: mine,
                kind: "polygons",
                polygons: [{ id: "p1", points: triangle }],
              },
            },
          },
        },
      ],
    });
    release();
    const frameWindow = await racing;
    // The saved frame answers with its whole post-save state, untouched observations included, so
    // a caller that merges the window does not take the untouched one for a deletion.
    expect(
      Object.keys(frameWindow.annotations)
        .filter((key) => JSON.parse(key)[0] === frameId)
        .sort(),
    ).toEqual([frameInstanceKey(frameId, OTHER_ID), frameInstanceKey(frameId, mine)].sort());
    // The next save of that frame still carries what the first one wrote.
    await service.submit({
      id: uuidv4(),
      message: "",
      operations: [
        {
          id: uuidv4(),
          labelKey: "opLabelEditPolygon",
          patch: { annotations: { [frameInstanceKey(frameId, OTHER_ID)]: undefined } },
        },
      ],
    });
    const second = server.saves[1]!.frames[0]!.annotations.map((item) => item.instance);
    expect(second).toEqual([`${R}/instances/${mine}`]);
  });

  it("reads a save's unloaded frames in one window and does not re-read the timeline", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    await service.loadDocument();
    const reads = server.timelineReads;
    const mine = uuidv4();
    const triangle = [
      { x: 0.5, y: 0.5 },
      { x: 0.75, y: 0.5 },
      { x: 0.75, y: 0.75 },
    ];
    const frames = [document.frames[3]!, document.frames[0]!, document.frames[2]!];
    await service.submit({
      id: uuidv4(),
      message: "",
      operations: [
        {
          id: uuidv4(),
          labelKey: "opLabelEditPolygon",
          patch: {
            instances: { [mine]: { id: mine, classId: CLASS_ID, name: "mug 2" } },
            annotations: Object.fromEntries(
              frames.map((frame) => [
                frameInstanceKey(frame.id, mine),
                {
                  frameId: frame.id,
                  instanceId: mine,
                  kind: "polygons" as const,
                  polygons: [{ id: `p-${frame.index}`, points: triangle }],
                },
              ]),
            ),
          },
        },
      ],
    });
    expect(server.listFrames).toHaveLength(1);
    expect(server.saves[0]!.frames).toHaveLength(3);
    expect(server.timelineReads).toBe(reads);
    // Frame 1 was inside the read window, so its presence now comes from loaded geometry.
    expect(service.timelineSummaries()).toEqual({});
  });

  it("drops an older timeline answer that arrives after a newer one", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    let release!: () => void;
    server.holdNextTimeline = new Promise((resolve) => {
      release = resolve;
    });
    const reads = server.timelineReads;
    const older = service.loadDocument();
    // Wait until the older read's timeline answer is taken (with the range), then change the server.
    while (server.timelineReads === reads) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    // The server state changes; the newer read sees no range.
    server.frames = [];
    await service.loadDocument();
    release();
    await older;
    expect(service.timelineSummaries()).toEqual({});
    expect(
      service.timelineSummaries()[frameInstanceKey(document.frames[1]!.id, OTHER_ID)],
    ).toBeUndefined();
  });

  it("stops a background timeline read on dispose", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    await service.loadDocument();
    const listener = jest.fn();
    service.subscribeTimeline(listener);
    let release!: () => void;
    server.holdNextTimeline = new Promise((resolve) => {
      release = resolve;
    });
    const other = {
      ...document.videos[0]!,
      id: "video-2",
      topic: "/cam/other",
      name: "/cam/other",
    };
    service.updateSourceMetadata!({ videos: [...document.videos, other], frames: document.frames });
    // The synchronous notification for the new metadata is not the background read.
    listener.mockClear();
    service.dispose!();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops listing when the service repeats a page token", async () => {
    const { server, service } = setup();
    seedServer(server);
    server.repeatClassPageToken = true;
    await expect(service.loadDocument()).rejects.toThrow(/repeated page token/);
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

  it("names the size a mask was annotated at when the same topic now decodes at another size", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    server.frames = [
      wireFrame({
        instance: `${R}/instances/${OTHER_ID}`,
        frameTime: frameTimeOf(LOG_TIMES[0]!),
        geometry: { case: "mask", value: { counts: encodeCounts([10, 10, 1280 * 720 - 20]) } },
      }),
    ];
    await service.loadDocument();
    const frameWindow = await service.loadFrameWindow("video", 0, 5);
    expect(
      frameWindow.unreadable?.[frameInstanceKey(document.frames[0]!.id, OTHER_ID)]?.reason,
    ).toContain("1280×720");
    expect(
      frameWindow.unreadable?.[frameInstanceKey(document.frames[0]!.id, OTHER_ID)]?.reason,
    ).toContain("640×480");
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
          labelKey: "opLabelEditPolygon",
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
          labelKey: "opLabelEditPolygon",
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
            labelKey: "opLabelEditPolygon",
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
      labelKey: "opLabelEditPolygon",
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
      labelKey: "opLabelEditPolygon",
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
    // A keyhole ring (a hole bridged into its outer ring) repeats its bridge vertices.
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
    ).rejects.toThrow(/Polygon 1 on .*a repeated vertex.*Server rule: Duplicate polygon vertex/);
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
            labelKey: "opLabelEditPolygon",
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
    ).rejects.toMatchObject({
      rpcCode: "FAILED_PRECONDITION",
      message: expect.stringContaining("not configured"),
    });
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
            labelKey: "opLabelEditPolygon",
            patch: {
              instances: { [target]: { id: target, classId: CLASS_ID, name: "t" } },
              instanceMerges: { [OTHER_ID]: target },
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "errorMergeUnsupportedLive" });
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
        {
          id: uuidv4(),
          labelKey: "opLabelEditPolygon",
          patch: { instances: { [OTHER_ID]: undefined } },
        },
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
          labelKey: "opLabelEditPolygon",
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

  it("keeps a frame whose propagated mask does not decode at the source size", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    await service.loadDocument();
    await service.loadFrameWindow("video", 0, 5);
    const maskFrame = (ns: bigint, counts: string) => ({
      event: {
        case: "frame",
        value: {
          frameTime: frameTimeOf(ns),
          annotations: [
            {
              instance: `${R}/instances/${OTHER_ID}`,
              frameTime: frameTimeOf(ns),
              geometry: { case: "mask", value: { counts } },
            },
          ],
        },
      },
    });
    server.propagate = async function* () {
      // 100 pixels, not 640 × 480.
      yield maskFrame(LOG_TIMES[2]!, encodeCounts([10, 10, 80]));
      yield maskFrame(LOG_TIMES[3]!, encodeCounts([1000, 10, 640 * 480 - 1010]));
      yield { event: { case: "done", value: { processedFrames: 2n, totalFrames: 2n } } };
    };
    const results: PropagationResult[] = [];
    await expect(
      (async () => {
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
      })(),
    ).rejects.toThrow(/640×480/);
    // The undecodable frame is not cleared (no "empty" result); the good one is still delivered.
    expect(results.map((item) => [item.frameId, item.kind])).toEqual([
      [document.frames[3]!.id, "mask"],
    ]);
  });

  it("sends the propagation direction the backend requires", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    await service.loadDocument();
    await service.loadFrameWindow("video", 0, 5);
    const requests: PropagateAnnotationRequest[] = [];
    server.propagate = async function* (request) {
      requests.push(request);
      yield { event: { case: "done", value: { processedFrames: 0n, totalFrames: 0n } } };
    };
    for (const end of [LOG_TIMES[0]!, LOG_TIMES[3]!]) {
      const results: PropagationResult[] = [];
      for await (const result of service.propagate(
        { instanceId: OTHER_ID, fromFrameId: document.frames[1]!.id, endTimeNs: end.toString() },
        new AbortController().signal,
      )) {
        results.push(result);
      }
      expect(results).toEqual([]);
    }
    expect(requests.map((request) => request.propagation!.direction)).toEqual([
      PropagationDirection.BACKWARD,
      PropagationDirection.FORWARD,
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
    await expect(run()).rejects.toMatchObject({
      name: "AnnotationRpcError",
      rpcCode: "UNAVAILABLE",
      message: expect.stringContaining("GPU unavailable"),
    });
    server.propagate = async function* () {
      yield { event: { case: "ready", value: {} } };
    };
    await expect(run()).rejects.toMatchObject({ code: "errorPropagationDisconnectedAfter" });
  });
});

const emptyDocument: SegmentationDocument = {
  record: { id: "r", name: "r" },
  videos: [],
  frames: [],
  classes: [],
  instances: [],
  annotations: {},
  annotationSummaries: {},
};
const recordName = "warehouses/w/projects/p/records/r";

describe("createLiveSegmentationService", () => {
  it("takes its client from the console API, which carries the desktop session", () => {
    const rpcClient = jest.fn().mockReturnValue({});
    const service = createLiveSegmentationService({
      consoleApi: { rpcClient },
      recordName,
      startNs: 0n,
      document: emptyDocument,
    });
    expect(service?.backend).toBe("live");
    expect(rpcClient).toHaveBeenCalledWith(AnnotationService);
  });

  it("creates nothing without a console API or a cloud record", () => {
    expect(
      createLiveSegmentationService({
        consoleApi: undefined,
        recordName,
        startNs: 0n,
        document: emptyDocument,
      }),
    ).toBeUndefined();
    const rpcClient = jest.fn();
    expect(
      createLiveSegmentationService({
        consoleApi: { rpcClient },
        recordName: "local.mcap",
        startNs: 0n,
        document: emptyDocument,
      }),
    ).toBeUndefined();
    expect(rpcClient).not.toHaveBeenCalled();
  });
});

describe("live adapter with the store", () => {
  const A = "33333333-3333-4333-8333-333333333333";
  const B = "44444444-4444-4444-8444-444444444444";
  const POLYGON_A = "55555555-5555-4555-8555-555555555555";
  // One frame per second for 30 s; 1 s windows keep the arithmetic readable.
  const times = Array.from({ length: 30 }, (_, index) => START_NS + BigInt(index + 1) * 1_000_000_000n);
  const polygon = (id: string, x: number) => ({
    geometry: {
      case: "polygons" as const,
      value: {
        polygons: [
          {
            id,
            points: [
              { x, y: 48 },
              { x: x + 100, y: 48 },
              { x: x + 100, y: 240 },
            ],
          },
        ],
      },
    },
  });

  async function liveStore() {
    const document = sourceDocument(times);
    const { server, service } = setup(document);
    server.classes.set(`${R}/classes/${CLASS_ID}`, {
      name: `${R}/classes/${CLASS_ID}`,
      displayName: "cup",
      color: "#ff0000",
    });
    for (const id of [A, B]) {
      server.instances.set(`${R}/instances/${id}`, {
        name: `${R}/instances/${id}`,
        class: `${R}/classes/${CLASS_ID}`,
        displayName: id === A ? "a" : "b",
      });
    }
    // A on every frame; B only on the first, next to A.
    for (const [index, ns] of times.entries()) {
      server.frames.push(
        wireFrame({
          ...polygon(index === 0 ? POLYGON_A : uuidv4(), 64),
          instance: `${R}/instances/${A}`,
          frameTime: frameTimeOf(ns),
        }),
      );
    }
    server.frames.push(
      wireFrame({
        ...polygon(uuidv4(), 300),
        instance: `${R}/instances/${B}`,
        frameTime: frameTimeOf(times[0]!),
      }),
    );
    const store = createSegmentationStore(service, { maxLoadedFrames: 8 });
    await store.getState().initialize();
    const first = document.frames[0]!;
    const far = document.frames[25]!;
    const goFar = async () => {
      store.getState().setCurrentFrame(far.id);
      await store.getState().loadFrameWindow("video", far.timestampSec - 4, far.timestampSec + 4);
    };
    const comeBack = async () => {
      store.getState().setCurrentFrame(first.id);
      await store.getState().loadFrameWindow("video", 0, first.timestampSec + 1);
    };
    const savedInstances = (save: SaveAnnotationRequest) =>
      save.frames
        .find((frame) => timestampToMicros(frame.frameTime!) === truncateToMicros(times[0]!))!
        .annotations.map((item) => item.instance)
        .sort();
    return { server, service, store, first, goFar, comeBack, savedInstances };
  }

  it("forgets the frames the store evicted and saves a re-read frame completely", async () => {
    const { server, service, store, first, goFar, comeBack, savedInstances } = await liveStore();
    expect(store.getState().isFrameReady(first.id)).toBe(true);

    await goFar();
    expect(store.getState().isFrameReady(first.id)).toBe(false);
    // The adapter holds what the store holds, not every window ever read.
    expect(service.diagnostics().loadedFrames).toBe(8);

    await comeBack();
    store.getState().setPolygonPoints(POLYGON_A, [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
      { x: 0.3, y: 0.3 },
    ]);
    store.getState().submit("move a");
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue.map((batch) => batch.status)).toEqual(["succeeded"]);
    // Only A changed; B on the same frame is still saved with it.
    expect(savedInstances(server.saves[0]!)).toEqual([
      `${R}/instances/${A}`,
      `${R}/instances/${B}`,
    ]);
    store.getState().dispose();
  });

  it("keeps the complete state of frames with drafts or a batch waiting for retry", async () => {
    const { server, service, store, first, goFar, savedInstances } = await liveStore();
    store.getState().setPolygonPoints(POLYGON_A, [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
      { x: 0.3, y: 0.3 },
    ]);
    // A staged draft protects the frame.
    await goFar();
    expect(store.getState().isFrameReady(first.id)).toBe(true);

    // So does a batch that failed and waits for retry.
    server.failNextSave = new ConnectError("busy", Code.Unavailable);
    store.getState().submit("move a");
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue.map((batch) => batch.status)).toEqual(["failed"]);
    await store.getState().loadFrameWindow("video", 10, 18);
    expect(store.getState().isFrameReady(first.id)).toBe(true);

    const reads = server.listFrames.length;
    store.getState().retrySubmission(store.getState().submissionQueue[0]!.id);
    await store.getState().waitForSubmissions();
    expect(store.getState().submissionQueue.map((batch) => batch.status)).toEqual(["succeeded"]);
    // The adapter still had the frame: the retry saved it without reading it again.
    expect(server.listFrames).toHaveLength(reads);
    expect(savedInstances(server.saves[0]!)).toEqual([
      `${R}/instances/${A}`,
      `${R}/instances/${B}`,
    ]);
    expect(service.diagnostics().loadedFrames).toBeGreaterThan(0);
    store.getState().dispose();
  });

  it("keeps the summaries of untouched loaded observations after a save", async () => {
    const { store, first } = await liveStore();
    store.getState().setPolygonPoints(POLYGON_A, [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
      { x: 0.3, y: 0.3 },
    ]);
    store.getState().submit("move a");
    await store.getState().waitForSubmissions();
    const summaries = store.getState().document!.annotationSummaries;
    expect(summaries[frameInstanceKey(first.id, B)]).toMatchObject({ polygonCount: 1 });
    expect(summaries[frameInstanceKey(first.id, A)]).toMatchObject({ polygonCount: 1 });
    store.getState().dispose();
  });

  it("keeps redo when a reread document differs only in its summaries", async () => {
    const { store } = await liveStore();
    store.getState().setPolygonPoints(POLYGON_A, [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
      { x: 0.3, y: 0.3 },
    ]);
    store.getState().undo();
    expect(store.getState().canRedo).toBe(true);
    // The read carries timeline placeholders where the base has exact summaries.
    await store.getState().initialize();
    expect(store.getState().canRedo).toBe(true);
    store.getState().dispose();
  });
});

describe("live annotation service edge cases", () => {
  it("records a malformed mask as unreadable without failing the window", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    server.frames.push(
      wireFrame({
        instance: `${R}/instances/${OTHER_ID}`,
        frameTime: frameTimeOf(LOG_TIMES[2]!),
        geometry: { case: "mask", value: { counts: "not rle \u0001" } },
      }),
    );
    await service.loadDocument();
    const frameWindow = await service.loadFrameWindow("video", 0, 5);
    expect(frameWindow.unreadable?.[frameInstanceKey(document.frames[2]!.id, OTHER_ID)]).toBeDefined();
    expect(frameWindow.annotations[frameInstanceKey(document.frames[1]!.id, OTHER_ID)]).toBeDefined();
  });

  it("does not carry a deleted observation's occlusion to a redrawn one", async () => {
    const { server, service, document } = setup();
    seedServer(server);
    await service.loadDocument();
    await service.loadFrameWindow("video", 0, 5);
    const frameId = document.frames[1]!.id;
    const key = frameInstanceKey(frameId, OTHER_ID);
    const edit = (annotation: StagedOperation["patch"]["annotations"]) =>
      service.submit({
        id: uuidv4(),
        message: "",
        operations: [{ id: uuidv4(), labelKey: "opLabelEditPolygon", patch: { annotations: annotation } }],
      });
    await edit({ [key]: undefined });
    await edit({
      [key]: {
        frameId,
        instanceId: OTHER_ID,
        kind: "polygons",
        polygons: [
          {
            id: "p1",
            points: [
              { x: 0.5, y: 0.5 },
              { x: 0.75, y: 0.5 },
              { x: 0.75, y: 0.75 },
            ],
          },
        ],
      },
    });
    expect(server.saves[1]!.frames[0]!.annotations[0]!.occluded).toBe(false);
  });

  it("passes a canceled quick annotation through as a cancellation", async () => {
    const globals = ["createImageBitmap", "OffscreenCanvas", "fetch"] as const;
    const saved = globals.map((name) => Reflect.get(globalThis, name));
    Object.assign(globalThis, {
      createImageBitmap: jest.fn(async () => ({ width: 640, height: 480, close: () => undefined })),
      OffscreenCanvas: class {
        public getContext() {
          return { drawImage: () => undefined };
        }
        public async convertToBlob() {
          return { arrayBuffer: async () => new TextEncoder().encode("jpeg").buffer };
        }
      },
      fetch: jest.fn(async () => ({ blob: async () => new Blob(["frame"]) })),
    });
    try {
      const { server, service } = setup();
      const request = {
        topic: TOPIC,
        logTimeNs: LOG_TIMES[0]!.toString(),
        width: 640,
        height: 480,
        imageUrl: "blob:frame",
        points: [{ x: 0.5, y: 0.5, positive: true }],
      };
      server.segmentFrameError = new ConnectError("replaced", Code.Canceled);
      const canceled = await service.segmentFrame!(request).catch((error: unknown) => error);
      expect(canceled).toBeInstanceOf(ConnectError);
      expect((canceled as ConnectError).code).toBe(Code.Canceled);
      server.segmentFrameError = new ConnectError("down", Code.Unavailable);
      await expect(service.segmentFrame!(request)).rejects.toMatchObject({ rpcCode: "UNAVAILABLE" });
    } finally {
      globals.forEach((name, index) => Reflect.set(globalThis, name, saved[index]));
    }
  });
});
