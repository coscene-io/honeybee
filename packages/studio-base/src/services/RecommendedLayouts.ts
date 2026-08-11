// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  MAX_SUPPORTED_LAYOUT_VERSION,
  type LayoutID,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import type { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import { COMPRESSED_VIDEO_DATATYPES } from "@foxglove/studio-base/panels/ThreeDeeRender/foxglove";
import { migratePanelsState } from "@foxglove/studio-base/services/migrateLayout";

export const RECOMMENDED_LAYOUT_MANIFEST_URL =
  "https://honeybee-public-layouts.coscene.io/manifest.json";

const RECOMMENDED_LAYOUT_ORIGIN = new URL(RECOMMENDED_LAYOUT_MANIFEST_URL).origin;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_CACHED_LAYOUTS = 32;

export type RecommendedLayoutTransport = "default" | "h264";

type WorkflowResolution = Record<string, Record<string, string>>;

type RobotManifest = {
  resolution?: Record<string, Partial<Record<RecommendedLayoutTransport, WorkflowResolution>>>;
};

export type RecommendedLayoutManifest = {
  generated_at?: string;
  robots: Record<string, RobotManifest>;
};

export type RecommendedLayoutDescriptor = {
  id: LayoutID;
  robot: string;
  resolution: string;
  transport: RecommendedLayoutTransport;
  workflow: string;
  role: string;
  name: string;
  url: string;
  generatedAt?: string;
};

let manifestPromise: Promise<RecommendedLayoutManifest> | undefined;
const layoutPromises = new Map<string, Promise<LayoutData>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != undefined && !Array.isArray(value);
}

function createStringMap<T>(): Record<string, T> {
  // eslint-disable-next-line no-restricted-syntax -- Remote manifest keys must not access Object.prototype.
  return Object.create(null) as Record<string, T>;
}

function isPanelConfigMap(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isRecord);
}

function isUserScriptMap(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (script) =>
        isRecord(script) &&
        typeof script.name === "string" &&
        typeof script.sourceCode === "string",
    )
  );
}

function isMosaicLayout(value: unknown): boolean {
  if (value == undefined) {
    return true;
  }

  const nodes: unknown[] = [value];
  while (nodes.length > 0) {
    const node = nodes.pop();
    if (typeof node === "string") {
      continue;
    }
    if (
      !isRecord(node) ||
      (node.direction !== "row" && node.direction !== "column") ||
      !("first" in node) ||
      !("second" in node) ||
      (typeof node.splitPercentage !== "undefined" &&
        (typeof node.splitPercentage !== "number" || !Number.isFinite(node.splitPercentage)))
    ) {
      return false;
    }
    nodes.push(node.first, node.second);
  }
  return true;
}

