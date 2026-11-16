// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

export type VirtualRows = {
  /** First and one-past-last row to render. */
  start: number;
  end: number;
  /** Top of each row and, at `offsets[count]`, the total height. */
  offsets: Float64Array;
  scrollTop: number;
  /** Height the viewport shows. Zero means unmeasured; every row is then rendered. */
  viewportHeight: number;
  /** Attach to each rendered row; its measured height replaces the estimate. */
  measure: (key: string) => (element: HTMLElement | ReactNull) => void;
  /** Scroll so the row's top is at the top of the viewport. */
  scrollToRow: (index: number) => void;
};

/**
 * Windowed rendering for a scroll container whose rows have different, content-driven heights.
 * Heights are estimated until a row has been rendered once, then measured with ResizeObserver
 * and remembered by key, so rows that scroll back in keep their size. Without a measured
 * viewport (tests, a hidden tab) every row is rendered.
 */
export function useVirtualRows({
  container,
  keys,
  estimate,
  overscan = 400,
}: {
  container: RefObject<HTMLElement>;
  keys: readonly string[];
  estimate: (index: number) => number;
  /** Extra pixels rendered above and below the viewport. */
  overscan?: number;
}): VirtualRows {
  const heights = useRef(new Map<string, number>());
  const [, setMeasuredVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) {
      return;
    }
    let frame: number | undefined;
    const read = () => {
      frame = undefined;
      setScrollTop(element.scrollTop);
      setViewportHeight(element.clientHeight);
    };
    read();
    const onScroll = () => {
      frame ??= requestAnimationFrame(read);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(read);
    resize?.observe(element);
    return () => {
      element.removeEventListener("scroll", onScroll);
      resize?.disconnect();
      if (frame != undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, [container]);

  // One observer for every rendered row. A change of any row's height re-lays out the list once.
  const elementsByKey = useRef(new Map<string, HTMLElement>());
  const rowObserver = useMemo(() => {
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }
    return new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.virtualKey;
        const height = (entry.target as HTMLElement).offsetHeight;
        if (key != undefined && height > 0 && heights.current.get(key) !== height) {
          heights.current.set(key, height);
          changed = true;
        }
      }
      if (changed) {
        setMeasuredVersion((version) => version + 1);
      }
    });
  }, []);
  useEffect(() => () => rowObserver?.disconnect(), [rowObserver]);
  const refs = useRef(new Map<string, (element: HTMLElement | ReactNull) => void>());
  const measure = useCallback(
    (key: string) => {
      let ref = refs.current.get(key);
      if (!ref) {
        ref = (element) => {
          const previous = elementsByKey.current.get(key);
          if (previous && previous !== element) {
            rowObserver?.unobserve(previous);
            elementsByKey.current.delete(key);
          }
          if (element) {
            element.dataset.virtualKey = key;
            elementsByKey.current.set(key, element);
            rowObserver?.observe(element);
          }
        };
        refs.current.set(key, ref);
      }
      return ref;
    },
    [rowObserver],
  );

  // Recomputed every render: O(rows), and a render follows each measurement (`measuredVersion`).
  const offsets = new Float64Array(keys.length + 1);
  for (let index = 0; index < keys.length; index++) {
    offsets[index + 1] = offsets[index]! + (heights.current.get(keys[index]!) ?? estimate(index));
  }

  const count = keys.length;
  let start = 0;
  let end = count;
  if (viewportHeight > 0) {
    start = Math.max(0, firstRowEndingAfter(offsets, scrollTop - overscan));
    end = Math.min(count, firstRowEndingAfter(offsets, scrollTop + viewportHeight + overscan) + 1);
  }

  const scrollToRow = useCallback(
    (index: number) => {
      const element = container.current;
      if (element && index >= 0 && index < offsets.length) {
        element.scrollTop = offsets[index]!;
      }
    },
    [container, offsets],
  );

  return { start, end, offsets, scrollTop, viewportHeight, measure, scrollToRow };
}

/** Index of the first row whose bottom is below `y` (binary search over prefix offsets). */
function firstRowEndingAfter(offsets: Float64Array, y: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle + 1]! > y) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}
