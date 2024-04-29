// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { ImageShadow20Filled } from "@fluentui/react-icons";
import BarChartIcon from "@mui/icons-material/BarChart";
import Clear from "@mui/icons-material/Clear";
import { Stack, alpha } from "@mui/material";
import Tooltip from "@mui/material/Tooltip";
import dayjs from "dayjs";
import { useCallback, useState, useMemo } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { subtract, toDate } from "@foxglove/rostime";
import { HighlightedText } from "@foxglove/studio-base/components/HighlightedText";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { ParamsFile, BagFileInfo } from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { confirmTypes } from "@foxglove/studio-base/hooks/useConfirm";
import { AppURLState } from "@foxglove/studio-base/util/appURLState";

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
    color: `${theme.palette.primary.main}`,
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
    color: "#374151",
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
    color: "#9CA3AF",
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
    color: "#9CA3AF",
  },
  unableToPlay: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  barChartIcon: {
    color: `${theme.palette.primary.main}`,
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
    backgroundColor: theme.palette.success.secondary,
    color: theme.palette.success.main,
  },
  successPoint: {
    borderRadius: "50%",
    width: "8px",
    height: "8px",
    border: `2px solid white`,
    backgroundColor: theme.palette.success.main,
  },
  generateError: {
    backgroundColor: theme.palette.error.secondary,
    color: theme.palette.error.main,
  },
  errorPoint: {
    borderRadius: "50%",
    width: "8px",
    height: "8px",
    border: `2px solid white`,
    backgroundColor: theme.palette.error.main,
  },
  generateProcessing: {
    backgroundColor: theme.palette.warning.secondary,
    color: theme.palette.warning.main,
  },
  processingPoint: {
    borderRadius: "50%",
    width: "8px",
    height: "8px",
    border: `2px solid white`,
    backgroundColor: theme.palette.warning.main,
  },
}));

const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;
const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;

const checkIsLogFile = (bag: BagFileInfo) => bag.displayName.endsWith(".log");

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
  const { t } = useTranslation("cosPlaylist");
  const [boxIsHovered, setBoxIsHovered] = useState<boolean>(false);
  const urlState = useMessagePipeline(selectUrlState);
  const consoleApi = useConsoleApi();
  const asyncBaseInfo = useBaseInfo(selectBaseInfo);
  const baseInfo = useMemo(() => asyncBaseInfo.value ?? {}, [asyncBaseInfo]);

  const isLogFile = checkIsLogFile(bag);

  const files: ParamsFile[] = JSON.parse(urlState?.parameters?.files ?? "{}");

  const deleteBag = useCallback(() => {
    const newFiles = files.filter((file) => {
      if ("filename" in file) {
        return file.filename !== bag.name;
      }
      if ("jobRunsName" in file) {
        return file.jobRunsName !== bag.name;
      }

      return false;
    });

    if (urlState != undefined) {
      consoleApi
        .setBaseInfo({
          ...baseInfo,
          files: newFiles,
        })
        .then((key) => {
          updateUrl({
            dsParams: {
              key,
            },
          });
          location.reload();
        })
        .catch((error) => {
          toast.error(t("addFilesFailed"));
          console.error("Failed to set base info", error);
        });
    }
  }, [bag.name, baseInfo, consoleApi, files, t, updateUrl, urlState]);

  const onDeleteBag = useCallback(async () => {
    const response = await confirm({
      title: t("deleteConfirmTitle"),
      prompt: t("deleteConfirmPrompt", {
        filename: bag.displayName,
      }),
      ok: t("remove"),
      cancel: t("cancel", {
        ns: "cosGeneral",
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
        {bag.startTime && bag.endTime && (
          <Stack
            className={cx(classes.bagLength, {
              [classes.isCurrentBag]: isCurrent || isHovered,
            })}
          >
            <HighlightedText
              text={dayjs(toDate(subtract(bag.endTime, bag.startTime))).format("mm[min]ss[s]")}
              highlight={filter}
            />
          </Stack>
        )}

        <Stack>
          <span
            className={cx(classes.bagStartTime, {
              [classes.isCurrentBag]: isCurrent || isHovered,
            })}
          >
            {!isLogFile && (
              <HighlightedText
                text={
                  bag.startTime
                    ? `${dayjs(toDate(bag.startTime)).format("YYYY-MM-DD")} ${formatTime(
                        bag.startTime,
                      )}`
                    : "-"
                }
                highlight={filter}
              />
            )}
          </span>
        </Stack>

        {bag.fileType === "GHOST_RESULT_FILE" && (
          <Tooltip title={t("shadowMode")} placement="top" className={classes.tooltip}>
            <div>
              <div className={classes.triangle} />
              <ImageShadow20Filled className={classes.shadowIcon} />
            </div>
          </Tooltip>
        )}
        <Clear
          className={cx(classes.deleteButton, {
            [classes.hideDeleteButton]: !boxIsHovered,
          })}
          onClick={(e) => {
            e.stopPropagation();
            onDeleteBag().catch((err) => {
              console.error(err);
            });
          }}
        />
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
          <div className={classes.successPoint} />
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
          <div className={classes.errorPoint} />
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
          <div className={classes.processingPoint} />
          {t("generateMediaProcessing")}
        </Stack>
      )}
    </div>
  );
}

export const BagView = React.memo(BagViewComponent);
