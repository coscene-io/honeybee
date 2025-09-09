// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import DiffIcon from "@mui/icons-material/Difference";
import DiffOutlinedIcon from "@mui/icons-material/DifferenceOutlined";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import { IconButton, MenuItem, Select, SelectChangeEvent } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { Topic } from "@foxglove/studio";
import MessagePathInput from "@foxglove/studio-base/components/MessagePathSyntax/MessagePathInput";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import PanelToolbar from "@foxglove/studio-base/components/PanelToolbar";
import Stack from "@foxglove/studio-base/components/Stack";
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import { Constants, RawMessagesPanelConfig } from "./types";

type Props = {
  canExpandAll: boolean;
  diffEnabled: boolean;
  diffMethod: RawMessagesPanelConfig["diffMethod"];
  diffTopicPath: string;
  onDiffTopicPathChange: (path: string) => void;
  onToggleDiff: () => void;
  onToggleExpandAll: () => void;
  onTopicPathChange: (path: string) => void;
  onPreviousFrame?: () => void;
  onNextFrame?: () => void;
  saveConfig: SaveConfig<RawMessagesPanelConfig>;
  topic?: Topic;
  topicPath: string;
};

const useStyles = makeStyles()((theme) => ({
  toolbar: {
    paddingBlock: 0,
    gap: theme.spacing(0.25),
  },
  iconButton: {
    padding: theme.spacing(0.25),

    "&.Mui-selected": {
      color: theme.palette.primary.main,
      backgroundColor: theme.palette.action.selected,
    },
  },
  diffOptions: {
    borderTop: `1px solid ${theme.palette.background.default}`,
    backgroundColor: theme.palette.background.paper,
    padding: theme.spacing(0.25, 0.75),
    paddingInlineEnd: theme.spacing(6.75),
    gap: theme.spacing(0.25),
    display: "flex",
  },
}));

const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;

function ToolbarComponent(props: Props): React.JSX.Element {
  const {
    canExpandAll,
    diffEnabled,
    diffMethod,
    diffTopicPath,
    onDiffTopicPathChange,
    onToggleDiff,
    onToggleExpandAll,
    onTopicPathChange,
    onPreviousFrame,
    onNextFrame,
    saveConfig,
    topic,
    topicPath,
  } = props;

  const { classes, cx } = useStyles();
  const { t } = useTranslation("rawMessages");
  const seek = useMessagePipeline(selectSeek);

  return (
    <>
      <PanelToolbar className={classes.toolbar}>
        <IconButton
          className={cx(classes.iconButton, { "Mui-selected": diffEnabled })}
          title={t("toggleDiff")}
          onClick={onToggleDiff}
          color={diffEnabled ? "default" : "inherit"}
          size="small"
        >
          {diffEnabled ? <DiffIcon fontSize="small" /> : <DiffOutlinedIcon fontSize="small" />}
        </IconButton>
        <IconButton
          className={classes.iconButton}
          title={canExpandAll ? t("expandAll") : t("collapseAll")}
          onClick={onToggleExpandAll}
          data-testid="expand-all"
          size="small"
        >
          {canExpandAll ? <UnfoldMoreIcon fontSize="small" /> : <UnfoldLessIcon fontSize="small" />}
        </IconButton>
        <Stack fullWidth paddingLeft={0.25}>
          <MessagePathInput
            index={0}
            path={topicPath}
            onChange={onTopicPathChange}
            inputStyle={{ height: 20 }}
          />
        </Stack>

        {onPreviousFrame && seek && (
          <IconButton
            className={classes.iconButton}
            title={t("previousFrame")}
            onClick={onPreviousFrame}
            data-testid="previous-frame"
            size="small"
          >
            <KeyboardArrowUpIcon fontSize="small" />
          </IconButton>
        )}
        {onNextFrame && seek && (
          <IconButton
            className={classes.iconButton}
            title={t("nextFrame")}
            onClick={onNextFrame}
            data-testid="next-frame"
            size="small"
          >
            <KeyboardArrowDownIcon fontSize="small" />
          </IconButton>
        )}
      </PanelToolbar>
      {diffEnabled && (
        <div className={classes.diffOptions}>
          <Select
            variant="filled"
            size="small"
            title={t("diffMethod")}
            value={diffMethod}
            MenuProps={{
              slotProps: {
                list: {
                  dense: true,
                },
              },
            }}
            onChange={(event: SelectChangeEvent) => {
              saveConfig({
                diffMethod: event.target.value as RawMessagesPanelConfig["diffMethod"],
              });
            }}
          >
            <MenuItem value={Constants.PREV_MSG_METHOD}>{t("previousMessage")}</MenuItem>
            <MenuItem value={Constants.CUSTOM_METHOD}>{t("custom")}</MenuItem>
          </Select>
          {diffMethod === Constants.CUSTOM_METHOD && (
            <MessagePathInput
              index={1}
              path={diffTopicPath}
              onChange={onDiffTopicPathChange}
              {...(topic ? { prioritizedDatatype: topic.schemaName } : {})}
            />
          )}
        </div>
      )}
    </>
  );
}

export const Toolbar = React.memo(ToolbarComponent);
