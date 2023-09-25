// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ImageShadow20Filled } from "@fluentui/react-icons";
import BarChartIcon from "@mui/icons-material/BarChart";
import { alpha } from "@mui/material";
import Tooltip from "@mui/material/Tooltip";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { subtract, toDate } from "@foxglove/rostime";
import { HighlightedText } from "@foxglove/studio-base/components/HighlightedText";
import { BagFileInfo } from "@foxglove/studio-base/context/CoSceneRecordContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";

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
    width: "70px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "auto 0",
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
}));

function BagViewComponent(params: {
  bag: BagFileInfo;
  filter: string;
  isHovered: boolean;
  isCurrent: boolean;
  onClick: (bag: BagFileInfo) => void;
  onHoverStart: (bag: BagFileInfo) => void;
  onHoverEnd: (bag: BagFileInfo) => void;
}) {
  const { bag, filter, isHovered, isCurrent, onClick, onHoverStart, onHoverEnd } = params;
  const { classes, cx } = useStyles();
  const { formatTime } = useAppTimeFormat();
  const { t } = useTranslation("cosPlaylist");
  return (
    <div
      className={cx(classes.bagBox, {
        [classes.unableToPlay]: !bag.startTime,
      })}
      onClick={() => {
        onClick(bag);
      }}
      onMouseEnter={() => {
        onHoverStart(bag);
      }}
      onMouseLeave={() => {
        onHoverEnd(bag);
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
          <HighlightedText text={bag.displayName} highlight={filter} />
        </span>
        <span
          className={cx(classes.bagStartTime, {
            [classes.isCurrentBag]: isCurrent || isHovered,
          })}
        >
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
      {bag.isGhostMode === true && (
        <Tooltip title={t("shadowMode")} placement="top" className={classes.tooltip}>
          <div>
            <div className={classes.triangle} />
            <ImageShadow20Filled className={classes.shadowIcon} />
          </div>
        </Tooltip>
      )}
    </div>
  );
}

export const BagView = React.memo(BagViewComponent);
