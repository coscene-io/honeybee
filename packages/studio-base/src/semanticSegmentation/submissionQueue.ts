// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { v4 as uuidv4 } from "uuid";

import { SegmentationError, segmentationErrorText } from "./errors";
import { cloneSegmentation, patchAnnotationKeys } from "./service";
import type { StoreInternals } from "./storeInternals";
import type { SemanticSegmentationStore, SubmissionBatch } from "./types";

/** Acknowledged batches listed for feedback. */
const KEPT_SUCCEEDED_BATCHES = 5;

/**
 * The store's submission queue. Batches are saved one at a time, in order. A failed batch holds
 * every batch after it: they may build on it (an instance it creates), and saving them first
 * would write over what it should have saved.
 */
export function createSubmissionQueue(
  context: StoreInternals,
): Pick<
  SemanticSegmentationStore,
  "submit" | "waitForSubmissions" | "retrySubmission" | "discardSubmission"
> {
  const { service, get, set, isDisposed, rebuild, assertEditable } = context;
  let pumpPromise: Promise<void> | undefined;
  function updateBatch(id: string, changes: Partial<SubmissionBatch>) {
    set({
      submissionQueue: get().submissionQueue.map((batch) =>
        batch.id === id ? { ...batch, ...changes } : batch,
      ),
    });
  }
  /**
   * Batches are sent in order. A failed batch holds every batch after it: they may build on it
   * (an instance it creates), and saving them first would write over what it should have saved.
   */
  function nextBatch(): SubmissionBatch | undefined {
    const batch = get().submissionQueue.find((item) => item.status !== "succeeded");
    return batch?.status === "queued" ? batch : undefined;
  }
  /** Acknowledged batches stay listed for feedback, the most recent few only. */
  function withoutOldSuccesses(queue: SubmissionBatch[]): SubmissionBatch[] {
    let kept = 0;
    return queue
      .reduceRight<SubmissionBatch[]>((result, batch) => {
        if (batch.status !== "succeeded" || ++kept <= KEPT_SUCCEEDED_BATCHES) {
          result.push(batch);
        }
        return result;
      }, [])
      .reverse();
  }
  async function pump() {
    for (;;) {
      const batch = nextBatch();
      if (!batch || isDisposed() || !context.base()) {
        return;
      }
      updateBatch(batch.id, { status: "submitting" });
      try {
        const result = await service.submit({
          id: batch.id,
          message: batch.message,
          operations: batch.operations,
        });
        if (isDisposed()) {
          return;
        }
        const before = context.base() ?? result.document;
        context.recordSave(
          batch.operations.flatMap((operation) => patchAnnotationKeys(before, operation.patch)),
        );
        context.setBase(cloneSegmentation(result.document));
        updateBatch(batch.id, { status: "succeeded", error: undefined });
        set({ submissionQueue: withoutOldSuccesses(get().submissionQueue) });
        if (result.warning) {
          set({ error: result.warning });
        }
      } catch (error) {
        if (isDisposed()) {
          return;
        }
        updateBatch(batch.id, { status: "failed", error: segmentationErrorText(error) });
        set({ error: segmentationErrorText(error) });
      }
      rebuild();
    }
  }
  function startPump() {
    if (pumpPromise) {
      return;
    }
    const completion: Promise<void> = Promise.resolve()
      .then(pump)
      .finally(() => {
        if (pumpPromise === completion) {
          pumpPromise = undefined;
          if (!isDisposed() && nextBatch()) {
            startPump();
          }
        }
      });
    pumpPromise = completion;
  }
  return {
    // No message: the queue shows the localized default (`defaultBatchMessage`). Local only.
    submit(commitMessage = "") {
      if (context.inTransaction()) {
        throw new SegmentationError("errorSubmitDuringCommand");
      }
      assertEditable();
      context.clearRedo();
      set({ canRedo: false });
      if (get().stagedOperations.length === 0) {
        return undefined;
      }
      const id = uuidv4();
      set({
        submissionQueue: [
          ...get().submissionQueue,
          {
            id,
            message: commitMessage,
            // Staged operations are immutable, so the queue can take them as they are.
            operations: get().stagedOperations,
            status: "queued",
          },
        ],
        stagedOperations: [],
        editing: false,
        drawing: undefined,
      });
      startPump();
      return id;
    },
    async waitForSubmissions() {
      while (pumpPromise) {
        await pumpPromise;
      }
    },
    retrySubmission(id) {
      assertEditable();
      const batch = get().submissionQueue.find((item) => item.id === id);
      if (batch?.status !== "failed") {
        throw new SegmentationError("errorRetryNotFailed");
      }
      updateBatch(id, { status: "queued", error: undefined });
      startPump();
    },
    discardSubmission(id) {
      assertEditable();
      const queue = get().submissionQueue;
      const index = queue.findIndex((item) => item.id === id);
      if (queue[index]?.status !== "failed") {
        throw new SegmentationError("errorDiscardNotFailed");
      }
      // The batches after it were never sent and may build on it. They return to staging, ahead
      // of newer edits, to be reviewed (or undone) and submitted again.
      const unsent = queue.slice(index + 1).flatMap((batch) => batch.operations);
      context.clearRedo();
      set({
        submissionQueue: queue.slice(0, index),
        stagedOperations: [...unsent, ...get().stagedOperations],
        canRedo: false,
        editing: false,
        drawing: undefined,
        error: undefined,
      });
      rebuild();
    },
  };
}
