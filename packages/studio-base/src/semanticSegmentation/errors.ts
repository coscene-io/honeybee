// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import i18next from "i18next";

import { segmentation as en } from "@foxglove/studio-base/i18n/en/segmentation";

/**
 * Errors the editor shows carry a code, not copy. The code is a key of the `segmentation` i18n
 * namespace (`error…` for failures, `unreadable…` for observations the editor cannot show,
 * `violation…` for polygon contract rules); the UI maps it to the active language.
 */
export type SegmentationTextCode = Extract<
  keyof typeof en,
  `error${string}` | `unreadable${string}` | `violation${string}` | `rpcReason${string}`
>;
/** An operation label shown in the staged list and the submission queue. */
export type OperationLabelKey = Extract<keyof typeof en, `opLabel${string}`>;
export type SegmentationErrorCode = Extract<SegmentationTextCode, `error${string}`>;
export type SegmentationTextParams = Record<string, string | number>;

function interpolate(template: string, params: SegmentationTextParams): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) =>
    params[name] == undefined ? "" : String(params[name]),
  );
}

/** The English copy for `code`: the message of a thrown SegmentationError, for logs and tests. */
export function englishSegmentationText(
  code: SegmentationTextCode,
  params: SegmentationTextParams = {},
): string {
  if (i18next.isInitialized) {
    return i18next.getFixedT("en", "segmentation")(code, params);
  }
  // Before i18n is initialized (module load, workers) the resource is filled in here.
  return interpolate(en[code], params);
}

/** The copy for `code` in the active language; English before i18n is initialized. */
export function segmentationText(
  code: SegmentationTextCode,
  params: SegmentationTextParams = {},
): string {
  if (i18next.isInitialized && i18next.exists(`segmentation:${code}`)) {
    return i18next.t(`segmentation:${code}`, params);
  }
  return englishSegmentationText(code, params);
}

/** A failure the editor reports to the user. `message` is English; show `segmentationErrorText`. */
export class SegmentationError extends Error {
  public override readonly name = "SegmentationError";
  public constructor(
    public readonly code: SegmentationErrorCode,
    public readonly params: SegmentationTextParams = {},
    options?: { cause?: unknown },
  ) {
    super(englishSegmentationText(code, params), options);
  }
}

/** What an AnnotationService call was doing, when it is not a plain read or save. */
export type AnnotationRpcOperation = "quickAnnotation" | "propagation";

/** A failed AnnotationService call, with the canonical gRPC code name (e.g. `FAILED_PRECONDITION`). */
export class AnnotationRpcError extends Error {
  public override readonly name = "AnnotationRpcError";
  /** The server's own message, without the code. */
  public readonly detail: string;
  public readonly operation?: AnnotationRpcOperation;
  public constructor(
    public readonly rpcCode: string,
    message: string,
    options?: { cause?: unknown; detail?: string; operation?: AnnotationRpcOperation },
  ) {
    super(message, options);
    this.detail = options?.detail ?? message;
    this.operation = options?.operation;
  }
}

const RPC_REASONS: Record<string, SegmentationTextCode> = {
  ABORTED: "rpcReasonAborted",
  ALREADY_EXISTS: "rpcReasonAlreadyExists",
  DEADLINE_EXCEEDED: "rpcReasonDeadlineExceeded",
  FAILED_PRECONDITION: "rpcReasonFailedPrecondition",
  INTERNAL: "rpcReasonInternal",
  INVALID_ARGUMENT: "rpcReasonInvalidArgument",
  NOT_FOUND: "rpcReasonNotFound",
  PERMISSION_DENIED: "rpcReasonPermissionDenied",
  RESOURCE_EXHAUSTED: "rpcReasonResourceExhausted",
  UNAUTHENTICATED: "rpcReasonUnauthenticated",
  UNAVAILABLE: "rpcReasonUnavailable",
  UNIMPLEMENTED: "rpcReasonUnimplemented",
};

const RPC_OPERATIONS: Record<AnnotationRpcOperation, SegmentationErrorCode> = {
  quickAnnotation: "errorRpcQuickAnnotation",
  propagation: "errorRpcPropagation",
};

/** An AnnotationService failure as user-facing copy: reason by code, then the server's detail. */
export function annotationRpcErrorText(error: AnnotationRpcError): string {
  const params = {
    code: error.rpcCode,
    reason: segmentationText(RPC_REASONS[error.rpcCode] ?? "rpcReasonUnknown"),
    detail: error.detail,
  };
  return segmentationText(error.operation ? RPC_OPERATIONS[error.operation] : "errorRpc", params);
}

/** Any error as the text the editor shows, in the active language when it carries a code. */
export function segmentationErrorText(error: unknown): string {
  if (error instanceof SegmentationError) {
    return segmentationText(error.code, error.params);
  }
  if (error instanceof AnnotationRpcError) {
    return annotationRpcErrorText(error);
  }
  return error instanceof Error ? error.message : String(error);
}
