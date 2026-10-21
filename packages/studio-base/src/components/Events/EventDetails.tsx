// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Button,
  ClickAwayListener,
  Paper,
  Popper,
  Stack,
  Typography,
  type PopoverPosition,
} from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { CustomFieldValuesFields } from "@foxglove/studio-base/components/CustomFieldProperty/field/CustomFieldValuesFields";
import {
  DOUBTFUL_MOMENT_COLOR,
  DOUBTFUL_FIELD_KEY,
  isMomentDoubtful,
} from "@foxglove/studio-base/components/Events/momentDoubtful";
import {
  useEvents,
  type TimelinePositionedEvent,
} from "@foxglove/studio-base/context/EventsContext";
import { usePlaybackTimeFormat } from "@foxglove/studio-base/hooks";
import { durationToSeconds } from "@foxglove/studio-base/util/time";

const useStyles = makeStyles()((theme) => ({
  popper: { zIndex: theme.zIndex.modal },
  details: {
    padding: theme.spacing(2),
    width: 400,
    maxWidth: "90vw",
    maxHeight: "70vh",
    overflow: "auto",
  },
  value: { overflowWrap: "anywhere", whiteSpace: "pre-wrap" },
}));

export function EventDetails({
  event,
  anchorPosition,
  onClose,
}: {
  event: TimelinePositionedEvent;
  anchorPosition: PopoverPosition;
  onClose: () => void;
}): React.JSX.Element {
  const schema = useEvents((store) => store.customFieldSchema);
  const { t } = useTranslation("event");
  const { classes } = useStyles();
  const { formatTime } = usePlaybackTimeFormat();
  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () => ({
        x: anchorPosition.left,
        y: anchorPosition.top,
        left: anchorPosition.left,
        right: anchorPosition.left,
        top: anchorPosition.top,
        bottom: anchorPosition.top,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      }),
    }),
    [anchorPosition],
  );
  const fields = [
    [t("name"), event.event.displayName],
    [t("startTime"), formatTime(event.startTime)],
    [t("end"), formatTime(event.endTime)],
    [t("duration"), `${durationToSeconds(event.event.duration).toFixed(3)} s`],
    [t("description"), event.event.description],
    ...Object.entries(event.event.customizedFields)
      .filter(([key]) => key !== DOUBTFUL_FIELD_KEY)
      .map(([key, value]) => [key, value]),
  ];
  return (
    <Popper
      open
      anchorEl={anchor}
      placement="bottom-start"
      className={classes.popper}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.stopPropagation();
      }}
    >
      <ClickAwayListener onClickAway={onClose}>
        <Paper
          role="dialog"
          aria-label={t("viewMoment")}
          elevation={8}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onClose();
            }
          }}
          className={classes.details}
        >
          <Stack spacing={1}>
            <Typography variant="h4">{t("viewMoment")}</Typography>
            {fields
              .filter(([, value]) => value)
              .map(([label, value], index) => (
                <Stack key={index}>
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography className={classes.value}>{value}</Typography>
                </Stack>
              ))}
            <CustomFieldValuesFields
              variant="secondary"
              properties={schema?.properties ?? []}
              customFieldValues={event.event.customFieldValues}
              readonly
              ignoreProperties
            />
            {isMomentDoubtful(event.event.customizedFields) && (
              <Typography color={DOUBTFUL_MOMENT_COLOR}>{t("doubtful")}</Typography>
            )}
            <Button autoFocus onClick={onClose}>
              {t("close")}
            </Button>
          </Stack>
        </Paper>
      </ClickAwayListener>
    </Popper>
  );
}
