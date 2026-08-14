// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  GrowthBook,
  GrowthBookProvider as Provider,
  useFeatureValue,
} from "@growthbook/growthbook-react";
import type { JSONValue } from "@growthbook/growthbook-react";
import type { PropsWithChildren } from "react";
import { useEffect } from "react";

import Logger from "@foxglove/log";

const log = Logger.getLogger(__filename);

type GrowthBookCosConfig = {
  FEATURE_FLAG_GROWTHBOOK?: Record<string, JSONValue>;
  GROWTHBOOK_API_HOST?: string;
  GROWTHBOOK_CLIENT_KEY?: string;
  GROWTHBOOK_ENABLED?: boolean;
};

export type GrowthBookRuntimeConfig = {
  apiHost: string;
  clientKey: string;
  enabled: boolean;
  fallbackValues: Record<string, JSONValue>;
};

export function readGrowthBookRuntimeConfig(): GrowthBookRuntimeConfig {
  const cosConfig = (
    typeof window === "undefined" ? {} : (window.cosConfig ?? {})
  ) as GrowthBookCosConfig;
  const fallbackValues = cosConfig.FEATURE_FLAG_GROWTHBOOK;

  return {
    apiHost: cosConfig.GROWTHBOOK_API_HOST?.trim() ?? "",
    clientKey: cosConfig.GROWTHBOOK_CLIENT_KEY?.trim() ?? "",
    enabled: cosConfig.GROWTHBOOK_ENABLED === true,
    fallbackValues:
      fallbackValues != undefined &&
      typeof fallbackValues === "object" &&
      !Array.isArray(fallbackValues)
        ? fallbackValues
        : {},
  };
}

function hasValidApiHost(apiHost: string): boolean {
  try {
    const protocol = new URL(apiHost).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function canInitializeRemotely(config: GrowthBookRuntimeConfig): boolean {
  return config.enabled && config.clientKey.length > 0 && hasValidApiHost(config.apiHost);
}

export function createGrowthBookClient(config: GrowthBookRuntimeConfig): GrowthBook {
  const features = Object.fromEntries(
    Object.entries(config.fallbackValues).map(([key, defaultValue]) => [key, { defaultValue }]),
  );

  return new GrowthBook({
    apiHost: config.apiHost,
    clientKey: config.clientKey,
    features,
    streamingHost: config.apiHost,
  });
}

export async function initializeGrowthBookClient(
  growthbook: GrowthBook,
  config: GrowthBookRuntimeConfig,
): Promise<void> {
  if (!canInitializeRemotely(config)) {
    return;
  }

  try {
    const result = await growthbook.init({ streaming: true });
    if (!result.success) {
      log.warn("Failed to initialize GrowthBook; using local feature flag fallbacks", result.error);
    }
  } catch (error) {
    log.warn("Failed to initialize GrowthBook; using local feature flag fallbacks", error);
  }
}

let growthBookClient: GrowthBook | undefined;
let growthBookRuntimeConfig: GrowthBookRuntimeConfig | undefined;
let initializationStarted = false;

export function getGrowthBookClient(): GrowthBook {
  if (growthBookClient == undefined) {
    growthBookRuntimeConfig = readGrowthBookRuntimeConfig();
    growthBookClient = createGrowthBookClient(growthBookRuntimeConfig);
  }
  return growthBookClient;
}

export function GrowthBookProvider({ children }: PropsWithChildren): React.JSX.Element {
  const growthbook = getGrowthBookClient();

  useEffect(() => {
    if (!initializationStarted && growthBookRuntimeConfig != undefined) {
      initializationStarted = true;
      void initializeGrowthBookClient(growthbook, growthBookRuntimeConfig);
    }
  }, [growthbook]);

  return <Provider growthbook={growthbook}>{children}</Provider>;
}

function getConfiguredFallback<T extends JSONValue>(featureKey: string, fallback: T): T {
  const fallbackValues = readGrowthBookRuntimeConfig().fallbackValues;
  return (Object.hasOwn(fallbackValues, featureKey) ? fallbackValues[featureKey] : fallback) as T;
}

// Feature flags control client presentation and rollout only. They are not an authorization boundary.
export function useFeatureIsOnWithConfig(
  featureKey: string,
  options: { fallback?: boolean } = {},
): boolean {
  const fallback = options.fallback ?? false;
  const localFallback = getConfiguredFallback(featureKey, fallback);
  return useFeatureValue<JSONValue>(featureKey, localFallback) === true;
}

export function useFeatureValueWithConfig<T extends JSONValue>(featureKey: string, fallback: T): T {
  const localFallback = getConfiguredFallback(featureKey, fallback);
  return useFeatureValue(featureKey, localFallback) as T;
}
