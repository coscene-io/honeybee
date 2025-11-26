// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { create } from "@bufbuild/protobuf";
import { PlanFeatureEnum_PlanFeature } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/enums/plan_feature_pb";
import { Project } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/project_pb";
import { Record } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/record_pb";
import { FileSchema as File_esSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/resources/file_pb";
import { CloudUpload, Check, Clear } from "@mui/icons-material";
import { Tooltip, IconButton, CircularProgress, Typography, Stack } from "@mui/material";
import { useCallback, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { ChoiceRecordDialog } from "@foxglove/studio-base/components/AppBar/UploadFile/ChoiceRecord";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { useEntitlementWithDialog } from "@foxglove/studio-base/context/SubscriptionEntitlementContext";
import { UploadFilesStore, useUploadFiles } from "@foxglove/studio-base/context/UploadFilesContext";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
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
  const analytics = useAnalytics();

  return useCallback(
    async (file: File, record: Record, project: Project) => {
      toast.success(t("uploadingFile"));

      const name = generateFileName({
        filename: file.name,
        recordName: record.name,
      });

      const Es_file = create(File_esSchema, {
        filename: file.name,
        name,
        size: BigInt(file.size),
      });

      const uploadUrlsResult = await consoleApi.generateFileUploadUrls({
        files: [Es_file],
        parent: record.name,
      });

      const url = uploadUrlsResult.preSignedUrls[name] ?? "";

      const abortController = new AbortController();

      try {
        const startTime = Date.now();
        // upload file to target url and update uploading files
        await uploadWithProgress(url, file, "PUT", abortController, (progress) => {
          setUpdateUploadingFiles(file.name, {
            fileBlob: file,
            status: "uploading",
            target: { record, project },
            url,
            progress,
            abortController,
          });
        });

        setUpdateUploadingFiles(file.name, {
          fileBlob: file,
          status: "succeeded",
          target: { record, project },
          url,
          progress: 100,
          abortController,
        });

        void analytics.logEvent(AppEvent.FILE_UPLOAD, {
          record_name: record.name,
          file_name: file.name,
          upload_time: Date.now() - startTime,
          file_size: file.size,
        });
      } catch {
        toast.error(t("uploadFileFailed"));
        setUpdateUploadingFiles(file.name, {
          fileBlob: file,
          status: "failed",
          target: { record, project },
          url,
          progress: 0,
          abortController,
        });
      }
    },
    [analytics, consoleApi, setUpdateUploadingFiles, t],
  );
}

export function UploadFile(): React.JSX.Element {
  const [openChooser, setOpenChooser] = useState(false);

  const currentFile = useUploadFiles(selectCurrentFile);
  const handleUploadFile = useHandleUploadFile();
  const uploadingFiles = useUploadFiles(selectUploadingFiles);
  const loginStatus = useCurrentUser(selectLoginStatus);

  const [entitlement, entitlementDialog] = useEntitlementWithDialog(
    PlanFeatureEnum_PlanFeature.INTERNAL_STORAGE,
  );

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
            <UploadingFileList
              handleReUpload={() => {
                setOpenChooser(true);
              }}
            />
          ) : (
            t("clickToUpload")
          )
        }
        classes={{ tooltip: classes.tooltip }}
        leaveDelay={500}
      >
        <IconButton
          onClick={() => {
            if (
              loginStatus === "alreadyLogin" &&
              currentFile != undefined &&
              (currentFileStatus == undefined || currentFileStatus.status === "failed")
            ) {
              if (entitlement != undefined && entitlement.usage > entitlement.maxQuota) {
                entitlementDialog();
              } else {
                setOpenChooser(true);
              }
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
        onConfirm={(record, project) => {
          if (currentFile != undefined) {
            void handleUploadFile(currentFile, record, project);
          }
        }}
        defaultRecordDisplayName={currentFile?.name}
      />
    </>
  );
}
