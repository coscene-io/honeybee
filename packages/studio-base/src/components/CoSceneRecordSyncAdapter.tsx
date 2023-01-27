import {
  CoSceneRecordStore,
  useRecord,
  BagFileInfo,
} from "@foxglove/studio-base/context/CoSceneRecordContext";
import { useConsoleApi } from "@foxglove/studio-base/context/ConsoleApiContext";
import { useAsyncFn } from "react-use";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { Ros1BagMedia } from "@coscene-io/coscene/proto/v1alpha1";
import { useEffect, useMemo } from "react";
import Logger from "@foxglove/log";
import { subtract, Time, toSec, fromNanoSec, compare } from "@foxglove/rostime";
import { scaleValue as scale } from "@foxglove/den/math";
import {
  TimelineInteractionStateStore,
  useHoverValue,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";

const HOVER_TOLERANCE = 0.01;

const log = Logger.getLogger(__filename);

function positionBag(
  bagFileMedia: Ros1BagMedia,
  startTime: Time,
  endTime: Time,
  name: string,
  displayName: string,
): BagFileInfo {
  const startSecs = toSec(startTime);
  const endSecs = toSec(endTime);

  const bagFileInterval = bagFileMedia.getInterval();

  if (!bagFileInterval) {
    return {
      name,
      displayName,
    };
  }

  const bagFileStartTime = fromNanoSec(
    BigInt(
      bagFileInterval!.getStartTime()!.getSeconds() * 1e9 +
        bagFileInterval!.getStartTime()!.getNanos(),
    ),
  );

  const bagFileEndTime = fromNanoSec(
    BigInt(
      bagFileInterval!.getEndTime()!.getSeconds() * 1e9 + bagFileInterval!.getEndTime()!.getNanos(),
    ),
  );

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

export function RecordsSyncAdapter(): ReactNull {
  const setRecord = useRecord(selectSetRecords);
  const setRecordBagFiles = useRecord(selectSetRecordBagFiles);
  const setBagsAtHoverValue = useTimelineInteractionState(selectSetBagsAtHoverValue);
  const setCurrentRecordBagFiles = useRecord(selectSetCurrentRecordBagFiles);

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

  const [_records, syncRecords] = useAsyncFn(async () => {
    if (
      urlState?.parameters?.warehouseId &&
      urlState?.parameters?.projectId &&
      urlState?.parameters?.recordId &&
      startTime &&
      startTime.sec > 0
    ) {
      try {
        const recordName = `warehouses/${urlState?.parameters?.warehouseId}/projects/${urlState?.parameters?.projectId}/records/${urlState?.parameters?.recordId}`;
        const record = await consoleApi.getRecord({ recordName });
        const recordBagFiles: BagFileInfo[] = [];

        setRecord({ loading: false, value: record });

        (record.getHead()?.getFilesList() || []).forEach((ele) => {
          if (ele.getFilename().split(".").pop() === "bag") {
            const fileMedia = ele.getMedia();

            const bagFileMedia = Ros1BagMedia.deserializeBinary(fileMedia?.getValue_asU8()!);

            if (startTime && endTime) {
              recordBagFiles.push(
                positionBag(bagFileMedia, startTime, endTime, ele.getName(), ele.getFilename()),
              );
            }
          }
        });

        setRecordBagFiles({ loading: false, value: recordBagFiles });
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
  ]);

  useEffect(() => {
    syncRecords().catch((error) => log.error(error));
  }, [syncRecords]);

  // Sync hovered value and hovered bagFiles.
  useEffect(() => {
    if (hoverValue && timeRange != undefined && timeRange > 0) {
      const hoverPosition = scale(hoverValue.value, 0, timeRange, 0, 1);
      const hoveredBagFiles = (bagFiles.value ?? []).filter((bagFile) => {
        if (bagFile.startPosition !== undefined && bagFile.endPosition !== undefined) {
          return (
            hoverPosition >= bagFile.startPosition * (1 - HOVER_TOLERANCE) &&
            hoverPosition <= bagFile.endPosition * (1 + HOVER_TOLERANCE)
          );
        }
        return false;
      });
      setBagsAtHoverValue(hoveredBagFiles);
    } else {
      setBagsAtHoverValue([]);
    }
  }, [hoverValue, setBagsAtHoverValue, timeRange, bagFiles]);

  // Sync current bag
  useEffect(() => {
    if (currentTime && bagFiles.value && bagFiles.value.length > 0) {
      const currentBagNames: BagFileInfo[] = [];
      bagFiles.value.forEach((ele) => {
        if (
          ele.startTime &&
          ele.endTime &&
          compare(ele.startTime, currentTime) < 0 &&
          compare(ele.endTime, currentTime) > 0
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
