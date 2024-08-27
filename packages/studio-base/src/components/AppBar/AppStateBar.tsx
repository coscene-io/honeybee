// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import InfoIcon from "@mui/icons-material/Info";
import { Button, IconButton, CircularProgress, Stack } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import {
  CoScenePlaylistStore,
  usePlaylist,
  BagFileInfo,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { PlayerPresence } from "@foxglove/studio-base/players/types";

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
}));

const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;
const selectPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;

export function AppStateBar(): JSX.Element {
  const bagFiles = usePlaylist(selectBagFiles);
  const { classes, theme } = useStyles();
  const { t } = useTranslation("appBar");
  const presence = useMessagePipeline(selectPresence);
  const [showLoadingStatus, setShowLoadingStatus] = useState(false);
  const [timer, setTimer] = useState<NodeJS.Timeout | undefined>(undefined);
  const { layoutActions } = useWorkspaceActions();
  const [layoutTipsOpen, setLayoutTipsOpen] = useState(false);

  const bagFileCount = bagFiles.value?.length ?? 0;

  // bag file doesn't need generate file media
  const normalBagFileCount = bagFiles.value?.filter((bagFile: BagFileInfo) => {
    return bagFile.mediaStatues === "OK";
  });

  const allGenerationgMediaCount = bagFiles.value?.filter((bagFile: BagFileInfo) => {
    return bagFile.mediaStatues === "PROCESSING" || bagFile.mediaStatues === "GENERATED_SUCCESS";
  });

  const generatedMediaCount = bagFiles.value?.filter((bagFile: BagFileInfo) => {
    return bagFile.mediaStatues === "GENERATED_SUCCESS";
  });

  const loading = presence === PlayerPresence.INITIALIZING || presence === PlayerPresence.BUFFERING;

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    const layoutTipsOpenTag = localStorage.getItem("CoScene_noMoreLayoutTips");
    if (layoutTipsOpenTag !== "true") {
      setLayoutTipsOpen(true);
    }
  }, []);

  const handleNoMoreTips = () => {
    localStorage.setItem("CoScene_noMoreLayoutTips", "true");
    setLayoutTipsOpen(false);
  };

  return (
    <>
      {/* media generating status bar */}
      {allGenerationgMediaCount &&
        generatedMediaCount &&
        allGenerationgMediaCount.length > 0 &&
        allGenerationgMediaCount.length > generatedMediaCount.length && (
          <Stack
            direction="row"
            paddingX={3}
            paddingY={1}
            gap={1}
            alignItems="center"
            className={classes.mediaGenerationStatusBar}
          >
            <InfoIcon />
            {t("mediaGeneratingTips", {
              successfulCount: generatedMediaCount.length + (normalBagFileCount?.length ?? 0),
              totalCount: bagFileCount,
            })}
          </Stack>
        )}

      {/* media generate success status bar */}
      {allGenerationgMediaCount &&
        generatedMediaCount &&
        allGenerationgMediaCount.length > 0 &&
        allGenerationgMediaCount.length === generatedMediaCount.length && (
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
                count: allGenerationgMediaCount.length,
              })}
            </Stack>

            <Button
              variant="text"
              onClick={() => {
                window.location.reload();
              }}
              style={{
                color: theme.palette.success.contrastText,
              }}
            >
              {t("refresh", {
                ns: "cosGeneral",
              })}
            </Button>
          </Stack>
        )}

      {/* loading status bar */}
      {showLoadingStatus && loading && (
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
