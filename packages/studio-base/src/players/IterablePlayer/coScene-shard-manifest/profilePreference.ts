// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const RAW_PROFILE = "raw";
export const SHARD_PROFILE_PREFERENCE_STORAGE_KEY = "studio.shardProfilePreference";

export type ShardProfileOption = { value: string; label: string };

export type ShardProfilePreference = ShardProfileOption;

export interface ManifestProfile {
  id: string;
  modality?: string;
  label?: string;
  params?: { h?: number; height?: number; fps?: number; codec?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != undefined && !Array.isArray(value);
}

export function profileToOption(p: ManifestProfile): ShardProfileOption {
  if (p.label != undefined && p.label.length > 0 && p.label !== p.id) {
    return { value: p.id, label: p.label };
  }
  const h = p.params?.h ?? p.params?.height;
  const fps = p.params?.fps;
  if (h != undefined && h > 0 && fps != undefined && fps > 0) {
    return { value: p.id, label: `${h}p · ${fps}fps` };
  }
  if (h != undefined && h > 0) {
    return { value: p.id, label: `${h}p` };
  }
  return { value: p.id, label: p.id };
}

export function profileHeight(p: ManifestProfile): number {
  return p.params?.h ?? p.params?.height ?? 0;
}

export function isDefaultVideoProfile(p: ManifestProfile): boolean {
  return p.modality === "video" || p.params?.h != undefined || p.params?.height != undefined;
}

export function manifestProfileOptions(profiles: readonly ManifestProfile[]): ShardProfileOption[] {
  return profiles
    .filter((p) => p.id !== "" && p.id !== "full" && p.id !== RAW_PROFILE)
    .sort((a, b) => profileHeight(a) - profileHeight(b))
    .map(profileToOption);
}

export function findMatchingShardProfilePreference(
  options: readonly ShardProfileOption[],
  preference: ShardProfilePreference | undefined,
): ShardProfileOption | undefined {
  if (preference == undefined) {
    return undefined;
  }
  return (
    options.find((option) => option.value === preference.value) ??
    options.find((option) => option.label === preference.label)
  );
}

export function loadShardProfilePreference(): ShardProfilePreference | undefined {
  if (typeof localStorage === "undefined") {
    return undefined;
  }
  try {
    const item = localStorage.getItem(SHARD_PROFILE_PREFERENCE_STORAGE_KEY);
    if (item == undefined) {
      return undefined;
    }
    const parsed = JSON.parse(item) as unknown;
    if (!isRecord(parsed) || typeof parsed.value !== "string" || typeof parsed.label !== "string") {
      return undefined;
    }
    return { value: parsed.value, label: parsed.label };
  } catch {
    return undefined;
  }
}

export function saveShardProfilePreference(option: ShardProfileOption): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    const serialized = JSON.stringify(option);
    if (serialized != undefined) {
      localStorage.setItem(SHARD_PROFILE_PREFERENCE_STORAGE_KEY, serialized);
    }
  } catch {
    // Ignore quota/security errors; profile selection should still work for the current page.
  }
}
