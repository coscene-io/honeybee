// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Manifest, ShardEntry } from "./manifest";

// For an encoded shard the topic ends with "/h264"; the source topic key strips
// that suffix so the encoded variants and the full-resolution shard share a key.
function sourceTopicKey(shard: ShardEntry): string | undefined {
  if (shard.kind !== "topic") {
    return undefined;
  }
  const t = shard.topic;
  if (!t) {
    return undefined;
  }
  return t.endsWith("/h264") ? t.slice(0, -"/h264".length) : t;
}

export type ActiveShardSet = {
  // Shards in the active set (tail first, then per-topic-group selection).
  shards: ShardEntry[];
  // Diagnostic: per-source-topic selected profile id (or "<none>" for groups
  // where no shard was selected — should never happen but exposed for tests).
  selectedProfileByTopic: Map<string, string>;
};

// Pick the active set of shards for a given preferred profile id.
//
// Selection rules:
// 1. The tail shard is always included.
// 2. For each "source topic group" of `kind: "topic"` shards (grouped by
//    sourceTopicKey()):
//      - If `preferredProfile` is set: pick the shard whose `profile`
//        matches. If no shard in the group matches, **exclude** the group
//        entirely (no silent fallback to `full`).
//      - If `preferredProfile` is undefined: pick the **lowest-quality**
//        video profile available for the group (the one with the smallest
//        `params.h`). This is the default low-bandwidth mode: layouts
//        referencing the encoded `/h264` topic name work out of the box,
//        and groups without any encoded variant (depth, pointcloud) are
//        excluded — heavy raw shards never get fetched by accident.
//
// To force the full-resolution variant, pass `?ds.profile=full`. To force
// the highest video quality, pass `?ds.profile=720p15` (or whichever is
// configured). Note: `?ds.profile=raw` is intercepted at the factory layer
// and routes to the legacy data-platform player — it never reaches here.
export function selectActiveShards(
  manifest: Manifest,
  preferredProfile: string | undefined,
): ActiveShardSet {
  // Build a height lookup so the no-preference default can pick the
  // highest-resolution video profile per group.
  const heightByProfileId = new Map<string, number>();
  for (const p of manifest.profiles) {
    const h =
      (p.params as { h?: number; height?: number } | undefined)?.h ??
      (p.params as { height?: number } | undefined)?.height ??
      0;
    heightByProfileId.set(p.id, h);
  }

  const groups = new Map<string, ShardEntry[]>();
  const tail: ShardEntry[] = [];

  for (const shard of manifest.shards) {
    if (shard.kind === "tail") {
      tail.push(shard);
      continue;
    }
    const key = sourceTopicKey(shard);
    if (key == undefined) {
      continue;
    }
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(shard);
  }

  const selected: ShardEntry[] = [...tail];
  const selectedProfileByTopic = new Map<string, string>();

  for (const [topic, bucket] of groups) {
    // First decide WHICH profile id to use for this group, then include every
    // shard in the group with that profile. Multi-input records have one
    // shard per (input file, topic, profile), so the group can have multiple
    // shards we want to interleave; the existing k-way merge handles ordering.
    let chosenProfile: string | undefined;
    if (preferredProfile) {
      const hasMatch = bucket.some((s) => s.profile === preferredProfile);
      if (hasMatch) {
        chosenProfile = preferredProfile;
      }
      // No fallback — the group is excluded if it lacks the requested profile.
    } else {
      // Default low-bandwidth mode: lowest-quality video variant only.
      // Raw passthrough variants (`full` = legacy raw-image, `raw` = raw
      // non-image like pointclouds — both potentially hundreds of MB) are
      // never picked by default. Groups with no video variant (depth,
      // pointcloud, telemetry) are excluded.
      const videoVariants = bucket
        .filter((s) => s.profile && s.profile !== "full" && s.profile !== "raw")
        .sort(
          (a, b) =>
            (heightByProfileId.get(a.profile!) ?? Number.MAX_SAFE_INTEGER) -
            (heightByProfileId.get(b.profile!) ?? Number.MAX_SAFE_INTEGER),
        );
      chosenProfile = videoVariants[0]?.profile;
    }
    if (chosenProfile != undefined) {
      for (const s of bucket) {
        if (s.profile === chosenProfile) {
          selected.push(s);
        }
      }
      selectedProfileByTopic.set(topic, chosenProfile);
    }
  }

  return { shards: selected, selectedProfileByTopic };
}
