// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useRef, useState } from "react";

/**
 * A function with a stable identity that always calls the latest closure. Handlers that read
 * fresh state on every render can be handed to memoized children without breaking their memo.
 */
export function useStableCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: Args) => latest.current(...args), []);
}

type AnyFunction = (...args: never[]) => unknown;

/**
 * An object of handlers with a stable identity (and stable members) that always call the latest
 * closures. The set of keys is fixed by the first render.
 */
export function useStableActions<T extends Record<string, AnyFunction>>(actions: T): T {
  const latest = useRef(actions);
  latest.current = actions;
  const [stable] = useState(
    () =>
      Object.fromEntries(
        Object.keys(actions).map((key) => [
          key,
          (...args: never[]) => latest.current[key]!(...args),
        ]),
      ) as T,
  );
  return stable;
}
