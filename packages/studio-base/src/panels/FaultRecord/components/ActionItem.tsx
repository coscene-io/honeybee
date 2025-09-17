// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ActionInfo, ActionDurationConfig } from "../types";
import { Button, DurationInput } from "./ui";

interface ActionItemProps {
  action: ActionInfo;
  isRecording: boolean;
  isStartLoading: boolean;
  isStopLoading: boolean;
  durations: ActionDurationConfig;
  onStartRecord: (actionName: string) => void;
  onStopRecord: (actionName: string) => void;
  onShowDetail: (actionName: string) => void;
  onUpdateDurations: (actionName: string, durations: ActionDurationConfig) => void;
}

export default function ActionItem({
  action,
  isRecording,
  isStartLoading,
  isStopLoading,
  durations,
  onStartRecord,
  onStopRecord,
  onShowDetail,
  onUpdateDurations,
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
              fontSize: 14,
              color: "#6b7280",
              marginBottom: 12,
            }}
          >
            {action.topics.length} topics
          </div>

          {/* Duration配置 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <DurationInput
              value={durations.preparationDuration}
              onChange={(newValue) => {
                onUpdateDurations(action.action_name, {
                  ...durations,
                  preparationDuration: newValue,
                });
              }}
              label="触发前时长(秒)"
              min={0}
              allowEmpty
              disabled={isThisActionRecording}
            />
            <DurationInput
              value={durations.recordDuration}
              onChange={(newValue) => {
                onUpdateDurations(action.action_name, {
                  ...durations,
                  recordDuration: newValue,
                });
              }}
              label="录制时长(秒)"
              min={0}
              allowEmpty
              disabled={isThisActionRecording}
            />
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
    </div>
  );
}
