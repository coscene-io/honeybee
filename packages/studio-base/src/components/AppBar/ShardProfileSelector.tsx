// SPDX-FileCopyrightText: Copyright (C) 2026 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { Select, MenuItem, FormControl } from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";

// Small AppBar control that lets the user switch the active shard-manifest
// profile without reloading manually. Visible only when the current data
// source is the `shard-manifest` source.
//
// The profile catalog is read from the manifest at runtime. The component
// fetches the manifest URL itself (small JSON, browser-cacheable) and shows
// whichever non-`full` profiles the sharder emitted. Switching rewrites
// `ds.profile=<id>` in the URL and reloads so the IterableSource
// re-initializes with the new selection.

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

const DEFAULT_OPTION: ProfileOption = { value: "", label: "Default (lowest)" };

function profileToOption(p: ManifestProfile): ProfileOption {
  if (p.label && p.label.length > 0 && p.label !== p.id) {
    return { value: p.id, label: p.label };
  }
  // Synthesize a label from params when the manifest's `label` is missing.
  const h = p.params?.h ?? p.params?.height;
  const fps = p.params?.fps;
  if (h && fps) return { value: p.id, label: `${h}p · ${fps}fps` };
  if (h) return { value: p.id, label: `${h}p` };
  return { value: p.id, label: p.id };
}

function profileHeight(p: ManifestProfile): number {
  return p.params?.h ?? p.params?.height ?? 0;
}

export function ShardProfileSelector(): React.JSX.Element | null {
  const search = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);

  const isShardManifest = search.get("ds") === "shard-manifest";
  const manifestUrl = search.get("ds.url") ?? "";
  const currentProfile = search.get("ds.profile") ?? "";

  const [profileOptions, setProfileOptions] = useState<ProfileOption[]>([DEFAULT_OPTION]);

  useEffect(() => {
    if (!isShardManifest || !manifestUrl) return;
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch(manifestUrl);
        if (!resp.ok) return;
        const json = (await resp.json()) as MinimalManifest;
        const fromManifest = (json.profiles ?? [])
          .filter((p) => p.id && p.id !== "full")
          .sort((a, b) => profileHeight(a) - profileHeight(b))
          .map(profileToOption);
        if (!cancelled && fromManifest.length > 0) {
          setProfileOptions([DEFAULT_OPTION, ...fromManifest]);
        }
      } catch {
        // Network error / parse error — silently keep the default-only list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isShardManifest, manifestUrl]);

  const onChange = useCallback((value: string) => {
    const next = new URLSearchParams(window.location.search);
    if (value) {
      next.set("ds.profile", value);
    } else {
      next.delete("ds.profile");
    }
    window.location.search = next.toString();
  }, []);

  if (!isShardManifest) {
    return null;
  }

  return (
    <FormControl size="small" variant="outlined" sx={{ minWidth: 160, mr: 1 }}>
      <Select
        value={currentProfile}
        onChange={(e) => onChange(String(e.target.value))}
        sx={{ height: 32, fontSize: 13 }}
        displayEmpty
      >
        {profileOptions.map((opt) => (
          <MenuItem key={opt.value} value={opt.value}>
            {opt.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
