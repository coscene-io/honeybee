// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { buildManifestUrl } from "./CoSceneDataPlatformDataSourceFactory";

describe("buildManifestUrl", () => {
  it("adds https protocol to object storage base URL without protocol", () => {
    expect(buildManifestUrl("mcap.dev.coscene.cn", "project-id", "record-id")).toBe(
      "https://mcap.dev.coscene.cn/projects/project-id/records/record-id/manifest.json",
    );
  });

  it("keeps existing protocol on object storage base URL", () => {
    expect(buildManifestUrl("http://mcap.dev.coscene.cn", "project-id", "record-id")).toBe(
      "http://mcap.dev.coscene.cn/projects/project-id/records/record-id/manifest.json",
    );
    expect(buildManifestUrl("https://mcap.dev.coscene.cn", "project-id", "record-id")).toBe(
      "https://mcap.dev.coscene.cn/projects/project-id/records/record-id/manifest.json",
    );
  });

  it("trims trailing slashes before appending manifest path", () => {
    expect(buildManifestUrl("mcap.dev.coscene.cn///", "project-id", "record-id")).toBe(
      "https://mcap.dev.coscene.cn/projects/project-id/records/record-id/manifest.json",
    );
  });
});
