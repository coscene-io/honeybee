// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const SHARE_MANIFEST_DATA_SOURCE_ID = "coscene-share-manifest";
export const SHARE_MANIFEST_HASH_PARAM = "manifest";
export const SHARE_MANIFEST_DIRECT_MANIFEST_URL_PARAM = "manifestUrl";
export const SHARE_MANIFEST_DIRECT_LAYOUT_URL_PARAM = "layoutUrl";
const SHARE_MANIFEST_PROFILE_PARAM = "profile";
const URL_PROFILE_PARAM = "ds.profile";
const RAW_PROFILE_ID = "raw";

export type ShareManifest = {
  version: 1;
  expireTime: string;
  links: {
    mini_mcap: string;
    layout: string;
  };
};

export type EncodedShareManifestParseResult =
  | { status: "expired"; encodedManifest: string; expireTime: string }
  | { status: "invalid"; encodedManifest: string; error: Error }
  | { status: "valid"; kind: "encoded"; encodedManifest: string; manifest: ShareManifest };

export type DirectShareManifestParseResult = {
  status: "valid";
  kind: "direct";
  manifestUrl: string;
  layoutUrl?: string;
  profile?: string;
};

export type ShareManifestParseResult =
  | { status: "missing" }
  | EncodedShareManifestParseResult
  | { status: "invalid"; encodedManifest?: string; error: Error }
  | DirectShareManifestParseResult;

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

function getHashParams(url: URL): URLSearchParams {
  return new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
}

function cleanShareProfile(profile: string | undefined): string | undefined {
  if (profile == undefined || profile.length === 0 || profile === RAW_PROFILE_ID) {
    return undefined;
  }
  return profile;
}

function asShareManifest(raw: unknown): ShareManifest {
  if (!isRecord(raw)) {
    throw new Error("Share manifest must be a JSON object");
  }
  if (raw.version !== 1) {
    throw new Error("Share manifest version must be 1");
  }
  if (typeof raw.expireTime !== "string" || Number.isNaN(Date.parse(raw.expireTime))) {
    throw new Error("Share manifest expireTime must be a valid date string");
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
    expireTime: raw.expireTime,
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
  const hashParams = getHashParams(url);
  return parseShareManifestParams(
    {
      [SHARE_MANIFEST_HASH_PARAM]: hashParams.get(SHARE_MANIFEST_HASH_PARAM) ?? undefined,
      [SHARE_MANIFEST_DIRECT_MANIFEST_URL_PARAM]:
        hashParams.get(SHARE_MANIFEST_DIRECT_MANIFEST_URL_PARAM) ?? undefined,
      [SHARE_MANIFEST_DIRECT_LAYOUT_URL_PARAM]:
        hashParams.get(SHARE_MANIFEST_DIRECT_LAYOUT_URL_PARAM) ?? undefined,
      [SHARE_MANIFEST_PROFILE_PARAM]: url.searchParams.get(URL_PROFILE_PARAM) ?? undefined,
    },
    now,
  );
}

export function parseShareManifestParams(
  params: Record<string, string | undefined> | undefined,
  now: Date = new Date(),
): ShareManifestParseResult {
  const encodedManifest = params?.[SHARE_MANIFEST_HASH_PARAM];
  if (encodedManifest != undefined && encodedManifest.length > 0) {
    return parseEncodedShareManifest(encodedManifest, now);
  }

  const manifestUrl = params?.[SHARE_MANIFEST_DIRECT_MANIFEST_URL_PARAM];
  if (manifestUrl == undefined) {
    return { status: "missing" };
  }
  if (!isHttpUrl(manifestUrl)) {
    return {
      status: "invalid",
      error: new Error("Share manifestUrl must be an HTTP(S) URL"),
    };
  }

  const rawLayoutUrl = params?.[SHARE_MANIFEST_DIRECT_LAYOUT_URL_PARAM];
  const layoutUrl = rawLayoutUrl != undefined && rawLayoutUrl.length > 0 ? rawLayoutUrl : undefined;
  if (layoutUrl != undefined && !isHttpUrl(layoutUrl)) {
    return {
      status: "invalid",
      error: new Error("Share layoutUrl must be an HTTP(S) URL"),
    };
  }

  return {
    status: "valid",
    kind: "direct",
    manifestUrl,
    ...(layoutUrl != undefined ? { layoutUrl } : {}),
    ...(() => {
      const profile = cleanShareProfile(params?.[SHARE_MANIFEST_PROFILE_PARAM]);
      return profile != undefined ? { profile } : {};
    })(),
  };
}

export function parseEncodedShareManifest(
  encodedManifest: string,
  now: Date = new Date(),
): EncodedShareManifestParseResult {
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

  if (isRecord(raw)) {
    const { expireTime } = raw;
    const expireTimeMs = typeof expireTime === "string" ? Date.parse(expireTime) : Number.NaN;
    if (
      typeof expireTime === "string" &&
      Number.isFinite(expireTimeMs) &&
      expireTimeMs <= now.getTime()
    ) {
      return { status: "expired", encodedManifest, expireTime };
    }
  }

  try {
    return { status: "valid", kind: "encoded", encodedManifest, manifest: asShareManifest(raw) };
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

/**
 * True when the given URL should open in share-manifest mode — i.e. when it carries
 * a *valid* share-manifest payload in the URL hash (`#manifest=...` or
 * `#manifestUrl=...`). App-state query params such as
 * `?ds=coscene-share-manifest&ds.manifestUrl=...` are not a supported share-link
 * format and must not opt the workspace into the isolated share store.
 *
 * The predicate is deliberately identical to the condition under which
 * `DeepLinksSyncAdapter` / `CoSceneShareManifestDataSourceFactory` actually load the
 * share source from legal share links: `status === "valid"` only. It intentionally
 * excludes `expired` and `invalid`/`missing` payloads — applying the share panel
 * defaults (sidebars hidden) for a URL that never loads as a legal share would be a
 * confusing degraded state.
 */
export function isShareManifestModeFromUrl(url: URL, now: Date = new Date()): boolean {
  return parseShareManifestFromUrl(url, now).status === "valid";
}

/**
 * Synchronously detect share-manifest mode from the current window location.
 * SSR-safe: returns false when `window` is unavailable or the URL cannot be parsed.
 */
export function windowIsShareManifestMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return isShareManifestModeFromUrl(new URL(window.location.href));
  } catch {
    return false;
  }
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
