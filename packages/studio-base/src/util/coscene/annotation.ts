// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SemanticSegmentationService } from "@foxglove/studio-base/semanticSegmentation/service";

/**
 * Live spatial-annotation client.
 *
 * No published `@coscene-io/cosceneapis-es-v2` exports the annotation service.
 * Honeybee is on 0.0.458. The newest release, 0.0.488, and the only branch
 * builds (colink, subscription) do not contain
 * `coscene/dataplatform/v1alpha3/services/annotation`. That contract is draft
 * https://github.com/coscene-io/cosceneapis/pull/866 on `feat/spatial-annotation-api`.
 * It is not merged and this client does not claim it is deployed.
 * https://github.com/coscene-io/cosceneapis/pull/867 is already merged into that
 * feature branch; do not reopen, revert, or re-merge it.
 *
 * When a published package exports the generated service, construct it here
 * with `getPromiseClient` from `./index` and adapt the responses onto
 * `SemanticSegmentationService`:
 *
 *   import { AnnotationService } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/services/annotation_pb";
 *   getPromiseClient(AnnotationService)
 *
 * Until that import exists, this returns undefined. Callers must not substitute
 * the mock service and report the result as a live read or save.
 */
export function createLiveSemanticSegmentationService(): SemanticSegmentationService | undefined {
  return undefined;
}
