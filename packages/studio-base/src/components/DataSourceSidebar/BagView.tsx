import { BagFileInfo } from "@foxglove/studio-base/context/CoSceneRecordContext";
import { makeStyles } from "tss-react/mui";
import { alpha } from "@mui/material";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { subtract, toDate } from "@foxglove/rostime";
import dayjs from "dayjs";
import BarChartIcon from "@mui/icons-material/BarChart";
import { HighlightedText } from "@foxglove/studio-base/components/HighlightedText";

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
  },
  isCurrentBag: {
    color: "#4F46E5 !important",
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
    color: "#4F46E5",
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
  return (
    <div
      className={cx(classes.bagBox, {
        [classes.unableToPlay]: !bag.startTime,
      })}
      onClick={() => onClick(bag)}
      onMouseEnter={() => onHoverStart(bag)}
      onMouseLeave={() => onHoverEnd(bag)}
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
            text={bag.startTime ? formatTime(bag.startTime) : "-"}
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
    </div>
  );
}

export const BagView = React.memo(BagViewComponent);
