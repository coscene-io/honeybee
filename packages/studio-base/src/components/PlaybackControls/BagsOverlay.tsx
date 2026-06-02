// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { makeStyles } from "tss-react/mui";

import { subtract, toSec } from "@foxglove/rostime";
import {
  CoScenePlaylistStore,
  usePlaylist,
  BagFileInfo,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";

import { type TimelineViewport, timelineRangeToStyle } from "./timelineViewport";

export const BAG_OVERLAY_HEIGHT_PX: number = 12;
const BAG_TICK_HEIGHT_PX: number = 6;
const BAG_TICK_HOVERED_HEIGHT_PX: number = 12;

const useStyles = makeStyles()(({ transitions, palette }) => ({
  root: {
    inset: 0,
    pointerEvents: "none",
    position: "absolute",
    display: "flex",
    alignItems: "center",
    height: BAG_OVERLAY_HEIGHT_PX,
  },
  tick: {
    transition: transitions.create("height", { duration: transitions.duration.shortest }),
    backgroundBlendMode: "overlay",
    backgroundColor: "#93c5fd",
    opacity: 0.5,
    position: "absolute",
    height: BAG_TICK_HEIGHT_PX,
  },
  tickHovered: {
    transition: transitions.create("height", { duration: transitions.duration.shortest }),
    backgroundColor: "#93c5fd",
    border: `1px solid ${palette.info.main}`,
    height: BAG_TICK_HOVERED_HEIGHT_PX,
  },
}));

const selectBags = (store: CoScenePlaylistStore) => store.bagFiles;
const selectHoveredBag = (store: TimelineInteractionStateStore) => store.hoveredBag;
const selectBagsAtHoverValue = (store: TimelineInteractionStateStore) => store.bagsAtHoverValue;

function BagTick({
  bag,
  viewport,
}: {
  bag: BagFileInfo;
  viewport: TimelineViewport;
}): React.JSX.Element | ReactNull {
  const bagsAtHoverValue = useTimelineInteractionState(selectBagsAtHoverValue);
  const hoveredBag = useTimelineInteractionState(selectHoveredBag);
  const { classes, cx } = useStyles();

  if (bag.startTime == undefined || bag.endTime == undefined) {
    return ReactNull;
  }

  const style = timelineRangeToStyle(
    bag.secondsSinceStart ?? toSec(bag.startTime) - viewport.totalStartSec,
    bag.secondsSinceStart != undefined
      ? bag.secondsSinceStart + toSec(subtract(bag.endTime, bag.startTime))
      : toSec(bag.endTime) - viewport.totalStartSec,
    viewport,
  );

  if (style == undefined) {
    return ReactNull;
  }

  return (
    <div
      className={cx(classes.tick, {
        [classes.tickHovered]: hoveredBag
          ? bag.name === hoveredBag.name
          : bagsAtHoverValue[bag.name] != undefined,
      })}
      style={style}
    />
  );
}

const MemoBagTick = React.memo(BagTick);

function UnmemoizedBagsOverlay({ viewport }: { viewport: TimelineViewport }): React.JSX.Element {
  const bags = usePlaylist(selectBags);
  const { classes } = useStyles();

  return (
    <div className={classes.root}>
      {(bags.value ?? [])
        .filter((ele) => ele.startTime)
        .map((bag, index) => (
          <MemoBagTick key={`${bag.name}${index}`} bag={bag} viewport={viewport} />
        ))}
    </div>
  );
}

export const BagsOverlay = React.memo(UnmemoizedBagsOverlay);
