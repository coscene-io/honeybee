// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ActionInfo } from "../types";

interface ActionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  actionInfo: ActionInfo | undefined;
}

export default function ActionDetailModal({
  isOpen,
  onClose,
  actionInfo,
}: ActionDetailModalProps): React.JSX.Element | null {
  if (!isOpen || !actionInfo) {
    return null;
  }

  // 计算Topics区域的高度：超过4个topic时启用滚动
  const shouldShowScroll = actionInfo.topics.length > 4;
  const topicsHeight = shouldShowScroll ? "200px" : "auto";

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "12px",
          padding: "32px",
          width: "100%",
          maxWidth: "700px",
          maxHeight: "90vh",
          overflow: "hidden",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "24px",
            paddingBottom: "16px",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "24px",
              fontWeight: 700,
              color: "#111827",
              letterSpacing: "-0.025em",
            }}
          >
            Action 详细信息
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "28px",
              cursor: "pointer",
              color: "#6b7280",
              padding: "8px",
              borderRadius: "6px",
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "40px",
              height: "40px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#f3f4f6";
              e.currentTarget.style.color = "#374151";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "#6b7280";
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", paddingRight: "8px" }}>
          {/* Basic Info */}
          <div style={{ marginBottom: "24px" }}>
            <h3
              style={{
                margin: "0 0 16px 0",
                fontSize: "18px",
                fontWeight: 600,
                color: "#111827",
              }}
            >
              基本信息
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: "16px 24px",
                padding: "20px",
                backgroundColor: "#f9fafb",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
              }}
            >
              <div style={{ fontWeight: 600, color: "#374151", fontSize: "14px" }}>
                Action Name:
              </div>
              <div style={{ color: "#111827", fontSize: "14px", fontFamily: "monospace" }}>
                {actionInfo.action_name}
              </div>

              <div style={{ fontWeight: 600, color: "#374151", fontSize: "14px" }}>Mode:</div>
              <div style={{ color: "#111827", fontSize: "14px" }}>{actionInfo.mode}</div>

              <div style={{ fontWeight: 600, color: "#374151", fontSize: "14px" }}>
                Pre-trigger:
              </div>
              <div style={{ color: "#111827", fontSize: "14px" }}>
                {actionInfo.preparation_duration_s}s
              </div>

              <div style={{ fontWeight: 600, color: "#374151", fontSize: "14px" }}>
                Record Duration:
              </div>
              <div style={{ color: "#111827", fontSize: "14px" }}>
                {actionInfo.record_duration_s}s
              </div>

              <div style={{ fontWeight: 600, color: "#374151", fontSize: "14px" }}>Method:</div>
              <div style={{ color: "#111827", fontSize: "14px" }}>
                {actionInfo.method || "未设置"}
              </div>

              <div style={{ fontWeight: 600, color: "#374151", fontSize: "14px" }}>
                Max Record Duration:
              </div>
              <div style={{ color: "#111827", fontSize: "14px" }}>
                {actionInfo.max_record_duration_s && actionInfo.max_record_duration_s > 0
                  ? `${actionInfo.max_record_duration_s}s`
                  : "未设置"}
              </div>

              <div style={{ fontWeight: 600, color: "#374151", fontSize: "14px" }}>
                Auto Upload:
              </div>
              <div style={{ color: "#111827", fontSize: "14px" }}>
                <span
                  style={{
                    padding: "4px 8px",
                    borderRadius: "4px",
                    backgroundColor: actionInfo.is_auto_upload ? "#dcfce7" : "#fee2e2",
                    color: actionInfo.is_auto_upload ? "#166534" : "#dc2626",
                    fontSize: "12px",
                    fontWeight: 500,
                  }}
                >
                  {actionInfo.is_auto_upload ? "Yes" : "No"}
                </span>
              </div>
            </div>
          </div>

          {/* Topics */}
          <div style={{ marginBottom: "24px" }}>
            <h3
              style={{
                margin: "0 0 16px 0",
                fontSize: "18px",
                fontWeight: 600,
                color: "#111827",
              }}
            >
              录制的 Topics ({actionInfo.topics.length} 个)
            </h3>
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                backgroundColor: "#ffffff",
                height: topicsHeight,
                overflow: shouldShowScroll ? "auto" : "visible",
                position: "relative",
              }}
            >
              {actionInfo.topics.length === 0 ? (
                <div
                  style={{
                    padding: "32px",
                    color: "#6b7280",
                    textAlign: "center",
                    fontSize: "14px",
                    fontStyle: "italic",
                  }}
                >
                  没有配置录制的 topics
                </div>
              ) : (
                <div style={{ padding: "16px" }}>
                  {actionInfo.topics.map((topic, index) => (
                    <div
                      key={index}
                      style={{
                        padding: "12px 16px",
                        margin: "0 0 8px 0",
                        backgroundColor: "#f8fafc",
                        borderRadius: "6px",
                        border: "1px solid #e2e8f0",
                        fontFamily: "monospace",
                        fontSize: "13px",
                        color: "#1e293b",
                        wordBreak: "break-all",
                        transition: "all 0.2s ease",
                        cursor: "default",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = "#f1f5f9";
                        e.currentTarget.style.borderColor = "#cbd5e1";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "#f8fafc";
                        e.currentTarget.style.borderColor = "#e2e8f0";
                      }}
                    >
                      {topic}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {shouldShowScroll && (
              <div
                style={{
                  fontSize: "12px",
                  color: "#6b7280",
                  textAlign: "center",
                  marginTop: "8px",
                  fontStyle: "italic",
                }}
              >
                滚动查看更多 topics
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            paddingTop: "16px",
            borderTop: "1px solid #e5e7eb",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "12px 24px",
              backgroundColor: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: 500,
              transition: "all 0.2s ease",
              minWidth: "80px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#2563eb";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#3b82f6";
            }}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
