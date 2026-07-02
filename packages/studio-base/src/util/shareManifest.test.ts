// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  SHARE_MANIFEST_DATA_SOURCE_ID,
  isShareManifestUrl,
  parseShareManifestFromUrl,
} from "@foxglove/studio-base/util/shareManifest";

function encodeBase64Url(value: unknown): string {
  const json = JSON.stringify(value);
  if (json == undefined) {
    throw new Error("Unable to encode share manifest");
  }
  return Buffer.from(json, "utf8").toString("base64url");
}

function encodeBase64(value: unknown): string {
  const json = JSON.stringify(value);
  if (json == undefined) {
    throw new Error("Unable to encode share manifest");
  }
  return Buffer.from(json, "utf8").toString("base64");
}

describe("share manifest URL parsing", () => {
  const future = "2026-06-30T10:00:00Z";
  const past = "2026-06-20T10:00:00Z";
  const now = new Date("2026-06-25T00:00:00Z");

  it("parses only the manifest hash parameter", () => {
    const manifest = {
      version: 1,
      expireTime: future,
      links: {
        mini_mcap: "https://mock-storage.example.com/artifacts/process.mini.mcap?sig=1",
        layout: "https://mock-storage.example.com/shares/layout.json?sig=2",
      },
    };
    const encoded = encodeBase64Url(manifest);

    expect(
      parseShareManifestFromUrl(new URL(`https://example.com/viz#manifest=${encoded}`), now),
    ).toEqual({
      status: "valid",
      kind: "encoded",
      encodedManifest: encoded,
      manifest,
    });
  });

  it("parses direct shard manifest hash parameters", () => {
    expect(
      parseShareManifestFromUrl(
        new URL(
          "https://example.com/viz?ds=coscene-share-manifest&ds.profile=720p#manifestUrl=https%3A%2F%2Fstorage.example.com%2Fshards%2Fmanifest.json&layoutUrl=https%3A%2F%2Fstorage.example.com%2Flayouts%2Fshare.json",
        ),
        now,
      ),
    ).toEqual({
      status: "valid",
      kind: "direct",
      manifestUrl: "https://storage.example.com/shards/manifest.json",
      layoutUrl: "https://storage.example.com/layouts/share.json",
      profile: "720p",
    });
  });

  it("allows direct shard manifest URLs without layout URLs", () => {
    expect(
      parseShareManifestFromUrl(
        new URL(
          "https://example.com/viz?ds=coscene-share-manifest#manifestUrl=https%3A%2F%2Fstorage.example.com%2Fshards%2Fmanifest.json",
        ),
        now,
      ),
    ).toEqual({
      status: "valid",
      kind: "direct",
      manifestUrl: "https://storage.example.com/shards/manifest.json",
    });
  });

  it("ignores raw profile on direct shard manifest URLs", () => {
    expect(
      parseShareManifestFromUrl(
        new URL(
          "https://example.com/viz?ds=coscene-share-manifest&ds.profile=raw#manifestUrl=https%3A%2F%2Fstorage.example.com%2Fshards%2Fmanifest.json",
        ),
        now,
      ),
    ).toEqual({
      status: "valid",
      kind: "direct",
      manifestUrl: "https://storage.example.com/shards/manifest.json",
    });
  });

  it("rejects direct shard manifest URLs with non-http URLs", () => {
    expect(
      parseShareManifestFromUrl(
        new URL(
          "https://example.com/viz#manifestUrl=file%3A%2F%2Fstorage.example.com%2Fmanifest.json",
        ),
        now,
      ),
    ).toMatchObject({ status: "invalid" });
    expect(
      parseShareManifestFromUrl(
        new URL(
          "https://example.com/viz#manifestUrl=https%3A%2F%2Fstorage.example.com%2Fmanifest.json&layoutUrl=ftp%3A%2F%2Fstorage.example.com%2Flayout.json",
        ),
        now,
      ),
    ).toMatchObject({ status: "invalid" });
  });

  it("prefers encoded manifests when both encoded and direct parameters exist", () => {
    const manifest = {
      version: 1,
      expireTime: future,
      links: {
        mini_mcap: "https://mock-storage.example.com/artifacts/process.mini.mcap?sig=1",
        layout: "https://mock-storage.example.com/shares/layout.json?sig=2",
      },
    };
    const encoded = encodeBase64Url(manifest);

    expect(
      parseShareManifestFromUrl(
        new URL(
          `https://example.com/viz#manifest=${encoded}&manifestUrl=https%3A%2F%2Fstorage.example.com%2Fshards%2Fmanifest.json`,
        ),
        now,
      ),
    ).toEqual({
      status: "valid",
      kind: "encoded",
      encodedManifest: encoded,
      manifest,
    });
  });

  it("does not accept expires_at as the expiration field", () => {
    const encoded = encodeBase64Url({
      version: 1,
      expires_at: future,
      links: {
        mini_mcap: "https://mock-storage.example.com/artifacts/process.mini.mcap",
        layout: "https://mock-storage.example.com/shares/layout.json",
      },
    });

    expect(
      parseShareManifestFromUrl(new URL(`https://example.com/viz#manifest=${encoded}`), now),
    ).toMatchObject({
      status: "invalid",
    });
  });

  it("does not treat a bare base64 hash as a share manifest", () => {
    const encoded = encodeBase64Url({
      version: 1,
      expireTime: future,
      links: {
        mini_mcap: "https://mock-storage.example.com/artifacts/process.mini.mcap",
        layout: "https://mock-storage.example.com/shares/layout.json",
      },
    });

    expect(parseShareManifestFromUrl(new URL(`https://example.com/viz#${encoded}`), now)).toEqual({
      status: "missing",
    });
  });

  it("rejects standard base64 manifest hash parameters", () => {
    const encoded = encodeBase64({
      version: 1,
      expireTime: future,
      links: {
        mini_mcap: "https://mock-storage.example.com/artifacts/process.mini.mcap",
        layout: "https://mock-storage.example.com/shares/layout.json",
      },
    });

    expect(
      parseShareManifestFromUrl(
        new URL(`https://example.com/viz#manifest=${encodeURIComponent(encoded)}`),
        now,
      ),
    ).toMatchObject({
      status: "invalid",
    });
  });

  it("returns expired before validating other manifest fields", () => {
    const encoded = encodeBase64Url({
      expireTime: past,
      links: {
        mini_mcap: "not-a-url",
      },
    });

    expect(
      parseShareManifestFromUrl(new URL(`https://example.com/viz#manifest=${encoded}`), now),
    ).toEqual({
      status: "expired",
      encodedManifest: encoded,
      expireTime: past,
    });
  });

  it("rejects malformed non-expired manifests", () => {
    const encoded = encodeBase64Url({
      version: 2,
      expireTime: future,
      links: {
        mini_mcap: "https://mock-storage.example.com/artifacts/process.mini.mcap",
        layout: "https://mock-storage.example.com/shares/layout.json",
      },
    });

    expect(
      parseShareManifestFromUrl(new URL(`https://example.com/viz#manifest=${encoded}`), now),
    ).toMatchObject({
      status: "invalid",
    });
  });

  it("treats valid and expired share URLs as authless entries", () => {
    const validEncoded = encodeBase64Url({
      version: 1,
      expireTime: future,
      links: {
        mini_mcap: "https://mock-storage.example.com/artifacts/process.mini.mcap",
        layout: "https://mock-storage.example.com/shares/layout.json",
      },
    });
    const expiredEncoded = encodeBase64Url({ expireTime: past });

    expect(SHARE_MANIFEST_DATA_SOURCE_ID).toBe("coscene-share-manifest");
    expect(
      isShareManifestUrl(new URL(`https://example.com/viz#manifest=${validEncoded}`), now),
    ).toBe(true);
    expect(
      isShareManifestUrl(new URL(`https://example.com/viz#manifest=${expiredEncoded}`), now),
    ).toBe(true);
    expect(isShareManifestUrl(new URL(`https://example.com/viz#${validEncoded}`), now)).toBe(false);
    expect(
      isShareManifestUrl(
        new URL(
          "https://example.com/viz#manifestUrl=https%3A%2F%2Fstorage.example.com%2Fmanifest.json",
        ),
        now,
      ),
    ).toBe(true);
  });
});
