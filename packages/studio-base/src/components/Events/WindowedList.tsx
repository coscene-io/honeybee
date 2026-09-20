// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { VariableSizeList, type ListChildComponentProps } from "react-window";

export type WindowedItem = { key: string; estimatedSize: number; content: React.ReactNode };
export type WindowedScrollRequest = { key: string };
type RowData = {
  items: WindowedItem[];
  horizontal: boolean;
  measure: (index: number, size: number) => void;
  pin: (index: number) => void;
  reveal: (index: number) => void;
  styles: Map<string, React.CSSProperties>;
};
const PinnedContext = createContext<{ data: RowData; index: number | undefined } | undefined>(
  undefined,
);

/** Layout writes must run outside ResizeObserver's delivery cycle. */
function observeSize(element: HTMLElement, measure: () => void): () => void {
  let frame: number | undefined;
  const observer = new ResizeObserver(() => {
    frame ??= requestAnimationFrame(() => {
      frame = undefined;
      measure();
    });
  });
  observer.observe(element);
  measure();
  return () => {
    observer.disconnect();
    if (frame != undefined) {
      cancelAnimationFrame(frame);
    }
  };
}

/** Preserve programmatic focus restoration (e.g. dialogs), but skip retained controls on Tab. */
function excludeFromTabOrder(element: HTMLElement): () => void {
  const original = new Map<Element, string | ReactNull>();
  const rememberChanges = (records: MutationRecord[]) => {
    for (const record of records) {
      if (record.type === "attributes" && record.attributeName === "tabindex") {
        const target = record.target as Element;
        if (original.has(target)) {
          original.set(target, target.getAttribute("tabindex"));
        }
      }
    }
  };
  const restore = (target: Element, tabIndex: string | ReactNull) => {
    if (tabIndex == undefined) {
      target.removeAttribute("tabindex");
    } else {
      target.setAttribute("tabindex", tabIndex);
    }
  };
  const update = () => {
    // Do not record our own writes as application changes to the original tabindex.
    observer.disconnect();
    for (const [target, tabIndex] of original) {
      if (!element.contains(target)) {
        restore(target, tabIndex);
        original.delete(target);
      }
    }
    const targets = element.querySelectorAll(
      "a[href], area[href], button, input, select, textarea, iframe, object, embed, " +
        "summary, audio[controls], video[controls], [tabindex], [contenteditable]",
    );
    for (const target of targets) {
      if (!original.has(target)) {
        original.set(target, target.getAttribute("tabindex"));
      }
      target.setAttribute("tabindex", "-1");
    }
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["tabindex", "href", "contenteditable", "controls"],
    });
  };
  const observer = new MutationObserver((records) => {
    rememberChanges(records);
    update();
  });
  update();
  return () => {
    rememberChanges(observer.takeRecords());
    observer.disconnect();
    for (const [target, tabIndex] of original) {
      restore(target, tabIndex);
    }
  };
}

const Row = memo(function Row({
  index,
  style,
  data,
  retained = false,
}: ListChildComponentProps<RowData> & { retained?: boolean }) {
  const { horizontal, measure } = data;
  const item = data.items[index]!;
  const ref = useRef<HTMLDivElement>(ReactNull);
  useLayoutEffect(() => {
    data.styles.set(item.key, style);
  }, [data.styles, item.key, style]);
  useLayoutEffect(() => {
    if (retained && ref.current != undefined) {
      return excludeFromTabOrder(ref.current);
    }
    return;
  }, [retained]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element == undefined || horizontal) {
      return;
    }
    const update = () => {
      const size = element.getBoundingClientRect().height;
      if (size > 0) {
        measure(index, size);
      }
    };
    return observeSize(element, update);
  }, [horizontal, measure, index]);
  return (
    <div
      style={style}
      onPointerDownCapture={() => {
        data.pin(index);
      }}
      onFocusCapture={(event) => {
        data.pin(index);
        // A portal's focus bubbles through React, but must not scroll its hidden anchor.
        if (retained && event.currentTarget.contains(event.target)) {
          data.reveal(index);
        }
      }}
    >
      <div ref={ref} style={data.horizontal ? { height: "100%" } : undefined}>
        {item.content}
      </div>
    </div>
  );
});

