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
        const result = await client.listProjects();
        if (mounted) {
          setProjects(result);
        }
      } catch (error) {
        // Handle error silently
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
        const tags = await client.listTags(value.projectId);
        if (mounted) {
          setAvailableTags(tags);
        }
        if (mounted && value.tags.length > 0) {
          const filtered = value.tags.filter((t) => tags.some((tag) => tag.name === t.name));
          if (filtered.length !== value.tags.length) {
            onChange({ ...value, tags: filtered });
          }
        }
      } catch (error) {
        // Handle error silently
      } finally {
        if (mounted) {
          setLoadingTags(false);
        }
      }
    }
    fetchTags();
    return () => {
      mounted = false;
    };
  }, [client, value.projectId, value.addTags, value.tags, onChange, log]);

  const handleTagsChange = useCallback(
    (newTags: Label[]) => {
      if (!value.addTags) {
        return;
      }
      onChange({ ...value, tags: newTags });
    },
    [value, onChange],
  );

  const handleCreateLabel = useCallback(
    async (labelName: string): Promise<Label> => {
      if (!value.projectId) {
        throw new Error("请先选择项目");
      }

      try {
        const newLabel = await client.createLabel(value.projectId, labelName);
        log?.("info", `成功创建标签: ${labelName}`);

        // Refresh the available tags list to include the new label
        const updatedTags = await client.listTags(value.projectId);
        setAvailableTags(updatedTags);

        return newLabel;
      } catch (error) {
        log?.("error", `创建标签失败: ${error}`);
        throw error;
      }
    },
    [client, value.projectId, log],
  );

  return (
    <Section
      title="上传目标配置"
      right={
        <span className="text-sm text-gray-500">
          {loadingProjects
            ? "加载项目…"
            : value.projectId
            ? `项目ID: ${value.projectId}`
            : "未选择项目"}
        </span>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <label style={{ fontSize: "14px", width: "80px", color: "#6b7280", fontWeight: "500" }}>
            上传项目
          </label>
          <select
            style={{
              border: "1px solid #d1d5db",
              borderRadius: "8px",
              padding: "8px 12px",
              fontSize: "14px",
              flex: 1,
              maxWidth: "300px",
              backgroundColor: "white",
            }}
            value={value.projectId || ""}
            onChange={(e) => {
              onChange({ ...value, projectId: e.target.value || undefined });
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

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <label style={{ fontSize: "14px", width: "80px", color: "#6b7280", fontWeight: "500" }}>
            标签
          </label>
          <Checkbox
            checked={value.addTags}
            onChange={(v) => {
              onChange({ ...value, addTags: v, tags: v ? value.tags : [] });
            }}
            label="为上传文件添加标签"
          />
        </div>

        {value.addTags && (
          <div style={{ marginLeft: "92px" }}>
            <div
              style={{
                maxWidth: "400px",
                borderRadius: "12px",
                border: "1px solid #e5e7eb",
                padding: "12px",
              }}
            >
              <div
                style={{
                  fontSize: "13px",
                  color: "#6b7280",
                  marginBottom: "8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontWeight: 500 }}>标签来自所选项目，可直接输入创建新标签</span>
                <span style={{ fontSize: "12px", color: "#9ca3af" }}>
                  {loadingTags ? "加载中…" : `${availableTags.length} 项`}
                </span>
              </div>
              {!value.projectId && !loadingTags && (
                <div style={{ fontSize: "12px", color: "#9ca3af" }}>请选择项目后再选择标签</div>
              )}
              {value.projectId && availableTags.length === 0 && !loadingTags && (
                <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "8px" }}>
                  该项目暂无可用标签，您可以直接输入创建新标签
                </div>
              )}
              {value.projectId && (
                <LabelSelector
                  value={value.tags}
                  options={availableTags}
                  onChange={handleTagsChange}
                  disabled={loadingTags}
                  onCreateLabel={handleCreateLabel}
                  projectId={value.projectId}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
