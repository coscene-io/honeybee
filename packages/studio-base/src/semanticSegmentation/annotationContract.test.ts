// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { documentFromCommit, isUuid, projectCommit } from "./annotationContract";
import { frameInstanceKey } from "./service";
import { SegmentationDocument } from "./types";

const record = "warehouses/local/projects/workshop/records/record-1";
const personClass = "52c8f7c3-cfba-441e-9b0c-f76ac2e0e455";
const frontInstance = "76d14082-7bf6-4ab3-8af1-044ba16bf4c5";
const sideInstance = "11111111-2222-4333-8444-555555555555";
const emptyInstance = "22222222-3333-4444-8555-666666666666";
const frontPolygon = "ece57791-a79a-4d97-9126-4c296dce77cb";
const requestId = "4e496fd6-4d1b-412b-bc2d-e0c60da852ea";

const topics = {
  "video-front": { topic: "/camera/front", width: 960, height: 540 },
  "video-side": { topic: "/camera/side", width: 1280, height: 720 },
};

function workshop(): SegmentationDocument {
  const frontFrame = {
    id: "front-0",
    videoId: "video-front",
    index: 0,
    timestampSec: 0,
    imageUrl: "",
  };
  const sideFrame = {
    id: "side-0",
    videoId: "video-side",
    index: 0,
    timestampSec: 0,
    imageUrl: "",
  };
  return {
    record: { id: "record-1", name: "Workshop" },
    videos: [
      {
        id: "video-front",
        recordId: "record-1",
        name: "Front",
        durationSec: 2,
        fps: 5,
        sizeBytes: 1,
        mediaUrl: "",
      },
      {
        id: "video-side",
        recordId: "record-1",
        name: "Side",
        durationSec: 2,
        fps: 5,
        sizeBytes: 1,
        mediaUrl: "",
      },
    ],
    classes: [{ id: personClass, name: "person", color: "#55AAFF" }],
    instances: [
      { id: frontInstance, classId: personClass, name: "Person front" },
      { id: sideInstance, classId: personClass, name: "Person side" },
      { id: emptyInstance, classId: personClass, name: "" },
    ],
    frames: [frontFrame, sideFrame],
    annotations: {
      [frameInstanceKey(frontFrame.id, frontInstance)]: {
        frameId: frontFrame.id,
        instanceId: frontInstance,
        version: 4,
        polygons: [
          {
            id: frontPolygon,
            points: [
              { x: 0.5, y: 0.25 },
              { x: 0.75, y: 0.25 },
              { x: 0.75, y: 0.5 },
            ],
          },
        ],
      },
      [frameInstanceKey(sideFrame.id, sideInstance)]: {
        frameId: sideFrame.id,
        instanceId: sideInstance,
        version: 2,
        polygons: [
          {
            id: "side-polygon",
            points: [
              { x: 0.25, y: 0.5 },
              { x: 0.5, y: 0.5 },
              { x: 0.5, y: 0.75 },
            ],
          },
        ],
      },
    },
    annotationSummaries: {},
    versions: {},
    momentReferences: [
      {
        id: "moment-1",
        momentId: "m",
        recordId: "record-1",
        videoId: "video-front",
        targetType: "class",
        targetId: personClass,
      },
    ],
  };
}

it("projects two camera topics into one catalog commit with original-image pixels", () => {
  const projection = projectCommit(workshop(), {
    record,
    baseCommit: `${record}/commits/genesis`,
    requestId,
    description: "save both cameras",
    topics,
  });
  const { commit } = projection.request;
  expect(projection.request.parent).toBe(record);
  expect(commit.catalog.classes).toEqual([
    { name: `${record}/classes/${personClass}`, displayName: "person", color: "#55AAFF" },
  ]);
  const byName = Object.fromEntries(
    commit.catalog.instances.map((item) => [item.displayName, item]),
  );
  expect(commit.catalog.instances).toHaveLength(3);
  expect(byName[""]).toMatchObject({ class: `${record}/classes/${personClass}` });
  expect(byName["Person front"]).toMatchObject({ class: `${record}/classes/${personClass}` });
  expect(byName["Person side"]).toMatchObject({ class: `${record}/classes/${personClass}` });
  expect(JSON.stringify(commit.catalog.instances)).not.toContain("topic");
  const front = commit.frames.find(
    (frame) => frame.topic === "/camera/front" && frame.frameIndex === "0",
  );
  expect(front?.annotations).toHaveLength(1);
  expect(front?.annotations[0]?.polygons.polygons[0]).not.toHaveProperty("topic");
  expect(front?.annotations[0]?.polygons.polygons[0]?.points[0]).toEqual({ x: 480, y: 135 });
  const side = commit.frames.find((frame) => frame.topic === "/camera/side");
  expect(side?.annotations[0]?.polygons.polygons[0]).not.toHaveProperty("topic");
  expect(side?.annotations[0]?.polygons.polygons[0]?.points[0]).toEqual({ x: 320, y: 360 });
  expect(isUuid(side?.annotations[0]?.polygons.polygons[0]?.id ?? "")).toBe(true);
  expect(JSON.stringify(projection.request)).not.toContain("version");
  expect(JSON.stringify(projection.request)).not.toContain("moment");
  const restored = documentFromCommit(workshop(), projection, topics);
  const frontKey = frameInstanceKey("front-0", frontInstance);
  expect(restored.annotations[frontKey]?.polygons[0]?.points[0]).toEqual({ x: 0.5, y: 0.25 });
  expect(restored.annotations[frontKey]?.version).toBe(4);
  expect(restored.instances.find((item) => item.id === emptyInstance)?.name).toBe("");
});

it("rejects a saved polygon that still has only two vertices", () => {
  const document = workshop();
  const key = frameInstanceKey("front-0", frontInstance);
  document.annotations[key]!.polygons[0]!.points = [
    { x: 0.1, y: 0.1 },
    { x: 0.2, y: 0.2 },
  ];
  expect(() =>
    projectCommit(document, {
      record,
      baseCommit: `${record}/commits/genesis`,
      requestId,
      description: "incomplete",
      topics,
    }),
  ).toThrow(/at least three vertices/);
});

it("keeps one instance when its polygons sit on two camera topics", () => {
  const document = workshop();
  const sideKey = frameInstanceKey("side-0", sideInstance);
  document.annotations[frameInstanceKey("side-0", frontInstance)] = {
    ...document.annotations[sideKey]!,
    instanceId: frontInstance,
  };
  delete document.annotations[sideKey];
  const projection = projectCommit(document, {
    record,
    baseCommit: `${record}/commits/genesis`,
    requestId,
    description: "same object, two canvases",
    topics,
  });
  const name = `${record}/instances/${frontInstance}`;
  const observations = projection.request.commit.frames.flatMap((frame) =>
    frame.annotations
      .filter((annotation) => annotation.instance === name)
      .map((annotation) => ({
        topic: frame.topic,
        polygonKeys: Object.keys(annotation.polygons.polygons[0] ?? {}).sort(),
      })),
  );
  expect(observations).toEqual([
    { topic: "/camera/front", polygonKeys: ["id", "points"] },
    { topic: "/camera/side", polygonKeys: ["id", "points"] },
  ]);
  const restored = documentFromCommit(document, projection, topics);
  expect(restored.annotations[frameInstanceKey("side-0", frontInstance)]?.polygons[0]?.topic).toBe(
    "/camera/side",
  );
});
