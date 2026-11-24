// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  isDefaultVideoProfile,
  profileHeight,
  profileToOption,
  RAW_PROFILE,
  saveShardProfilePreference,
} from "@foxglove/studio-base/players/IterablePlayer/coScene-shard-manifest/profilePreference";
import type {
  ManifestProfile,
  ShardProfileOption,
} from "@foxglove/studio-base/players/IterablePlayer/coScene-shard-manifest/profilePreference";
import {
  MANIFEST_URL_PARAM,
  SHARD_MODE_MANIFEST,
  SHARD_MODE_PARAM,
} from "@foxglove/studio-base/util/shardManifestUrlParams";

/**
 * Annotation is fixed to one transcode quality. Every transcode profile of a camera is the same
 * topic (`…/h264`) at another size, and a mask is bound to the size it was drawn at, so masks
 * drawn at 720p cannot be read at 480p. The raw image is another topic: it keeps its own
 * annotations and is never switched.
 */
export const ANNOTATION_PROFILE_HEIGHT = 720;

export type AnnotationProfileDecision =
  | { type: "keep" }
  | {
      type: "switch";
      option: ShardProfileOption;
      height: number;
      /** False when the record has no 720p profile and this is the closest one. */
      exact: boolean;
    };

function isVideoProfile(profile: ManifestProfile): boolean {
  return (
    profile.id !== "" &&
    profile.id !== "full" &&
    profile.id !== RAW_PROFILE &&
    isDefaultVideoProfile(profile) &&
    profileHeight(profile) > 0
  );
}

/**
 * Which profile annotation needs, given the profiles the manifest offers and the one in use
 * (`ds.profile`, empty for the default, which is the lowest quality).
 *
 * - Raw stays raw. A source without a shard manifest or without video profiles is left alone.
 * - Otherwise the 720p profile; a record without one uses the closest (the higher on a tie), so
 *   everyone annotating that record agrees on the size.
 */
export function decideAnnotationProfile(input: {
  shardMode: string | undefined;
  profiles: readonly ManifestProfile[];
  currentProfile: string;
}): AnnotationProfileDecision {
  const { shardMode, profiles, currentProfile } = input;
  if (shardMode !== SHARD_MODE_MANIFEST || currentProfile === RAW_PROFILE) {
    return { type: "keep" };
  }
  const videos = profiles
    .filter(isVideoProfile)
    .sort((a, b) => profileHeight(a) - profileHeight(b));
  const lowest = videos[0];
  if (!lowest) {
    return { type: "keep" };
  }
  const inUse = videos.find((profile) => profile.id === currentProfile) ?? lowest;
  const target = videos.reduce((best, profile) => {
    const distance = Math.abs(profileHeight(profile) - ANNOTATION_PROFILE_HEIGHT);
    const bestDistance = Math.abs(profileHeight(best) - ANNOTATION_PROFILE_HEIGHT);
    return distance < bestDistance ||
      (distance === bestDistance && profileHeight(profile) > profileHeight(best))
      ? profile
      : best;
  });
  if (target.id === inUse.id) {
    return { type: "keep" };
  }
  return {
    type: "switch",
    option: profileToOption(target),
    height: profileHeight(target),
    exact: profileHeight(target) === ANNOTATION_PROFILE_HEIGHT,
  };
}

const NOTICE_KEY = "studio.segmentation.profileSwitchNotice";

export type ProfileSwitchNotice = { height: number; exact: boolean };

/** Remembers, across the reload a profile change needs, to tell the user about it. */
export function rememberProfileSwitch(notice: ProfileSwitchNotice): void {
  try {
    globalThis.sessionStorage.setItem(NOTICE_KEY, JSON.stringify(notice)!);
  } catch {
    // The switch still happens; only the explanation is lost.
  }
}

/** The pending notice, once: reading clears it. */
export function takeProfileSwitchNotice(): ProfileSwitchNotice | undefined {
  try {
    const stored = globalThis.sessionStorage.getItem(NOTICE_KEY);
    if (stored == undefined) {
      return undefined;
    }
    globalThis.sessionStorage.removeItem(NOTICE_KEY);
    const parsed = JSON.parse(stored) as Partial<ProfileSwitchNotice>;
    return typeof parsed.height === "number" && typeof parsed.exact === "boolean"
      ? { height: parsed.height, exact: parsed.exact }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Reloads the page on another profile. Swappable in tests, where jsdom cannot navigate. */
export const annotationProfileNavigation = {
  reload(search: string): void {
    window.location.search = search;
  },
};

const manifestProfiles = new Map<string, Promise<ManifestProfile[] | undefined>>();

/** The profiles a shard manifest offers; undefined when it cannot be read. Cached per URL. */
export async function loadManifestProfiles(
  manifestUrl: string,
): Promise<ManifestProfile[] | undefined> {
  let pending = manifestProfiles.get(manifestUrl);
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(manifestUrl);
        if (!response.ok) {
          return undefined;
        }
        const json = (await response.json()) as { profiles?: ManifestProfile[] };
        return json.profiles ?? [];
      } catch {
        return undefined;
      }
    })();
    manifestProfiles.set(manifestUrl, pending);
    void pending.then((profiles) => {
      if (profiles == undefined) {
        manifestProfiles.delete(manifestUrl);
      }
    });
  }
  return await pending;
}

/** Whether a session start has to look at the profile first (a shard manifest source). */
export function needsAnnotationProfileCheck(
  urlState: { parameters?: Record<string, string | undefined> } | undefined,
): boolean {
  const parameters = urlState?.parameters;
  return parameters?.[SHARD_MODE_PARAM] === SHARD_MODE_MANIFEST && !!parameters[MANIFEST_URL_PARAM];
}

/**
 * Called before a session starts. Switches the page to the annotation profile when the source is
 * on another one: returns "reloading" (the page is going away, do not enter) or "ready".
 * Anything unexpected (no manifest, a read failure) lets annotation go on as it is.
 */
export async function ensureAnnotationProfile(
  urlState: { parameters?: Record<string, string | undefined> } | undefined,
): Promise<"ready" | "reloading"> {
  const parameters = urlState?.parameters;
  const manifestUrl = parameters?.[MANIFEST_URL_PARAM];
  if (parameters?.[SHARD_MODE_PARAM] !== SHARD_MODE_MANIFEST || !manifestUrl) {
    return "ready";
  }
  const profiles = await loadManifestProfiles(manifestUrl);
  if (!profiles) {
    return "ready";
  }
  const decision = decideAnnotationProfile({
    shardMode: parameters[SHARD_MODE_PARAM],
    profiles,
    currentProfile: parameters.profile ?? "",
  });
  if (decision.type === "keep") {
    return "ready";
  }
  saveShardProfilePreference(decision.option);
  rememberProfileSwitch({ height: decision.height, exact: decision.exact });
  const lowest = profiles
    .filter(isVideoProfile)
    .sort((a, b) => profileHeight(a) - profileHeight(b))[0];
  const next = new URLSearchParams(window.location.search);
  if (decision.option.value === lowest?.id) {
    next.delete("ds.profile");
  } else {
    next.set("ds.profile", decision.option.value);
  }
  annotationProfileNavigation.reload(next.toString());
  return "reloading";
}
