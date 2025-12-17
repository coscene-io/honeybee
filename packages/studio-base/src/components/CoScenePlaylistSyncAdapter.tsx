// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAsyncFn } from "react-use";
import { v4 as uuidv4 } from "uuid";

import { scaleValue as scale } from "@foxglove/den/math";
import Logger from "@foxglove/log";
import { subtract, toSec, Time, fromNanoSec, compare } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoScenePlaylistStore,
  usePlaylist,
  BagFileInfo,
  PlaylistMediaStatues,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import {
  TimelineInteractionStateStore,
  useHoverValue,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { MediaStatus, FileList } from "@foxglove/studio-base/services/api/CoSceneConsoleApi";
import { stringToColor } from "@foxglove/studio-base/util/coscene";

const HOVER_TOLERANCE = 0.01;

const log = Logger.getLogger(__filename);

function mediaStatusMapping(status: MediaStatus): PlaylistMediaStatues {
  switch (status) {
    case "NORMAL":
      return "OK";
    case "GENERATING":
      return "PROCESSING";
    case "PENDING":
      return "PROCESSING";
    case "GENERATED_SUCCESS":
      return "GENERATED_SUCCESS";
    default:
      return "ERROR";
  }
}

function positionBag({
  source,
  displayName,
  startTime,
  endTime,
  ghostModeFileType,
  projectName,
  recordName,
  currentFileStartTime,
  currentFileEndTime,
  mediaStatus,
}: {
  source: string;
  displayName: string;
  startTime: Time;
  endTime: Time;
  currentFileStartTime: number;
  currentFileEndTime: number;
  projectName: string;
  recordName: string;
  ghostModeFileType: "NORMAL_FILE" | "GHOST_RESULT_FILE" | "GHOST_SOURCE_FILE";
  mediaStatus: MediaStatus;
}): BagFileInfo {
  const startSecs = toSec(startTime);
  const endSecs = toSec(endTime);

  const bagFileStartTime = fromNanoSec(BigInt(currentFileStartTime * 1e6));
  const bagFileEndTime = fromNanoSec(BigInt(currentFileEndTime * 1e6));

  const startTimeInSeconds = toSec(bagFileStartTime);
  const endTimeInSeconds = toSec(bagFileEndTime);

  const startPosition = scale(startTimeInSeconds, startSecs, endSecs, 0, 1);
  const endPosition = scale(endTimeInSeconds, startSecs, endSecs, 0, 1);

  let colorCertificate: string | undefined = undefined;

  if (ghostModeFileType !== "GHOST_RESULT_FILE") {
    colorCertificate = source.split("/files/")[0];
  }

  return {
    startTime: bagFileStartTime,
    endTime: bagFileEndTime,
    secondsSinceStart: startTimeInSeconds - startSecs,
    fileType: ghostModeFileType,
    startPosition,
    endPosition,
    projectDisplayName: projectName,
    recordDisplayName: recordName,
    recordColor: colorCertificate != undefined ? stringToColor(colorCertificate) : undefined,
    name: source,
    displayName,
    mediaStatues: mediaStatusMapping(mediaStatus),
  };
}

const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;
const selectSetBagFiles = (state: CoScenePlaylistStore) => state.setBagFiles;
const selectSetCurrentRecordBagFiles = (state: CoScenePlaylistStore) => state.setCurrentBagFiles;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;

const selectSetBagsAtHoverValue = (store: TimelineInteractionStateStore) =>
  store.setBagsAtHoverValue;
const selectHoverBag = (store: TimelineInteractionStateStore) => store.hoveredBag;
const selectDataSource = (state: CoreDataStore) => state.dataSource;
const selectExternalInitConfig = (state: CoreDataStore) => state.externalInitConfig;

export function PlaylistSyncAdapter(): ReactNull {
  const setBagFiles = usePlaylist(selectSetBagFiles);
  const setBagsAtHoverValue = useTimelineInteractionState(selectSetBagsAtHoverValue);
  const setCurrentRecordBagFiles = usePlaylist(selectSetCurrentRecordBagFiles);
  const hoveredBag = useTimelineInteractionState(selectHoverBag);

  const urlState = useMessagePipeline(selectUrlState);
  const consoleApi = useConsoleApi();
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const seek = useMessagePipeline(selectSeek);

  const [hoverComponentId] = useState<string>(() => uuidv4());
  const hoverValue = useHoverValue({ componentId: hoverComponentId, isPlaybackSeconds: true });
  const bagFiles = usePlaylist(selectBagFiles);

  const dataSource = useCoreData(selectDataSource);
  const externalInitConfig = useCoreData(selectExternalInitConfig);

  const timeRange = useMemo(() => {
    if (!startTime || !endTime) {
      return undefined;
    }

    return toSec(subtract(endTime, startTime));
  }, [endTime, startTime]);

  const baseInfoKey = urlState?.parameters?.key;

  const [playlist, syncPlaylist] = useAsyncFn(async () => {
    try {
      if (baseInfoKey && startTime && endTime) {
        setBagFiles({ loading: true });
        return await consoleApi.getPlaylist(baseInfoKey);
      }
    } catch (error) {
      setBagFiles({ loading: false, error });
    }
    return false;
  }, [baseInfoKey, startTime, endTime, consoleApi, setBagFiles]);

  const updateBagFiles = useCallback(
    (playListFiles: FileList[], mediaStatusList: { filename: string; status: MediaStatus }[]) => {
      if (startTime == undefined || endTime == undefined) {
        return;
      }

      const newStateRecordBagFiles = playListFiles.map((ele) => {
        const currentStatus = mediaStatusList.find((media) => media.filename === ele.source)
          ?.status;
        return positionBag({
          ...ele,
          startTime,
          endTime,
          currentFileStartTime: ele.startTime,
          currentFileEndTime: ele.endTime,
          mediaStatus:
            ele.mediaStatus === "GENERATING" && currentStatus === "NORMAL"
              ? "GENERATED_SUCCESS"
              : currentStatus ?? "GENERATE_INCAPABLE",
        });
      });

      newStateRecordBagFiles.sort((a, b) =>
        a.startTime && b.startTime ? compare(a.startTime, b.startTime) : a.startTime ? -1 : 1,
      );

      setBagFiles({ loading: false, value: newStateRecordBagFiles });
    },
    [startTime, endTime, setBagFiles],
  );

  const [_records, syncRecords] = useAsyncFn(async () => {
    if (
      urlState?.parameters?.key &&
      playlist.value != undefined &&
      playlist.value !== false &&
      startTime != undefined &&
      endTime != undefined
    ) {
      try {
        const recordBagFiles: BagFileInfo[] = [];

        const playListFiles = playlist.value.fileList;

        const hasNoMediaFile = playListFiles.find((ele) => ele.mediaStatus === "GENERATING");

        playListFiles.forEach((ele) => {
          recordBagFiles.push(
            positionBag({
              ...ele,
              startTime,
              endTime,
              currentFileStartTime: ele.startTime,
              currentFileEndTime: ele.endTime,
            }),
          );
        });

        recordBagFiles.sort((a, b) =>
          a.startTime && b.startTime ? compare(a.startTime, b.startTime) : a.startTime ? -1 : 1,
        );

        setBagFiles({ loading: false, value: recordBagFiles });

        if (hasNoMediaFile && baseInfoKey) {
          consoleApi
            .getFilesStatus(baseInfoKey)
            .then((response) => {
              // Get the readable stream from the response body
              // const stream = response.getReader();
              // Get the reader from the stream
              const reader = response.body?.getReader();
              let buffer = "";

              // Define a function to read each chunk
              const readChunk = () => {
                // Read a chunk from the reader
                if (reader == undefined) {
                  return;
                }

                reader
                  .read()
                  .then(({ value, done }) => {
                    const chunk = new TextDecoder().decode(value);

                    buffer += chunk;

                    const messages = buffer.split("\n");
                    buffer = messages.pop() ?? ""; // 保留最后一个可能不完整的消息

                    for (const message of messages) {
                      if (message.trim()) {
                        try {
                          const cleanMessage = message.replace(/^data:/, "").trim();
                          const mediaStatusList: { filename: string; status: MediaStatus }[] =
                            JSON.parse(cleanMessage);
                          updateBagFiles(playListFiles, mediaStatusList);
                        } catch (error) {
                          log.error("decode last chunk error", error, message);
                        }
                      }
                    }

                    if (done) {
                      return;
                    }
                    readChunk(); // 继续读取下一个 chunk
                  })
                  .catch((error: unknown) => {
                    log.error("read chunk error", error);
                    setTimeout(() => {
                      syncRecords().catch((err: unknown) => {
                        log.error("retry syncRecords", err);
                      });
                    }, 3000);
                  });
              };
              // Start reading the first chunk
              readChunk();
            })
            .catch((error: unknown) => {
              console.error(error);
            });
        }
      } catch (error) {
        setBagFiles({ loading: false, error });
      }
    }
  }, [
    urlState?.parameters?.key,
    playlist.value,
    startTime,
    endTime,
    setBagFiles,
    baseInfoKey,
    consoleApi,
    updateBagFiles,
  ]);

  useEffect(() => {
    if (dataSource?.id !== "coscene-data-platform") {
      return;
    }
    syncPlaylist().catch((error: unknown) => {
      log.error(error);
      setBagFiles({ loading: false, error: error as Error });
    });
  }, [dataSource?.id, setBagFiles, syncPlaylist]);

  useEffect(() => {
    syncRecords().catch((error: unknown) => {
      log.error(error);
    });
  }, [syncRecords]);

  // Seek to target file once upon initial load (or when files become available)
  const hasSoughtToTargetFileRef = useRef(false);

  useEffect(() => {
    if (hasSoughtToTargetFileRef.current) {
      return;
    }
    const target = externalInitConfig?.targetFileName ?? "";

    if (target !== "" && bagFiles.value && seek) {
      const targetFile = bagFiles.value.find((ele) => ele.name === target);
      if (targetFile?.startTime != undefined) {
        seek(targetFile.startTime);
        hasSoughtToTargetFileRef.current = true;
      }
    }
  }, [bagFiles.value, externalInitConfig?.targetFileName, seek]);

  // Sync hovered value and hovered bagFiles.
  useEffect(() => {
    if (hoverValue && timeRange != undefined && timeRange > 0) {
      const hoverPosition = scale(hoverValue.value, 0, timeRange, 0, 1);
      const hoveredBagFiles = (bagFiles.value ?? []).filter((bagFile) => {
        if (bagFile.startPosition != undefined && bagFile.endPosition != undefined) {
          return (
            hoverPosition >= bagFile.startPosition * (1 - HOVER_TOLERANCE) &&
            hoverPosition <= bagFile.endPosition * (1 + HOVER_TOLERANCE)
          );
        }
        return false;
      });
      if (hoveredBag == undefined) {
        setBagsAtHoverValue(hoveredBagFiles);
      }
    } else {
      setBagsAtHoverValue([]);
    }
  }, [hoverValue, setBagsAtHoverValue, timeRange, bagFiles, hoveredBag]);

  // Sync current bag
  useEffect(() => {
    if (currentTime && bagFiles.value && bagFiles.value.length > 0) {
      const currentBagNames: BagFileInfo[] = [];
      bagFiles.value.forEach((ele) => {
        if (
          ele.startTime &&
          ele.endTime &&
          compare(ele.startTime, currentTime) <= 0 &&
          compare(ele.endTime, currentTime) >= 0
        ) {
          currentBagNames.push(ele);
        }
      });
      setCurrentRecordBagFiles(currentBagNames);
    } else {
      setCurrentRecordBagFiles([]);
    }
  }, [currentTime, bagFiles, setCurrentRecordBagFiles]);

  return ReactNull;
}
