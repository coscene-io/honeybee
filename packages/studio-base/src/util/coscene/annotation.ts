// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  annotationBackend,
  type ActiveAnnotationBackend,
} from "@foxglove/studio-base/semanticSegmentation/annotationBackend";
import {
  createLiveAnnotationService,
  type LiveSemanticSegmentationService,
} from "@foxglove/studio-base/semanticSegmentation/liveService";
import type { SegmentationDocument } from "@foxglove/studio-base/semanticSegmentation/types";
import { AnnotationService } from "@foxglove/studio-base/services/api/spatial-annotation/generated/coscene/dataplatform/v1alpha3/services/annotation_pb";

import { getPromiseClient } from "./index";

/**
 * Live spatial-annotation client for `coscene.dataplatform.v1alpha3.services.AnnotationService`
 * (cosceneapis PR #866 at 96015385a). The generated code is a local snapshot under
 * `services/api/spatial-annotation/generated` until a published `@coscene-io/cosceneapis-es-v2`
 * contains it; see the README there.
 *
 * Transport is Honeybee's gRPC-Web client (`getPromiseClient`), so auth and base URL match every
 * other record RPC. Propagation is a gRPC-Web server stream on the same client.
 */
const RECORD_NAME = /^warehouses\/[^/]+\/projects\/[^/]+\/records\/[^/]+$/;

/** True for a cloud record the annotation service can address. */
export function isAnnotationRecordName(recordName: string | undefined): recordName is string {
  return recordName != undefined && RECORD_NAME.test(recordName);
}

/** Which backend a session for this record would use now. */
export function resolveAnnotationBackend(recordName: string | undefined): ActiveAnnotationBackend {
  if (!isAnnotationRecordName(recordName)) {
    return { kind: "local", reason: "no-cloud-record" };
  }
  return annotationBackend.getState().mode === "live"
    ? { kind: "live", recordName }
    : { kind: "local", reason: "chosen" };
}

/**
 * The live service for a cloud record, or undefined when the session should stay in this
 * browser (a local file, or the user switched to 本机标注).
 */
export function createLiveSemanticSegmentationService(args: {
  recordName: string | undefined;
  startNs: bigint;
  document: SegmentationDocument;
}): LiveSemanticSegmentationService | undefined {
  const backend = resolveAnnotationBackend(args.recordName);
  if (backend.kind !== "live") {
    return undefined;
  }
  return createLiveAnnotationService({
    client: getPromiseClient(AnnotationService),
    recordName: backend.recordName,
    startNs: args.startNs,
    document: args.document,
  });
}
