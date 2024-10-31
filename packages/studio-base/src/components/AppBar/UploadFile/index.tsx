// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { File as File_es } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/file_pb";
import { CloudUpload, Check, Clear } from "@mui/icons-material";
import { Tooltip, IconButton, CircularProgress, Typography, Stack } from "@mui/material";
import { useCallback, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { ChoiceRecordDialog } from "@foxglove/studio-base/components/AppBar/UploadFile/ChoiceRecord";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { UploadFilesStore, useUploadFiles } from "@foxglove/studio-base/context/UploadFilesContext";
import { generateFileName, uploadWithProgress } from "@foxglove/studio-base/util/coscene/upload";

import { UploadingFileList } from "./UploadingFileList";

const selectCurrentFile = (store: UploadFilesStore) => store.currentFile;
const selectUploadingFiles = (store: UploadFilesStore) => store.uploadingFiles;
const selectLoginStatus = (store: UserStore) => store.loginStatus;

const selectSetUpdateUploadingFiles = (store: UploadFilesStore) => store.setUpdateUploadingFiles;

const useStyles = makeStyles()(() => ({
  tooltip: {
    maxWidth: "none",
  },
}));

function useHandleUploadFile() {
  const setUpdateUploadingFiles = useUploadFiles(selectSetUpdateUploadingFiles);
  const { t } = useTranslation("appBar");

  const consoleApi = useConsoleApi();

  return useCallback(
    async (file: File, recordName: string) => {
      toast.success(t("uploadingFile"));

      const name = generateFileName({
        filename: file.name,
        recordName,
      });

      const Es_file = new File_es({
        filename: file.name,
        name,
        size: BigInt(file.size),
      });

      const uploadUrlsResult = await consoleApi.generateFileUploadUrls({
        files: [Es_file],
        parent: recordName,
      });

      const url = uploadUrlsResult.preSignedUrls[name] ?? "";

      const abortController = new AbortController();

      try {
        // upload file to target url and update uploading files
        await uploadWithProgress(url, file, "PUT", abortController, (progress) => {
          setUpdateUploadingFiles(file.name, {
            fileBlob: file,
            status: "uploading",
            target: { recordName },
            url,
            progress,
            abortController,
          });
        });

        setUpdateUploadingFiles(file.name, {
          fileBlob: file,
          status: "succeeded",
          target: { recordName },
          url,
          progress: 100,
          abortController,
        });
      } catch (error) {
        toast.error(t("uploadFileFailed"));
        setUpdateUploadingFiles(file.name, {
          fileBlob: file,
          status: "failed",
          target: { recordName },
          url,
          progress: 0,
          abortController,
        });
      }
    },
    [consoleApi, setUpdateUploadingFiles, t],
  );
}

export function UploadFile(): JSX.Element {
  const [openChooser, setOpenChooser] = useState(false);

  const currentFile = useUploadFiles(selectCurrentFile);
  const handleUploadFile = useHandleUploadFile();
  const uploadingFiles = useUploadFiles(selectUploadingFiles);
  const loginStatus = useCurrentUser(selectLoginStatus);

  const currentFileStatus = uploadingFiles[currentFile?.name ?? ""];

  const { t } = useTranslation("appBar");

  const { classes } = useStyles();

  return (
    <>
      <Tooltip
        describeChild
        title={
          loginStatus !== "alreadyLogin" ? (
            t("loginFirst")
          ) : Object.keys(currentFileStatus ?? {}).length > 0 ? (
            <UploadingFileList />
          ) : (
            t("clickToUpload")
          )
        }
        classes={{ tooltip: classes.tooltip }}
        open
      >
        <IconButton
          onClick={() => {
            if (
              (currentFileStatus == undefined || currentFileStatus.status === "failed") &&
              loginStatus === "alreadyLogin"
            ) {
              setOpenChooser(true);
            }
          }}
        >
          <Stack display="flex" alignItems="center" justifyContent="center">
            {currentFileStatus?.status === "uploading" && (
              <Stack position="relative" display="inline-flex" width={32} height={32}>
                <CircularProgress
                  variant="determinate"
                  size={32}
                  value={currentFileStatus.progress ?? 0}
                />
                <Stack
                  top={0}
                  left={0}
                  bottom={0}
                  right={0}
                  position="absolute"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                >
                  <Typography
                    variant="caption"
                    component="div"
                    color="text.secondary"
                  >{`${Math.round(currentFileStatus.progress ?? 0)}%`}</Typography>
                </Stack>
              </Stack>
            )}
            {currentFileStatus?.status === "succeeded" && <Check color="success" />}
            {currentFileStatus?.status === "failed" && <Clear color="error" />}
            {currentFileStatus == undefined && <CloudUpload />}
          </Stack>
        </IconButton>
      </Tooltip>
      <ChoiceRecordDialog
        open={openChooser}
        onClose={() => {
          setOpenChooser(false);
        }}
        onConfirm={(record) => {
          if (
            currentFile != undefined &&
            (currentFileStatus == undefined || currentFileStatus.status === "failed")
          ) {
            void handleUploadFile(currentFile, record);
          }
        }}
      />
    </>
  );
}
