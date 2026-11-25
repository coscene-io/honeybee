/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { reloadWithSearch } from "@foxglove/studio-base/util/reloadWithSearch";

import {
  decideAnnotationProfile,
  ensureAnnotationProfile,
  rememberProfileSwitch,
  takeProfileSwitchNotice,
} from "./annotationProfile";

jest.mock("@foxglove/studio-base/util/reloadWithSearch", () => ({ reloadWithSearch: jest.fn() }));

const profile = (id: string, h: number) => ({ id, modality: "video", params: { h } });
const record = [profile("480p15", 480), profile("720p15", 720), profile("1080p15", 1080)];

describe("decideAnnotationProfile", () => {
  const decide = (profiles: typeof record, currentProfile: string, shardMode = "manifest") =>
    decideAnnotationProfile({ shardMode, profiles, currentProfile });

  it("switches the default (lowest) quality and others to 720p", () => {
    expect(decide(record, "")).toMatchObject({
      type: "switch",
      option: { value: "720p15" },
      height: 720,
      exact: true,
    });
    expect(decide(record, "1080p15")).toMatchObject({
      type: "switch",
      option: { value: "720p15" },
    });
    expect(decide(record, "480p15")).toMatchObject({ type: "switch", option: { value: "720p15" } });
  });

  it("keeps 720p, and raw, which is another topic with annotations of its own", () => {
    expect(decide(record, "720p15")).toEqual({ type: "keep" });
    expect(decide(record, "raw")).toEqual({ type: "keep" });
    expect(decide(record, "", "raw")).toEqual({ type: "keep" });
    expect(
      decideAnnotationProfile({ shardMode: undefined, profiles: record, currentProfile: "" }),
    ).toEqual({ type: "keep" });
  });

  it("uses the closest profile for a record without 720p, higher on a tie, and says it is not 720p", () => {
    const noHd = [profile("480p15", 480), profile("1080p15", 1080)];
    expect(decide(noHd, "1080p15")).toMatchObject({
      type: "switch",
      option: { value: "480p15" },
      height: 480,
      exact: false,
    });
    expect(decide(noHd, "")).toEqual({ type: "keep" });
    const tie = [profile("480p15", 480), profile("960p15", 960)];
    expect(decide(tie, "480p15")).toMatchObject({ option: { value: "960p15" }, exact: false });
  });

  it("leaves a record without video profiles alone", () => {
    expect(decide([], "")).toEqual({ type: "keep" });
    expect(decide([{ id: "full", modality: "image" } as never], "")).toEqual({ type: "keep" });
  });
});

describe("ensureAnnotationProfile", () => {
  const original = globalThis.fetch;
  const reload = jest.mocked(reloadWithSearch);
  const manifest = (url: string) => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ profiles: record }),
    })) as unknown as typeof fetch;
    return {
      parameters: { shardMode: "manifest", manifestUrl: url, profile: "" } as Record<
        string,
        string
      >,
    };
  };

  beforeEach(() => {
    reload.mockClear();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("reloads on 720p, remembers the choice and the notice, and does not enter", async () => {
    await expect(ensureAnnotationProfile(manifest("https://m/1.json"))).resolves.toBe("reloading");
    expect(reload.mock.lastCall?.[0].toString()).toBe("ds.profile=720p15");
    expect(JSON.parse(window.localStorage.getItem("studio.shardProfilePreference")!)).toMatchObject(
      {
        value: "720p15",
      },
    );
    expect(takeProfileSwitchNotice()).toEqual({ height: 720, exact: true });
    expect(takeProfileSwitchNotice()).toBeUndefined();
  });

  it("lets a session start when already on 720p, on raw, or without a manifest", async () => {
    const onHd = manifest("https://m/2.json");
    onHd.parameters.profile = "720p15";
    await expect(ensureAnnotationProfile(onHd)).resolves.toBe("ready");
    const raw = manifest("https://m/3.json");
    raw.parameters.profile = "raw";
    await expect(ensureAnnotationProfile(raw)).resolves.toBe("ready");
    await expect(ensureAnnotationProfile({ parameters: {} })).resolves.toBe("ready");
    await expect(ensureAnnotationProfile(undefined)).resolves.toBe("ready");
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not block annotation when the manifest cannot be read", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      ensureAnnotationProfile({
        parameters: { shardMode: "manifest", manifestUrl: "https://m/4.json", profile: "" },
      }),
    ).resolves.toBe("ready");
    expect(reload).not.toHaveBeenCalled();
  });

  it("round-trips the notice and ignores garbage", () => {
    rememberProfileSwitch({ height: 480, exact: false });
    expect(takeProfileSwitchNotice()).toEqual({ height: 480, exact: false });
    window.sessionStorage.setItem("studio.segmentation.profileSwitchNotice", "{nope");
    expect(takeProfileSwitchNotice()).toBeUndefined();
  });
});
