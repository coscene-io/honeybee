// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useState, useCallback } from "react";
import { Label } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/label_pb";

import { Section, Checkbox } from "./ui";
import LabelSelector from "./LabelSelector";
import type { CoSceneClient, UploadConfig } from "../types";

export function ProjectAndTagPicker({
  client,
  value,
  onChange,
  log,
}: {
  client: CoSceneClient;
  value: UploadConfig;
  onChange: (v: UploadConfig) => void;
  log?: (level: "info" | "error" | "warn", message: string) => void;
}) {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);
  const [availableTags, setAvailableTags] = useState<Label[]>([]);

  useEffect(() => {
    let mounted = true;
    async function fetchProjects() {
      setLoadingProjects(true);
      try {
        const clientName = client?.constructor?.name || 'Unknown';
        log?.("info", `[项目下拉] 调用${clientName}.listProjects()`);
        const result = await client.listProjects();
        if (mounted) {
          setProjects(result);
          log?.("info", `[项目下拉] 获取到${result.length}个项目: [${result.map(p => `${p.name}(${p.id})`).join(', ')}]`);
        }
      } catch (error) {
        log?.("error", `[项目下拉] 获取项目失败: ${error}`);
      } finally {
        if (mounted) {
          setLoadingProjects(false);
        }
      }
    }
    fetchProjects();
    return () => {
      mounted = false;
    };
  }, [client, log]);

  useEffect(() => {
    let mounted = true;
    async function fetchTags() {
      if (!value.projectId || !value.addTags) {
        setAvailableTags([]);
        return;
      }
      setLoadingTags(true);
      try {
        const clientName = client?.constructor?.name || 'Unknown';
        log?.("info", `[标签获取] 调用${clientName}.listTags(${value.projectId})`);
        const tags = await client.listTags(value.projectId);
        if (mounted) {
          setAvailableTags(tags);
          log?.("info", `[标签获取] 项目${value.projectId}获取到${tags.length}个标签: [${tags.map(t => t.displayName ?? t.name).join(', ')}]`);
        }
        if (mounted && value.tags.length > 0) {
          const filtered = value.tags.filter((t) => tags.some(tag => tag.name === t.name));
          if (filtered.length !== value.tags.length) {onChange({ ...value, tags: filtered });}
        }
      } catch (error) {
        log?.("error", `[标签获取] 获取项目${value.projectId}标签失败: ${error}`);
      } finally {
        if (mounted) {setLoadingTags(false);}
      }
    }
    fetchTags();
    return () => {
      mounted = false;
    };
  }, [client, value.projectId, value.addTags, value.tags, onChange, log]);

  const handleTagsChange = useCallback(
    (newTags: Label[]) => {
      if (!value.addTags) {return;}
      log?.("info", `[标签选择] 更新标签: [${newTags.map(t => t.displayName ?? t.name).join(', ')}]`);
      onChange({ ...value, tags: newTags });
    },
    [value, onChange, log]
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ fontSize: '14px', width: '80px', color: '#6b7280', fontWeight: '500' }}>上传项目</label>
          <select
            style={{
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '14px',
              flex: 1,
              maxWidth: '300px',
              backgroundColor: 'white'
            }}
            value={value.projectId || ""}
            onChange={(e) => { 
              const oldProject = value.projectId || '未选择';
              const newProject = e.target.value || '未选择';
              const projectName = projects.find(p => p.id === e.target.value)?.name || e.target.value;
              onChange({ ...value, projectId: e.target.value || null });
              log?.("info", `[项目选择] ${oldProject} -> ${newProject} (${projectName})`);
            }}
          >
            <option value="">请选择项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ fontSize: '14px', width: '80px', color: '#6b7280', fontWeight: '500' }}>标签</label>
          <Checkbox
            checked={value.addTags}
            onChange={(v) => { onChange({ ...value, addTags: v, tags: v ? value.tags : [] }); }}
            label="为上传文件添加标签"
          />
        </div>

        {value.addTags && (
          <div style={{ marginLeft: '92px' }}>
             <div style={{ maxWidth: '400px', borderRadius: '12px', border: '1px solid #e5e7eb', padding: '12px' }}>
              <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                 <span>可选标签（来自所选项目）</span>
                 <span style={{ fontSize: '12px', color: '#9ca3af' }}>{loadingTags ? "加载中…" : `${availableTags.length} 项`}</span>
               </div>
               {!value.projectId && !loadingTags && <div style={{ fontSize: '12px', color: '#9ca3af' }}>请选择项目后再选择标签</div>}
               {value.projectId && availableTags.length === 0 && !loadingTags && (
                 <div style={{ fontSize: '12px', color: '#9ca3af' }}>该项目暂无可用标签</div>
               )}
              {availableTags.length > 0 && (
                <LabelSelector
                  value={value.tags}
                  options={availableTags}
                  onChange={handleTagsChange}
                  disabled={loadingTags}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}