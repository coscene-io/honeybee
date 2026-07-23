// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Select, MenuItem, FormControl } from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import {
  findMatchingShardProfilePreference,
  isDefaultVideoProfile,
  loadShardProfilePreference,
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
  SHARD_MODE_RAW,
} from "@foxglove/studio-base/util/shardManifestUrlParams";
import { SHARE_MANIFEST_DATA_SOURCE_ID } from "@foxglove/studio-base/util/shareManifest";

interface MinimalManifest {
  profiles?: ManifestProfile[];
}

const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

const useStyles = makeStyles()(() => ({
  formControl: {
    minWidth: 160,
    marginRight: 8,
  },
  select: {
    height: 32,
    fontSize: 13,
  },
}));

export function ShardProfileSelector(): React.JSX.Element | ReactNull {
  const { classes } = useStyles();
  const { t } = useTranslation("appBar");
  const urlState = useMessagePipeline(selectUrlState);

  const sourceId = urlState?.sourceId;
  const shardMode = urlState?.parameters?.[SHARD_MODE_PARAM];
  const manifestUrl = urlState?.parameters?.[MANIFEST_URL_PARAM] ?? "";
  const isDataPlatformShardManifest =
    sourceId === "coscene-data-platform" &&
    (shardMode === SHARD_MODE_MANIFEST || shardMode === SHARD_MODE_RAW);
  const isShareDirectShardManifest =
    sourceId === SHARE_MANIFEST_DATA_SOURCE_ID &&
    shardMode === SHARD_MODE_MANIFEST &&
    manifestUrl !== "";
  const isShardManifest = isDataPlatformShardManifest || isShareDirectShardManifest;
  const allowRawProfile = isDataPlatformShardManifest;
  const profileParam = urlState?.parameters?.profile ?? "";
  const currentProfile = !allowRawProfile && profileParam === RAW_PROFILE ? "" : profileParam;
  const rawOption = useMemo<ShardProfileOption>(
    () => ({ value: RAW_PROFILE, label: t("rawData") }),
    [t],
  );

  const [profileOptions, setProfileOptions] = useState<ShardProfileOption[]>([]);
  const [defaultProfile, setDefaultProfile] = useState<string>("");

  useEffect(() => {
    if (!isShardManifest || !manifestUrl) {
      setProfileOptions([]);
      setDefaultProfile("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch(manifestUrl);
        if (!resp.ok) {
          return;
        }
        const json = (await resp.json()) as MinimalManifest;
        const profiles = (json.profiles ?? [])
          .filter((p) => p.id !== "" && p.id !== "full" && p.id !== RAW_PROFILE)
          .sort((a, b) => profileHeight(a) - profileHeight(b));
        const fromManifest = profiles.map(profileToOption);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled || fromManifest.length === 0) {
          return;
        }
        setProfileOptions(fromManifest);
        setDefaultProfile(profiles.find(isDefaultVideoProfile)?.id ?? fromManifest[0]?.value ?? "");
      } catch {
        // Network error / parse error — silently keep the default-only list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isShardManifest, manifestUrl]);

  const options = useMemo(() => {
    if (!allowRawProfile) {
      return profileOptions;
    }
    if (profileOptions.some((opt) => opt.value === RAW_PROFILE)) {
      return profileOptions;
    }
    return [...profileOptions, rawOption];
  }, [allowRawProfile, profileOptions, rawOption]);

  const selectorVisible =
    isDataPlatformShardManifest || (isShareDirectShardManifest && options.length > 1);

  const selectedValue =
    currentProfile !== "" && options.some((option) => option.value === currentProfile)
      ? currentProfile
      : defaultProfile;

  useEffect(() => {
    if (!selectorVisible || options.length === 0) {
      return;
    }
    const hasCurrentProfile =
      currentProfile !== "" && options.some((option) => option.value === currentProfile);
    if (hasCurrentProfile) {
      return;
    }
    const savedOption = findMatchingShardProfilePreference(options, loadShardProfilePreference());
    if (
      savedOption == undefined ||
      (savedOption.value === defaultProfile && currentProfile === "")
    ) {
      return;
    }
    const next = new URLSearchParams(window.location.search);
    if (savedOption.value === defaultProfile) {
      next.delete("ds.profile");
    } else {
      next.set("ds.profile", savedOption.value);
    }
    window.location.search = next.toString();
  }, [currentProfile, defaultProfile, options, selectorVisible]);

  const onChange = useCallback(
    (value: string) => {
      const selectedOption = options.find((option) => option.value === value);
      if (selectedOption != undefined) {
        saveShardProfilePreference(selectedOption);
      }
      const next = new URLSearchParams(window.location.search);
      if (value !== "" && value !== defaultProfile) {
        next.set("ds.profile", value);
      } else {
        next.delete("ds.profile");
      }
      window.location.search = next.toString();
    },
    [defaultProfile, options],
  );

  if (!selectorVisible) {
    return ReactNull;
  }

  return (
    <FormControl size="small" variant="outlined" className={classes.formControl}>
      <Select
        value={selectedValue}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className={classes.select}
        displayEmpty
      >
        {options.map((opt) => (
          <MenuItem key={opt.value} value={opt.value}>
            {opt.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
