// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createClient } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";

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
 * Local propagation sidecar (tools/seg-local-propagation). Opt in per browser:
 * `localStorage.setItem("coStudio.semanticSegmentation.propagationUrl", "http://127.0.0.1:18876")`.
 * No credentials are sent to it.
 */
export const PROPAGATION_URL_KEY = "coStudio.semanticSegmentation.propagationUrl";

/**
 * Quick annotation (click-to-mask) on the same sidecar, without routing propagation there:
 * `localStorage.setItem("coStudio.semanticSegmentation.segmentUrl", "http://127.0.0.1:18876")`.
 * When unset, quick annotation follows the propagation URL.
 */
export const SEGMENT_URL_KEY = "coStudio.semanticSegmentation.segmentUrl";

function loopbackUrl(key: string): string | undefined {
  try {
    const url = globalThis.localStorage.getItem(key)?.trim();
    return url != undefined && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)
      ? url.replace(/\/$/, "")
      : undefined;
  } catch {
    return undefined;
  }
}

export function localPropagationUrl(): string | undefined {
  return loopbackUrl(PROPAGATION_URL_KEY);
}

export function localSegmentUrl(): string | undefined {
  return loopbackUrl(SEGMENT_URL_KEY) ?? localPropagationUrl();
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
  const propagationUrl = localPropagationUrl();
  return createLiveAnnotationService({
    client: getPromiseClient(AnnotationService),
    ...(propagationUrl
      ? {
          propagationClient: createClient(
            AnnotationService,
            createGrpcWebTransport({ baseUrl: propagationUrl }),
          ),
        }
      : {}),
    recordName: backend.recordName,
    startNs: args.startNs,
    document: args.document,
  });
}
