// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ReplayIcon from "@mui/icons-material/Replay";
import { IconButton, LinearProgress, List, ListItem, Stack, Tooltip } from "@mui/material";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { UploadFilesStore, useUploadFiles } from "@foxglove/studio-base/context/UploadFilesContext";

const selectUploadingFiles = (store: UploadFilesStore) => store.uploadingFiles;
const selectCurrentUser = (store: UserStore) => store.user;

const useStyles = makeStyles()(() => ({
  linearProgress: {
    minWidth: "200px",
    width: "100%",
  },
}));

export function UploadingFileList({
  handleReUpload,
}: {
  handleReUpload: () => void;
}): React.JSX.Element {
  const uploadingFiles = useUploadFiles(selectUploadingFiles);
  const currentUser = useCurrentUser(selectCurrentUser);

  const { t } = useTranslation("appBar");
  const { classes } = useStyles();

  return (
    <List>
      {Object.entries(uploadingFiles).map(([name, status]) => (
        <ListItem key={name}>
          <Stack direction="row" alignItems="center" gap={1} width="">
            <Stack alignItems="center" gap={1} display="flex" flex={1}>
              <Stack flex={1}>{name}</Stack>
              <LinearProgress
                className={classes.linearProgress}
                variant="determinate"
                color={
                  status.status === "uploading"
                    ? "primary"
                    : status.status === "failed"
                    ? "error"
                    : "success"
                }
                value={status.progress}
              />
            </Stack>
            <Stack direction="row" alignItems="center" gap={1}>
              <Tooltip title={t("copyRecordLink")}>
                <span>
                  <IconButton
                    onClick={async (e) => {
                      e.stopPropagation();
                      const orgSlug = currentUser?.orgSlug;
                      const targetSite = currentUser?.targetSite;

                      const projectSlug = status.target.project.slug;
                      const recordId = status.target.record.name
                        .split("/records/")[1]
                        ?.split("/")[0];

                      await navigator.clipboard.writeText(
                        `${targetSite}/${orgSlug}/${projectSlug}/records/${recordId}`,
                      );
                      toast.success(t("copyRecordLinkSuccess"));
                    }}
                    disabled={status.status !== "succeeded"}
                  >
                    <ContentCopyIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t("openInBrowser")}>
                <span>
                  <IconButton
                    onClick={async (e) => {
                      e.stopPropagation();
                      const orgSlug = currentUser?.orgSlug;
                      const targetSite = currentUser?.targetSite;

                      const projectSlug = status.target.project.slug;
                      const recordId = status.target.record.name
                        .split("/records/")[1]
                        ?.split("/")[0];

                      window.open(
                        `${targetSite}/${orgSlug}/${projectSlug}/records/${recordId}`,
                        "_blank",
                      );
                    }}
                    disabled={status.status !== "succeeded"}
                  >
                    <OpenInNewIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t("reUpload")}>
                <span>
                  <IconButton
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReUpload();
                    }}
                    disabled={status.status !== "succeeded"}
                  >
                    <ReplayIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Stack>
        </ListItem>
      ))}
    </List>
  );
}
