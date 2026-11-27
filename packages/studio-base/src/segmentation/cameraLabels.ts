// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { t } from "i18next";

function segmentsOf(topic: string): string[] {
  return topic.split("/").filter((part) => part.length > 0);
}

/** The name a lone camera gets: its second path segment, as the editor has always shown it. */
function singleTopicLabel(segments: readonly string[]): string | undefined {
  return segments[1] ?? segments[0];
}

/**
 * Short, distinct names for camera topics shown side by side.
 *
 * Path segments every topic shares at the start or at the end are dropped, so
 * `/cam_head/compressed/h265` and `/cam_wrist_left/compressed/h265` read `cam_head` and
 * `cam_wrist_left`, and `/cam/left/image` and `/cam/right/image` read `left` and `right`. A name
 * that comes out empty or still matches another one grows by one segment on each side until it is
 * unique, at worst the whole topic. A lone topic keeps the name it had before.
 *
 * The result maps each input topic to its name; topics without segments are left out.
 */
export function distinctTopicLabels(topics: Iterable<string>): Map<string, string> {
  const byKey = new Map<string, { segments: string[]; topics: string[] }>();
  for (const topic of topics) {
    const segments = segmentsOf(topic);
    if (segments.length === 0) {
      continue;
    }
    const key = segments.join("/");
    const entry = byKey.get(key) ?? { segments, topics: [] };
    entry.topics.push(topic);
    byKey.set(key, entry);
  }
  const entries = [...byKey.values()];
  const labels = new Map<string, string>();
  if (entries.length === 1) {
    const [only] = entries;
    for (const topic of only!.topics) {
      labels.set(topic, singleTopicLabel(only!.segments)!);
    }
    return labels;
  }

  const shortest = Math.min(...entries.map((entry) => entry.segments.length));
  let prefix = 0;
  while (
    prefix < shortest &&
    entries.every((entry) => entry.segments[prefix] === entries[0]!.segments[prefix])
  ) {
    prefix++;
  }
  let suffix = 0;
  while (
    prefix + suffix < shortest &&
    entries.every(
      (entry) =>
        entry.segments[entry.segments.length - 1 - suffix] ===
        entries[0]!.segments[entries[0]!.segments.length - 1 - suffix],
    )
  ) {
    suffix++;
  }

  const widen = entries.map(() => 0);
  const nameOf = (index: number): string => {
    const { segments } = entries[index]!;
    const start = Math.max(0, prefix - widen[index]!);
    const end = Math.min(segments.length, segments.length - suffix + widen[index]!);
    return segments.slice(start, end).join("/");
  };
  const isWhole = (index: number): boolean =>
    prefix - widen[index]! <= 0 && suffix - widen[index]! <= 0;
  for (;;) {
    const names = entries.map((_, index) => nameOf(index));
    const counts = new Map<string, number>();
    for (const name of names) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const growing = names.flatMap((name, index) =>
      (name.length === 0 || counts.get(name)! > 1) && !isWhole(index) ? [index] : [],
    );
    for (const index of growing) {
      widen[index]!++;
    }
    if (growing.length === 0) {
      names.forEach((name, index) => {
        for (const topic of entries[index]!.topics) {
          labels.set(topic, name);
        }
      });
      return labels;
    }
  }
}

/**
 * The short name of `topic` among the cameras in `shownWith`, which should include `topic`.
 * Falls back to a generic image name when there is no topic.
 */
export function segmentationCameraLabel(
  topic: string | undefined,
  shownWith: Iterable<string | undefined> = [],
): string {
  if (topic == undefined) {
    return t("segmentation:image");
  }
  const group = new Set<string>([topic]);
  for (const other of shownWith) {
    if (other != undefined) {
      group.add(other);
    }
  }
  return distinctTopicLabels(group).get(topic) ?? t("segmentation:image");
}
