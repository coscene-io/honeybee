// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { Checkbox, FormControlLabel, Typography, useTheme } from "@mui/material";
import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactHoverObserver from "react-hover-observer";
import Tree from "react-json-tree";
import { makeStyles } from "tss-react/mui";

import { parseMessagePath, MessagePathStructureItem, MessagePath } from "@foxglove/message-path";
import { compare, Time } from "@foxglove/rostime";
import { Immutable, SettingsTreeAction } from "@foxglove/studio";
import { useDataSourceInfo } from "@foxglove/studio-base/PanelAPI";
import EmptyState from "@foxglove/studio-base/components/EmptyState";
import useGetItemStringWithTimezone from "@foxglove/studio-base/components/JsonTree/useGetItemStringWithTimezone";
import {
  messagePathStructures,
  traverseStructure,
} from "@foxglove/studio-base/components/MessagePathSyntax/messagePathsForDatatype";
import {
  MessagePathDataItem,
  MessageAndData,
} from "@foxglove/studio-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { useMessageDataItem } from "@foxglove/studio-base/components/MessagePathSyntax/useMessageDataItem";
import {
  useMessagePipeline,
  MessagePipelineContext,
} from "@foxglove/studio-base/components/MessagePipeline";
import Panel from "@foxglove/studio-base/components/Panel";
import { usePanelContext } from "@foxglove/studio-base/components/PanelContext";
import Stack from "@foxglove/studio-base/components/Stack";
import { Toolbar } from "@foxglove/studio-base/panels/RawMessages/Toolbar";
import getDiff, {
  DiffObject,
  diffLabels,
  diffLabelsByLabelText,
} from "@foxglove/studio-base/panels/RawMessages/getDiff";
import { Topic } from "@foxglove/studio-base/players/types";
import { usePanelSettingsTreeUpdate } from "@foxglove/studio-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@foxglove/studio-base/types/panels";
import { enumValuesByDatatypeAndField } from "@foxglove/studio-base/util/enums";
import { useJsonTreeTheme } from "@foxglove/studio-base/util/globalConstants";

import { DiffSpan } from "./DiffSpan";
import DiffStats from "./DiffStats";
import MaybeCollapsedValue from "./MaybeCollapsedValue";
import Metadata from "./Metadata";
import Value from "./Value";
import {
  ValueAction,
  getStructureItemForPath,
  getValueActionForValue,
} from "./getValueActionForValue";
import { Constants, NodeState, RawMessagesPanelConfig } from "./types";
import { DATA_ARRAY_PREVIEW_LIMIT, generateDeepKeyPaths, toggleExpansion } from "./utils";

type Props = {
  config: Immutable<RawMessagesPanelConfig>;
  saveConfig: SaveConfig<RawMessagesPanelConfig>;
};

const isSingleElemArray = (obj: unknown): obj is unknown[] => {
  if (!Array.isArray(obj)) {
    return false;
  }
  return obj.filter((a) => a != undefined).length === 1;
};

const dataWithoutWrappingArray = (data: unknown) => {
  return isSingleElemArray(data) && typeof data[0] === "object" ? data[0] : data;
};

const useStyles = makeStyles()((theme) => ({
  topic: {
    fontFamily: theme.typography.body1.fontFamily,
    fontFeatureSettings: `${theme.typography.fontFeatureSettings}, "zero"`,
  },
  hoverObserver: {
    display: "inline-flex",
    alignItems: "center",
  },
}));

const MAX_RENDERED_TIME_ARRAY_LENGTH = 1000;

// Selector functions for player controls
const selectSeekPlayback = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectStartPlayback = (ctx: MessagePipelineContext) => ctx.startPlayback;
const selectPausePlayback = (ctx: MessagePipelineContext) => ctx.pausePlayback;

