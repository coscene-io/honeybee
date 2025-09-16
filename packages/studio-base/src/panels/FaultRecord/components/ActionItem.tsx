// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ActionInfo } from "../types";
import { Button } from "./ui";

interface ActionItemProps {
  action: ActionInfo;
  isRecording: boolean;
  isStartLoading: boolean;
  isStopLoading: boolean;
  onStartRecord: (actionName: string) => void;
  onStopRecord: (actionName: string) => void;
  onShowDetail: (actionName: string) => void;
}

export default function ActionItem({
  action,
  isRecording,
  isStartLoading,
  isStopLoading,
  onStartRecord,
  onStopRecord,
  onShowDetail,
}: ActionItemProps): React.JSX.Element {
  const isThisActionRecording = isRecording;

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 16,
        backgroundColor: isThisActionRecording ? "#fef2f2" : "#ffffff",
        marginBottom: 12,
        transition: "all 0.2s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 12,
        }}
      >
        <div style={{ flex: 1 }}>
          <h4
            style={{
              margin: "0 0 8px 0",
              fontSize: 16,
              fontWeight: 600,
              color: "#1f2937",
            }}
          >
            {action.action_name}
          </h4>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "8px 16px",
              fontSize: 14,
              color: "#6b7280",
            }}
          >
            <span style={{ fontWeight: 500 }}>Mode:</span>
            <span>{action.mode}</span>

            <span style={{ fontWeight: 500 }}>Pre-trigger:</span>
            <span>{action.preparation_duration_s}s</span>

            <span style={{ fontWeight: 500 }}>Record Duration:</span>
            <span>{action.record_duration_s}s</span>

            <span style={{ fontWeight: 500 }}>Auto Upload:</span>
            <span>{action.is_auto_upload ? "Yes" : "No"}</span>

            <span style={{ fontWeight: 500 }}>Topics:</span>
            <span>{action.topics.length} topics</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <Button
            onClick={() => {
              onShowDetail(action.action_name);
            }}
            variant="ghost"
            size="default"
          >
            详情
          </Button>

          <Button
            onClick={() => {
              onStartRecord(action.action_name);
            }}
            disabled={isStartLoading || isThisActionRecording}
            loading={isStartLoading && isThisActionRecording}
            variant="primary"
            size="default"
          >
            {isStartLoading && isThisActionRecording ? "启动中..." : "开始录制"}
          </Button>

          <Button
            onClick={() => {
              onStopRecord(action.action_name);
            }}
            disabled={isStopLoading || !isThisActionRecording}
            loading={isStopLoading && isThisActionRecording}
            variant="danger"
            size="default"
          >
            {isStopLoading && isThisActionRecording ? "停止中..." : "停止录制"}
          </Button>
        </div>
      </div>

      {/* Topics preview */}
      {action.topics.length > 0 && (
        <div
          style={{
            borderTop: "1px solid #f3f4f6",
            paddingTop: 12,
            marginTop: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8, fontWeight: 500 }}>
            Topics ({action.topics.length}):
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              maxHeight: 60,
              overflow: "hidden",
            }}
          >
            {action.topics.slice(0, 5).map((topic, index) => (
              <span
                key={index}
                style={{
                  padding: "2px 6px",
                  backgroundColor: "#f3f4f6",
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: "monospace",
                  color: "#374151",
                }}
              >
                {topic}
              </span>
            ))}
            {action.topics.length > 5 && (
              <span
                style={{
                  padding: "2px 6px",
                  color: "#6b7280",
                  fontSize: 11,
                }}
              >
                +{action.topics.length - 5} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
