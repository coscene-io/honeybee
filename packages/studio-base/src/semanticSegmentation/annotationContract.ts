// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createHash } from "crypto";

import { frameInstanceKey } from "./service";
import {
  FrameInstance,
  SegmentationClass,
  SegmentationDocument,
  SegmentationInstance,
  SegmentationPolygon,
} from "./types";

/** Protobuf JSON for one CreateCommit call. The canvas is FrameSnapshot.topic, not a polygon field. */
export type AnnotationPoint = { x: number; y: number };

export type AnnotationPolygon = {
  id: string;
  points: AnnotationPoint[];
};

export type AnnotationClass = {
  name: string;
  displayName: string;
  color: string;
};

export type AnnotationInstance = {
  name: string;
  class: string;
  displayName: string;
};

export type AnnotationObservation = {
  instance: string;
  frameTime: string;
  polygons: { polygons: AnnotationPolygon[] };
};

export type AnnotationFrameSnapshot = {
  topic: string;
  frameTime: string;
  annotations: AnnotationObservation[];
};

export type AnnotationCatalog = {
  classes: AnnotationClass[];
  instances: AnnotationInstance[];
};

export type AnnotationCommit = {
  baseCommit: string;
  description: string;
  catalog: AnnotationCatalog;
  frames: AnnotationFrameSnapshot[];
};

export type CreateCommitBody = {
  parent: string;
  requestId: string;
  commit: AnnotationCommit;
};

export type TopicBinding = {
  topic: string;
  width: number;
  height: number;
};

