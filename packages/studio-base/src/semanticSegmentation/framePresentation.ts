// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { FramePresentationRequest, FramePresenter } from "./types";

/** Safety deadline for a missing decoder/render event, never evidence of presentation. */
export const FRAME_PRESENTATION_TIMEOUT_MS = 10000;

export async function waitForFramePresentation(
  presenter: FramePresenter,
  request: FramePresentationRequest,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (status: "completed" | "failed", error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      if (status === "failed") {
        reject(error instanceof Error ? error : new Error(String(error)));
      } else {
        resolve();
      }
    };
    const abort = () => {
      finish("failed", request.signal.reason ?? new Error("Frame presentation cancelled"));
    };
    const timer = setTimeout(() => {
      finish(
        "failed",
        new Error(
          `Frame ${request.frame.id} presentation timed out; reopen the Image Panel and retry propagation. Accepted results remain drafts.`,
        ),
      );
    }, FRAME_PRESENTATION_TIMEOUT_MS);
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) {
      abort();
    } else {
      void Promise.resolve()
        .then(async () => {
          if (!request.signal.aborted) {
            await presenter(request);
          }
        })
        .then(
          () => {
            finish("completed");
          },
          (error: unknown) => {
            finish("failed", error);
          },
        );
    }
  });
}
