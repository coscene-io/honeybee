// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Playback manifest schema. Permissive about future fields (e.g., pointcloud
// profiles); the parser only enforces what we need today.

export type Profile = {
  id: string;
  modality: string;
  label: string;
  params?: Record<string, unknown>;
};

export type TopicEntry = {
  name: string;
  schema: string;
  messageCount: number;
};

export type TimeRange = {
  startNs: string; // bigint as decimal string
  endNs: string;
};

export type ShardEntry = {
  id: string;
  kind: "tail" | "topic";
  topic?: string;
  schema?: string;
  profile?: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  timeRange: TimeRange;
  topics: TopicEntry[];
  messageCount?: number;
};

export type SourceFileInfo = {
  name: string;
  sha256: string;
  sizeBytes: number;
  timeRange: TimeRange;
};

export type Manifest = {
  version: number;
  // One entry per input MCAP. Single-file manifests have length 1; record-level
  // manifests for multi-input recordings have length N.
  sourceFiles: SourceFileInfo[];
  profiles: Profile[];
  shards: ShardEntry[];
};

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x != undefined && !Array.isArray(x);
}

function asString(x: unknown, path: string): string {
  if (typeof x !== "string") {
    throw new Error(`manifest field ${path} expected string, got ${typeof x}`);
  }
  return x;
}

function asNumber(x: unknown, path: string): number {
  if (typeof x !== "number") {
    throw new Error(`manifest field ${path} expected number, got ${typeof x}`);
  }
  return x;
}

function asTimeRange(x: unknown, path: string): TimeRange {
  if (!isObject(x)) {
    throw new Error(`manifest field ${path} expected object`);
  }
  return {
    startNs: asString(x.startNs, `${path}.startNs`),
    endNs: asString(x.endNs, `${path}.endNs`),
  };
}

export function parseManifest(raw: unknown): Manifest {
  if (!isObject(raw)) {
    throw new Error("manifest is not a JSON object");
  }
  if (asNumber(raw.version, "version") !== 1) {
    throw new Error(`unsupported manifest version: ${String(raw.version)}`);
  }

  const sourceFilesRaw = raw.sourceFiles;
  if (!Array.isArray(sourceFilesRaw) || sourceFilesRaw.length === 0) {
    throw new Error("manifest.sourceFiles is not a non-empty array");
  }
  const sourceFiles: SourceFileInfo[] = sourceFilesRaw.map((s, i) => {
    if (!isObject(s)) {
      throw new Error(`manifest.sourceFiles[${i}] is not an object`);
    }
    return {
      name: asString(s.name, `sourceFiles[${i}].name`),
      sha256: asString(s.sha256, `sourceFiles[${i}].sha256`),
      sizeBytes: asNumber(s.sizeBytes, `sourceFiles[${i}].sizeBytes`),
      timeRange: asTimeRange(s.timeRange, `sourceFiles[${i}].timeRange`),
    };
  });

  const profilesRaw = raw.profiles;
  if (!Array.isArray(profilesRaw)) {
    throw new Error("manifest.profiles is not an array");
  }
  const profiles: Profile[] = profilesRaw.map((p, i) => {
    if (!isObject(p)) {
      throw new Error(`manifest.profiles[${i}] is not an object`);
    }
    return {
      id: asString(p.id, `profiles[${i}].id`),
      modality: asString(p.modality, `profiles[${i}].modality`),
      label: asString(p.label, `profiles[${i}].label`),
      params: isObject(p.params) ? p.params : undefined,
    };
  });

  const shardsRaw = raw.shards;
  if (!Array.isArray(shardsRaw)) {
    throw new Error("manifest.shards is not an array");
  }
  const shards: ShardEntry[] = shardsRaw.map((s, i) => {
    if (!isObject(s)) {
      throw new Error(`manifest.shards[${i}] is not an object`);
    }
    const kindRaw = asString(s.kind, `shards[${i}].kind`);
    if (kindRaw !== "tail" && kindRaw !== "topic") {
      throw new Error(`shards[${i}].kind must be 'tail' or 'topic', got ${kindRaw}`);
    }
    const topicsRaw = s.topics;
    if (!Array.isArray(topicsRaw)) {
      throw new Error(`shards[${i}].topics is not an array`);
    }
    const topics: TopicEntry[] = topicsRaw.map((t, j) => {
      if (!isObject(t)) {
        throw new Error(`shards[${i}].topics[${j}] is not an object`);
      }
      return {
        name: asString(t.name, `shards[${i}].topics[${j}].name`),
        schema: asString(t.schema, `shards[${i}].topics[${j}].schema`),
        messageCount: asNumber(t.messageCount, `shards[${i}].topics[${j}].messageCount`),
      };
    });
    return {
      id: asString(s.id, `shards[${i}].id`),
      kind: kindRaw,
      topic: typeof s.topic === "string" ? s.topic : undefined,
      schema: typeof s.schema === "string" ? s.schema : undefined,
      profile: typeof s.profile === "string" ? s.profile : undefined,
      filename: asString(s.filename, `shards[${i}].filename`),
      sizeBytes: asNumber(s.sizeBytes, `shards[${i}].sizeBytes`),
      sha256: asString(s.sha256, `shards[${i}].sha256`),
      timeRange: asTimeRange(s.timeRange, `shards[${i}].timeRange`),
      topics,
      messageCount: typeof s.messageCount === "number" ? s.messageCount : undefined,
    };
  });

  return {
    version: 1,
    sourceFiles,
    profiles,
    shards,
  };
}
