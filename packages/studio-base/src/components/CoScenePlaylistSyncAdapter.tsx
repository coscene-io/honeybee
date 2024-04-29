// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo, useState } from "react";
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
import {
  TimelineInteractionStateStore,
  useHoverValue,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { MediaStatus } from "@foxglove/studio-base/services/CoSceneConsoleApi";
import { stringToColor } from "@foxglove/studio-base/util/coscene";

const HOVER_TOLERANCE = 0.01;

const log = Logger.getLogger(__filename);

function mediaStatusMapping(status: MediaStatus): PlaylistMediaStatues {
  switch (status) {
    case "NORMAL":
      return "OK";
    case "GENERATING":
      return "PROCESSING";
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
  timeMode,
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
  timeMode: "relativeTime" | "absoluteTime";
  mediaStatus: MediaStatus;
}): BagFileInfo {
  const startSecs = toSec(startTime);
  const endSecs = toSec(endTime);

  const bagFileStartTime = fromNanoSec(BigInt(currentFileStartTime * 1e6));
  const bagFileEndTime = fromNanoSec(BigInt(currentFileEndTime * 1e6));

  const startTimeInSeconds = toSec(bagFileStartTime);
  const endTimeInSeconds = toSec(bagFileEndTime);

  const startPosition =
    timeMode === "absoluteTime"
      ? scale(startTimeInSeconds, startSecs, endSecs, 0, 1)
      : scale(0, startSecs, endSecs, 0, 1);
  const endPosition =
    timeMode === "absoluteTime"
      ? scale(endTimeInSeconds, startSecs, endSecs, 0, 1)
      : scale(endTimeInSeconds - startTimeInSeconds, startSecs, endSecs, 0, 1);

  let colorCertificate: string | undefined = undefined;

  if (ghostModeFileType === "NORMAL_FILE" || ghostModeFileType === "GHOST_SOURCE_FILE") {
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
const selectSetBagsAtHoverValue = (store: TimelineInteractionStateStore) =>
  store.setBagsAtHoverValue;
const selectHoverBag = (store: TimelineInteractionStateStore) => store.hoveredBag;

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
  const [hoverComponentId] = useState<string>(() => uuidv4());
  const hoverValue = useHoverValue({ componentId: hoverComponentId, isPlaybackSeconds: true });
  const bagFiles = usePlaylist(selectBagFiles);

  const timeMode = useMemo(() => {
    return localStorage.getItem("CoScene_timeMode") === "relativeTime"
      ? "relativeTime"
      : "absoluteTime";
  }, []);

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
              timeMode,
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
              // Define a function to read each chunk
              const readChunk = () => {
                // Read a chunk from the reader
                if (!reader) {
                  return;
                }

                reader
                  .read()
                  .then(({ value, done }) => {
                    // Check if the stream is done
                    if (done) {
                      const newStateRecordBagFiles: BagFileInfo[] = [];
                      playListFiles.forEach((ele) => {
                        newStateRecordBagFiles.push(
                          positionBag({
                            ...ele,
                            startTime,
                            endTime,
                            currentFileStartTime: ele.startTime,
                            currentFileEndTime: ele.endTime,
                            timeMode,
                            mediaStatus:
                              ele.mediaStatus === "GENERATING"
                                ? "GENERATED_SUCCESS"
                                : ele.mediaStatus,
                          }),
                        );
                      });

                      newStateRecordBagFiles.sort((a, b) =>
                        a.startTime && b.startTime
                          ? compare(a.startTime, b.startTime)
                          : a.startTime
                          ? -1
                          : 1,
                      );

                      setBagFiles({ loading: false, value: newStateRecordBagFiles });

                      return;
                    }

                    // Convert the chunk value to a string
                    const chunkString = new TextDecoder().decode(value);

                    const playlistString = chunkString.split("data:").pop();

                    const mediaStatusList: { filename: string; status: MediaStatus }[] = JSON.parse(
                      playlistString ?? "",
                    );

                    const newStateRecordBagFiles: BagFileInfo[] = [];
                    playListFiles.forEach((ele) => {
                      const currentStatus = mediaStatusList.find(
                        (media) => media.filename === ele.source,
                      )?.status;

                      newStateRecordBagFiles.push(
                        positionBag({
                          ...ele,
                          startTime,
                          endTime,
                          currentFileStartTime: ele.startTime,
                          currentFileEndTime: ele.endTime,
                          timeMode,
                          mediaStatus:
                            ele.mediaStatus === "GENERATING" &&
                            currentStatus != undefined &&
                            currentStatus === "NORMAL"
                              ? "GENERATED_SUCCESS"
                              : ele.mediaStatus,
                        }),
                      );
                    });

                    newStateRecordBagFiles.sort((a, b) =>
                      a.startTime && b.startTime
                        ? compare(a.startTime, b.startTime)
                        : a.startTime
                        ? -1
                        : 1,
                    );

                    setBagFiles({ loading: false, value: newStateRecordBagFiles });

                    // Read the next chunk
                    readChunk();
                  })
                  .catch((error) => {
                    // Log the error
                    console.error(error);
                  });
              };
              // Start reading the first chunk
              readChunk();
            })
            .catch((error) => {
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
    timeMode,
    consoleApi,
  ]);

  useEffect(() => {
    syncPlaylist().catch((error) => {
      log.error(error);
      setBagFiles({ loading: false, error });
    });
  }, [setBagFiles, syncPlaylist]);

  useEffect(() => {
    syncRecords().catch((error) => {
      log.error(error);
    });
  }, [syncRecords]);

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
