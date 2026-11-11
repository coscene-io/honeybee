// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ReOrderDotsVertical16Regular } from "@fluentui/react-icons";
import { Badge, Typography } from "@mui/material";
import { FzfResultItem } from "fzf";
import { useCallback, useMemo } from "react";
import { makeStyles } from "tss-react/mui";

import { HighlightChars } from "@foxglove/studio-base/components/HighlightChars";
import { DraggedMessagePath } from "@foxglove/studio-base/components/PanelExtensionAdapter";
import Stack from "@foxglove/studio-base/components/Stack";
import { useMessagePathDrag } from "@foxglove/studio-base/services/messagePathDragging";

import { MessagePathSearchItem } from "./getMessagePathSearchItems";
import { useTopicListStyles } from "./useTopicListStyles";

const useStyles = makeStyles()((theme) => ({
  layout1: {
    color: theme.palette.text.secondary,
  },
}));

export function MessagePathRow({
  messagePathResult,
  style,
  selected,
  onClick,
  onContextMenu,
}: {
  messagePathResult: FzfResultItem<MessagePathSearchItem>;
  style: React.CSSProperties;
  selected: boolean;
  onClick: React.MouseEventHandler<HTMLDivElement>;
  onContextMenu: React.MouseEventHandler<HTMLDivElement>;
}): React.JSX.Element {
  const { classes } = useStyles();

  const { cx, classes: topicClasses } = useTopicListStyles();

  const {
    fullPath,
    suffix: { pathSuffix, type, isLeaf },
    topic,
  } = messagePathResult.item;

  const item: DraggedMessagePath = useMemo(
    () => ({
      path: fullPath,
      rootSchemaName: topic.schemaName,
      isTopic: false,
      isLeaf,
      topicName: topic.name,
    }),
    [fullPath, isLeaf, topic.name, topic.schemaName],
  );

  const { connectDragSource, connectDragPreview, cursor, isDragging, draggedItemCount } =
    useMessagePathDrag({
      item,
      selected,
    });

  const combinedRef: React.Ref<HTMLDivElement> = useCallback(
    (el) => {
      connectDragSource(el);
      connectDragPreview(el);
    },
    [connectDragPreview, connectDragSource],
  );

  return (
    <div
      ref={combinedRef}
      className={cx(topicClasses.row, topicClasses.fieldRow, {
        [topicClasses.isDragging]: isDragging,
        [topicClasses.selected]: selected,
      })}
      style={{ ...style, cursor }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {draggedItemCount > 1 && (
        <Badge
          color="primary"
          className={topicClasses.countBadge}
          badgeContent={draggedItemCount}
        />
      )}
      <Stack flex="auto" direction="row" gap={2} overflow="hidden">
        <Typography variant="body2" noWrap>
          <HighlightChars
            str={pathSuffix}
            indices={messagePathResult.positions}
            offset={messagePathResult.item.offset}
          />
        </Typography>
        <Typography variant="caption" noWrap className={classes.layout1}>
          {type}
        </Typography>
      </Stack>
      <div data-testid="TopicListDragHandle" style={{ cursor }} className={topicClasses.dragHandle}>
        <ReOrderDotsVertical16Regular />
      </div>
    </div>
  );
}
