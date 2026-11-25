// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { loadManifestProfiles, profileSearchParams } from "./profilePreference";

describe("profileSearchParams", () => {
  it("sets another profile and keeps the rest of the query", () => {
    expect(profileSearchParams("?ds=a", "720p", "480p").toString()).toBe("ds=a&ds.profile=720p");
  });

  it.each(["480p", ""])("drops ds.profile for the default (%j)", (profile) => {
    expect(profileSearchParams("?ds=a&ds.profile=720p", profile, "480p").toString()).toBe("ds=a");
  });
});

describe("loadManifestProfiles", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });
  const answer = (response: unknown) => {
    globalThis.fetch = jest.fn(async () => response) as unknown as typeof fetch;
  };

  it("returns the manifest's profiles, or none when it lists none", async () => {
    answer({ ok: true, json: async () => ({ profiles: [{ id: "720p" }] }) });
    await expect(loadManifestProfiles("https://m/a.json")).resolves.toEqual([{ id: "720p" }]);
    answer({ ok: true, json: async () => ({}) });
    await expect(loadManifestProfiles("https://m/a.json")).resolves.toEqual([]);
  });

  it("is undefined when the manifest cannot be read", async () => {
    answer({ ok: false });
    await expect(loadManifestProfiles("https://m/a.json")).resolves.toBeUndefined();
    globalThis.fetch = jest.fn(async () => {
      throw new Error("offline");
    });
    await expect(loadManifestProfiles("https://m/a.json")).resolves.toBeUndefined();
  });
});