// Keep an active row in the same React parent when it leaves the render window.
// Its key/type remain identical, preserving local state, focus and portalled controls.
const Inner = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function Inner(
  { children, ...props },
  ref,
) {
  const pinned = useContext(PinnedContext);
  const rows = Array.isArray(children)
    ? (children as React.ReactElement<ListChildComponentProps<RowData>>[])
    : [];
  const index = pinned?.index;
  const item = index == undefined ? undefined : pinned?.data.items[index];
  const extra =
    pinned != undefined &&
    index != undefined &&
    item != undefined &&
    !rows.some((row) => row.props.index === index) ? (
      <Row
        key={item.key}
        data={pinned.data}
        index={index}
        retained
        style={{
          ...(pinned.data.styles.get(item.key) ?? { position: "absolute", top: 0 }),
          opacity: 0,
          pointerEvents: "none",
        }}
      />
    ) : undefined;
  return (
    <div {...props} ref={ref}>
      {extra == undefined ? rows : [...rows, extra]}
    </div>
  );
});

/** The same windowing primitive supports variable-height sidebar rows and fixed-width cards. */
export function WindowedList({
  items,
  horizontal = false,
  scrollRequest,
  resetKey,
}: {
  items: WindowedItem[];
  horizontal?: boolean;
  scrollRequest?: WindowedScrollRequest;
  resetKey?: unknown;
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(ReactNull);
  const outer = useRef<HTMLDivElement>(ReactNull);
  const list = useRef<VariableSizeList<RowData>>(ReactNull);
  const sizes = useRef(new Map<string, number>());
  const styles = useRef(new Map<string, React.CSSProperties>());
  const scrollOffset = useRef(0);
  const visibleStart = useRef(0);
  const scrollTarget = useRef<number | undefined>();
  const [scrollbarHeight, setScrollbarHeight] = useState(0);
  const horizontalHeight = 50 + scrollbarHeight;
  const [bounds, setBounds] = useState({ width: 300, height: horizontal ? 50 : 600 });
  const [pinnedKey, setPinnedKey] = useState<string | undefined>();
  const indices = useMemo(() => new Map(items.map((item, index) => [item.key, index])), [items]);
  useLayoutEffect(() => {
    const element = outer.current;
    if (!horizontal || element == undefined) {
      return;
    }
    return observeSize(element, () => {
      setScrollbarHeight(Math.max(0, element.offsetHeight - element.clientHeight));
    });
  }, [horizontal]);
  useLayoutEffect(() => {
    const element = root.current;
    if (element == undefined) {
      return;
    }
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setBounds((old) =>
          old.width === rect.width && old.height === rect.height
            ? old
            : { width: rect.width, height: rect.height },
        );
      }
    };
    return observeSize(element, measure);
  }, []);
  const anchorSnapshot = useRef<{
    anchorIndex: number;
    anchorKey: string | undefined;
    withinRow: number;
    offset: number;
  }>();
  const previousMeasurement = useRef({ width: bounds.width, resetKey });
  useLayoutEffect(() => {
    const { anchorIndex = 0, anchorKey, withinRow = 0, offset = 0 } = anchorSnapshot.current ?? {};
    const committedStyles = styles.current;
    if (
      previousMeasurement.current.width !== bounds.width ||
      previousMeasurement.current.resetKey !== resetKey
    ) {
      sizes.current.clear();
    }
    previousMeasurement.current = { width: bounds.width, resetKey };
    for (const key of sizes.current.keys()) {
      if (!indices.has(key)) {
        sizes.current.delete(key);
      }
    }
    for (const key of styles.current.keys()) {
      if (!indices.has(key)) {
        styles.current.delete(key);
      }
    }
    list.current?.resetAfterIndex(0, false);
    if (anchorKey != undefined && offset > 0) {
      const nextIndex = indices.get(anchorKey) ?? Math.min(anchorIndex, items.length - 1);
      const nextAnchor = items[nextIndex];
      const nextSize =
        nextAnchor == undefined
          ? 1
          : (sizes.current.get(nextAnchor.key) ?? nextAnchor.estimatedSize);
      let nextOffset = Math.max(0, Math.min(withinRow, nextSize - 1));
      for (let index = 0; index < nextIndex; index++) {
        const item = items[index]!;
        nextOffset += sizes.current.get(item.key) ?? item.estimatedSize;
      }
      // New rows measure before react-window reports this requested scroll in its next commit.
      scrollOffset.current = Math.max(0, nextOffset);
      visibleStart.current = nextIndex;
      list.current?.scrollTo(scrollOffset.current);
    }
    list.current?.resetAfterIndex(0);
    return () => {
      // Capture the previous commit before child layout effects update styles and measurements.
      // A render-time snapshot can become stale if rendering yields while the user scrolls.
      const anchorIndex = visibleStart.current;
      const anchor = items[anchorIndex];
      const anchorStyle = anchor == undefined ? undefined : committedStyles.get(anchor.key);
      const oldPosition = horizontal ? anchorStyle?.left : anchorStyle?.top;
      const offset = scrollOffset.current;
      const withinRow = typeof oldPosition === "number" ? offset - oldPosition : 0;
      anchorSnapshot.current = { anchorIndex, anchorKey: anchor?.key, withinRow, offset };
    };
  }, [bounds.width, resetKey, indices, items, horizontal]);
  const measure = useCallback(
    (index: number, size: number) => {
      const item = items[index];
      if (item == undefined) {
        return;
      }
      const old = sizes.current.get(item.key) ?? item.estimatedSize;
      if (old === size) {
        return;
      }
      sizes.current.set(item.key, size);
      list.current?.resetAfterIndex(index);
      if (scrollTarget.current != undefined) {
        // Newly mounted rows can move a target far beyond its estimated position.
        // Keep aligning while measurements settle, until the user scrolls away.
        list.current?.scrollToItem(scrollTarget.current, "center");
      } else if (index < visibleStart.current) {
        scrollOffset.current += size - old;
        list.current?.scrollTo(scrollOffset.current);
      }
    },
    [items],
  );
  const pin = useCallback(
    (index: number) => {
      setPinnedKey(items[index]?.key);
    },
    [items],
  );
  const reveal = useCallback((index: number) => {
    // Restoring focus takes precedence over the previous hover/selection scroll request.
    scrollTarget.current = undefined;
    list.current?.scrollToItem(index, "smart");
  }, []);
  const data = useMemo<RowData>(
    () => ({ items, horizontal, measure, pin, reveal, styles: styles.current }),
    [items, horizontal, measure, pin, reveal],
  );
  const pinned = useMemo(
    () => ({ data, index: pinnedKey == undefined ? undefined : indices.get(pinnedKey) }),
    [data, indices, pinnedKey],
  );
  useLayoutEffect(() => {
    const index = scrollRequest == undefined ? undefined : indices.get(scrollRequest.key);
    scrollTarget.current = index;
    if (index != undefined) {
      list.current?.scrollToItem(index, horizontal ? "smart" : "center");
    }
  }, [scrollRequest, indices, horizontal]);
  return (
    <div
      ref={root}
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        height: horizontal ? horizontalHeight : "100%",
      }}
    >
      <PinnedContext.Provider value={pinned}>
        <VariableSizeList<RowData>
          ref={list}
          outerRef={outer}
          innerElementType={Inner}
          layout={horizontal ? "horizontal" : "vertical"}
          width={bounds.width}
          height={horizontal ? horizontalHeight : bounds.height}
          itemCount={items.length}
          itemData={data}
          itemKey={(index) => items[index]!.key}
          itemSize={(index) => sizes.current.get(items[index]!.key) ?? items[index]!.estimatedSize}
          overscanCount={3}
          onScroll={(state) => {
            if (!state.scrollUpdateWasRequested && state.scrollOffset !== scrollOffset.current) {
              scrollTarget.current = undefined;
            }
            scrollOffset.current = state.scrollOffset;
          }}
          onItemsRendered={(state) => {
            visibleStart.current = state.visibleStartIndex;
          }}
        >
          {Row}
        </VariableSizeList>
      </PinnedContext.Provider>
    </div>
  );
}
