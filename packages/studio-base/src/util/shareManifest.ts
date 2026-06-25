// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const SHARE_MANIFEST_DATA_SOURCE_ID = "coscene-share-manifest";
export const SHARE_MANIFEST_HASH_PARAM = "manifest";

export type ShareManifest = {
  version: 1;
  expires_at: string;
  links: {
    mini_mcap: string;
    layout: string;
  };
};

export type ShareManifestParseResult =
  | { status: "missing" }
  | { status: "expired"; encodedManifest: string; expiresAt: string }
  | { status: "invalid"; encodedManifest: string; error: Error }
  | { status: "valid"; encodedManifest: string; manifest: ShareManifest };

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != undefined && !Array.isArray(value);
}

function decodeBase64UrlJson(encoded: string): unknown {
  if (!BASE64URL_PATTERN.test(encoded)) {
    throw new Error("Share manifest must be base64url encoded");
  }
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as unknown;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getManifestHashParam(url: URL): string | undefined {
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  return params.get(SHARE_MANIFEST_HASH_PARAM) ?? undefined;
}

function asShareManifest(raw: unknown): ShareManifest {
  if (!isRecord(raw)) {
    throw new Error("Share manifest must be a JSON object");
  }
  if (raw.version !== 1) {
    throw new Error("Share manifest version must be 1");
  }
  if (typeof raw.expires_at !== "string" || Number.isNaN(Date.parse(raw.expires_at))) {
    throw new Error("Share manifest expires_at must be a valid date string");
  }
  if (!isRecord(raw.links)) {
    throw new Error("Share manifest links must be an object");
  }
  if (typeof raw.links.mini_mcap !== "string" || !isHttpUrl(raw.links.mini_mcap)) {
    throw new Error("Share manifest links.mini_mcap must be an HTTP(S) URL");
  }
  if (typeof raw.links.layout !== "string" || !isHttpUrl(raw.links.layout)) {
    throw new Error("Share manifest links.layout must be an HTTP(S) URL");
  }

  return {
    version: 1,
    expires_at: raw.expires_at,
    links: {
      mini_mcap: raw.links.mini_mcap,
      layout: raw.links.layout,
    },
  };
}

export function parseShareManifestFromUrl(
  url: URL,
  now: Date = new Date(),
): ShareManifestParseResult {
  const encodedManifest = getManifestHashParam(url);
  if (encodedManifest == undefined || encodedManifest.length === 0) {
    return { status: "missing" };
  }

  return parseEncodedShareManifest(encodedManifest, now);
}

export function parseEncodedShareManifest(
  encodedManifest: string,
  now: Date = new Date(),
): Exclude<ShareManifestParseResult, { status: "missing" }> {
  let raw: unknown;
  try {
    raw = decodeBase64UrlJson(encodedManifest);
  } catch (error) {
    return {
      status: "invalid",
      encodedManifest,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  if (isRecord(raw) && typeof raw.expires_at === "string") {
    const expiresAtMs = Date.parse(raw.expires_at);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= now.getTime()) {
      return { status: "expired", encodedManifest, expiresAt: raw.expires_at };
    }
  }

  try {
    return { status: "valid", encodedManifest, manifest: asShareManifest(raw) };
  } catch (error) {
    return {
      status: "invalid",
      encodedManifest,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export function isShareManifestUrl(url: URL, now: Date = new Date()): boolean {
  const result = parseShareManifestFromUrl(url, now);
  return result.status === "valid" || result.status === "expired";
}

export function windowShareManifestParseResult(): ShareManifestParseResult {
  if (typeof window === "undefined") {
    return { status: "missing" };
  }
  try {
    return parseShareManifestFromUrl(new URL(window.location.href));
  } catch {
    return { status: "missing" };
  }
}
