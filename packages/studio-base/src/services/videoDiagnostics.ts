// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { inspectVideoPacket } from "@foxglove/den/video/h26x/inspectVideoPacket";
import { type Time, toNanoSec } from "@foxglove/rostime";

export type FindingKind =
  | "bFrame"
  | "order"
  | "regression"
  | "gap"
  | "empty"
  | "annexB"
  | "malformed"
  | "parameters"
  | "decodeError";
export type Interval = { start: bigint; end: bigint };
type GapClock = "imageClock" | "recordClock";
type GapMeasurement = { duration: number; clock: GapClock };
export type Finding = Interval & {
  kind: FindingKind;
  topic: string;
  otherTopic?: string;
  detail?: string;
  duration?: number;
  open?: boolean;
  clock?: GapClock;
  resetDecoder?: boolean;
};

// B pictures can account for most frames of a long recording. Retain timestamps in small
// per-second buckets and materialize a finding only when a history row is requested.
export class BFrameHistory {
  readonly #seconds = new Map<bigint, { offsets: number[]; media: (bigint | undefined)[] }>();
  public size = 0;
  public first?: bigint;
  public last?: bigint;

  public constructor(private readonly topic: string) {}

  public add(log: bigint, media: bigint | undefined): void {
    const second = log / 1_000_000_000n;
    const offset = Number(log % 1_000_000_000n);
    let bucket = this.#seconds.get(second);
    if (!bucket) {
      bucket = { offsets: [], media: [] };
      this.#seconds.set(second, bucket);
    }
    for (
      let pos = bucket.offsets.indexOf(offset);
      pos >= 0;
      pos = bucket.offsets.indexOf(offset, pos + 1)
    ) {
      if (bucket.media[pos] === media) {
        return;
      }
    }
    bucket.offsets.push(offset);
    bucket.media.push(media);
    this.size++;
    if (this.first == undefined || log < this.first) {
      this.first = log;
    }
    if (this.last == undefined || log > this.last) {
      this.last = log;
    }
  }

  public *[Symbol.iterator](): IterableIterator<[string, Finding]> {
    for (const [second, bucket] of this.#seconds) {
      for (const [index, offset] of bucket.offsets.entries()) {
        const start = second * 1_000_000_000n + BigInt(offset);
        yield [
          `${start}/${bucket.media[index] ?? "?"}`,
          { kind: "bFrame", topic: this.topic, start, end: start },
        ];
      }
    }
  }
}

type FrameStamp = { log: bigint; media?: bigint };
export class VideoRun {
  public pps = new Map<number, number>();
  public previous?: FrameStamp;
  public key?: FrameStamp;
  public useRecordClock = false;
  public format?: string;
}

type VideoInput = {
  receiveTime: Time;
  message: {
    format?: string;
    timestamp?: Partial<Time>;
    data?: unknown;
  };
};

export type TopicDiagnostics = {
  format: string;
  coverage: Interval[];
  classified: boolean;
  bFrames?: BFrameHistory;
  sawKey: boolean;
  unknown: boolean;
  reorder?: boolean;
  recentGap?: GapMeasurement;
  longestGap?: GapMeasurement;
  findings: Map<FindingKind, Map<string, Finding>>;
};

// Sorted, disjoint intervals. Only bridge consecutive messages from a single delivery run.
function addCoverage(ranges: Interval[], start: bigint, end: bigint): void {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (ranges[mid]!.end < start) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  const current = ranges[low];
  if (!current || current.start > end) {
    ranges.splice(low, 0, { start, end });
    return;
  }
  if (start < current.start) {
    current.start = start;
  }
  if (end > current.end) {
    current.end = end;
    while (ranges[low + 1] && ranges[low + 1]!.start <= current.end) {
      const next = ranges.splice(low + 1, 1)[0]!;
      if (next.end > current.end) {
        current.end = next.end;
      }
    }
  }
}

export class VideoDiagnostics {
  public readonly topics = new Map<string, TopicDiagnostics>();
  readonly #owners = new Map<string, object>();

  public topic(name: string): TopicDiagnostics {
    let topic = this.topics.get(name);
    if (!topic) {
      topic = {
        format: "",
        coverage: [],
        classified: false,
        sawKey: false,
        unknown: false,
        findings: new Map(),
      };
      this.topics.set(name, topic);
    }
    return topic;
  }

  public claim(topic: string, owner: object): boolean {
    if (!this.#owners.has(topic)) {
      this.#owners.set(topic, owner);
    }
    return this.#owners.get(topic) === owner;
  }

