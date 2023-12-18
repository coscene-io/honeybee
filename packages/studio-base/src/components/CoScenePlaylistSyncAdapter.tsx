// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo, useState } from "react";
import { useAsyncFn } from "react-use";
import { v4 as uuidv4 } from "uuid";

import { scaleValue as scale } from "@foxglove/den/math";
import Logger from "@foxglove/log";
import { subtract, toSec, fromNanoSec, compare } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoScenePlaylistStore,
  usePlaylist,
  BagFileInfo,
  ParamsFile,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import {
  TimelineInteractionStateStore,
  useHoverValue,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { timestampToTime } from "@foxglove/studio-base/util/time";

const HOVER_TOLERANCE = 0.01;

const log = Logger.getLogger(__filename);

function positionBag({
  source,
  displayName,
  startTime,
  endTime,
  isGhostMode,
}: {
  source: string;
  displayName: string;
  startTime: number;
  endTime: number;
  projectName: string;
  recordName: string;
  isGhostMode: boolean;
}): BagFileInfo {
  const startSecs = Math.floor(startTime / 1000);
  const endSecs = Math.floor(endTime / 1000);

  const bagFileStartTime = fromNanoSec(BigInt(startTime * 1e6));

  const bagFileEndTime = fromNanoSec(BigInt(endTime * 1e6));

  const startTimeInSeconds = toSec(bagFileStartTime);
  const endTimeInSeconds = toSec(bagFileEndTime);

  const startPosition = scale(startTimeInSeconds, startSecs, endSecs, 0, 1);
  const endPosition = scale(endTimeInSeconds, startSecs, endSecs, 0, 1);

  return {
    startTime: bagFileStartTime,
    endTime: bagFileEndTime,
    secondsSinceStart: startTimeInSeconds - startSecs,
    isGhostMode,
    startPosition,
    endPosition,
    name: isGhostMode ? "shadow/" + source : source,
    displayName: isGhostMode ? `shadow/${displayName}` : displayName,
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
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;

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
  const seek = useMessagePipeline(selectSeek);

  const timeRange = useMemo(() => {
    if (!startTime || !endTime) {
      return undefined;
    }

    return toSec(subtract(endTime, startTime));
  }, [endTime, startTime]);

  const [playlist, syncPlaylist] = useAsyncFn(async () => {
    try {
      if ((urlState?.parameters?.files, startTime && endTime)) {
        const files: ParamsFile[] = JSON.parse(urlState?.parameters?.files ?? "{}");
        const jobRuns: string[] = [];
        const fileNames: string[] = [];

        files.forEach((file) => {
          if ("filename" in file) {
            fileNames.push(file.filename);
          }

          if ("jobRunsName" in file) {
            jobRuns.push(file.jobRunsName);
          }
        });

        return await consoleApi.getPlaylist({
          jobRuns,
          fileNames,
        });
      }
    } catch (error) {
      setBagFiles({ loading: false, error });
    }
    return false;
  }, [consoleApi, urlState?.parameters?.files, setBagFiles, startTime, endTime]);

  const [_records, syncRecords] = useAsyncFn(async () => {
    if (
      urlState?.parameters?.warehouseId &&
      urlState.parameters.projectId &&
      playlist.value != undefined &&
      playlist.value !== false
    ) {
      try {
        const filename = urlState.parameters.filename;
        const urlFilesInfo: ParamsFile[] = JSON.parse(urlState.parameters.files ?? "{}");

        const recordBagFiles: BagFileInfo[] = [];

        // 当url中携带filename时，以对应bag的startTime开始播放
        let bagStartTime = undefined;

        const playListFiles = playlist.value.fileList;

        if (playListFiles.length > 0) {
          bagStartTime = playListFiles.find((bag) => bag.displayName === filename);
        }

        playListFiles.forEach((ele) => {
          recordBagFiles.push(positionBag(ele));
        });

        const fileNameIdentifier: string[] = [];
        const jobrunsIdentifier: string[] = [];

        urlFilesInfo.forEach((file) => {
          if ("filename" in file) {
            fileNameIdentifier.push(file.filename);
          }

          if ("jobRunsName" in file) {
            jobrunsIdentifier.push(file.jobRunsName);
          }
        });

        // 文件在url中但是不在playlist中，说明文件已经被删除或者没有权限访问
        const allPlayListFilesSource = playListFiles.map((ele) => ele.source);

        fileNameIdentifier
          .filter((ele) => !allPlayListFilesSource.includes(ele))
          .forEach((ele) => {
            recordBagFiles.push({
              name: ele,
              displayName: ele.split("/").pop() ?? "unknow",
            });
          });

        jobrunsIdentifier
          .filter((ele) => !allPlayListFilesSource.includes(ele))
          .forEach((ele) => {
            recordBagFiles.push({
              name: ele,
              displayName: "unknow",
            });
          });
        // ----

        recordBagFiles.sort((a, b) =>
          a.startTime && b.startTime ? compare(a.startTime, b.startTime) : a.startTime ? -1 : 1,
        );

        if (bagStartTime != undefined && seek) {
          seek(timestampToTime(bagStartTime.startTime));

          // Remove the filename parameter from the url
          // to prevent sharing an url that doesn't jump based
          // on the timestamp but on the filename.
          const newURL = new URL(window.location.href);

          newURL.searchParams.delete("ds.filename");

          window.history.replaceState(undefined, "", newURL.href);
        }

        setBagFiles({ loading: false, value: recordBagFiles });
      } catch (error) {
        setBagFiles({ loading: false, error });
      }
    }
  }, [
    urlState?.parameters?.warehouseId,
    urlState?.parameters?.projectId,
    urlState?.parameters?.filename,
    urlState?.parameters?.files,
    playlist.value,
    seek,
    setBagFiles,
  ]);

  useEffect(() => {
    syncPlaylist().catch((error) => {
      log.error(error);
    });
  }, [syncPlaylist]);

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
