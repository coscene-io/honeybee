// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import InfoIcon from "@mui/icons-material/Info";
import { Button } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import Stack from "@foxglove/studio-base/components/Stack";
import {
  CoScenePlaylistStore,
  usePlaylist,
  BagFileInfo,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
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
              successfulCount: generatedMediaCount.length,
              totalCount: allGenerationgMediaCount.length,
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
      {showLoadingStatus && loading && <div>loading status bar</div>}
    </>
  );
}