function parseWorkflowResolution(value: unknown): WorkflowResolution | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const result = createStringMap<Record<string, string>>();
  for (const [workflow, rolesValue] of Object.entries(value)) {
    const roles = createStringMap<string>();
    if (isRecord(rolesValue)) {
      for (const [role, path] of Object.entries(rolesValue)) {
        if (typeof path === "string" && path.length > 0) {
          roles[role] = path;
        }
      }
    }
    result[workflow] = roles;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function parseRecommendedLayoutManifest(value: unknown): RecommendedLayoutManifest {
  if (!isRecord(value) || !isRecord(value.robots)) {
    throw new Error("Recommended layout manifest is invalid");
  }

  const robots = createStringMap<RobotManifest>();
  for (const [robotName, robotValue] of Object.entries(value.robots)) {
    if (!isRecord(robotValue) || !isRecord(robotValue.resolution)) {
      continue;
    }

    const resolutions =
      createStringMap<Partial<Record<RecommendedLayoutTransport, WorkflowResolution>>>();
    for (const [resolutionName, resolutionValue] of Object.entries(robotValue.resolution)) {
      if (!isRecord(resolutionValue)) {
        continue;
      }
      const transports: Partial<Record<RecommendedLayoutTransport, WorkflowResolution>> = {};
      const defaultResolution = parseWorkflowResolution(resolutionValue.default);
      const h264Resolution = parseWorkflowResolution(resolutionValue.h264);
      if (defaultResolution) {
        transports.default = defaultResolution;
      }
      if (h264Resolution) {
        transports.h264 = h264Resolution;
      }
      if (Object.keys(transports).length > 0) {
        resolutions[resolutionName] = transports;
      }
    }

    if (Object.keys(resolutions).length > 0) {
      robots[robotName] = { resolution: resolutions };
    }
  }

  return {
    robots,
    ...(typeof value.generated_at === "string" ? { generated_at: value.generated_at } : {}),
  };
}

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("Recommended layout response is too large");
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return text + decoder.decode();
      }
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Recommended layout response is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const resolvedUrl = new URL(url, RECOMMENDED_LAYOUT_MANIFEST_URL);
  if (resolvedUrl.origin !== RECOMMENDED_LAYOUT_ORIGIN) {
    throw new Error("Recommended layout URL must use the manifest origin");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(resolvedUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Recommended layout request failed (${response.status})`);
    }
    if (response.url && new URL(response.url).origin !== RECOMMENDED_LAYOUT_ORIGIN) {
      throw new Error("Recommended layout response must use the manifest origin");
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new Error("Recommended layout response is too large");
    }
    return JSON.parse(await readResponseText(response)) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadRecommendedLayoutManifest(): Promise<RecommendedLayoutManifest> {
  manifestPromise ??= fetchJson(RECOMMENDED_LAYOUT_MANIFEST_URL)
    .then(parseRecommendedLayoutManifest)
    .catch((error: unknown) => {
      manifestPromise = undefined;
      throw error;
    });
  return await manifestPromise;
}

function parseLayoutData(value: unknown): LayoutData {
  if (
    !isRecord(value) ||
    !isPanelConfigMap(value.configById ?? value.savedProps) ||
    !isRecord(value.globalVariables) ||
    !isUserScriptMap(value.userNodes) ||
    !isMosaicLayout(value.layout)
  ) {
    throw new Error("Recommended layout data is invalid");
  }
  if (
    value.version != undefined &&
    (typeof value.version !== "number" ||
      !Number.isInteger(value.version) ||
      value.version < 0 ||
      value.version > MAX_SUPPORTED_LAYOUT_VERSION)
  ) {
    throw new Error("Recommended layout version is not supported");
  }
  return migratePanelsState(value as unknown as LayoutData);
}

export async function loadRecommendedLayoutData(
  descriptor: RecommendedLayoutDescriptor,
): Promise<LayoutData> {
  let promise = layoutPromises.get(descriptor.url);
  if (promise) {
    layoutPromises.delete(descriptor.url);
    layoutPromises.set(descriptor.url, promise);
    return await promise;
  }

  const request = fetchJson(descriptor.url)
    .then(parseLayoutData)
    .catch((error: unknown) => {
      if (layoutPromises.get(descriptor.url) === request) {
        layoutPromises.delete(descriptor.url);
      }
      throw error;
    });
  promise = request;
  layoutPromises.set(descriptor.url, promise);
  while (layoutPromises.size > MAX_CACHED_LAYOUTS) {
    const oldestUrl = layoutPromises.keys().next().value;
    if (oldestUrl == undefined) {
      break;
    }
    layoutPromises.delete(oldestUrl);
  }
  return await promise;
}

function recommendedLayoutId(
  robot: string,
  transport: RecommendedLayoutTransport,
  url: string,
): LayoutID {
  const parts = [robot, transport, url].map(encodeURIComponent);
  return `recommended:${parts.join(":")}` as LayoutID;
}

function descriptorForEntry(
  manifest: RecommendedLayoutManifest,
  robot: string,
  transport: RecommendedLayoutTransport,
  resolution: string,
  workflow: string,
  role: string,
  path: string,
): RecommendedLayoutDescriptor {
  const url = new URL(path, RECOMMENDED_LAYOUT_MANIFEST_URL);
  if (url.origin !== RECOMMENDED_LAYOUT_ORIGIN) {
    throw new Error("Recommended layout URL must use the manifest origin");
  }
  return {
    id: recommendedLayoutId(robot, transport, url.toString()),
    robot,
    resolution,
    transport,
    workflow,
    role,
    name: `${workflow} / ${role}`,
    url: url.toString(),
    generatedAt: manifest.generated_at,
  };
}

export function listRecommendedLayouts(
  manifest: RecommendedLayoutManifest,
  robot: string,
): RecommendedLayoutDescriptor[] {
  const resolutions = manifest.robots[robot]?.resolution;
  if (!resolutions) {
    return [];
  }

  const result: RecommendedLayoutDescriptor[] = [];
  for (const transport of ["default", "h264"] as const) {
    const seenUrls = new Set<string>();
    const transportLayouts: RecommendedLayoutDescriptor[] = [];
    for (const [resolution, transportConfigs] of Object.entries(resolutions)) {
      for (const [workflow, roles] of Object.entries(transportConfigs[transport] ?? {})) {
        for (const [role, path] of Object.entries(roles)) {
          const descriptor = descriptorForEntry(
            manifest,
            robot,
            transport,
            resolution,
            workflow,
            role,
            path,
          );
          if (seenUrls.has(descriptor.url)) {
            continue;
          }
          seenUrls.add(descriptor.url);
          transportLayouts.push(descriptor);
        }
      }
    }

    const nameCounts = new Map<string, number>();
    for (const descriptor of transportLayouts) {
      nameCounts.set(descriptor.name, (nameCounts.get(descriptor.name) ?? 0) + 1);
    }
    result.push(
      ...transportLayouts.map((descriptor) =>
        (nameCounts.get(descriptor.name) ?? 0) > 1
          ? { ...descriptor, name: `${descriptor.name} / ${descriptor.resolution}` }
          : descriptor,
      ),
    );
  }
  return result;
}

export function resolveRecommendedLayout(
  manifest: RecommendedLayoutManifest,
  robot: string,
  transport: RecommendedLayoutTransport,
): RecommendedLayoutDescriptor | undefined {
  const workflows = manifest.robots[robot]?.resolution?.["_default"]?.[transport];
  const workflowEntry = Object.entries(workflows ?? {})[0];
  if (!workflowEntry?.[1].viewer) {
    return undefined;
  }
  return descriptorForEntry(
    manifest,
    robot,
    transport,
    "_default",
    workflowEntry[0],
    "viewer",
    workflowEntry[1].viewer,
  );
}

export function hasCompressedVideoTopic(topics: readonly { schemaName: string }[]): boolean {
  return topics.some((topic) => COMPRESSED_VIDEO_DATATYPES.has(topic.schemaName));
}
