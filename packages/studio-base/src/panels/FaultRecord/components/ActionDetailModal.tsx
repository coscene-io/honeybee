// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ActionInfo } from "../types";

interface ActionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  actionInfo: ActionInfo | null;
}

export default function ActionDetailModal({ isOpen, onClose, actionInfo }: ActionDetailModalProps) {
  if (!isOpen || !actionInfo) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: 8,
          padding: "min(24px, 3vw)",
          width: "min(600px, 90%)",
          maxWidth: "90%",
          maxHeight: "80%",
          overflow: "auto",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#1f2937" }}>
            Action 详细信息
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 24,
              cursor: "pointer",
              color: "#6b7280",
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, marginBottom: 16 }}>
            <div style={{ fontWeight: 600, color: "#374151" }}>Action Name:</div>
            <div style={{ color: "#1f2937" }}>{actionInfo.action_name}</div>

            <div style={{ fontWeight: 600, color: "#374151" }}>Mode:</div>
            <div style={{ color: "#1f2937" }}>{actionInfo.mode}</div>

            <div style={{ fontWeight: 600, color: "#374151" }}>Pre-trigger:</div>
            <div style={{ color: "#1f2937" }}>{actionInfo.preparation_duration_s}s</div>

            <div style={{ fontWeight: 600, color: "#374151" }}>Record Duration:</div>
            <div style={{ color: "#1f2937" }}>{actionInfo.record_duration_s}s</div>

            <div style={{ fontWeight: 600, color: "#374151" }}>Auto Upload:</div>
            <div style={{ color: "#1f2937" }}>{actionInfo.is_auto_upload ? "Yes" : "No"}</div>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: "0 0 12px 0", fontSize: 16, fontWeight: 600, color: "#1f2937" }}>
            录制的 Topics ({actionInfo.topics.length} 个)
          </h3>
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              maxHeight: 300,
              overflow: "auto",
              backgroundColor: "#f9fafb",
            }}
          >
            {actionInfo.topics.length === 0 ? (
              <div style={{ padding: 16, color: "#6b7280", textAlign: "center" }}>
                没有配置录制的 topics
              </div>
            ) : (
              <div style={{ padding: 8 }}>
                {actionInfo.topics.map((topic, index) => (
                  <div
                    key={index}
                    style={{
                      padding: "8px 12px",
                      margin: "4px 0",
                      backgroundColor: "white",
                      borderRadius: 4,
                      border: "1px solid #e5e7eb",
                      fontFamily: "monospace",
                      fontSize: 14,
                      color: "#1f2937",
                    }}
                  >
                    {topic}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              backgroundColor: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}