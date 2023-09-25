// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo, useState } from "react";
import { useAsyncFn } from "react-use";
import { v4 as uuidv4 } from "uuid";

import { scaleValue as scale } from "@foxglove/den/math";
import Logger from "@foxglove/log";
import { subtract, Time, toSec, fromNanoSec, compare } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoSceneRecordStore,
  useRecord,
  BagFileInfo,
} from "@foxglove/studio-base/context/CoSceneRecordContext";
import {
  TimelineInteractionStateStore,
  useHoverValue,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { timestampToTime } from "@foxglove/studio-base/util/time";

const HOVER_TOLERANCE = 0.01;
const ROS_BAG_MEDIA_TYPE = "application/vnd.ros1.bag";
const CYBER_RT_MEDIA_TYPE = "application/vnd.cyber.rt";
const MCAP_MEDIA_TYPE = "application/vnd.mcap";

const log = Logger.getLogger(__filename);

function positionBag(
  startTime: Time,
  endTime: Time,
  name: string,
  displayName: string,
  currentBagInfo?: {
    fileName: string;
    startTime: number;
    endTime: number;
    isGhostMode: boolean;
    recordName: string;
  },
): BagFileInfo {
  const startSecs = toSec(startTime);
  const endSecs = toSec(endTime);

  if (currentBagInfo?.startTime == undefined) {
    return {
      name,
      displayName,
    };
  }

  const bagFileStartTime = fromNanoSec(BigInt(currentBagInfo.startTime * 1e6));

  const bagFileEndTime = fromNanoSec(BigInt(currentBagInfo.endTime * 1e6));

  const startTimeInSeconds = toSec(bagFileStartTime);
  const endTimeInSeconds = toSec(bagFileEndTime);

  const startPosition = scale(startTimeInSeconds, startSecs, endSecs, 0, 1);
  const endPosition = scale(endTimeInSeconds, startSecs, endSecs, 0, 1);

  return {
    startTime: bagFileStartTime,
    endTime: bagFileEndTime,
    secondsSinceStart: startTimeInSeconds - startSecs,
    isGhostMode: currentBagInfo.isGhostMode,
    startPosition,
    endPosition,
    name,
    displayName,
  };
}

const selectSetRecords = (state: CoSceneRecordStore) => state.setRecord;
const selectBagFiles = (state: CoSceneRecordStore) => state.recordBagFiles;
const selectSetRecordBagFiles = (state: CoSceneRecordStore) => state.setRecordBagFiles;
const selectSetCurrentRecordBagFiles = (state: CoSceneRecordStore) => state.setCurrentBagFiles;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;
const selectSetBagsAtHoverValue = (store: TimelineInteractionStateStore) =>
  store.setBagsAtHoverValue;
const selectHoverBag = (store: TimelineInteractionStateStore) => store.hoveredBag;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;

export function RecordsSyncAdapter(): ReactNull {
  const setRecord = useRecord(selectSetRecords);
  const setRecordBagFiles = useRecord(selectSetRecordBagFiles);
  const setBagsAtHoverValue = useTimelineInteractionState(selectSetBagsAtHoverValue);
  const setCurrentRecordBagFiles = useRecord(selectSetCurrentRecordBagFiles);
  const hoveredBag = useTimelineInteractionState(selectHoverBag);

  const urlState = useMessagePipeline(selectUrlState);
  const consoleApi = useConsoleApi();
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const currentTime = useMessagePipeline(selectCurrentTime);
  const [hoverComponentId] = useState<string>(() => uuidv4());
  const hoverValue = useHoverValue({ componentId: hoverComponentId, isPlaybackSeconds: true });
  const bagFiles = useRecord(selectBagFiles);
  const seek = useMessagePipeline(selectSeek);

  const timeRange = useMemo(() => {
    if (!startTime || !endTime) {
      return undefined;
    }

    return toSec(subtract(endTime, startTime));
  }, [endTime, startTime]);

  const [playlist, syncPlaylist] = useAsyncFn(async () => {
    try {
      if (
        urlState?.parameters?.warehouseId &&
        urlState.parameters.projectId &&
        startTime &&
        endTime
      ) {
        const revisionName =
          urlState.parameters.recordId &&
          urlState.parameters.revisionId &&
          `warehouses/${urlState.parameters.warehouseId}/projects/${urlState.parameters.projectId}/records/${urlState.parameters.recordId}/revisions/${urlState.parameters.revisionId}`;
        const jobRunId =
          urlState.parameters.workflowRunsId &&
          urlState.parameters.jobRunsId &&
          `warehouses/${urlState.parameters.warehouseId}/projects/${urlState.parameters.projectId}/workflowRuns/${urlState.parameters.workflowRunsId}/jobRuns/${urlState.parameters.jobRunsId}`;
        const projectName = `warehouses/${urlState.parameters.warehouseId}/projects/${urlState.parameters.projectId}`;

        const accessToken = localStorage.getItem("coScene_org_jwt");

        return await consoleApi.getPlaylist({
          revisionName,
          jobRunId,
          projectName,
          accessToken: accessToken ?? "",
        });
      }
    } catch (error) {
      setRecord({ loading: false, error });
      setRecordBagFiles({ loading: false, error });
    }
    return false;
  }, [
    consoleApi,
    urlState?.parameters?.warehouseId,
    urlState?.parameters?.projectId,
    urlState?.parameters?.recordId,
    urlState?.parameters?.revisionId,
    urlState?.parameters?.jobRunsId,
    urlState?.parameters?.workflowRunsId,
    setRecord,
    setRecordBagFiles,
    startTime,
    endTime,
  ]);

  const [_records, syncRecords] = useAsyncFn(async () => {
    if (
      urlState?.parameters?.warehouseId &&
      urlState.parameters.projectId &&
      playlist.value != undefined &&
      playlist.value !== false
    ) {
      try {
        const recordName = urlState.parameters.recordId
          ? `warehouses/${urlState.parameters.warehouseId}/projects/${urlState.parameters.projectId}/records/${urlState.parameters.recordId}`
          : playlist.value.bagList[0]?.recordName;
        const filename = urlState.parameters.filename;

        const record = await consoleApi.getRecord({ recordName: recordName ?? "" });
        const recordBagFiles: BagFileInfo[] = [];
        let filesList = record.getHead()?.getFilesList() ?? [];

        // ps: record.getHead is the latest revision of the file, if revision id is available, get the files from getRevision
        if (urlState.parameters.revisionId) {
          const revision = await consoleApi.getRevision({
            revisionName: recordName
              ? `${recordName}/revisions/${urlState.parameters.revisionId}`
              : "",
          });

          filesList = revision.getFilesList();
        }

        const shadowBags = playlist.value.bagList.filter((bag) => bag.isGhostMode);
        const originalBags = playlist.value.bagList.filter((bag) => !bag.isGhostMode);

        // 当url中携带filename时，以对应bag的startTime开始播放
        let bagStartTime = undefined;

        if (shadowBags.length > 0) {
          bagStartTime = shadowBags.find((bag) => bag.fileName === filename);
        } else {
          bagStartTime = originalBags.find((bag) => bag.fileName === filename);
        }

        filesList.forEach((ele) => {
          if (
            ele.getMediaType() === ROS_BAG_MEDIA_TYPE ||
            ele.getMediaType() === CYBER_RT_MEDIA_TYPE ||
            ele.getMediaType() === MCAP_MEDIA_TYPE
          ) {
            if (startTime && endTime && playlist.value != undefined && playlist.value !== false) {
              const currentBagInfo = originalBags.find((bag) => bag.fileName === ele.getFilename());
              recordBagFiles.push(
                positionBag(startTime, endTime, ele.getName(), ele.getFilename(), currentBagInfo),
              );
            }
          }
        });

        shadowBags.forEach((ele) => {
          if (startTime && endTime && playlist.value != undefined && playlist.value !== false) {
            recordBagFiles.push(
              positionBag(startTime, endTime, `shadow/${ele.fileName}`, ele.fileName, ele),
            );
          }
        });

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

        setRecordBagFiles({ loading: false, value: recordBagFiles });
        setRecord({ loading: false, value: record });
      } catch (error) {
        setRecord({ loading: false, error });
        setRecordBagFiles({ loading: false, error });
      }
    }
  }, [
    urlState?.parameters?.warehouseId,
    urlState?.parameters?.projectId,
    urlState?.parameters?.recordId,
    urlState?.parameters?.filename,
    urlState?.parameters?.revisionId,
    playlist.value,
    consoleApi,
    seek,
    setRecordBagFiles,
    setRecord,
    startTime,
    endTime,
  ]);

  useEffect(() => {
    syncPlaylist().catch((error) => log.error(error));
  }, [syncPlaylist]);

  useEffect(() => {
    syncRecords().catch((error) => log.error(error));
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