function RawMessages(props: Props) {
  const {
    palette: { mode: themePreference },
  } = useTheme();
  const { classes } = useStyles();
  const jsonTreeTheme = useJsonTreeTheme();
  const { config, saveConfig } = props;
  const { openSiblingPanel } = usePanelContext();
  const { topicPath, diffMethod, diffTopicPath, diffEnabled, showFullMessageForDiff, fontSize } =
    config;
  const { topics, datatypes } = useDataSourceInfo();
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const { setMessagePathDropConfig } = usePanelContext();

  // Player control hooks
  const seekPlayback = useMessagePipeline(selectSeekPlayback);
  const startPlayback = useMessagePipeline(selectStartPlayback);
  const pausePlayback = useMessagePipeline(selectPausePlayback);

  // Flag bit to indicate that the next message is the previous frame, current frame, next frame.
  const frameState = useRef<"previous" | "current" | "next">("current");
  // 记录我们播放过的每一帧的时间戳，方便用户返回上一帧, 这里要注意⚠️ 在连续播放的情况下，用户看到的是渲染帧，比如当前以一秒 60 帧的速度播放，
  // 用户看到的是 1/60 秒这个时间范围内的最后一帧，如果频率很高，那么用户能看到的只占所有数据的很小一部分，但是我们需要记录所有数据的时间戳，
  // 而不是只记录渲染帧最后一帧的时间戳，这样才能保证用户在点击上一帧的时候看到的是上一条消息，而不是上一个渲染帧的最后一条消息

  // record the timestamp of each frame, so that the user can return to the previous frame, here
  // is the note ⚠️ in the continuous playback case, the user sees the rendered frame, for example,
  // if the current playback speed is 60 frames per second, the user sees the last frame of the
  // 1/60 second time range, if the frequency is high, then the user can only see a very small
  // part of the data, but we need to record the timestamp of all data, rather than just the last
  // frame of the rendered frame, so that the user can see the previous message when clicking the
  // previous frame, rather than the last frame of the previous rendered frame
  const rendedTime = useRef<Time[]>([]);

  // 用于保存next frame操作前的消息数据，避免在next状态下显示中间帧造成抖动
  // Save message data before next frame operation to avoid flickering from intermediate frames
  const frozenMessagesRef = useRef<MessageAndData[] | undefined>();

  // 如果用户是连续播放，我们需要记录播放过的所有消息的时间戳（包括未被展示的消息, 参考 rendedTime 的注释），
  // 但是如果用户手动跳转到一个时间位置，我们需要清空记录
  // 但是上一帧和下一帧的实际上也是一种跳转，所以我们需要一个标记位，来标记这次跳转是产生自用户点击上一帧/下一帧按钮，还是点击进度条跳转的
  // 我们将 onRestore 传入 useMessageDataItem, useMessageDataItem 会在每次监听到跳转之后调用这个函数，
  // onRestore 则需要根据 frameState 的值来决定清空还是保留记录

  // if the user is playing continuously, we need to record the timestamp of all messages (including
  // the messages that are not shown, reference the comment of rendedTime), but if the user manually
  // jumps to a time position, we need to clear the record
  // but the previous frame and the next frame are also a kind of jump, so we need a flag to mark
  // this jump is generated by the user clicking the previous frame/next frame button, or the progress
  // bar jump
  // we will pass onRestore to useMessageDataItem, useMessageDataItem will call this function after
  // receiving a jump, onRestore then needs to decide whether to clear or keep the record according
  // to the value of frameState
  const onRestore = () => {
    if (frameState.current === "current") {
      rendedTime.current = [];
    }

    if (frameState.current === "next" || frameState.current === "previous") {
      frameState.current = "current";
      // 清除冻结状态，恢复正常显示
      // Clear frozen state and resume normal display
      frozenMessagesRef.current = undefined;
    }
  };

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

  const defaultGetItemString = useGetItemStringWithTimezone();
  const getItemString = useMemo(
    () =>
      diffEnabled
        ? (_type: string, data: DiffObject, itemType: React.ReactNode) => (
            <DiffStats data={data} itemType={itemType} />
          )
        : defaultGetItemString,
    [defaultGetItemString, diffEnabled],
  );

  const topicRosPath: MessagePath | undefined = useMemo(
    () => parseMessagePath(topicPath),
    [topicPath],
  );
  const topic: Topic | undefined = useMemo(
    () => topicRosPath && topics.find(({ name }) => name === topicRosPath.topicName),
    [topicRosPath, topics],
  );

  const structures = useMemo(() => messagePathStructures(datatypes), [datatypes]);

  const rootStructureItem: MessagePathStructureItem | undefined = useMemo(() => {
    if (!topic || !topicRosPath || topic.schemaName == undefined) {
      return;
    }
    return traverseStructure(structures[topic.schemaName], topicRosPath.messagePath).structureItem;
  }, [structures, topic, topicRosPath]);

  const [expansion, setExpansion] = useState(config.expansion);

  // Pass an empty path to useMessageDataItem if our path doesn't resolve to a valid topic to avoid
  // spamming the message pipeline with useless subscription requests.
  const matchedMessages = useMessageDataItem(topic ? topicPath : "", {
    historySize: "all",
    onRestore,
  });
  const diffMessages = useMessageDataItem(diffEnabled ? diffTopicPath : "");

  // 在next状态下使用冻结的消息数据，避免显示中间帧
  // Use frozen message data in next state to avoid showing intermediate frames
  const effectiveMessages = useMemo(() => {
    if (frameState.current === "next" && frozenMessagesRef.current) {
      return frozenMessagesRef.current;
    }
    return matchedMessages;
  }, [matchedMessages]);

  const diffTopicObj = diffMessages[0];
  const currTickObj = effectiveMessages[effectiveMessages.length - 1];
  const prevTickObj = effectiveMessages[effectiveMessages.length - 2];

  const inTimetickDiffMode = diffEnabled && diffMethod === Constants.PREV_MSG_METHOD;
  const baseItem = inTimetickDiffMode ? prevTickObj : currTickObj;
  const diffItem = inTimetickDiffMode ? currTickObj : diffTopicObj;

  useEffect(() => {
    if (matchedMessages.length === 0) {
      return;
    }

    // 上一帧的时间已经记录到 renderedTime 中，所以不需要添加对应帧的时间戳
    // the time of the previous frame has already been recorded in renderedTime, so no need to add
    if (frameState.current === "previous") {
      return;
    }

    const latestMessage = matchedMessages[0];

    if (frameState.current === "next" && latestMessage) {
      pausePlayback?.();
      seekPlayback?.(latestMessage.messageEvent.receiveTime);
      return;
    }

    if (latestMessage?.messageEvent.receiveTime) {
      const newTime = latestMessage.messageEvent.receiveTime;

      // Optimization: 99% of the time, new time is the largest value, so add directly to the end
      if (
        rendedTime.current.length === 0 ||
        compare(rendedTime.current[rendedTime.current.length - 1]!, newTime) < 0
      ) {
        // New time is greater than the last time in array, add directly to the end
        rendedTime.current = rendedTime.current.concat(
          matchedMessages.map((message) => message.messageEvent.receiveTime),
        );
      } else {
        // find the index of the time that is less than and closest to newTime
        let closestIndex = -1;
        for (let i = rendedTime.current.length - 1; i >= 0; i--) {
          if (compare(rendedTime.current[i]!, newTime) < 0) {
            closestIndex = i;
            break;
          }
        }

        // if a time is found, delete all elements after it
        if (closestIndex >= 0) {
          rendedTime.current = rendedTime.current.slice(0, closestIndex + 1);
        } else {
          // if no time is found, clear the array
          rendedTime.current = [];
        }

        // add the new time to the end of the array
        rendedTime.current = rendedTime.current.concat(
          matchedMessages.map((message) => message.messageEvent.receiveTime),
        );
      }
    }

    if (rendedTime.current.length > MAX_RENDERED_TIME_ARRAY_LENGTH) {
      rendedTime.current = rendedTime.current.slice(-MAX_RENDERED_TIME_ARRAY_LENGTH);
    }
  }, [matchedMessages, pausePlayback, seekPlayback]);

  const nodes = useMemo(() => {
    if (baseItem) {
      const data = dataWithoutWrappingArray(baseItem.queriedData.map(({ value }) => value));
      return generateDeepKeyPaths(data, 5);
    } else {
      return new Set<string>();
    }
  }, [baseItem]);

  const canExpandAll = useMemo(() => {
    if (expansion === "none") {
      return true;
    }
    if (expansion === "all") {
      return false;
    }
    if (
      typeof expansion === "object" &&
      Object.values(expansion).some((v) => v === NodeState.Collapsed)
    ) {
      return true;
    } else {
      return false;
    }
  }, [expansion]);

  const onTopicPathChange = useCallback(
    (newTopicPath: string) => {
      setExpansion(undefined);
      saveConfig({ topicPath: newTopicPath });
    },
    [saveConfig],
  );

  const onDiffTopicPathChange = useCallback(
    (newDiffTopicPath: string) => {
      saveConfig({ diffTopicPath: newDiffTopicPath });
    },
    [saveConfig],
  );

  const onToggleDiff = useCallback(() => {
    saveConfig({ diffEnabled: !diffEnabled });
  }, [diffEnabled, saveConfig]);

  const onToggleExpandAll = useCallback(() => {
    setExpansion(canExpandAll ? "all" : "none");
  }, [canExpandAll]);

  const onLabelClick = useCallback(
    (keypath: (string | number)[]) => {
      setExpansion((old) => toggleExpansion(old ?? "all", nodes, keypath.join("~")));
    },
    [nodes],
  );

  useEffect(() => {
    saveConfig({ expansion });
  }, [expansion, saveConfig]);

  const getValueLabels = useCallback(
    ({
      constantName,
      label,
      itemValue,
      keyPath,
    }: {
      constantName: string | undefined;
      label: string;
      itemValue: unknown;
      keyPath: ReadonlyArray<number | string>;
    }): { arrLabel: string; itemLabel: string } => {
      let itemLabel = label;
      if (typeof itemValue === "bigint") {
        itemLabel = itemValue.toString();
      }
      // output preview for the first x items if the data is in binary format
      // sample output: Int8Array(331776) [-4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, ...]
      let arrLabel = "";
      if (ArrayBuffer.isView(itemValue)) {
        const array = itemValue as Uint8Array;
        const itemPart = array.slice(0, DATA_ARRAY_PREVIEW_LIMIT).join(", ");
        const length = array.length;
        arrLabel = `(${length}) [${itemPart}${length >= DATA_ARRAY_PREVIEW_LIMIT ? ", …" : ""}] `;
        itemLabel = itemValue.constructor.name;
      }
      if (constantName != undefined) {
        itemLabel = `${itemLabel} (${constantName})`;
      }

      // When we encounter a nsec field (nanosecond) that is a number, we ensure the label displays 9 digits.
      // This helps when visually scanning time values from `sec` and `nsec` fields.
      // A nanosecond label of 099999999 makes it easier to realize this is 0.09 seconds compared to
      // 99999999 which requires some counting to reamize this is also 0.09
      if (keyPath[0] === "nsec" && typeof itemValue === "number") {
        itemLabel = _.padStart(itemLabel, 9, "0");
      }

      return { arrLabel, itemLabel };
    },
    [],
  );

  const renderDiffLabel = useCallback(
    (label: string, itemValue: unknown) => {
      let constantName: string | undefined;
      const { arrLabel, itemLabel } = getValueLabels({
        constantName,
        label,
        itemValue,
        keyPath: [],
      });
      return (
        <Value
          arrLabel={arrLabel}
          basePath=""
          itemLabel={itemLabel}
          itemValue={itemValue}
          valueAction={undefined}
          onTopicPathChange={onTopicPathChange}
          openSiblingPanel={openSiblingPanel}
        />
      );
    },
    [getValueLabels, onTopicPathChange, openSiblingPanel],
  );

  const enumMapping = useMemo(() => enumValuesByDatatypeAndField(datatypes), [datatypes]);

  const valueRenderer = useCallback(
    (
      structureItem: MessagePathStructureItem | undefined,
      data: unknown[],
      queriedData: MessagePathDataItem[],
      label: string,
      itemValue: unknown,
      ...keyPath: (number | string)[]
    ) => (
      <ReactHoverObserver className={classes.hoverObserver}>
        {({ isHovering }: { isHovering: boolean }) => {
          const lastKeyPath = _.last(keyPath) as number;
          let valueAction: ValueAction | undefined;
          if (isHovering) {
            valueAction = getValueActionForValue(
              data[lastKeyPath],
              structureItem,
              keyPath.slice(0, -1).reverse(),
            );
          }

          let constantName: string | undefined;
          if (structureItem) {
            const childStructureItem = getStructureItemForPath(
              structureItem,
              keyPath.slice(0, -1).reverse(),
            );
            if (childStructureItem) {
              // if it's an array index (typeof number) then we want the nearest named array which will be typeof string

              const keyPathIndex = keyPath.findIndex((key) => typeof key === "string");
              const field = keyPath[keyPathIndex];
              if (typeof field === "string") {
                const datatype = childStructureItem.datatype;
                constantName = enumMapping[datatype]?.[field]?.[String(itemValue)];
              }
            }
          }
          const basePath = queriedData[lastKeyPath]?.path ?? "";
          const { arrLabel, itemLabel } = getValueLabels({
            constantName,
            label,
            itemValue,
            keyPath,
          });

          return (
            <Value
              arrLabel={arrLabel}
              basePath={basePath}
              itemLabel={itemLabel}
              itemValue={itemValue}
              valueAction={valueAction}
              onTopicPathChange={onTopicPathChange}
              openSiblingPanel={openSiblingPanel}
            />
          );
        }}
      </ReactHoverObserver>
    ),
    [classes.hoverObserver, enumMapping, getValueLabels, onTopicPathChange, openSiblingPanel],
  );

  const renderSingleTopicOrDiffOutput = useCallback(() => {
    const shouldExpandNode = (keypath: (string | number)[]) => {
      if (expansion === "all") {
        return true;
      }
      if (expansion === "none") {
        return false;
      }

      const joinedPath = keypath.join("~");
      if (expansion && expansion[joinedPath] === NodeState.Collapsed) {
        return false;
      }
      if (expansion && expansion[joinedPath] === NodeState.Expanded) {
        return true;
      }

      return true;
    };

    if (topicPath.length === 0) {
      return <EmptyState>No topic selected</EmptyState>;
    }
    if (diffEnabled && diffMethod === Constants.CUSTOM_METHOD && (!baseItem || !diffItem)) {
      return (
        <EmptyState>{`Waiting to diff next messages from "${topicPath}" and "${diffTopicPath}"`}</EmptyState>
      );
    }

    if (!baseItem) {
      return <EmptyState>Waiting for next message…</EmptyState>;
    }

    const data = dataWithoutWrappingArray(baseItem.queriedData.map(({ value }) => value));
    const hideWrappingArray =
      baseItem.queriedData.length === 1 && typeof baseItem.queriedData[0]?.value === "object";
    const shouldDisplaySingleVal =
      (data != undefined && typeof data !== "object") ||
      (isSingleElemArray(data) && data[0] != undefined && typeof data[0] !== "object");
    const singleVal = isSingleElemArray(data) ? data[0] : data;

    const diffData =
      diffItem && dataWithoutWrappingArray(diffItem.queriedData.map(({ value }) => value));

    const diff = diffEnabled
      ? getDiff({
          before: data,
          after: diffData,
          idLabel: undefined,
          showFullMessageForDiff,
        })
      : {};

    return (
      <Stack
        className={classes.topic}
        flex="auto"
        overflowX="hidden"
        paddingLeft={0.75}
        data-testid="panel-scroll-container"
      >
        <Metadata
          data={data}
          diffData={diffData}
          diff={diff}
          message={baseItem.messageEvent}
          {...(topic ? { datatype: topic.schemaName } : undefined)}
          {...(diffItem ? { diffMessage: diffItem.messageEvent } : undefined)}
        />
        {shouldDisplaySingleVal ? (
          <Typography
            variant="h1"
            fontSize={fontSize}
            whiteSpace="pre-wrap"
            style={{ wordWrap: "break-word" }}
          >
            <MaybeCollapsedValue itemLabel={String(singleVal)} />
          </Typography>
        ) : diffEnabled && _.isEqual({}, diff) ? (
          <EmptyState>No difference found</EmptyState>
        ) : (
          <>
            {diffEnabled && (
              <FormControlLabel
                disableTypography
                checked={showFullMessageForDiff}
                control={
                  <Checkbox
                    size="small"
                    defaultChecked
                    onChange={() => {
                      saveConfig({ showFullMessageForDiff: !showFullMessageForDiff });
                    }}
                  />
                }
                label="Show full msg"
              />
            )}
            <Tree
              labelRenderer={(raw) => (
                <>
                  <DiffSpan>{_.first(raw)}</DiffSpan>
                  {/* https://stackoverflow.com/questions/62319014/make-text-selection-treat-adjacent-elements-as-separate-words */}
                  <span style={{ fontSize: 0 }}>&nbsp;</span>
                </>
              )}
              shouldExpandNode={shouldExpandNode}
              onExpand={(_data, _level, keyPath) => {
                onLabelClick(keyPath);
              }}
              onCollapse={(_data, _level, keyPath) => {
                onLabelClick(keyPath);
              }}
              hideRoot
              invertTheme={false}
              getItemString={getItemString}
              valueRenderer={(valueAsString: string, value, ...keyPath) => {
                if (diffEnabled) {
                  return renderDiffLabel(valueAsString, value);
                }
                if (hideWrappingArray) {
                  // When the wrapping array is hidden, put it back here.
                  return valueRenderer(
                    rootStructureItem,
                    [data],
                    baseItem.queriedData,
                    valueAsString,
                    value,
                    ...keyPath,
                    0,
                  );
                }

                return valueRenderer(
                  rootStructureItem,
                  data as unknown[],
                  baseItem.queriedData,
                  valueAsString,
                  value,
                  ...keyPath,
                );
              }}
              postprocessValue={(rawVal: unknown) => {
                if (rawVal == undefined) {
                  return rawVal;
                }
                const idValue = (rawVal as Record<string, unknown>)[diffLabels.ID.labelText];
                const addedValue = (rawVal as Record<string, unknown>)[diffLabels.ADDED.labelText];
                const changedValue = (rawVal as Record<string, unknown>)[
                  diffLabels.CHANGED.labelText
                ];
                const deletedValue = (rawVal as Record<string, unknown>)[
                  diffLabels.DELETED.labelText
                ];
                if (
                  (addedValue != undefined ? 1 : 0) +
                    (changedValue != undefined ? 1 : 0) +
                    (deletedValue != undefined ? 1 : 0) ===
                    1 &&
                  idValue == undefined
                ) {
                  return addedValue ?? changedValue ?? deletedValue;
                }
                return rawVal;
              }}
              theme={{
                ...jsonTreeTheme,
                tree: { margin: 0 },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                nestedNode: ({ style }, keyPath: any) => {
                  const baseStyle = {
                    ...style,
                    fontSize,
                    paddingTop: 2,
                    paddingBottom: 2,
                    marginTop: 2,
                    textDecoration: "inherit",
                  };
                  if (!diffEnabled) {
                    return { style: baseStyle };
                  }
                  let backgroundColor;
                  let textDecoration;
                  if (diffLabelsByLabelText[keyPath[0]]) {
                    backgroundColor =
                      themePreference === "dark"
                        ? // @ts-expect-error backgroundColor is not a property?
                          diffLabelsByLabelText[keyPath[0]].invertedBackgroundColor
                        : // @ts-expect-error backgroundColor is not a property?
                          diffLabelsByLabelText[keyPath[0]].backgroundColor;
                    textDecoration =
                      keyPath[0] === diffLabels.DELETED.labelText ? "line-through" : "none";
                  }
                  const nestedObj = _.get(diff, keyPath.slice().reverse(), {});
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                  const nestedObjKey = Object.keys(nestedObj)[0];
                  if (nestedObjKey != undefined && diffLabelsByLabelText[nestedObjKey]) {
                    backgroundColor =
                      themePreference === "dark"
                        ? // @ts-expect-error backgroundColor is not a property?
                          diffLabelsByLabelText[nestedObjKey].invertedBackgroundColor
                        : // @ts-expect-error backgroundColor is not a property?
                          diffLabelsByLabelText[nestedObjKey].backgroundColor;
                    textDecoration =
                      nestedObjKey === diffLabels.DELETED.labelText ? "line-through" : "none";
                  }
                  return {
                    style: {
                      ...baseStyle,
                      backgroundColor,
                      textDecoration: textDecoration ?? "inherit",
                    },
                  };
                },
                nestedNodeLabel: ({ style }) => ({
                  style: { ...style, textDecoration: "inherit" },
                }),
                nestedNodeChildren: ({ style }) => ({
                  style: { ...style, textDecoration: "inherit" },
                }),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                value: ({ style }, _nodeType, keyPath: any) => {
                  const baseStyle = {
                    ...style,
                    fontSize,
                    textDecoration: "inherit",
                  };
                  if (!diffEnabled) {
                    return { style: baseStyle };
                  }
                  let backgroundColor;
                  let textDecoration;
                  const nestedObj = _.get(diff, keyPath.slice().reverse(), {});
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                  const nestedObjKey = Object.keys(nestedObj)[0];
                  if (nestedObjKey != undefined && diffLabelsByLabelText[nestedObjKey]) {
                    backgroundColor =
                      themePreference === "dark"
                        ? // @ts-expect-error backgroundColor is not a property?
                          diffLabelsByLabelText[nestedObjKey].invertedBackgroundColor
                        : // @ts-expect-error backgroundColor is not a property?
                          diffLabelsByLabelText[nestedObjKey].backgroundColor;
                    textDecoration =
                      nestedObjKey === diffLabels.DELETED.labelText ? "line-through" : "none";
                  }
                  return {
                    style: {
                      ...baseStyle,
                      backgroundColor,
                      textDecoration: textDecoration ?? "inherit",
                    },
                  };
                },
                label: { textDecoration: "inherit" },
              }}
              data={diffEnabled ? diff : data}
            />
          </>
        )}
      </Stack>
    );
  }, [
    baseItem,
    classes.topic,
    fontSize,
    diffEnabled,
    diffItem,
    diffMethod,
    diffTopicPath,
    expansion,
    getItemString,
    jsonTreeTheme,
    onLabelClick,
    renderDiffLabel,
    rootStructureItem,
    saveConfig,
    showFullMessageForDiff,
    themePreference,
    topic,
    topicPath,
    valueRenderer,
  ]);

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action === "update") {
        if (action.payload.path[0] === "general") {
          if (action.payload.path[1] === "fontSize") {
            saveConfig({
              fontSize:
                action.payload.value != undefined ? (action.payload.value as number) : undefined,
            });
          }
        }
      }
    },
    [saveConfig],
  );

  const handlePreviousFrame = useCallback(() => {
    pausePlayback?.();
    frameState.current = "previous";
    rendedTime.current.pop();
    if (rendedTime.current.length > 0) {
      seekPlayback?.(rendedTime.current[rendedTime.current.length - 1]!);
    }
  }, [pausePlayback, seekPlayback]);

  const handleNextFrame = useCallback(() => {
    // 防止连续快速点击时重复执行next操作
    // Prevent repeated next operations during rapid clicking
    if (frameState.current === "next") {
      return;
    }

    // 在开始next操作前冻结当前消息数据，避免显示中间帧
    // Freeze current message data before starting next operation to avoid intermediate frames
    if (matchedMessages.length > 0) {
      frozenMessagesRef.current = [...matchedMessages];
    }

    frameState.current = "next";
    startPlayback?.();
  }, [startPlayback, matchedMessages]);

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: {
        general: {
          label: "General",
          fields: {
            fontSize: {
              label: "Font size",
              input: "select",
              options: [
                { label: "auto", value: undefined },
                ...Constants.FONT_SIZE_OPTIONS.map((value) => ({
                  label: `${value} px`,
                  value,
                })),
              ],
              value: fontSize,
            },
          },
        },
      },
    });
  }, [actionHandler, fontSize, updatePanelSettingsTree]);

  return (
    <Stack flex="auto" overflow="hidden" position="relative">
      <Toolbar
        canExpandAll={canExpandAll}
        diffEnabled={diffEnabled}
        diffMethod={diffMethod}
        diffTopicPath={diffTopicPath}
        onDiffTopicPathChange={onDiffTopicPathChange}
        onToggleDiff={onToggleDiff}
        onToggleExpandAll={onToggleExpandAll}
        onTopicPathChange={onTopicPathChange}
        onPreviousFrame={handlePreviousFrame}
        onNextFrame={handleNextFrame}
        saveConfig={saveConfig}
        topicPath={topicPath}
      />
      {renderSingleTopicOrDiffOutput()}
    </Stack>
  );
}

const defaultConfig: RawMessagesPanelConfig = {
  diffEnabled: false,
  diffMethod: Constants.CUSTOM_METHOD,
  diffTopicPath: "",
  showFullMessageForDiff: false,
  topicPath: "",
  fontSize: undefined,
};

export default Panel(
  Object.assign(RawMessages, {
    panelType: "RawMessages",
    defaultConfig,
  }),
);
