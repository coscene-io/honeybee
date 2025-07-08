// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import InfoIcon from "@mui/icons-material/Info";
import WarningIcon from "@mui/icons-material/Warning";
import { Button, IconButton, CircularProgress, Stack } from "@mui/material";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import {
  CoScenePlaylistStore,
  usePlaylist,
  BagFileInfo,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { PlayerPresence } from "@foxglove/studio-base/players/types";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import { windowAppURLState } from "@foxglove/studio-base/util/appURLState";

import { useAutoDisconnection } from "./hooks/useAutoDisconnection";

// 页面在活跃状态下，连续 30 分钟没有任何操作，则自动断开
const TIMEOUT_CONFIG = {
  foreground: 1000 * 60 * 30, // 前台30分钟
  background: 1000 * 60 * 30, // 后台30分钟
  warning: 1000 * 60 * 5, // 提前5分钟警告
};

const useStyles = makeStyles()((theme) => ({
  mediaGenerationStatusBar: {
    backgroundColor: theme.palette.warning.main,
    color: theme.palette.warning.contrastText,
  },
  mediaGeneratSuccessStatusBar: {
    backgroundColor: theme.palette.success.main,
    color: theme.palette.success.contrastText,
  },
  loadingStatusBar: {
    backgroundColor: theme.palette.background.menu,
    color: theme.palette.text.primary,
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  mediaGenerationErrorStatusBar: {
    backgroundColor: theme.palette.error.main,
    color: theme.palette.error.contrastText,
  },
  autoDisconnectionTips: {
    backgroundColor: theme.palette.warning.main,
    color: theme.palette.warning.contrastText,
  },
}));

const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;
const selectPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

const selectUser = (store: UserStore) => store.user;
const selectDataSource = (state: CoSceneBaseStore) => state.dataSource;

const disableTimeoutSetting = localStorage.getItem("disable_timeout") === "true";

export function AppStateBar(): React.JSX.Element {
  const bagFiles = usePlaylist(selectBagFiles);
  const { classes, theme } = useStyles();
  const { t } = useTranslation("appBar");
  const presence = useMessagePipeline(selectPresence);
  const confirm = useConfirm();
  const urlState = useMessagePipeline(selectUrlState);

  const linkType = urlState?.parameters?.linkType ?? "";
  const dataSource = useBaseInfo(selectDataSource);
  const isDisableTimeout =
    disableTimeoutSetting || dataSource?.id !== "coscene-websocket" || linkType !== "coLink";

  const remainingTime = useAutoDisconnection({
    confirm,
    foregroundTimeout: TIMEOUT_CONFIG.foreground,
    backgroundTimeout: TIMEOUT_CONFIG.background,
    disableTimeout: isDisableTimeout,
  });

  const [showLoadingStatus, setShowLoadingStatus] = useState(false);
  const [timer, setTimer] = useState<NodeJS.Timeout | undefined>(undefined);
  const { layoutActions } = useWorkspaceActions();
  const [layoutTipsOpen, setLayoutTipsOpen] = useState(false);

  const [fileLoadingToastId, setFileLoadingToastId] = useState<string | undefined>(undefined);

  // Add state for controlling visibility of media generation messages
  const [showGeneratingMedia, setShowGeneratingMedia] = useState(true);
  const [showGeneratingMediaSuccess, setShowGeneratingMediaSuccess] = useState(true);
  const [showGeneratingMediaError, setShowGeneratingMediaError] = useState(true);

  const { selectSource } = usePlayerSelection();
  const currentUser = useCurrentUser(selectUser);

  const [initializingTime, setInitializingTime] = useState(0);
  const [bufferingTime, setBufferingTime] = useState(0);

  const analytics = useAnalytics();

  const key = windowAppURLState()?.dsParams?.key;

  const bagFileCount = bagFiles.value?.length ?? 0;

  // bag file doesn't need generate file media
  const normalBagFileCount =
    bagFiles.value?.filter((bagFile: BagFileInfo) => {
      return bagFile.mediaStatues === "OK";
    }).length ?? 0;

  const generatingMediaCount =
    bagFiles.value?.filter((bagFile: BagFileInfo) => {
      return bagFile.mediaStatues === "PROCESSING";
    }).length ?? 0;

  const generatedMediaCount =
    bagFiles.value?.filter((bagFile: BagFileInfo) => {
      return bagFile.mediaStatues === "GENERATED_SUCCESS";
    }).length ?? 0;

  const errorMediaCount =
    bagFiles.value?.filter((bagFile: BagFileInfo) => {
      return bagFile.mediaStatues === "ERROR";
    }).length ?? 0;

  const isGeneratingMediaSuccess =
    bagFileCount > 0 &&
    generatedMediaCount > 0 &&
    normalBagFileCount + generatedMediaCount === bagFileCount;

  const isGeneratingMediaError =
    bagFileCount > 0 &&
    normalBagFileCount + generatedMediaCount + errorMediaCount === bagFileCount &&
    errorMediaCount > 0;

  const loading = presence === PlayerPresence.INITIALIZING || presence === PlayerPresence.BUFFERING;

  useEffect(() => {
    if (presence === PlayerPresence.INITIALIZING) {
      setInitializingTime(Date.now());
    }
    if (presence === PlayerPresence.BUFFERING) {
      setBufferingTime(Date.now());
    }

    if (presence !== PlayerPresence.INITIALIZING && presence !== PlayerPresence.BUFFERING) {
      if (initializingTime > 0) {
        void analytics.logEvent(AppEvent.PLAYER_INITIALIZING_TIME, {
          initializing_time: Date.now() - initializingTime,
        });
        setInitializingTime(0);
      }
      if (bufferingTime > 0) {
        void analytics.logEvent(AppEvent.PLAYER_BUFFERING_TIME, {
          buffering_time: Date.now() - bufferingTime,
        });
        setBufferingTime(0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presence, analytics]);

  useEffect(() => {
    if (timer) {
      clearTimeout(timer);
      setTimer(undefined);
    }
    if (loading) {
      const timeout = setTimeout(() => {
        setShowLoadingStatus(true);
      }, 3000);

      setTimer(timeout);
    } else {
      setShowLoadingStatus(false);
      if (fileLoadingToastId) {
        toast.remove(fileLoadingToastId);
        setFileLoadingToastId(undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, fileLoadingToastId]);

  useEffect(() => {
    const layoutTipsOpenTag = localStorage.getItem("CoScene_noMoreLayoutTips");
    if (layoutTipsOpenTag !== "true") {
      setLayoutTipsOpen(true);
    }
  }, []);

  // Reset visibility when media generation conditions change
  useEffect(() => {
    setShowGeneratingMedia(true);
  }, [generatingMediaCount, generatedMediaCount, normalBagFileCount, bagFileCount]);

  useEffect(() => {
    setShowGeneratingMediaSuccess(true);
  }, [isGeneratingMediaSuccess]);

  useEffect(() => {
    setShowGeneratingMediaError(true);
  }, [isGeneratingMediaError]);

  const handleNoMoreTips = () => {
    localStorage.setItem("CoScene_noMoreLayoutTips", "true");
    setLayoutTipsOpen(false);
  };

  useEffect(() => {
    if (showLoadingStatus && loading && fileLoadingToastId == undefined) {
      const toastId = toast.custom(() => (
        <Stack
          paddingX={1}
          paddingY={1}
          alignItems="center"
          direction="row"
          justifyContent="center"
          className={classes.loadingStatusBar}
          gap={1}
        >
          {/* loading status bar */}
          <CircularProgress
            size={18}
            style={{ color: theme.palette.appBar.primary }}
            variant="indeterminate"
          />
          {t("loadingTips")}
        </Stack>
      ));

      setFileLoadingToastId(toastId);
    }
  }, [
    showLoadingStatus,
    loading,
    classes.loadingStatusBar,
    t,
    theme.palette.appBar.primary,
    fileLoadingToastId,
  ]);

  return (
    <>
      {remainingTime < TIMEOUT_CONFIG.warning && !isDisableTimeout && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="center"
          position="relative"
          className={classes.autoDisconnectionTips}
          paddingY={1}
          gap={1}
        >
          <WarningIcon fontSize="small" />
          {t("autoDisconnectionTips", {
            time: dayjs(remainingTime).format("mm:ss"),
          })}
        </Stack>
      )}

      {generatingMediaCount > 0 &&
        generatedMediaCount + normalBagFileCount < bagFileCount &&
        showGeneratingMedia && (
          <Stack
            direction="row"
            paddingX={3}
            gap={1}
            alignItems="center"
            justifyContent="space-between"
            className={classes.mediaGenerationStatusBar}
          >
            <Stack direction="row" gap={1} alignItems="center">
              <InfoIcon />
              {t("mediaGeneratingTips", {
                successfulCount: generatedMediaCount + normalBagFileCount,
                totalCount: bagFileCount,
              })}
            </Stack>
            <IconButton
              size="small"
              onClick={() => {
                setShowGeneratingMedia(false);
              }}
              style={{
                color: theme.palette.warning.contrastText,
              }}
            >
              <CloseIcon />
            </IconButton>
          </Stack>
        )}

      {isGeneratingMediaSuccess && showGeneratingMediaSuccess && (
        <Stack
          direction="row"
          paddingX={3}
          alignItems="center"
          justifyContent="space-between"
          className={classes.mediaGeneratSuccessStatusBar}
        >
          <Stack direction="row" gap={1} alignItems="center">
            <CheckCircleOutlineIcon />
            {t("mediaSuccessfulGeneration", {
              count: bagFileCount,
            })}
          </Stack>

          <Stack direction="row" gap={1} alignItems="center">
            <Button
              // variant="text"
              onClick={() => {
                selectSource("coscene-data-platform", {
                  type: "connection",
                  params: { ...currentUser, key },
                });
                setShowGeneratingMediaSuccess(false);
              }}
              style={{
                color: theme.palette.success.contrastText,
              }}
            >
              {t("refresh", {
                ns: "cosGeneral",
              })}
            </Button>
            <IconButton
              size="small"
              onClick={() => {
                setShowGeneratingMediaSuccess(false);
              }}
              style={{
                color: theme.palette.success.contrastText,
              }}
            >
              <CloseIcon />
            </IconButton>
          </Stack>
        </Stack>
      )}

      {isGeneratingMediaError && showGeneratingMediaError && (
        <Stack
          direction="row"
          paddingX={3}
          alignItems="center"
          justifyContent="space-between"
          className={classes.mediaGenerationErrorStatusBar}
        >
          <Stack direction="row" gap={1} alignItems="center">
            <InfoIcon />
            {t("mediaGenerationError")}
          </Stack>
          <IconButton
            size="small"
            onClick={() => {
              setShowGeneratingMediaError(false);
            }}
            style={{
              color: theme.palette.error.contrastText,
            }}
          >
            <CloseIcon />
          </IconButton>
        </Stack>
      )}

      {layoutTipsOpen && (
        <Stack direction="row" alignItems="center" justifyContent="center" position="relative">
          <Stack direction="row" alignItems="center">
            <span>{t("layoutGuideliens")}</span>
            <Button
              onClick={() => {
                layoutActions.setOpen(true);
              }}
            >
              {t("toSetupLayout")}
            </Button>
          </Stack>
          <Stack direction="row" alignItems="center" position="absolute" right={8}>
            <Button onClick={handleNoMoreTips}>{t("noMoreTips")}</Button>
            <IconButton
              onClick={() => {
                setLayoutTipsOpen(false);
              }}
            >
              <CloseIcon />
            </IconButton>
          </Stack>
        </Stack>
      )}
    </>
  );
}
