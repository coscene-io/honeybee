// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { ImageShadow20Filled } from "@fluentui/react-icons";
import BarChartIcon from "@mui/icons-material/BarChart";
import Clear from "@mui/icons-material/Clear";
import { Stack, alpha } from "@mui/material";
import Tooltip from "@mui/material/Tooltip";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import { useCallback, useState, useMemo } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { subtract, toNanoSec, toDate } from "@foxglove/rostime";
import { HighlightedText } from "@foxglove/studio-base/components/HighlightedText";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import {
  usePlaylist,
  CoScenePlaylistStore,
  BagFileInfo,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { confirmTypes } from "@foxglove/studio-base/hooks/useConfirm";
import { AppURLState } from "@foxglove/studio-base/util/appURLState";

dayjs.extend(duration);

const useStyles = makeStyles<void, "bagMetadata">()((theme, _params, classes) => ({
  lineBox: {
    borderLeft: `1px solid ${theme.palette.divider}`,
    marginLeft: theme.spacing(2.5),
    paddingBottom: "12px",
  },
  bagBox: {
    display: "flex",
    // justifyContent: "space-between",
    flexDirection: "column",
    cursor: "pointer",
    "&:hover": {
      [`.${classes.bagMetadata}`]: {
        backgroundColor: alpha(theme.palette.info.main, theme.palette.action.hoverOpacity),
        borderColor: theme.palette.info.main,
      },
    },
    padding: "12px",
    margin: "0px 15px 0px 12px",
    position: "relative",
    backgroundColor: theme.palette.background.default,
  },
  triangle: {
    width: 0,
    height: 0,
    borderBottom: "24px solid transparent",
    borderLeft: "24px solid #F3F4F6",
    borderRight: "24px solid transparent",
    position: "absolute",
    left: 0,
    top: 0,
  },
  shadowIcon: {
    position: "absolute",
    left: "2px",
    top: "2px",
    width: "10px",
    height: "10px",
    color: theme.palette.primary.main,
  },
  tooltip: {
    position: "absolute",
    width: "24px",
    left: 0,
    top: 0,
  },
  isCurrentBag: {
    color: `${theme.palette.primary.main} !important`,
  },
  bagName: {
    fontFamily: "Inter",
    fontStyle: "normal",
    fontWeight: "400",
    fontSize: "14px",
    lineHeight: "20px",
    color: theme.palette.text.primary,
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  bagStartTime: {
    display: "flex",
    width: "100%",
    justifyContent: "space-between",
    fontFamily: "Inter",
    fontStyle: "normal",
    fontWeight: "400",
    fontSize: "12px",
    lineHeight: "16px",
    color: theme.palette.text.secondary,
  },
  bagMetadata: {
    padding: theme.spacing(1),
  },
  bagLength: {
    fontFamily: "Inter",
    fontStyle: "normal",
    fontWeight: "400",
    fontSize: "12px",
    lineHeight: "16px",
    color: theme.palette.text.secondary,
  },
  unableToPlay: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  barChartIcon: {
    color: theme.palette.primary.main,
    height: "16px",
    width: "16px",
    marginBottom: "-2px",
  },
  hiddenBarChartIcon: {
    display: "none",
  },
  hideDeleteButton: {
    display: "none",
  },
  deleteButton: {
    position: "absolute",
    cursor: "pointer",
    top: "50%",
    transform: "translateY(-50%)",
    right: theme.spacing(2),
    padding: theme.spacing(0.5),
  },
  bagFileName: {
    color: theme.palette.text.primary,
  },
  generateSuccess: {
    backgroundColor: theme.palette.success.main,
    color: theme.palette.success.contrastText,
  },

  generateError: {
    backgroundColor: theme.palette.error.main,
    color: theme.palette.error.contrastText,
  },

  generateProcessing: {
    backgroundColor: theme.palette.warning.main,
    color: theme.palette.warning.contrastText,
  },
}));

const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectExternalInitConfig = (state: CoreDataStore) => state.externalInitConfig;

const checkIsLogFile = (bag: BagFileInfo) => bag.displayName.endsWith(".log");

const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;
const selectUser = (store: UserStore) => store.user;

function BagViewComponent(params: {
  bag: BagFileInfo;
  filter: string;
  isHovered: boolean;
  isCurrent: boolean;
  updateUrl: (newState: AppURLState) => void;
  onClick: (bag: BagFileInfo) => void;
  onHoverStart: (bag: BagFileInfo) => void;
  onHoverEnd: (bag: BagFileInfo) => void;
  confirm: confirmTypes;
}) {
  const {
    bag,
    filter,
    isHovered,
    isCurrent,
    updateUrl,
    onClick,
    onHoverStart,
    onHoverEnd,
    confirm,
  } = params;
  const { classes, cx } = useStyles();
  const { formatTime } = useAppTimeFormat();
  const { t } = useTranslation("playList");
  const [boxIsHovered, setBoxIsHovered] = useState<boolean>(false);
  const urlState = useMessagePipeline(selectUrlState);
  const consoleApi = useConsoleApi();
  const externalInitConfig = useCoreData(selectExternalInitConfig);

  const currentUser = useCurrentUser(selectUser);
  const { selectSource } = usePlayerSelection();

  const bagFiles = usePlaylist(selectBagFiles);

  const isLogFile = checkIsLogFile(bag);

  const files = useMemo(() => {
    return externalInitConfig?.files ?? [];
  }, [externalInitConfig?.files]);

  /**
   *  - cannot delete shadow mode files
   *
   *  - In order to support record level files, if any file is deleted,
   *  the deleted file is removed from the list of files returned
   *  in the playlist and the remaining files are added back to the file list.
   */
  const deleteBag = useCallback(() => {
    const newFiles = files.filter((file) => {
      if ("jobRunsName" in file) {
        return true;
      }

      return false;
    });

    bagFiles.value?.forEach((file) => {
      if (
        file.fileType === "GHOST_RESULT_FILE" ||
        file.fileType === "GHOST_SOURCE_FILE" ||
        file.name === bag.name
      ) {
        return;
      }

      newFiles.push({
        filename: file.name,
      });
    });

    if (urlState != undefined) {
      consoleApi
        .setExternalInitConfig({
          ...externalInitConfig,
          files: newFiles,
        })
        .then((key) => {
          updateUrl({
            dsParams: {
              key,
            },
          });

          selectSource("coscene-data-platform", {
            type: "connection",
            params: { ...currentUser, key },
          });
        })
        .catch((error: unknown) => {
          toast.error(t("addFilesFailed"));
          console.error("Failed to set base info", error);
        });
    }
  }, [
    files,
    bagFiles.value,
    urlState,
    bag.name,
    consoleApi,
    externalInitConfig,
    updateUrl,
    selectSource,
    currentUser,
    t,
  ]);

  const onDeleteBag = useCallback(async () => {
    const response = await confirm({
      title: t("deleteConfirmTitle"),
      prompt: t("deleteConfirmPrompt", {
        filename: bag.displayName,
      }),
      ok: t("remove"),
      cancel: t("cancel", {
        ns: "general",
      }),
      variant: "danger",
    });
    if (response !== "ok") {
      return;
    }

    deleteBag();
  }, [confirm, bag, deleteBag, t]);

  return (
    <div className={classes.lineBox}>
      <Stack
        className={cx(classes.bagBox, {
          [classes.unableToPlay]: !bag.startTime && !isLogFile,
          [classes.isCurrentBag]: isCurrent || isHovered,
        })}
        onClick={() => {
          onClick(bag);
        }}
        onMouseEnter={() => {
          onHoverStart(bag);
          setBoxIsHovered(true);
        }}
        onMouseLeave={() => {
          onHoverEnd(bag);
          setBoxIsHovered(false);
        }}
        borderRadius={bag.mediaStatues === "OK" ? "4px" : "4px 4px 0 0"}
        gap="4px"
      >
        <Stack
          className={cx(classes.bagName, {
            [classes.isCurrentBag]: isCurrent || isHovered,
          })}
        >
          <BarChartIcon
            className={cx(classes.barChartIcon, {
              [classes.hiddenBarChartIcon]: !isCurrent,
            })}
          />
          {isLogFile ? (
            <span className={classes.bagFileName}>{bag.displayName}</span>
          ) : (
            <HighlightedText text={bag.displayName} highlight={filter} />
          )}
        </Stack>
        {bag.startTime && bag.endTime && bag.mediaStatues === "OK" && (
          <Stack
            className={cx(classes.bagLength, {
              [classes.isCurrentBag]: isCurrent || isHovered,
            })}
          >
            <HighlightedText
              text={(() => {
                const timeDuration = dayjs.duration(
                  Number(toNanoSec(subtract(bag.endTime, bag.startTime))) / 1e9,
                  "seconds",
                );
                const hours = Math.floor(timeDuration.asHours());
                const minutes = timeDuration.minutes();
                const seconds = timeDuration.seconds();
                return hours > 0 ? `${hours}h:${minutes}m:${seconds}s` : `${minutes}m:${seconds}s`;
              })()}
              highlight={filter}
            />
          </Stack>
        )}

        {bag.startTime && bag.endTime && bag.mediaStatues === "OK" && (
          <Stack>
            <span
              className={cx(classes.bagStartTime, {
                [classes.isCurrentBag]: isCurrent || isHovered,
              })}
            >
              {!isLogFile && (
                <HighlightedText
                  text={`${dayjs(toDate(bag.startTime)).format("YYYY-MM-DD")} ${formatTime(
                    bag.startTime,
                  )}`}
                  highlight={filter}
                />
              )}
            </span>
          </Stack>
        )}

        {bag.fileType === "GHOST_RESULT_FILE" && (
          <Tooltip title={t("shadowMode")} placement="top" className={classes.tooltip}>
            <div>
              <div className={classes.triangle} />
              <ImageShadow20Filled className={classes.shadowIcon} />
            </div>
          </Tooltip>
        )}
        {bag.fileType !== "GHOST_RESULT_FILE" && bag.fileType !== "GHOST_SOURCE_FILE" && (
          <Clear
            className={cx(classes.deleteButton, {
              [classes.hideDeleteButton]: !boxIsHovered,
            })}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteBag().catch((err: unknown) => {
                console.error(err);
              });
            }}
          />
        )}
      </Stack>
      {bag.mediaStatues === "GENERATED_SUCCESS" && (
        <Stack
          marginLeft="12px"
          marginRight="15px"
          paddingX="12px"
          paddingY="4px"
          className={classes.generateSuccess}
          borderRadius="0 0 4px 4px"
          direction="row"
          gap="4px"
        >
          {t("generateMediaSuccess")}
        </Stack>
      )}

      {bag.mediaStatues === "ERROR" && (
        <Stack
          marginLeft="12px"
          marginRight="15px"
          paddingX="12px"
          paddingY="4px"
          className={classes.generateError}
          borderRadius="0 0 4px 4px"
          direction="row"
          gap="4px"
        >
          {t("generateMediaFailed")}
        </Stack>
      )}

      {bag.mediaStatues === "PROCESSING" && (
        <Stack
          marginLeft="12px"
          marginRight="15px"
          paddingX="12px"
          paddingY="4px"
          className={classes.generateProcessing}
          borderRadius="0 0 4px 4px"
          direction="row"
          gap="4px"
        >
          {t("generateMediaProcessing")}
        </Stack>
      )}
    </div>
  );
}

export const BagView = React.memo(BagViewComponent);
