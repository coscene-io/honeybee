// SPDX-FileCopyrightText: Copyright (C) 2026 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { Manifest, ShardEntry } from "./manifest";
import { selectActiveShards } from "./profileSelection";

function shard(partial: Partial<ShardEntry> & Pick<ShardEntry, "id" | "kind">): ShardEntry {
  return {
    filename: `${partial.id}.mcap`,
    sizeBytes: 1,
    sha256: "0".repeat(64),
    timeRange: { startNs: "0", endNs: "0" },
    topics: [],
    ...partial,
  };
}

function manifest(shards: ShardEntry[]): Manifest {
  return {
    version: 1,
    sourceFiles: [
      {
        name: "x",
        sha256: "0".repeat(64),
        sizeBytes: 0,
        timeRange: { startNs: "0", endNs: "0" },
      },
    ],
    profiles: [
      { id: "full", modality: "video", label: "full" },
      { id: "480p10", modality: "video", label: "480p", params: { h: 480, fps: 10 } },
      { id: "720p15", modality: "video", label: "720p", params: { h: 720, fps: 15 } },
    ],
    shards,
  };
}

describe("selectActiveShards", () => {
  it("includes the tail shard always", () => {
    const m = manifest([shard({ id: "tail", kind: "tail" })]);
    const result = selectActiveShards(m, undefined);
    expect(result.shards.map((s) => s.id)).toEqual(["tail"]);
  });

  it("picks the LOWEST-resolution video profile per group when no preference set", () => {
    const m = manifest([
      shard({ id: "tail", kind: "tail" }),
      shard({ id: "cam_a-full", kind: "topic", topic: "/cam_a/img", profile: "full" }),
      shard({
        id: "cam_a-480p10",
        kind: "topic",
        topic: "/cam_a/img/h264",
        profile: "480p10",
      }),
      shard({
        id: "cam_a-720p15",
        kind: "topic",
        topic: "/cam_a/img/h264",
        profile: "720p15",
      }),
    ]);
    const result = selectActiveShards(m, undefined);
    expect(result.shards.map((s) => s.id)).toEqual(["tail", "cam_a-480p10"]);
    expect(result.selectedProfileByTopic.get("/cam_a/img")).toBe("480p10");
  });

  it("excludes groups with no video variants by default (no full fallback)", () => {
    const m = manifest([
      shard({ id: "tail", kind: "tail" }),
      shard({ id: "depth-full", kind: "topic", topic: "/cam_a/depth", profile: "full" }),
    ]);
    const result = selectActiveShards(m, undefined);
    // depth-full is excluded; only the tail remains.
    expect(result.shards.map((s) => s.id)).toEqual(["tail"]);
  });

  it("explicit `full` profile still works for raw passthrough on demand", () => {
    const m = manifest([
      shard({ id: "tail", kind: "tail" }),
      shard({ id: "cam_a-full", kind: "topic", topic: "/cam_a/img", profile: "full" }),
      shard({ id: "cam_a-480p10", kind: "topic", topic: "/cam_a/img/h264", profile: "480p10" }),
    ]);
    const result = selectActiveShards(m, "full");
    expect(result.shards.map((s) => s.id).sort()).toEqual(["cam_a-full", "tail"]);
    expect(result.selectedProfileByTopic.get("/cam_a/img")).toBe("full");
  });

  it("picks the requested profile when preferredProfile is set", () => {
    const m = manifest([
      shard({ id: "tail", kind: "tail" }),
      shard({ id: "cam_a-full", kind: "topic", topic: "/cam_a/img", profile: "full" }),
      shard({
        id: "cam_a-480p10",
        kind: "topic",
        topic: "/cam_a/img/h264",
        profile: "480p10",
      }),
      shard({
        id: "cam_a-720p15",
        kind: "topic",
        topic: "/cam_a/img/h264",
        profile: "720p15",
      }),
    ]);
    const result = selectActiveShards(m, "480p10");
    expect(result.shards.map((s) => s.id)).toEqual(["tail", "cam_a-480p10"]);
    expect(result.selectedProfileByTopic.get("/cam_a/img")).toBe("480p10");
  });

  it("excludes topic groups that lack the requested profile (no fallback to full)", () => {
    const m = manifest([
      shard({ id: "tail", kind: "tail" }),
      shard({ id: "cam_a-full", kind: "topic", topic: "/cam_a/img", profile: "full" }),
      shard({
        id: "cam_a-480p10",
        kind: "topic",
        topic: "/cam_a/img/h264",
        profile: "480p10",
      }),
      // depth has only `full` (e.g., depth_compress can't be encoded)
      shard({ id: "depth-full", kind: "topic", topic: "/cam_a/depth", profile: "full" }),
    ]);
    const result = selectActiveShards(m, "480p10");
    const ids = result.shards.map((s) => s.id).sort();
    // Heavy topics without a 480p10 variant are excluded — keeps low-bandwidth
    // mode actually low-bandwidth.
    expect(ids).toEqual(["cam_a-480p10", "tail"]);
    expect(result.selectedProfileByTopic.get("/cam_a/img")).toBe("480p10");
    expect(result.selectedProfileByTopic.has("/cam_a/depth")).toBe(false);
  });

  it("groups encoded and full shards by stripping /h264 suffix", () => {
    const m = manifest([
      shard({ id: "cam-full", kind: "topic", topic: "/cam/foo", profile: "full" }),
      shard({ id: "cam-480p10", kind: "topic", topic: "/cam/foo/h264", profile: "480p10" }),
    ]);
    const result = selectActiveShards(m, "480p10");
    expect(result.shards.map((s) => s.id)).toEqual(["cam-480p10"]);
  });

  it("excludes a group with neither matching profile when a profile is requested", () => {
    const m = manifest([
      shard({ id: "weird-720p15", kind: "topic", topic: "/cam/x/h264", profile: "720p15" }),
    ]);
    const result = selectActiveShards(m, "480p10");
    expect(result.shards.map((s) => s.id)).toEqual([]);
  });

  it("falls back to `full` when no preferred profile and `full` is missing — picks first", () => {
    const m = manifest([
      shard({ id: "only-720p15", kind: "topic", topic: "/cam/x/h264", profile: "720p15" }),
    ]);
    const result = selectActiveShards(m, undefined);
    expect(result.shards.map((s) => s.id)).toEqual(["only-720p15"]);
  });

  it("excludes `raw` shards from default mode (non-image passthrough only on opt-in)", () => {
    const m = manifest([
      shard({ id: "tail", kind: "tail" }),
      shard({ id: "lidar-raw", kind: "topic", topic: "/lidar/points", profile: "raw" }),
    ]);
    const result = selectActiveShards(m, undefined);
    // Raw passthrough is heavy; default mode keeps just the tail.
    expect(result.shards.map((s) => s.id)).toEqual(["tail"]);
  });

  it("explicit `raw` profile loads non-image passthrough shards", () => {
    const m = manifest([
      shard({ id: "tail", kind: "tail" }),
      shard({ id: "lidar-raw", kind: "topic", topic: "/lidar/points", profile: "raw" }),
      shard({
        id: "cam_a-480p10",
        kind: "topic",
        topic: "/cam_a/img/h264",
        profile: "480p10",
      }),
    ]);
    const result = selectActiveShards(m, "raw");
    // Image groups have no `raw` variant → excluded; lidar group matches → included.
    expect(result.shards.map((s) => s.id).sort()).toEqual(["lidar-raw", "tail"]);
    expect(result.selectedProfileByTopic.get("/lidar/points")).toBe("raw");
  });

  it("ignores `topic`-kind shards with no `topic` field", () => {
    const m = manifest([
      shard({ id: "tail", kind: "tail" }),
      shard({ id: "broken", kind: "topic", profile: "full" }),
    ]);
    const result = selectActiveShards(m, undefined);
    expect(result.shards.map((s) => s.id)).toEqual(["tail"]);
  });

  // Record-level (multi-input) cases: every input file contributes a shard
  // per (topic, profile), all of which need to be selected together so the
  // k-way merge can interleave them by logTime.
  it("includes every tail shard from a multi-input record", () => {
    const m = manifest([
      shard({ id: "bag-0/tail", kind: "tail" }),
      shard({ id: "bag-1/tail", kind: "tail" }),
    ]);
    const result = selectActiveShards(m, undefined);
    expect(result.shards.map((s) => s.id).sort()).toEqual(["bag-0/tail", "bag-1/tail"]);
  });

  it("selects ALL shards at the chosen profile across input files", () => {
    const m = manifest([
      shard({ id: "bag-0/tail", kind: "tail" }),
      shard({ id: "bag-1/tail", kind: "tail" }),
      shard({
        id: "bag-0/cam_a-480p10",
        kind: "topic",
        topic: "/cam_a/img/h264",
        profile: "480p10",
      }),
      shard({
        id: "bag-0/cam_a-720p15",
        kind: "topic",
        topic: "/cam_a/img/h264",
        profile: "720p15",
      }),
      shard({
        id: "bag-1/cam_a-480p10",
        kind: "topic",
        topic: "/cam_a/img/h264",
        profile: "480p10",
      }),
      shard({
        id: "bag-1/cam_a-720p15",
        kind: "topic",
        topic: "/cam_a/img/h264",
        profile: "720p15",
      }),
    ]);
    const result = selectActiveShards(m, "480p10");
    expect(result.shards.map((s) => s.id).sort()).toEqual([
      "bag-0/cam_a-480p10",
      "bag-0/tail",
      "bag-1/cam_a-480p10",
      "bag-1/tail",
    ]);
    expect(result.selectedProfileByTopic.get("/cam_a/img")).toBe("480p10");
  });

  it("default mode picks lowest-quality variant once, then includes it from every file", () => {
    const m = manifest([
      shard({ id: "bag-0/tail", kind: "tail" }),
      shard({ id: "bag-1/tail", kind: "tail" }),
      shard({
        id: "bag-0/cam_a-480p10",
        kind: "topic",
        topic: "/cam_a/img/h264",
        profile: "480p10",
      }),
      shard({
        id: "bag-0/cam_a-720p15",
        kind: "topic",
        topic: "/cam_a/img/h264",
        profile: "720p15",
      }),
      shard({
        id: "bag-1/cam_a-480p10",
        kind: "topic",
        topic: "/cam_a/img/h264",
        profile: "480p10",
      }),
      shard({
        id: "bag-1/cam_a-720p15",
        kind: "topic",
        topic: "/cam_a/img/h264",
        profile: "720p15",
      }),
    ]);
    const result = selectActiveShards(m, undefined);
    expect(result.shards.map((s) => s.id).sort()).toEqual([
      "bag-0/cam_a-480p10",
      "bag-0/tail",
      "bag-1/cam_a-480p10",
      "bag-1/tail",
    ]);
  });
});
