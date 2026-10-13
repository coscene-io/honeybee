// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toSec, type Time } from "@foxglove/rostime";
import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";

import { isSecondsInRange, timelineDurationSeconds } from "./eventTimeContainment";

type Entry = { event: TimelinePositionedEvent; start: number; end: number; order: number };

/** A start-sorted interval tree, augmented with maximum ends so long moments are not missed. */
class IntervalIndex {
  readonly #entries: Entry[];
  readonly #maxEnds: Float64Array;
  readonly #size: number;

  public constructor(entries: Entry[]) {
    this.#entries = entries
      .filter((entry) => Number.isFinite(entry.start) && Number.isFinite(entry.end))
      .sort((a, b) => (a.start === b.start ? a.order - b.order : a.start - b.start));
    this.#size = 2 ** Math.ceil(Math.log2(Math.max(1, this.#entries.length)));
    this.#maxEnds = new Float64Array(this.#size * 2).fill(Number.NEGATIVE_INFINITY);
    this.#entries.forEach((entry, index) => {
      this.#maxEnds[this.#size + index] = entry.end;
    });
    for (let i = this.#size - 1; i > 0; i--) {
      this.#maxEnds[i] = Math.max(this.#maxEnds[i * 2]!, this.#maxEnds[i * 2 + 1]!);
    }
  }

  public query(
    start: number,
    end: number,
    contains?: (entry: Entry) => boolean,
  ): TimelinePositionedEvent[] {
    const matches: Entry[] = [];
    const visit = (node: number, left: number, right: number): void => {
      if (
        left >= this.#entries.length ||
        this.#entries[left]!.start > end ||
        this.#maxEnds[node]! < start
      ) {
        return;
      }
      if (right - left === 1) {
        const entry = this.#entries[left]!;
        if (contains == undefined || contains(entry)) {
          matches.push(entry);
        }
        return;
      }
      const middle = (left + right) >>> 1;
      visit(node * 2, left, middle);
      visit(node * 2 + 1, middle, right);
    };
    if (Number.isFinite(start) && Number.isFinite(end)) {
      visit(1, 0, this.#size);
    }
    return matches.sort((a, b) => a.order - b.order).map((entry) => entry.event);
  }
}

export class EventTimeIndex {
  public readonly byId: ReadonlyMap<string, TimelinePositionedEvent>;
  readonly #relative: IntervalIndex;
  #absolute: IntervalIndex | undefined;

  readonly #events: TimelinePositionedEvent[];
  public constructor(events: TimelinePositionedEvent[], origin: Time) {
    this.#events = events;
    this.byId = new Map(events.map((event) => [event.event.name, event]));
    this.#relative = new IntervalIndex(
      events.map((event, order) => ({
        event,
        order,
        start: timelineDurationSeconds(origin, event.startTime),
        end: timelineDurationSeconds(origin, event.endTime),
      })),
    );
  }

  public atRelativeTime(seconds: number, recordingDuration: number): TimelinePositionedEvent[] {
    return this.#relative.query(seconds, seconds, (entry) =>
      isSecondsInRange(seconds, entry.start, entry.end, recordingDuration),
    );
  }

  public atAbsoluteTime(seconds: number, recordingEnd: Time): TimelinePositionedEvent[] {
    this.#absolute ??= new IntervalIndex(
      this.#events.map((event, order) => ({
        event,
        order,
        start: toSec(event.startTime),
        end: toSec(event.endTime),
      })),
    );
    return this.#absolute.query(seconds, seconds, (entry) =>
      isSecondsInRange(seconds, entry.start, entry.end, toSec(recordingEnd)),
    );
  }

  public inRelativeRange(start: number, end: number): TimelinePositionedEvent[] {
    return this.#relative.query(start, end);
  }
}

const indexes = new WeakMap<TimelinePositionedEvent[], { origin: string; index: EventTimeIndex }>();
export const EMPTY_EVENTS: TimelinePositionedEvent[] = [];

/** One origin per immutable event snapshot; replacing a recording releases the old index. */
export function getEventTimeIndex(events: TimelinePositionedEvent[], origin: Time): EventTimeIndex {
  const key = `${origin.sec}:${origin.nsec}`;
  const cached = indexes.get(events);
  if (cached?.origin === key) {
    return cached.index;
  }
  const index = new EventTimeIndex(events, origin);
  indexes.set(events, { origin: key, index });
  return index;
}
