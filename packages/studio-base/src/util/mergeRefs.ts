// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Ref, RefCallback } from "react";

/** Preserve React 19 callback-ref cleanups when attaching multiple refs to one node. */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (value) => {
    const cleanups = refs.map((ref) => {
      if (typeof ref === "function") {
        const cleanup = ref(value);
        return typeof cleanup === "function" ? cleanup : () => ref(ReactNull);
      }
      if (ref != undefined) {
        ref.current = value;
        return () => {
          ref.current = ReactNull;
        };
      }
      return undefined;
    });
    if (value == undefined) {
      return;
    }
    return () => {
      // Release every owner, including when another owner's cleanup throws.
      const errors: unknown[] = [];
      for (const cleanup of cleanups) {
        try {
          cleanup?.();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "Failed to clean up merged refs");
      }
    };
  };
}
