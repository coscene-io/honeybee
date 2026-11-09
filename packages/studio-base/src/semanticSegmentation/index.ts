// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export * from "./types";
export { frameInstanceKey } from "./service";
export type { SemanticSegmentationService } from "./service";
export {
  createMockSemanticSegmentationService,
  createSeedDocument,
  GPU_IDLE_TIMEOUT_MS,
  MEDIA_CACHE_LIMIT_BYTES,
} from "./mockService";
export type { MockSemanticSegmentationService } from "./mockService";
export { createSemanticSegmentationStore } from "./store";