  public release(topic: string, owner: object): void {
    if (this.#owners.get(topic) === owner) {
      this.#owners.delete(topic);
    }
  }

  public record(finding: Finding, key = String(finding.start)): void {
    const { findings } = this.topic(finding.topic);
    let group = findings.get(finding.kind);
    if (!group) {
      group = new Map();
      findings.set(finding.kind, group);
    }
    if (group.get(key)?.resetDecoder === true) {
      finding.resetDecoder = true;
    }
    group.set(key, finding);
  }

  public decoderReset(topic: string, log: bigint, previous: bigint, current: bigint): void {
    // Normalization supplies a zero timestamp for incomplete messages. Only annotate a
    // regression observed on the original input.
    const finding = this.topics
      .get(topic)
      ?.findings.get("regression")
      ?.get(`${log}/${previous}/${current}`);
    if (finding) {
      finding.resetDecoder = true;
    }
  }

  public cover(topic: string, start: bigint, end: bigint): void {
    addCoverage(this.topic(topic).coverage, start <= end ? start : end, end);
  }

  public inspect(topicName: string, input: VideoInput, run: VideoRun): void {
    const { format, timestamp, data } = input.message;
    if (format !== "h264" && format !== "h265") {
      return;
    }
    const topic = this.topic(topicName);
    topic.format = format;
    const log = toNanoSec(input.receiveTime);
    const media =
      timestamp?.sec != undefined && timestamp.nsec != undefined
        ? toNanoSec({ sec: timestamp.sec, nsec: timestamp.nsec })
        : undefined;
    const previous = run.previous;
    if (format !== run.format || (previous && previous.log > log)) {
      run.pps.clear();
      run.key = undefined;
    }
    run.format = format;
    addCoverage(topic.coverage, previous && previous.log < log ? previous.log : log, log);
    if (media == undefined) {
      run.useRecordClock = true;
    }
    if (previous?.media != undefined && media != undefined && previous.media > media) {
      // A B-picture presentation timestamp may move backwards in decode order. Recording
      // time still measures the distance between random-access points in continuous input.
      run.useRecordClock = true;
      this.record(
        {
          kind: "regression",
          topic: topicName,
          start: log,
          end: log,
          duration: Number(previous.media - media) / 1e9,
          detail: `${previous.media} → ${media}`,
        },
        `${log}/${previous.media}/${media}`,
      );
    }
    const info = inspectVideoPacket(
      format,
      data instanceof Uint8Array || Array.isArray(data) ? data : [],
      run.pps,
    );
    topic.reorder = info.reorder ?? topic.reorder;
    const point = { topic: topicName, start: log, end: log };
    if (info.problem) {
      this.record({ ...point, kind: info.problem });
      run.key = undefined;
    }
    if (info.missing.length > 0) {
      this.record({ ...point, kind: "parameters", detail: info.missing.join(", ") });
    }
    if (info.bFrame === true) {
      (topic.bFrames ??= new BFrameHistory(topicName)).add(log, media);
    }
    topic.sawKey ||= info.key && !info.problem;
    topic.classified ||= info.bFrame != undefined;
    topic.unknown ||= info.bFrame == undefined;
    const stamp = { media, log };
    const key = run.key;
    if (
      key &&
      (log > key.log || (media != undefined && key.media != undefined && media > key.media))
    ) {
      const useMedia =
        !run.useRecordClock && key.media != undefined && media != undefined && media > key.media;
      const clock: GapClock = useMedia ? "imageClock" : "recordClock";
      const duration = Number(useMedia ? media - key.media! : log - key.log) / 1e9;
      const id = `${key.log}/${key.media ?? "?"}`;
      const old = topic.findings.get("gap")?.get(id);
      if (
        info.key ||
        !old ||
        (old.open === true && (duration > (old.duration ?? 0) || old.clock !== clock))
      ) {
        this.record(
          {
            topic: topicName,
            kind: "gap",
            start: key.log,
            end: log,
            duration,
            clock,
            open: !info.key,
          },
          id,
        );
      }
      if (info.key) {
        const measured = { duration, clock };
        topic.recentGap = measured;
        if (!topic.longestGap || duration > topic.longestGap.duration) {
          topic.longestGap = measured;
        }
      }
    }
    if (info.key && !info.problem) {
      run.key = stamp;
      run.useRecordClock = media == undefined;
    }
    run.previous = stamp;
  }
}
