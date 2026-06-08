// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2020-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import { IconButton } from "@mui/material";
import { useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import EmptyState from "@foxglove/studio-base/components/EmptyState";
import KeyListener from "@foxglove/studio-base/components/KeyListener";
import MessagePathInput from "@foxglove/studio-base/components/MessagePathSyntax/MessagePathInput";
import { useMessageDataItem } from "@foxglove/studio-base/components/MessagePathSyntax/useMessageDataItem";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Panel from "@foxglove/studio-base/components/Panel";
import { usePanelContext } from "@foxglove/studio-base/components/PanelContext";
import PanelToolbar from "@foxglove/studio-base/components/PanelToolbar";
import Stack from "@foxglove/studio-base/components/Stack";
import { useFrameNavigation } from "@foxglove/studio-base/hooks";
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import Table from "./Table";

type Config = { topicPath: string };
type Props = { config: Config; saveConfig: SaveConfig<Config> };

const useStyles = makeStyles()((theme) => ({
  toolbar: {
    paddingBlock: 0,
    gap: theme.spacing(0.25),
  },
  monospace: {
    fontFamily: theme.typography.fontMonospace,
  },
  iconButton: {
    padding: theme.spacing(0.25),
  },
}));

const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;

function TablePanel({ config, saveConfig }: Props) {
  const { topicPath } = config;
  const { classes } = useStyles();
  const { t } = useTranslation("table");
  const onTopicPathChange = useCallback(
    (newTopicPath: string) => {
      saveConfig({ topicPath: newTopicPath });
    },
    [saveConfig],
  );

  const seek = useMessagePipeline(selectSeek);

  // Use frame navigation hook
  const {
    hasPreFrame,
    handlePreviousFrame,
    handleNextFrame,
    onRestore,
    getEffectiveMessages,
    updateRenderedTime,
    keyDownHandlers,
    keyUpHandlers,
    panelRef,
  } = useFrameNavigation();

  const messageDataItems = useMessageDataItem(topicPath ? topicPath : "", {
    historySize: "all",
    onRestore,
  });
  const effectiveMessages = getEffectiveMessages(messageDataItems);
  const cachedMessages =
    effectiveMessages.length > 0
      ? effectiveMessages[effectiveMessages.length - 1]?.queriedData ?? []
      : [];

  // Update rendered time for frame navigation
  useEffect(() => {
    updateRenderedTime(messageDataItems);
  }, [messageDataItems, updateRenderedTime]);

  const { setMessagePathDropConfig } = usePanelContext();

  useEffect(() => {
    setMessagePathDropConfig({
      getDropStatus(paths) {
        if (paths.length !== 1) {
          return { canDrop: false };
        }
        return { canDrop: true, effect: "replace" };
      },
      handleDrop(paths) {
        const path = paths[0];
        if (path) {
          saveConfig({ topicPath: path.path });
        }
      },
    });
  }, [setMessagePathDropConfig, saveConfig]);

  return (
    <div
      ref={panelRef}
      tabIndex={0}
      style={{
        outline: "none",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      <Stack flex="auto" overflow="hidden" position="relative">
        <PanelToolbar className={classes.toolbar}>
          <MessagePathInput index={0} path={topicPath} onChange={onTopicPathChange} />
          {hasPreFrame && seek && (
            <IconButton
              className={classes.iconButton}
              title={t("previousFrame")}
              onClick={handlePreviousFrame}
              data-testid="previous-frame"
              size="small"
            >
              <KeyboardArrowUpIcon fontSize="small" />
            </IconButton>
          )}
          {seek && (
            <IconButton
              className={classes.iconButton}
              title={t("nextFrame")}
              onClick={() => {
                handleNextFrame(messageDataItems);
              }}
              data-testid="next-frame"
              size="small"
            >
              <KeyboardArrowDownIcon fontSize="small" />
            </IconButton>
          )}
        </PanelToolbar>
        {topicPath.length === 0 && <EmptyState>{t("noTopicSelected")}</EmptyState>}
        {topicPath.length !== 0 && cachedMessages.length === 0 && (
          <EmptyState>{t("waitingForNextMessage")}</EmptyState>
        )}
        {topicPath.length !== 0 && cachedMessages.length > 0 && (
          <Stack overflow="auto" className={classes.monospace}>
            <Table
              value={
                cachedMessages.length > 1
                  ? cachedMessages.map((item) => item.value)
                  : cachedMessages[0]?.value
              }
              accessorPath=""
            />
          </Stack>
        )}
        <KeyListener global keyDownHandlers={keyDownHandlers} keyUpHandlers={keyUpHandlers} />
      </Stack>
    </div>
  );
}

TablePanel.panelType = "Table";
TablePanel.defaultConfig = {
  topicPath: "",
};

export default Panel(TablePanel);
