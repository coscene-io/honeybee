// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { BeforeSendFn, CaptureResult, Properties } from "posthog-js";

import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";

const SAFE_MESSAGE_CACHE_METRIC_KEYS = new Set([
  "metric",
  "kind",
  "status",
  "stage",
  "operation",
  "oldVersion",
  "currentVersion",
  "blockedVersion",
  "durationMs",
  "maxCacheSize",
  "writesDisabled",
  "usage",
  "quota",
  "usageRatio",
  "budget",
  "candidateCount",
  "succeededCount",
  "failedCount",
  "interrupted",
  "sessionCount",
  "totalBytes",
]);

const SENSITIVE_AUTOMATIC_PROPERTY =
  /(?:url|referr|pathname|(?:^|_)host$|(?:^|_)utm_|campaign|gclid|gad_source|gclsrc|dclid|gbraid|wbraid|fbclid|msclkid|twclid|li_fat_id|mc_cid|igshid|ttclid|rdt_cid|source_?key|(?:^|_)topic(?:_|$)|(?:^|_)message(?:_|$))/i;

/** Restrict caller-supplied metric data so future call sites cannot accidentally send cache data. */
export function sanitizeMessageCacheMetricData(
  data: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  if (!data) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => SAFE_MESSAGE_CACHE_METRIC_KEYS.has(key)),
  );
}

function removeSensitiveAutomaticProperties(properties: Properties): Properties {
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([key]) => !SENSITIVE_AUTOMATIC_PROPERTY.test(key.replaceAll("$", "")),
    ),
  );
}

/** Final PostHog hook: SDK URL/referrer enrichment happens after capture() is called. */
export const sanitizeMessageCacheCaptureResult: BeforeSendFn = (result) => {
  if (!result || result.event !== AppEvent.MESSAGE_CACHE) {
    return result;
  }

  const sanitized: CaptureResult = {
    ...result,
    properties: removeSensitiveAutomaticProperties(result.properties),
  };
  // Identified-person defaults can contain the initial URL/referrer as nested values. Cache
  // health metrics do not need person mutations, so omit both maps for this event entirely.
  delete sanitized.$set;
  delete sanitized.$set_once;
  return sanitized;
};
