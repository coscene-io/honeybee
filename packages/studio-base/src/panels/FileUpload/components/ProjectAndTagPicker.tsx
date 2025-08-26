// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useState, useCallback } from "react";

import { Section, Checkbox } from "./ui";
import type { CoSceneClient, UploadConfig } from "../types";

export function ProjectAndTagPicker({
  client,
  value,
  onChange,
}: {
  client: CoSceneClient;
  value: UploadConfig;
  onChange: (v: UploadConfig) => void;
}) {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    setLoadingProjects(true);
    client
      .listProjects()
      .then((ps) => mounted && setProjects(ps))
      .finally(() => mounted && setLoadingProjects(false));
    return () => {
      mounted = false;
    };
  }, [client]);

  useEffect(() => {
    let mounted = true;
    async function fetchTags() {
      if (!value.projectId || !value.addTags) {
        setAvailableTags([]);
        return;
      }
      setLoadingTags(true);
      try {
        const tags = await client.listTags(value.projectId);
        if (mounted) {setAvailableTags(tags);}
        if (mounted && value.tags.length > 0) {
          const filtered = value.tags.filter((t) => tags.includes(t));
          if (filtered.length !== value.tags.length) {onChange({ ...value, tags: filtered });}
        }
      } finally {
        if (mounted) {setLoadingTags(false);}
      }
    }
    fetchTags();
    return () => {
      mounted = false;
    };
  }, [client, value.projectId, value.addTags, value.tags, onChange]);

  const toggleTag = useCallback(
    (t: string) => {
      if (!value.addTags) {return;}
      const set = new Set(value.tags);
      set.has(t) ? set.delete(t) : set.add(t);
      onChange({ ...value, tags: Array.from(set) });
    },
    [value, onChange]
  );

  return (
    <Section
      title="上传目标配置"
      right={
        <span className="text-sm text-gray-500">
          {loadingProjects ? "加载项目…" : value.projectId ? `项目ID: ${value.projectId}` : "未选择项目"}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <label className="text-sm w-24 text-gray-600">上传项目</label>
          <select
            className="border rounded-lg px-2 py-1 text-sm"
            value={value.projectId || ""}
            onChange={(e) => { onChange({ ...value, projectId: e.target.value || null }); }}
          >
            <option value="">请选择项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm w-24 text-gray-600">标签</label>
          <Checkbox
            checked={value.addTags}
            onChange={(v) => { onChange({ ...value, addTags: v, tags: v ? value.tags : [] }); }}
            label="为上传文件添加标签"
          />
        </div>

        {value.addTags && (
          <div className="rounded-xl border p-3">
            <div className="text-sm text-gray-600 mb-2 flex items-center justify-between">
              <span>可选标签（来自所选项目）</span>
              <span className="text-xs text-gray-400">{loadingTags ? "加载中…" : `${availableTags.length} 项`}</span>
            </div>
            {!value.projectId && !loadingTags && <div className="text-xs text-gray-400">请选择项目后再选择标签</div>}
            {value.projectId && availableTags.length === 0 && !loadingTags && (
              <div className="text-xs text-gray-400">该项目暂无可用标签</div>
            )}
            {availableTags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {availableTags.map((t) => (
                  <label key={t} className="text-xs bg-gray-50 border px-2 py-1 rounded-xl inline-flex items-center gap-2">
                    <input type="checkbox" checked={value.tags.includes(t)} onChange={() => { toggleTag(t); }} />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}