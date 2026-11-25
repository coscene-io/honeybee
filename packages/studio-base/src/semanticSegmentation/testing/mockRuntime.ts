// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  createSegmentationRuntime,
  type SegmentationRuntime,
  type SegmentationRuntimeOptions,
} from "../runtime";
import type { SegmentationDocument } from "../types";
import { createMockSemanticSegmentationService } from "./mockService";

/** A runtime over the in-memory mock service, with the mock's default latency. Tests only. */
export function createMockSegmentationRuntime(
  document?: SegmentationDocument,
  options?: SegmentationRuntimeOptions,
  /** Adjusts the service before the runtime is built: the runtime takes its methods then. */
  prepare?: (service: ReturnType<typeof createMockSemanticSegmentationService>) => void,
): SegmentationRuntime {
  const service = createMockSemanticSegmentationService({
    document,
    controls: { delayMs: 500, streamDelayMs: 350 },
  });
  prepare?.(service);
  return createSegmentationRuntime(service, document, options);
}
