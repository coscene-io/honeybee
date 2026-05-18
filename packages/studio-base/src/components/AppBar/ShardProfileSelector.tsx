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

type ProfileOption = { value: string; label: string };

interface ManifestProfile {
  id: string;
  modality?: string;
  label?: string;
  params?: { h?: number; height?: number; fps?: number; codec?: string };
}

interface MinimalManifest {
  profiles?: ManifestProfile[];
}

const RAW_PROFILE = "raw";
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

function profileToOption(p: ManifestProfile): ProfileOption {
  if (p.label != undefined && p.label.length > 0 && p.label !== p.id) {
    return { value: p.id, label: p.label };
  }
  // Synthesize a label from params when the manifest's `label` is missing.
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

function profileHeight(p: ManifestProfile): number {
  return p.params?.h ?? p.params?.height ?? 0;
}

function isDefaultVideoProfile(p: ManifestProfile): boolean {
  return p.modality === "video" || p.params?.h != undefined || p.params?.height != undefined;
}

export function ShardProfileSelector(): React.JSX.Element | ReactNull {
  const { classes } = useStyles();
  const { t } = useTranslation("appBar");
  const urlState = useMessagePipeline(selectUrlState);
  const search = useMemo(() => {
    if (typeof window === "undefined") {
      return new URLSearchParams();
    }
    return new URLSearchParams(window.location.search);
  }, []);

  const isShardManifest =
    urlState?.sourceId === "coscene-data-platform" &&
    (urlState.parameters?.[SHARD_MODE_PARAM] === SHARD_MODE_MANIFEST ||
      urlState.parameters?.[SHARD_MODE_PARAM] === SHARD_MODE_RAW);
  const manifestUrl = urlState?.parameters?.[MANIFEST_URL_PARAM] ?? "";
  const currentProfile = search.get("ds.profile") ?? "";
  const rawOption = useMemo<ProfileOption>(
    () => ({ value: RAW_PROFILE, label: t("rawData") }),
    [t],
  );

  const [profileOptions, setProfileOptions] = useState<ProfileOption[]>([]);
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
    if (profileOptions.some((opt) => opt.value === RAW_PROFILE)) {
      return profileOptions;
    }
    return [...profileOptions, rawOption];
  }, [profileOptions, rawOption]);

  const selectedValue = currentProfile === "" ? defaultProfile : currentProfile;

  const onChange = useCallback(
    (value: string) => {
      const next = new URLSearchParams(window.location.search);
      if (value !== "" && value !== defaultProfile) {
        next.set("ds.profile", value);
      } else {
        next.delete("ds.profile");
      }
      window.location.search = next.toString();
    },
    [defaultProfile],
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
