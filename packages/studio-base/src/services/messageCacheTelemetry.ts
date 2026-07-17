// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { BeforeSendFn, CaptureResult, Properties } from "posthog-js";

import IAnalytics, { AppEvent } from "@foxglove/studio-base/services/IAnalytics";

const SAFE_MESSAGE_CACHE_STRING_KEYS = new Set(["metric", "kind", "status", "stage", "operation"]);

const SAFE_MESSAGE_CACHE_NUMBER_KEYS = new Set([
  "oldVersion",
  "currentVersion",
  "blockedVersion",
  "durationMs",
  "maxCacheSize",
  "usage",
  "quota",
  "usageRatio",
  "budget",
  "candidateCount",
  "succeededCount",
  "failedCount",
  "sessionCount",
  "totalBytes",
]);

const SAFE_MESSAGE_CACHE_BOOLEAN_KEYS = new Set(["writesDisabled", "interrupted"]);

// PostHog needs a small number of primitive transport and environment fields for ingestion and
// useful grouping. Objects, page data, campaign data, and SDK-added URLs are deliberately omitted.
const SAFE_POSTHOG_PRIMITIVE_KEYS = new Set([
  "token",
  "distinct_id",
  "$anon_distinct_id",
  "$device_id",
  "$user_id",
  "$session_id",
  "$window_id",
  "$lib",
  "$lib_version",
  "$insert_id",
  "$device_type",
  "$browser",
  "$browser_version",
  "$os",
  "$os_version",
  "$screen_height",
  "$screen_width",
  "$viewport_height",
  "$viewport_width",
  "$had_persisted_distinct_id",
  "$process_person_profile",
  "time",
  "platform",
  "environment",
  "os",
  "gl_vendor",
  "gl_renderer",
  "source_id",
  "speed",
  "org_id",
  "org_display_name",
]);

const MAX_SAFE_AUTOMATIC_STRING_LENGTH = 256;
const MAX_SAFE_METRIC_STRING_LENGTH = 64;
const SAFE_METRIC_STRING = /^[a-z][a-z0-9]*(?:[- ][a-z0-9]+)*$/;
const SUSPICIOUS_STRING_VALUE =
  /(?:^\s*[/[{]|(?:https?|file|blob|data):|[?&](?:x-amz-[^=]*|signature|sig|token|credential|key)=|[\r\n])/i;

function isSafePrimitive(value: unknown): value is string | number | boolean {
  switch (typeof value) {
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "string":
      return (
        value.length <= MAX_SAFE_AUTOMATIC_STRING_LENGTH && !SUSPICIOUS_STRING_VALUE.test(value)
      );
    default:
      return false;
  }
}

function isSafeMetricString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_SAFE_METRIC_STRING_LENGTH &&
    SAFE_METRIC_STRING.test(value)
  );
}

/** Restrict caller-supplied metric data so future call sites cannot accidentally send cache data. */
export function sanitizeMessageCacheMetricData(
  data: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  if (data == undefined) {
    return sanitized;
  }

  for (const [key, value] of Object.entries(data)) {
    if (SAFE_MESSAGE_CACHE_STRING_KEYS.has(key) && isSafeMetricString(value)) {
      sanitized[key] = value;
    } else if (
      SAFE_MESSAGE_CACHE_NUMBER_KEYS.has(key) &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      sanitized[key] = value;
    } else if (SAFE_MESSAGE_CACHE_BOOLEAN_KEYS.has(key) && typeof value === "boolean") {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function sanitizeMessageCacheCaptureProperties(properties: Properties): Properties {
  const sanitized: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (SAFE_POSTHOG_PRIMITIVE_KEYS.has(key) && isSafePrimitive(value)) {
      sanitized[key] = value;
    }
  }
  return Object.assign(sanitized, sanitizeMessageCacheMetricData(properties));
}

/** Fire-and-forget metrics support both synchronous and asynchronous analytics implementations. */
export function logMessageCacheMetric(
  analytics: Pick<IAnalytics, "logEvent">,
  metric: string,
  data: Readonly<Record<string, unknown>>,
): void {
  void Promise.resolve(analytics.logEvent(AppEvent.MESSAGE_CACHE, { ...data, metric })).catch(
    () => undefined,
  );
}

/** Final PostHog hook: SDK URL/referrer enrichment happens after capture() is called. */
export const sanitizeMessageCacheCaptureResult: BeforeSendFn = (result) => {
  if (!result || result.event !== AppEvent.MESSAGE_CACHE) {
    return result;
  }

  const sanitized: CaptureResult = {
    uuid: result.uuid,
    event: result.event,
    properties: sanitizeMessageCacheCaptureProperties(result.properties),
  };
  if (result.timestamp != undefined) {
    sanitized.timestamp = result.timestamp;
  }
  return sanitized;
};
