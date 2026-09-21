// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useLayoutEffect, useRef, useState } from "react";

import type { WindowedScrollRequest } from "./WindowedList";

/** Match per-row scroll effects: only changed active rows scroll; a stale selection must not
 * override a newly hovered row. The last changed row in display order wins, as before. */
export function useMomentScrollTarget({
  selected,
  hovered,
  order,
  disabled = false,
}: {
  selected: string | undefined;
  hovered: ReadonlySet<string>;
  order: ReadonlyMap<string, number>;
  disabled?: boolean;
}): WindowedScrollRequest | undefined {
  const previous = useRef<{
    selected: string | undefined;
    hovered: ReadonlySet<string>;
    order: ReadonlyMap<string, number>;
    disabled: boolean;
  }>();
  const [target, setTarget] = useState<WindowedScrollRequest | undefined>();
  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = { selected, hovered, order, disabled };
    if (disabled) {
      setTarget(undefined);
      return;
    }
    const changed = new Set<string>();
    const all = new Set([...hovered, ...(old?.hovered ?? [])]);
    if (selected != undefined) {
      all.add(selected);
    }
    if (old?.selected != undefined) {
      all.add(old.selected);
    }
    const reset = old == undefined || old.disabled;
    for (const name of all) {
      if (
        reset ||
        (name === selected) !== (name === old.selected) ||
        hovered.has(name) !== old.hovered.has(name) ||
        (!old.order.has(name) && order.has(name))
      ) {
        changed.add(name);
      }
    }
    if (changed.size === 0) {
      // Replacing or reordering existing rows does not reactivate them. Only retire
      // a request whose row disappeared; keep the latest hover ahead of stale selection.
      setTarget((current) =>
        current != undefined && !order.has(current.key) ? undefined : current,
      );
      return;
    }
    let next: string | undefined;
    for (const name of changed) {
      if (
        (name === selected || hovered.has(name)) &&
        order.has(name) &&
        (next == undefined || order.get(name)! > order.get(next)!)
      ) {
        next = name;
      }
    }
    // A changed active state can request the same row again after a manual scroll.
    setTarget(next == undefined ? undefined : { key: next });
  }, [selected, hovered, order, disabled]);
  return target;
}
