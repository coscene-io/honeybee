// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { alpha } from "@mui/material";
import { clamp } from "lodash";
import { makeStyles } from "tss-react/mui";

import {
  CoSceneRecordStore,
  BagFileInfo,
  useRecord,
} from "@foxglove/studio-base/context/CoSceneRecordContext";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@foxglove/studio-base/context/TimelineInteractionStateContext";

const useStyles = makeStyles()(({ transitions, palette }) => ({
  root: {
    inset: 0,
    pointerBags: "none",
    position: "absolute",
    display: "flex",
    alignItems: "center",
    height: 10,
  },
  tick: {
    transition: transitions.create("height", { duration: transitions.duration.shortest }),
    backgroundBlendMode: "overlay",
    backgroundColor: "#B9AFFF",
    opacity: 0.5,
    position: "absolute",
    height: 6,
  },
  tickHovered: {
    transition: transitions.create("height", { duration: transitions.duration.shortest }),
    backgroundColor: "#B9AFFF",
    border: `1px solid ${palette.info.main}`,
    height: 12,
  },
}));

const selectBags = (store: CoSceneRecordStore) => store.recordBagFiles;
const selectHoveredBag = (store: TimelineInteractionStateStore) => store.hoveredBag;
const selectBagsAtHoverValue = (store: TimelineInteractionStateStore) => store.bagsAtHoverValue;

function BagTick({ bag }: { bag: BagFileInfo }): JSX.Element {
  const bagsAtHoverValue = useTimelineInteractionState(selectBagsAtHoverValue);
  const hoveredBag = useTimelineInteractionState(selectHoveredBag);
  const { classes, cx } = useStyles();

  const left = `calc(${clamp(bag.startPosition!, 0, 1) * 100}% - 1px)`;
  const right = `calc(100% - ${clamp(bag.endPosition!, 0, 1) * 100}% - 1px)`;

  return (
    <div
      className={cx(classes.tick, {
        [classes.tickHovered]: hoveredBag
          ? bag.name === hoveredBag.name
          : bagsAtHoverValue[bag.name] != undefined,
      })}
      style={{ left, right }}
    />
  );
}

const MemoBagTick = React.memo(BagTick);

export function BagsOverlay(): JSX.Element {
  const bags = useRecord(selectBags);
  const { classes } = useStyles();

  return (
    <div className={classes.root}>
      {(bags.value ?? [])
        .filter((ele) => ele.startTime)
        .map((bag) => (
          <MemoBagTick key={bag.name} bag={bag} />
        ))}
    </div>
  );
}
