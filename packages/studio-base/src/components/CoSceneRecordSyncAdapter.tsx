import {
  CoSceneRecordStore,
  useRecord,
  BagFiles,
} from "@foxglove/studio-base/context/CoSceneRecordContext";
import { useConsoleApi } from "@foxglove/studio-base/context/ConsoleApiContext";
import { useAsyncFn } from "react-use";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { Ros1BagMedia } from "@coscene-io/coscene/proto/v1alpha1";
import { useEffect } from "react";
import Logger from "@foxglove/log";

const log = Logger.getLogger(__filename);

const selectSetRecords = (state: CoSceneRecordStore) => state.setRecord;
const selectSetRecordBagMedia = (state: CoSceneRecordStore) => state.setRecordBagMedia;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

export function RecordsSyncAdapter(): ReactNull {
  const setRecord = useRecord(selectSetRecords);
  const setRecordBagMedia = useRecord(selectSetRecordBagMedia);
  const urlState = useMessagePipeline(selectUrlState);
  const consoleApi = useConsoleApi();

  const [_records, syncRecords] = useAsyncFn(async () => {
    if (
      urlState?.parameters?.warehouseId &&
      urlState?.parameters?.projectId &&
      urlState?.parameters?.recordId
    ) {
      const recordName = `warehouses/${urlState?.parameters?.warehouseId}/projects/${urlState?.parameters?.projectId}/records/${urlState?.parameters?.recordId}`;
      const record = await consoleApi.getRecord({ recordName });
      const recordsBagFileMedia: BagFiles = {};

      setRecord({ loading: false, value: record });

      (record.getHead()?.getFilesList() || []).forEach((ele) => {
        if (ele.getFilename().split(".").pop() === "bag") {
          const fileMedia = ele.getMedia();

          const bagFileMedia = Ros1BagMedia.deserializeBinary(fileMedia?.getValue_asU8()!);
          recordsBagFileMedia[ele.getFilename()] = bagFileMedia;

          setRecordBagMedia({ loading: false, value: recordsBagFileMedia });
        }
      });
    }
  }, [
    consoleApi,
    setRecord,
    urlState?.parameters?.warehouseId,
    urlState?.parameters?.projectId,
    urlState?.parameters?.recordId,
  ]);

  useEffect(() => {
    syncRecords().catch((error) => log.error(error));
  }, [syncRecords]);

  return ReactNull;
}
