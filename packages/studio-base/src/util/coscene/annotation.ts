// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  createLiveAnnotationService,
  type LiveSemanticSegmentationService,
} from "@foxglove/studio-base/semanticSegmentation/liveService";
import type { SegmentationDocument } from "@foxglove/studio-base/semanticSegmentation/types";
import type ConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";
import { AnnotationService } from "@foxglove/studio-base/services/api/spatial-annotation";

/**
 * Live spatial-annotation client for `coscene.dataplatform.v1alpha3.services.AnnotationService`.
 * The protocol comes from `services/api/spatial-annotation` (a local snapshot of cosceneapis
 * PR #866; its README names the commit and how to switch to the published SDK).
 *
 * Transport is the console API's gRPC-Web client (`ConsoleApi.rpcClient`), so auth, base URL and
 * the desktop session match every other record RPC. Propagation is a server stream on it.
 */
const RECORD_NAME = /^warehouses\/[^/]+\/projects\/[^/]+\/records\/[^/]+$/;

/** True for a cloud record the annotation service can address. */
export function isAnnotationRecordName(recordName: string | undefined): recordName is string {
  return recordName != undefined && RECORD_NAME.test(recordName);
}

/** The live service for a cloud record; undefined for sources it cannot address (local files). */
export function createLiveSemanticSegmentationService(args: {
  /** Undefined outside the console API provider: there is then no authenticated client. */
  consoleApi: Pick<ConsoleApi, "rpcClient"> | undefined;
  recordName: string | undefined;
  startNs: bigint;
  document: SegmentationDocument;
}): LiveSemanticSegmentationService | undefined {
  if (!isAnnotationRecordName(args.recordName) || !args.consoleApi) {
    return undefined;
  }
  return createLiveAnnotationService({
    client: args.consoleApi.rpcClient(AnnotationService),
    recordName: args.recordName,
    startNs: args.startNs,
    document: args.document,
  });
}
