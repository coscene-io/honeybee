// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// 该文件用于记录合并主分支时被主分支删除的代码，但是当前组件仍然需要使用的代码

import { TFunction } from "i18next";

import { Immutable } from "@foxglove/studio";
import { PlotPath } from "@foxglove/studio-base/panels/AnnotatedPlot/internalTypes";

export type Indices = [slice: number, offset: number];

export type Bounds = {
  x: { min: number; max: number };
  y: { min: number; max: number };
};

/**
 * Creates inverted bounds with values set to extremes to simplify calculating the union
 * with a series of other bounds.
 */
export function makeInvertedBounds(): Bounds {
  return {
    x: { min: Number.MAX_SAFE_INTEGER, max: Number.MIN_SAFE_INTEGER },
    y: { min: Number.MAX_SAFE_INTEGER, max: Number.MIN_SAFE_INTEGER },
  };
}

/**
 * Finds the union of two rectangular bounds.
 */
export function unionBounds(a: Immutable<Bounds>, b: Immutable<Bounds>): Bounds {
  return {
    x: { min: Math.min(a.x.min, b.x.min), max: Math.max(a.x.max, b.x.max) },
    y: { min: Math.min(a.y.min, b.y.min), max: Math.max(a.y.max, b.y.max) },
  };
}

/**
 * Coalesces null, undefined and empty string to undefined.
 */
function presence<T>(value: undefined | T): undefined | T {
  if (value === "") {
    return undefined;
  }

  return value ?? undefined;
}

export function plotPathDisplayName(
  path: Readonly<PlotPath>,
  index: number,
  t: TFunction<"plot">,
): string {
  return presence(path.label) ?? presence(path.value) ?? `${t("series")} ${index + 1}`;
}
