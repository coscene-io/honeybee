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
  loadShardProfilePreference,
  manifestProfileOptions,
  RAW_PROFILE,
  saveShardProfilePreference,
} from "@foxglove/studio-base/players/IterablePlayer/coScene-shard-manifest/profilePreference";
import type {
  ManifestProfile,
  ShardProfileOption,
} from "@foxglove/studio-base/players/IterablePlayer/coScene-shard-manifest/profilePreference";

interface MinimalManifest {
  profiles?: ManifestProfile[];
}

const DEFAULT_OPTION: ShardProfileOption = { value: "", label: "Default (lowest)" };
const SHARD_MODE_PARAM = "shardMode";
const SHARD_MODE_MANIFEST = "manifest";
const SHARD_MODE_RAW = "raw";
const MANIFEST_URL_PARAM = "manifestUrl";

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

  const isShardManifest =
    urlState?.sourceId === "coscene-data-platform" &&
    (urlState.parameters?.[SHARD_MODE_PARAM] === SHARD_MODE_MANIFEST ||
      urlState.parameters?.[SHARD_MODE_PARAM] === SHARD_MODE_RAW);
  const manifestUrl = urlState?.parameters?.[MANIFEST_URL_PARAM] ?? "";
  const currentProfile = urlState?.parameters?.profile ?? "";
  const rawOption = useMemo<ShardProfileOption>(
    () => ({ value: RAW_PROFILE, label: t("rawData") }),
    [t],
  );

  const [profileOptions, setProfileOptions] = useState<ShardProfileOption[]>([DEFAULT_OPTION]);

  useEffect(() => {
    if (!isShardManifest || !manifestUrl) {
      setProfileOptions([DEFAULT_OPTION]);
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
        const fromManifest = manifestProfileOptions(json.profiles ?? []);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled || fromManifest.length === 0) {
          return;
        }
        setProfileOptions([DEFAULT_OPTION, ...fromManifest]);
      } catch {
        // Network error / parse error — silently keep the default-only list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isShardManifest, manifestUrl]);

  const options = useMemo(() => {
    if (profileOptions.some((opt) => opt.value === RAW_PROFILE)) {
      return profileOptions;
    }
    return [...profileOptions, rawOption];
  }, [profileOptions, rawOption]);

  const selectedValue =
    currentProfile !== "" && options.some((option) => option.value === currentProfile)
      ? currentProfile
      : DEFAULT_OPTION.value;

  useEffect(() => {
    if (!isShardManifest || options.length === 0) {
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
      (savedOption.value === DEFAULT_OPTION.value && currentProfile === "")
    ) {
      return;
    }
    const next = new URLSearchParams(window.location.search);
    if (savedOption.value === DEFAULT_OPTION.value) {
      next.delete("ds.profile");
    } else {
      next.set("ds.profile", savedOption.value);
    }
    window.location.search = next.toString();
  }, [currentProfile, isShardManifest, options]);

  const onChange = useCallback(
    (value: string) => {
      const selectedOption = options.find((option) => option.value === value);
      if (selectedOption != undefined) {
        saveShardProfilePreference(selectedOption);
      }
      const next = new URLSearchParams(window.location.search);
      if (value !== DEFAULT_OPTION.value) {
        next.set("ds.profile", value);
      } else {
        next.delete("ds.profile");
      }
      window.location.search = next.toString();
    },
    [options],
  );

  if (!isShardManifest) {
    return ReactNull;
  }

  return (
    <FormControl size="small" variant="outlined" className={classes.formControl}>
      <Select
        value={selectedValue}
        onChange={(e) => {
          onChange(String(e.target.value));
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
