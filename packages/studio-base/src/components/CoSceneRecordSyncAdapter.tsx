// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Ros1BagMedia } from "@coscene-io/coscene/proto/v1alpha1";
import { useEffect, useMemo } from "react";
import { useAsyncFn } from "react-use";

import { scaleValue as scale } from "@foxglove/den/math";
import Logger from "@foxglove/log";
import { subtract, Time, toSec, fromNanoSec, compare } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import {
  CoSceneRecordStore,
  useRecord,
  BagFileInfo,
} from "@foxglove/studio-base/context/CoSceneRecordContext";
import { useConsoleApi } from "@foxglove/studio-base/context/ConsoleApiContext";
import {
  TimelineInteractionStateStore,
  useHoverValue,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { getPlaylistResponse } from "@foxglove/studio-base/src/services/CoSceneConsoleApi";

const HOVER_TOLERANCE = 0.01;
const ROS_BAG_MEDIA_TYPE = "application/vnd.ros1.bag";

const log = Logger.getLogger(__filename);

function positionBag(
  bagFileMedia: Ros1BagMedia,
  startTime: Time,
  endTime: Time,
  name: string,
  displayName: string,
  playlist: getPlaylistResponse,
): BagFileInfo {
  const startSecs = toSec(startTime);
  const endSecs = toSec(endTime);

  const currentBagInfo = playlist.bagList.find((bag) => bag.fileName === displayName);

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
    media: bagFileMedia,
    startTime: bagFileStartTime,
    endTime: bagFileEndTime,
    secondsSinceStart: startTimeInSeconds - startSecs,
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
  const hoverValue = useHoverValue();
  const bagFiles = useRecord(selectBagFiles);

  const timeRange = useMemo(() => {
    if (!startTime || !endTime) {
      return undefined;
    }

    return toSec(subtract(endTime, startTime));
  }, [endTime, startTime]);

  const [playlist, syncPlaylist] = useAsyncFn(async () => {
    if (
      urlState?.parameters?.warehouseId &&
      urlState.parameters.projectId &&
      urlState.parameters.recordId &&
      urlState.parameters.revisionId
    ) {
      const revisionName = `warehouses/${urlState.parameters.warehouseId}/projects/${urlState.parameters.projectId}/records/${urlState.parameters.recordId}/revisions/${urlState.parameters.revisionId}`;

      const accessToken = localStorage.getItem("coScene_org_jwt");

      return await consoleApi.getPlaylist({ revisionName, accessToken: accessToken ?? "" });
    }

    return false;
  }, [
    consoleApi,
    urlState?.parameters?.warehouseId,
    urlState?.parameters?.projectId,
    urlState?.parameters?.recordId,
    urlState?.parameters?.revisionId,
  ]);

  const [_records, syncRecords] = useAsyncFn(async () => {
    if (
      urlState?.parameters?.warehouseId &&
      urlState.parameters.projectId &&
      urlState.parameters.recordId &&
      playlist.value != undefined &&
      playlist.value !== false
    ) {
      try {
        const recordName = `warehouses/${urlState.parameters.warehouseId}/projects/${urlState.parameters.projectId}/records/${urlState.parameters.recordId}`;
        const record = await consoleApi.getRecord({ recordName });
        const recordBagFiles: BagFileInfo[] = [];

        (record.getHead()?.getFilesList() ?? []).forEach((ele) => {
          if (ele.getMediaType() === ROS_BAG_MEDIA_TYPE) {
            const fileMedia = ele.getMedia();

            const bagFileMedia = Ros1BagMedia.deserializeBinary(
              fileMedia?.getValue_asU8() as Uint8Array,
            );

            if (startTime && endTime && playlist.value != undefined && playlist.value !== false) {
              recordBagFiles.push(
                positionBag(
                  bagFileMedia,
                  startTime,
                  endTime,
                  ele.getName(),
                  ele.getFilename(),
                  playlist.value,
                ),
              );
            }
          }
        });

        recordBagFiles.sort((a, b) =>
          a.startTime && b.startTime ? compare(a.startTime, b.startTime) : a.startTime ? -1 : 1,
        );

        setRecordBagFiles({ loading: false, value: recordBagFiles });
        setRecord({ loading: false, value: record });
      } catch (error) {
        setRecord({ loading: false, error });
        setRecordBagFiles({ loading: false, error });
      }
    }
  }, [
    consoleApi,
    setRecord,
    urlState?.parameters?.warehouseId,
    urlState?.parameters?.projectId,
    urlState?.parameters?.recordId,
    startTime,
    endTime,
    setRecordBagFiles,
    playlist,
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
