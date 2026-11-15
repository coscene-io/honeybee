// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createStore } from "zustand/vanilla";

/**
 * Where annotations of a cloud record are read and saved.
 * - `live`: the published AnnotationService (only for a cloud record).
 * - `local`: this browser (the mock service), for work without the backend.
 * The choice is per browser and only changes the next annotation session.
 */
export type AnnotationBackendMode = "live" | "local";

const STORAGE_KEY = "coStudio.semanticSegmentation.backend";

function readMode(): AnnotationBackendMode {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY) === "local" ? "local" : "live";
  } catch {
    return "live";
  }
}

export const annotationBackend = createStore<{
  mode: AnnotationBackendMode;
  /** Open cloud record, published by mounted image panels for the app bar. */
  recordName: string | undefined;
  setMode: (mode: AnnotationBackendMode) => void;
}>((set) => ({
  mode: readMode(),
  recordName: undefined,
  setMode: (mode) => {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage may be disabled; the choice still applies to this page.
    }
    set({ mode });
  },
}));

/** What actually backs the open session; shown in the app bar. */
export type ActiveAnnotationBackend =
  | { kind: "live"; recordName: string }
  | { kind: "local"; reason: "chosen" | "no-cloud-record" };