export type CommitProjection = {
  request: CreateCommitBody;
  editorIdByName: Record<string, string>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function stableUuid(key: string): string {
  const bytes = createHash("sha256").update(key).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function resourceName(
  record: string,
  collection: "classes" | "instances",
  editorId: string,
): string {
  const id = isUuid(editorId) ? editorId : stableUuid(`${record}/${collection}/${editorId}`);
  return `${record}/${collection}/${id}`;
}

function polygonWireId(record: string, instanceName: string, editorId: string): string {
  return isUuid(editorId) ? editorId : stableUuid(`${record}/${instanceName}/polygons/${editorId}`);
}

function requireBinding(topics: Record<string, TopicBinding>, videoId: string): TopicBinding {
  const binding = topics[videoId];
  if (
    binding == undefined ||
    binding.topic.length === 0 ||
    binding.width <= 0 ||
    binding.height <= 0
  ) {
    throw new Error(`Topic binding for ${videoId} needs a topic and a positive frame size`);
  }
  return binding;
}

function toPixel(normalized: number, size: number): number {
  if (!Number.isFinite(normalized)) {
    throw new Error("Annotation coordinate must be finite");
  }
  return normalized * size;
}

function toNormalized(pixel: number, size: number): number {
  return pixel / size;
}

function projectPolygon(
  polygon: SegmentationPolygon,
  record: string,
  instanceName: string,
  binding: TopicBinding,
  editorIdByName: Record<string, string>,
): AnnotationPolygon {
  if (polygon.points.length > 0 && polygon.points.length < 3) {
    throw new Error("A saved polygon needs at least three vertices or an empty placeholder");
  }
  if (polygon.topic != undefined && polygon.topic !== binding.topic) {
    throw new Error(`Polygon ${polygon.id} belongs to ${polygon.topic}, not ${binding.topic}`);
  }
  const id = polygonWireId(record, instanceName, polygon.id);
  editorIdByName[id] = polygon.id;
  return {
    id,
    points: polygon.points.map((point) => ({
      x: toPixel(point.x, binding.width),
      y: toPixel(point.y, binding.height),
    })),
  };
}

/** Absolute log_time (decimal ns) as a protobuf JSON Timestamp, keeping nanosecond precision. */
export function nsToTimestamp(ns: string): string {
  const value = BigInt(ns);
  const seconds = value / 1_000_000_000n;
  const fraction = (value % 1_000_000_000n).toString().padStart(9, "0");
  return `${new Date(Number(seconds) * 1000).toISOString().slice(0, 19)}.${fraction}Z`;
}

/** Inverse of nsToTimestamp, as a decimal ns string. */
export function timestampToNs(timestamp: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(timestamp);
  if (!match) {
    throw new Error(`Invalid frame_time ${timestamp}`);
  }
  const seconds = BigInt(Date.parse(`${match[1]}Z`) / 1000);
  return seconds * 1_000_000_000n + BigInt((match[2] ?? "").padEnd(9, "0") || "0");
}

export function projectCommit(
  document: SegmentationDocument,
  args: {
    record: string;
    baseCommit: string;
    requestId: string;
    description: string;
    topics: Record<string, TopicBinding>;
  },
): CommitProjection {
  if (!isUuid(args.requestId)) {
    throw new Error("CreateCommit requestId must be a UUID");
  }
  if (args.baseCommit.length === 0) {
    throw new Error("CreateCommit baseCommit must name the current head");
  }
  const editorIdByName: Record<string, string> = {};
  const classes = document.classes.map((item) => {
    const name = resourceName(args.record, "classes", item.id);
    editorIdByName[name] = item.id;
    return { name, displayName: item.name, color: item.color };
  });
  const classNameByEditorId = new Map(
    classes.map((item) => [editorIdByName[item.name], item.name]),
  );
  const instances = document.instances.map((item) => {
    const className = classNameByEditorId.get(item.classId);
    if (className == undefined) {
      throw new Error(`Instance ${item.id} points at a missing class`);
    }
    const name = resourceName(args.record, "instances", item.id);
    editorIdByName[name] = item.id;
    return {
      name,
      class: className,
      displayName: item.name,
    };
  });
  const instanceByEditorId = new Map(instances.map((item) => [editorIdByName[item.name], item]));
  const framesById = new Map(document.frames.map((frame) => [frame.id, frame]));
  const snapshots = new Map<string, AnnotationFrameSnapshot>();
  for (const annotation of Object.values(document.annotations)) {
    const frame = framesById.get(annotation.frameId);
    const instance = instanceByEditorId.get(annotation.instanceId);
    if (frame == undefined) {
      continue;
    }
    if (instance == undefined) {
      throw new Error(`Annotation ${annotation.frameId} is missing its instance`);
    }
    const binding = requireBinding(args.topics, frame.videoId);
    const key = `${binding.topic}\u0000${frame.logTimeNs}`;
    const snapshot = snapshots.get(key) ?? {
      topic: binding.topic,
      frameTime: nsToTimestamp(frame.logTimeNs),
      annotations: [],
    };
    snapshot.annotations.push({
      instance: instance.name,
      frameTime: nsToTimestamp(frame.logTimeNs),
      polygons: {
        polygons: annotation.polygons.map((polygon) =>
          projectPolygon(polygon, args.record, instance.name, binding, editorIdByName),
        ),
      },
    });
    snapshots.set(key, snapshot);
  }
  const frames = [...snapshots.values()]
    .sort((left, right) => {
      const topicOrder = left.topic.localeCompare(right.topic);
      if (topicOrder !== 0) {
        return topicOrder;
      }
      const delta = timestampToNs(left.frameTime) - timestampToNs(right.frameTime);
      return delta < 0n ? -1 : delta > 0n ? 1 : 0;
    })
    .map((snapshot) => ({
      ...snapshot,
      annotations: [...snapshot.annotations].sort((left, right) =>
        left.instance.localeCompare(right.instance),
      ),
    }));
  return {
    editorIdByName,
    request: {
      parent: args.record,
      requestId: args.requestId,
      commit: {
        baseCommit: args.baseCommit,
        description: args.description,
        catalog: {
          classes: classes.sort((left, right) => left.name.localeCompare(right.name)),
          instances: instances.sort((left, right) => left.name.localeCompare(right.name)),
        },
        frames,
      },
    },
  };
}

export function contractRequestId(editorRequestId: string): string {
  return isUuid(editorRequestId) ? editorRequestId : stableUuid(`request/${editorRequestId}`);
}

export function recordResourceName(recordId: string): string {
  return `warehouses/local/projects/workshop/records/${recordId}`;
}

/** Project an editor document using its video topics and the frames each instance already occupies. */
export function projectStoredDocument(
  document: SegmentationDocument,
  args: { baseCommit: string; requestId: string; description: string },
): CommitProjection {
  const topics: Record<string, TopicBinding> = {};
  for (const video of document.videos) {
    topics[video.id] = {
      topic: video.topic ?? `/camera/${video.id}`,
      width: video.width ?? 960,
      height: video.height ?? 540,
    };
  }
  return projectCommit(document, {
    record: recordResourceName(document.record.id),
    baseCommit: args.baseCommit,
    requestId: contractRequestId(args.requestId),
    description: args.description,
    topics,
  });
}

export function documentFromCommit(
  source: SegmentationDocument,
  projection: CommitProjection,
  topics: Record<string, TopicBinding>,
): SegmentationDocument {
  const { commit } = projection.request;
  const videoIdByTopic = new Map<string, string>();
  for (const [videoId, binding] of Object.entries(topics)) {
    if (videoIdByTopic.has(binding.topic)) {
      throw new Error(`Topic ${binding.topic} is not unique in the record`);
    }
    videoIdByTopic.set(binding.topic, videoId);
  }
  const classes: SegmentationClass[] = commit.catalog.classes.map((item) => ({
    id: projection.editorIdByName[item.name] ?? item.name,
    name: item.displayName,
    color: item.color,
  }));
  const instances: SegmentationInstance[] = commit.catalog.instances.map((item) => {
    const classId = projection.editorIdByName[item.class] ?? item.class;
    return {
      id: projection.editorIdByName[item.name] ?? item.name,
      classId,
      name: item.displayName,
    };
  });
  const frameIdByVideoIndex = new Map(
    source.frames.map((frame) => [`${frame.videoId}\u0000${frame.logTimeNs}`, frame.id]),
  );
  const annotations: Record<string, FrameInstance> = {};
  for (const snapshot of commit.frames) {
    const videoId = videoIdByTopic.get(snapshot.topic);
    const binding = videoId == undefined ? undefined : topics[videoId];
    if (videoId == undefined || binding == undefined) {
      throw new Error(`Commit topic ${snapshot.topic} is not in the media catalog`);
    }
    const frameId = frameIdByVideoIndex.get(`${videoId}\u0000${timestampToNs(snapshot.frameTime)}`);
    if (frameId == undefined) {
      throw new Error(
        `Commit frame ${snapshot.topic}@${snapshot.frameTime} is not in the media catalog`,
      );
    }
    for (const observation of snapshot.annotations) {
      const instanceId = projection.editorIdByName[observation.instance] ?? observation.instance;
      const polygons: SegmentationPolygon[] = observation.polygons.polygons.map((polygon) => ({
        id: projection.editorIdByName[polygon.id] ?? polygon.id,
        topic: snapshot.topic,
        points: polygon.points.map((point) => ({
          x: toNormalized(point.x, binding.width),
          y: toNormalized(point.y, binding.height),
        })),
      }));
      annotations[frameInstanceKey(frameId, instanceId)] = {
        frameId,
        instanceId,
        polygons,
        version: source.annotations[frameInstanceKey(frameId, instanceId)]?.version ?? 1,
      };
    }
  }
  return {
    ...source,
    classes,
    instances,
    annotations,
  };
}
