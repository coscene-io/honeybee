// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  inspectVideoPacket,
  type PacketInspection,
} from "@foxglove/den/video/h26x/inspectVideoPacket";
import { type Time, toNanoSec } from "@foxglove/rostime";
import { hasIntegerTime } from "@foxglove/studio-base/util/time";

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

// A context-free HEVC backfill can be classified later, once lookback reaches its PPS.
// Keep packet identities in per-second buckets and materialize only the requested B-frame rows.
export class SliceHistory {
  readonly #seconds = new Map<
    bigint,
    {
      offsets: number[];
      media: (bigint | undefined)[];
      classifications: (boolean | undefined)[];
      bIndexes: number[];
    }
  >();
  public size = 0;
  public first?: bigint;
  public last?: bigint;
  public classified = false;
  public unknownCount = 0;

  public constructor(private readonly topic: string) {}

  public observe(
    log: bigint,
    media: bigint | undefined,
    { bFrame }: PacketInspection,
    format: "h264" | "h265",
  ): void {
    this.classified ||= bFrame != undefined;
    // AVC slice types are self-contained. No later PPS can change a known non-B result.
    if (format === "h264" && bFrame === false) {
      return;
    }
    const second = log / 1_000_000_000n;
    const offset = Number(log % 1_000_000_000n);
    let bucket = this.#seconds.get(second);
    if (!bucket) {
      bucket = { offsets: [], media: [], classifications: [], bIndexes: [] };
      this.#seconds.set(second, bucket);
    }
    let index = bucket.offsets.indexOf(offset);
    while (index >= 0 && bucket.media[index] !== media) {
      index = bucket.offsets.indexOf(offset, index + 1);
    }
    if (index === -1) {
      index = bucket.offsets.length;
      bucket.offsets.push(offset);
      bucket.media.push(media);
      bucket.classifications.push(bFrame);
      if (bFrame == undefined) {
        this.unknownCount++;
      }
    } else {
      const previous = bucket.classifications[index];
      if (bFrame == undefined || previous === true || previous === bFrame) {
        return;
      }
      if (previous == undefined) {
        this.unknownCount--;
      }
      bucket.classifications[index] = bFrame;
    }
    if (bFrame === true) {
      bucket.bIndexes.push(index);
      this.size++;
      if (this.first == undefined || log < this.first) {
        this.first = log;
      }
      if (this.last == undefined || log > this.last) {
        this.last = log;
      }
    }
  }

  public *[Symbol.iterator](): IterableIterator<[string, Finding]> {
    for (const [second, bucket] of this.#seconds) {
      for (const index of bucket.bIndexes) {
        const start = second * 1_000_000_000n + BigInt(bucket.offsets[index]!);
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

  public copy(): VideoRun {
    return Object.assign(new VideoRun(), this, { pps: new Map(this.pps) });
  }
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
  slices?: SliceHistory;
  sawKey: boolean;
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
  readonly #inspectors = new Map<string, { owner?: object; readers: Set<object>; run: VideoRun }>();
  // Panels seeking together may read the same immutable recording range independently.
  // Share the parser state, without retaining their packets or coupling their cancellation.
  readonly #lastLookback = new Map<string, Interval & { count: number; run: VideoRun }>();

  public inspectLookback(
    topic: string,
    start: bigint,
    end: bigint,
    count: number,
    inspect: (run: VideoRun) => void,
  ): VideoRun {
    const previous = this.#lastLookback.get(topic);
    if (previous?.start === start && previous.end === end && previous.count === count) {
      return previous.run.copy();
    }
    const run = new VideoRun();
    inspect(run);
    this.#lastLookback.set(topic, { start, end, count, run: run.copy() });
    return run;
  }

  public topic(name: string): TopicDiagnostics {
    let topic = this.topics.get(name);
    if (!topic) {
      topic = {
        format: "",
        coverage: [],
        sawKey: false,
        findings: new Map(),
      };
      this.topics.set(name, topic);
    }
    return topic;
  }

  public claimRun(
    topic: string,
    reader: object,
    local: VideoRun,
    previousLog?: bigint,
  ): VideoRun | undefined {
    let stream = this.#inspectors.get(topic);
    if (!stream) {
      stream = { readers: new Set(), run: local };
      this.#inspectors.set(topic, stream);
    }
    const continuing =
      stream.readers.has(reader) &&
      previousLog != undefined &&
      stream.run.previous?.log === previousLog;
    stream.readers.add(reader);
    if (stream.owner == undefined) {
      stream.owner = reader;
      if (!continuing) {
        stream.run = local;
      }
    } else if (stream.owner === reader) {
      stream.run = local;
    } else {
      return undefined;
    }
    return stream.run;
  }

  public release(topic: string, reader: object): void {
    const stream = this.#inspectors.get(topic);
    if (!stream) {
      return;
    }
    stream.readers.delete(reader);
    if (stream.readers.size === 0) {
      this.#inspectors.delete(topic);
    } else if (stream.owner === reader) {
      stream.owner = undefined;
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
    const media = hasIntegerTime(timestamp) ? toNanoSec(timestamp) : undefined;
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
    (topic.slices ??= new SliceHistory(topicName)).observe(log, media, info, format);
    topic.sawKey ||= info.key && !info.problem;
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
