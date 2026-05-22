// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export enum ManifestStorageSource {
  Default = "default",
  CoSceneVizData = "cosceneVizData",
}

export const COSCENE_VIZ_DATA_BASE_URL = "https://coscene-viz-data.coscene.io";

function ensureObjectStorageBaseUrlProtocol(objectStorageBaseUrl: string): string {
  if (/^https?:\/\//i.test(objectStorageBaseUrl)) {
    return objectStorageBaseUrl;
  }
  return `https://${objectStorageBaseUrl}`;
}

export function buildManifestUrl(
  objectStorageBaseUrl: string,
  projectId: string,
  recordId: string,
): string {
  return `${ensureObjectStorageBaseUrlProtocol(objectStorageBaseUrl).replace(
    /\/+$/,
    "",
  )}/projects/${projectId}/records/${recordId}/manifest.json`;
}

export function getManifestStorageBaseUrl(
  manifestStorageSource: string | undefined,
  defaultObjectStorageBaseUrl: string | undefined,
): string | undefined {
  if (manifestStorageSource === ManifestStorageSource.CoSceneVizData) {
    return COSCENE_VIZ_DATA_BASE_URL;
  }
  return defaultObjectStorageBaseUrl;
}

export async function manifestExists(manifestUrl: string): Promise<boolean> {
  try {
    const response = await fetch(manifestUrl, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}
