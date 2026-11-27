// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SegmentationService } from "./service";
import type { SegmentationDocument, SegmentationStore } from "./types";

/**
 * What the store shares with the parts split out of it (the submission queue and propagation).
 * One instance per store; every accessor reads the store's current state.
 */
export type StoreInternals = {
  service: SegmentationService;
  get: () => SegmentationStore;
  set: (partial: Partial<SegmentationStore>) => void;
  subscribe: (listener: () => void) => () => void;
  isDisposed: () => boolean;
  /** The authoritative server state: the last document read, saves and loaded windows. */
  base: () => SegmentationDocument | undefined;
  setBase: (document: SegmentationDocument) => void;
  /** Frames whose geometry window has been read. */
  loadedFrames: Set<string>;
  /** Changes when initialize replaces the record context; reads and runs from before are void. */
  documentEpoch: () => number;
  /** Acknowledged saves so far. A read notes it when it starts; see `savedAfter`. */
  saveSeq: () => number;
  /** Keys a save rewrote after `seq`: a read that started at `seq` holds pre-save values there. */
  savedAfter: (seq: number) => (key: string) => boolean;
  /** Record one acknowledged save and the annotation keys it rewrote. */
  recordSave: (keys: Iterable<string>) => void;
  /** Read the current server state before removing a failed batch's optimistic overlay. */
  reconcileFailedSubmission: () => Promise<boolean>;
  /** Publish base + queued + staged operations as the document. */
  rebuild: () => void;
  /** Selection, focus and drawing that survive `document`. */
  prunedRefs: (document: SegmentationDocument) => Partial<SegmentationStore>;
  clearRedo: () => void;
  assertEditable: () => void;
  /** The published document; throws before initialize. */
  document: () => SegmentationDocument;
  inTransaction: () => boolean;
};
