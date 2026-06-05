// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@foxglove/rostime";

import { KeyframeIndex } from "./keyframeIndex";

const t = (sec: number, nsec = 0): Time => ({ sec, nsec });

describe("KeyframeIndex", () => {
  it("returns undefined when empty", () => {
    const index = new KeyframeIndex();
    expect(index.size()).toBe(0);
    expect(index.nearestKeyframeAtOrBefore(t(10))).toBeUndefined();
  });

  it("returns the largest keyframe at or before a time", () => {
    const index = new KeyframeIndex();
    index.addKeyframe(t(20));
    index.addKeyframe(t(10));
    index.addKeyframe(t(30));

    expect(index.nearestKeyframeAtOrBefore(t(5))).toBeUndefined();
    expect(index.nearestKeyframeAtOrBefore(t(10))).toEqual(t(10));
    expect(index.nearestKeyframeAtOrBefore(t(25))).toEqual(t(20));
    expect(index.nearestKeyframeAtOrBefore(t(30))).toEqual(t(30));
    expect(index.nearestKeyframeAtOrBefore(t(100))).toEqual(t(30));
  });

  it("dedupes identical keyframes and stays sorted", () => {
    const index = new KeyframeIndex();
    index.addKeyframe(t(10, 500));
    index.addKeyframe(t(10, 500));
    index.addKeyframe(t(10, 500));
    expect(index.size()).toBe(1);

    index.addKeyframe(t(10, 400));
    index.addKeyframe(t(10, 600));
    expect(index.size()).toBe(3);
    expect(index.nearestKeyframeAtOrBefore(t(10, 550))).toEqual(t(10, 500));
    expect(index.nearestKeyframeAtOrBefore(t(10, 450))).toEqual(t(10, 400));
  });
});
