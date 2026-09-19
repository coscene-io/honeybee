// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/** Coalesce visual previews, while allowing pointerup to synchronously consume the final input. */
export function frameInput<T>(apply: (input: T) => void): {
  schedule: (input: T) => void;
  flush: (last?: T) => void;
  cancel: () => void;
} {
  let frame: number | undefined;
  let pending: T | undefined;
  const cancel = () => {
    if (frame != undefined) {
      cancelAnimationFrame(frame);
    }
    frame = undefined;
    pending = undefined;
  };
  const flush = (last?: T) => {
    const input = last ?? pending;
    cancel();
    if (input != undefined) {
      apply(input);
    }
  };
  return {
    schedule(input: T) {
      pending = input;
      frame ??= requestAnimationFrame(() => {
        flush();
      });
    },
    flush,
    cancel,
  };
}
