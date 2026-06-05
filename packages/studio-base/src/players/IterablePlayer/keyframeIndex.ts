// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time, fromNanoSec, toNanoSec } from "@foxglove/rostime";

export class KeyframeIndex {
  #keyframesNs: bigint[] = [];

  public addKeyframe(time: Time): void {
    const ns = toNanoSec(time);
    const i = this.#lowerBound(ns);
    if (this.#keyframesNs[i] !== ns) {
      this.#keyframesNs.splice(i, 0, ns);
    }
  }

  public nearestKeyframeAtOrBefore(time: Time): Time | undefined {
    const ns = toNanoSec(time);
    const i = this.#upperBound(ns);
    return i > 0 ? fromNanoSec(this.#keyframesNs[i - 1]!) : undefined;
  }

  public size(): number {
    return this.#keyframesNs.length;
  }

  #lowerBound(ns: bigint): number {
    let lo = 0;
    let hi = this.#keyframesNs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.#keyframesNs[mid]! < ns) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  #upperBound(ns: bigint): number {
    let lo = 0;
    let hi = this.#keyframesNs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.#keyframesNs[mid]! <= ns) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
}
