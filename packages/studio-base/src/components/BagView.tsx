// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { ImageShadow20Filled } from "@fluentui/react-icons";
import BarChartIcon from "@mui/icons-material/BarChart";
import Clear from "@mui/icons-material/Clear";
import { alpha } from "@mui/material";
import Tooltip from "@mui/material/Tooltip";
import dayjs from "dayjs";
import * as _ from "lodash-es";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { subtract, toDate } from "@foxglove/rostime";
import { HighlightedText } from "@foxglove/studio-base/components/HighlightedText";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { ParamsFile, BagFileInfo } from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { confirmTypes } from "@foxglove/studio-base/hooks/useConfirm";
import { AppURLState } from "@foxglove/studio-base/util/appURLState";

const useStyles = makeStyles<void, "bagMetadata">()((theme, _params, classes) => ({
  bagBox: {
    display: "flex",
    justifyContent: "space-between",
    cursor: "pointer",
    "&:hover": {
      [`.${classes.bagMetadata}`]: {
        backgroundColor: alpha(theme.palette.info.main, theme.palette.action.hoverOpacity),
        borderColor: theme.palette.info.main,
      },
    },
    borderBottom: `1px solid ${theme.palette.divider}`,
    padding: "10px 13px",
    position: "relative",
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
  bagInfo: {
    display: "flex",
    width: "100%",
    flexDirection: "column",
    gap: "4px",
  },
  bagName: {
    fontFamily: "Inter",
    fontStyle: "normal",
    fontWeight: "400",
    fontSize: "14px",
    lineHeight: "20px",
    color: "#374151",
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
    position: "absolute",
    float: "right",
    right: theme.spacing(2),
    width: "70px",
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
}));

const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

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
      updateUrl({
        dsParams: _.pickBy(
          {
            ...urlState.parameters,
            files: JSON.stringify(newFiles),
          },
          _.isString,
        ),
      });
    }

    location.reload();
  }, [bag.name, files, updateUrl, urlState]);

  const onDeleteBag = useCallback(async () => {
    const response = await confirm({
      title: t("deleteConfirmTitle"),
      prompt: t("deleteConfirmPrompt", {
        filename: bag.displayName,
      }),
      ok: t("delete", {
        ns: "cosGeneral",
      }),
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
    <div
      className={cx(classes.bagBox, {
        [classes.unableToPlay]: !bag.startTime && !isLogFile,
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
    >
      <div className={classes.bagInfo}>
        <span
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
        </span>
        <span
          className={cx(classes.bagStartTime, {
            [classes.isCurrentBag]: isCurrent || isHovered,
          })}
        >
          <HighlightedText
            text={`${bag.projectDisplayName}/${bag.recordDisplayName}`}
            highlight={filter}
          />
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
      </div>
      {bag.startTime && bag.endTime && (
        <div
          className={cx(classes.bagLength, {
            [classes.isCurrentBag]: isCurrent || isHovered,
          })}
        >
          <HighlightedText
            text={dayjs(toDate(subtract(bag.endTime, bag.startTime))).format("mm[min]ss[s]")}
            highlight={filter}
          />
        </div>
      )}
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
        onClick={onDeleteBag}
      />
    </div>
  );
}

export const BagView = React.memo(BagViewComponent);
