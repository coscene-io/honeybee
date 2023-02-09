// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Divider, Typography } from "@mui/material";
import dayjs from "dayjs";
import { isEmpty } from "lodash";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { fromNanoSec, add, subtract as subtractTimes, Time, toDate } from "@foxglove/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { fonts } from "@foxglove/studio-base/util/sharedStyleConstants";
import { formateTimeToReadableFormat } from "@foxglove/studio-base/util/time";

export type PlaybackControlsTooltipItem =
  | { type: "divider" }
  | { type: "item"; title: string; value: string };

const useStyles = makeStyles()((theme) => ({
  tooltipDivider: {
    gridColumn: "span 2",
    marginBlock: theme.spacing(0.5),
    opacity: 0.5,
  },
  tooltipWrapper: {
    fontFeatureSettings: `${fonts.SANS_SERIF_FEATURE_SETTINGS}, "zero"`,
    fontFamily: fonts.SANS_SERIF,
    whiteSpace: "nowrap",
    columnGap: theme.spacing(0.5),
    display: "grid",
    alignItems: "center",
    gridTemplateColumns: "auto 1fr",
    flexDirection: "column",
  },
  itemKey: {
    fontSize: "0.7rem",
    opacity: 0.7,
    textAlign: "end",
    textTransform: "lowercase",
  },
}));

const selectHoveredEvents = (store: TimelineInteractionStateStore) => store.eventsAtHoverValue;
const selectHoveredBags = (store: TimelineInteractionStateStore) => store.bagsAtHoverValue;
const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;

export function PlaybackControlsTooltipContent(params: { stamp: Time }): ReactNull | JSX.Element {
  const { stamp } = params;
  const { formatTime, timeFormat } = useAppTimeFormat();
  const hoveredEvents = useTimelineInteractionState(selectHoveredEvents);
  const hoveredBags = useTimelineInteractionState(selectHoveredBags);
  const startTime = useMessagePipeline(selectStartTime);
  const { classes } = useStyles();
  const { t } = useTranslation("common");

  if (!startTime) {
    return ReactNull;
  }

  const timeFromStart = subtractTimes(stamp, startTime);

  const tooltipItems: PlaybackControlsTooltipItem[] = [];

  if (!isEmpty(hoveredEvents)) {
    Object.values(hoveredEvents).forEach(({ event }) => {
      const eventStartTime = fromNanoSec(
        BigInt(event.getTriggerTime()!.getSeconds() * 1e9 + event.getTriggerTime()!.getNanos()),
      );
      const eventEndTime = add(startTime, fromNanoSec(BigInt(event.getDuration() * 1e9)));

      tooltipItems.push({
        type: "item",
        title: t("start"),
        value: formatTime(eventStartTime),
      });
      tooltipItems.push({
        type: "item",
        title: t("end"),
        value: formatTime(eventEndTime),
      });

      if (!isEmpty(event.getCustomizedFieldsMap())) {
        event.getCustomizedFieldsMap().forEach((val, key) => {
          tooltipItems.push({ type: "item", title: key, value: val });
        });
      }
      tooltipItems.push({ type: "divider" });
    });
  }

  if (!isEmpty(hoveredBags)) {
    Object.values(hoveredBags).forEach((bag) => {
      if (bag.startTime && bag.endTime) {
        tooltipItems.push({
          type: "item",
          title: t("name"),
          value: bag.displayName,
        });
        tooltipItems.push({
          type: "item",
          title: t("start"),
          value: formatTime(bag.startTime),
        });
        tooltipItems.push({
          type: "item",
          title: t("end"),
          value: formatTime(bag.endTime),
        });
        tooltipItems.push({
          type: "item",
          title: t("duration"),
          value: dayjs(toDate(subtractTimes(bag.endTime, bag.startTime))).format("mm[min]ss[s]"),
        });
      }
      tooltipItems.push({ type: "divider" });
    });
  }

  switch (timeFormat) {
    case "TOD":
      tooltipItems.push({ type: "item", title: t("time"), value: formatTime(stamp) });
      break;
    case "SEC":
      tooltipItems.push({ type: "item", title: "SEC", value: formatTime(stamp) });
      break;
  }

  tooltipItems.push({
    type: "item",
    title: t("elapsed"),
    value: formateTimeToReadableFormat(timeFromStart),
  });

  return (
    <div className={classes.tooltipWrapper}>
      {tooltipItems.map((item, idx) => {
        if (item.type === "divider") {
          return <Divider key={`divider_${idx}`} className={classes.tooltipDivider} />;
        }
        return (
          <Fragment key={`${item.title}_${idx}`}>
            <Typography className={classes.itemKey}>{item.title}</Typography>
            <Typography variant="subtitle2">{item.value}</Typography>
          </Fragment>
        );
      })}
    </div>
  );
}
