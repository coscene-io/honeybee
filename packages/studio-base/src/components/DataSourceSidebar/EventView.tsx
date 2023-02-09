// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Event } from "@coscene-io/coscene/proto/v1alpha2";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";
import { alpha, Alert, TextField } from "@mui/material";
import Snackbar from "@mui/material/Snackbar";
import { FieldMask } from "google-protobuf/google/protobuf/field_mask_pb";
import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";

import { toRFC3339String, fromDate } from "@foxglove/rostime";
import { HighlightedText } from "@foxglove/studio-base/components/HighlightedText";
import { useConsoleApi } from "@foxglove/studio-base/context/ConsoleApiContext";
import {
  TimelinePositionedEvent,
  EventsStore,
  useEvents,
} from "@foxglove/studio-base/context/EventsContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";

const useStyles = makeStyles<void, "eventMetadata" | "eventSelected">()(
  (theme, _params, classes) => ({
    spacer: {
      cursor: "default",
      height: theme.spacing(1),
      gridColumn: "span 2",
    },
    event: {
      display: "contents",
      cursor: "pointer",
      "&:hover": {
        [`.${classes.eventMetadata}`]: {
          backgroundColor: alpha(theme.palette.info.main, theme.palette.action.hoverOpacity),
          borderColor: theme.palette.info.main,
        },
      },
    },
    eventSelected: {
      [`.${classes.eventMetadata}`]: {
        backgroundColor: alpha(theme.palette.info.main, theme.palette.action.activatedOpacity),
        borderColor: theme.palette.info.main,
        boxShadow: `0 0 0 1px ${theme.palette.info.main}`,
      },
    },
    eventHovered: {
      [`.${classes.eventMetadata}`]: {
        backgroundColor: alpha(theme.palette.info.main, theme.palette.action.hoverOpacity),
        borderColor: theme.palette.info.main,
      },
    },
    eventMetadata: {
      padding: theme.spacing(1),
      backgroundColor: theme.palette.background.default,
      borderRight: `1px solid ${theme.palette.divider}`,
      borderBottom: `1px solid ${theme.palette.divider}`,

      "&:nth-of-type(odd)": {
        borderLeft: `1px solid ${theme.palette.divider}`,
      },
      "&:first-of-type": {
        borderTop: `1px solid ${theme.palette.divider}`,
        borderTopLeftRadius: theme.shape.borderRadius,
      },
      "&:nth-of-type(2)": {
        borderTop: `1px solid ${theme.palette.divider}`,
        borderTopRightRadius: theme.shape.borderRadius,
      },
      "&:nth-last-of-type(2)": {
        borderBottomRightRadius: theme.shape.borderRadius,
      },
      "&:nth-last-of-type(3)": {
        borderBottomLeftRadius: theme.shape.borderRadius,
      },
    },
    eventBox: {
      display: "flex",
      cursor: "pointer",
      flexDirection: "column",
      padding: "8px",
    },
    eventTitle: {
      padding: "5px 0",
      display: "flex",
      justifyContent: "space-between",
    },
    eventTitleIcons: {
      display: "flex",
      gap: "5px",
    },
    grid: {
      display: "grid",
      flexShrink: 1,
      gridTemplateColumns: "auto 1fr",
      overflowY: "auto",
      // padding: theme.spacing(1),
    },
  }),
);

const selectRefreshEvents = (store: EventsStore) => store.refreshEvents;

function EventViewComponent(params: {
  event: TimelinePositionedEvent;
  filter: string;
  isHovered: boolean;
  isSelected: boolean;
  onClick: (event: TimelinePositionedEvent) => void;
  onHoverStart: (event: TimelinePositionedEvent) => void;
  onHoverEnd: (event: TimelinePositionedEvent) => void;
}): JSX.Element {
  const { event, filter, isHovered, isSelected, onClick, onHoverStart, onHoverEnd } = params;
  const { classes, cx } = useStyles();
  const consoleApi = useConsoleApi();
  const refreshEvents = useEvents(selectRefreshEvents);
  const [open, setOpen] = useState(false);
  const { formatTime } = useAppTimeFormat();
  const { t } = useTranslation("dataSource");
  const [toastInfo, setToastInfo] = useState<{
    message: string;
    type: "success" | "error";
  }>({
    message: "",
    type: "success",
  });

  const handleClose = (
    _event: globalThis.Event | React.SyntheticEvent<unknown, globalThis.Event>,
    reason?: string,
  ) => {
    if (reason === "clickaway") {
      return;
    }

    setOpen(false);
  };

  const [deletedEvent, deleteEvent] = useAsyncFn(async () => {
    await consoleApi.deleteEvent({ eventName: event.event.getName() });
    setOpen(true);
    setToastInfo({
      message: "Event deleted",
      type: "success",
    });
    refreshEvents();
  }, [consoleApi, event, refreshEvents]);

  const [updatedEventDesc, updateEventDesc] = useAsyncFn(
    async (desc: string) => {
      const fieldMask = new FieldMask();
      fieldMask.addPaths("description");
      await consoleApi.updateEvent({
        event: new Event().setName(event.event.getName()).setDescription(desc),
        updateMask: fieldMask,
      });
      setOpen(true);
      setToastInfo({
        message: "Moment have been updated",
        type: "success",
      });
      refreshEvents();
    },
    [consoleApi, event, refreshEvents],
  );

  useEffect(() => {
    if (deletedEvent.error) {
      setToastInfo({
        message: "Error deleting event",
        type: "error",
      });
      setOpen(true);
    }

    if (updatedEventDesc.error) {
      setToastInfo({
        message: "Error updating event",
        type: "error",
      });
      setOpen(true);
    }
  }, [deletedEvent, updatedEventDesc]);

  const handleShareEvent = async () => {
    const link = window.location.href;
    const copyLink = link.replace(
      /time=.+Z&|time=.+Z$/,
      `time=${encodeURIComponent(
        toRFC3339String(fromDate(event.event.getTriggerTime()!.toDate())),
      )}&`,
    );

    await navigator.clipboard.writeText(copyLink);

    setOpen(true);
    setToastInfo({
      message: "Copied moment to clipboard",
      type: "success",
    });
  };

  return (
    <div
      className={classes.eventBox}
      onClick={() => onClick(event)}
      onMouseEnter={() => onHoverStart(event)}
      onMouseLeave={() => onHoverEnd(event)}
    >
      <div className={classes.eventTitle}>
        <div>{event.event.getDisplayName()}</div>
        <div
          className={classes.eventTitleIcons}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <ShareIcon fontSize="small" onClick={handleShareEvent} />
          <DeleteIcon fontSize="small" onClick={deleteEvent} />
        </div>
      </div>
      <div className={classes.grid}>
        <div
          data-testid="sidebar-event"
          className={cx(classes.event, {
            [classes.eventSelected]: isSelected,
            [classes.eventHovered]: isHovered,
          })}
        >
          <Fragment key="triggerTime">
            <div className={classes.eventMetadata}>
              <HighlightedText text={t("triggerTime")} highlight={filter} />
            </div>
            <div className={classes.eventMetadata}>
              <HighlightedText
                text={formatTime(fromDate(event.event.getTriggerTime()!.toDate()))}
                highlight={filter}
              />
            </div>
          </Fragment>

          <Fragment key="duration">
            <div className={classes.eventMetadata}>
              <HighlightedText text={t("duration")} highlight={filter} />
            </div>
            <div className={classes.eventMetadata}>
              <HighlightedText
                text={`${event.event.getDuration().toString()} s`}
                highlight={filter}
              />
            </div>
          </Fragment>

          <Fragment key="description">
            <div className={classes.eventMetadata}>
              <HighlightedText text={t("description")} highlight={filter} />
            </div>
            <div
              className={classes.eventMetadata}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <TextField
                hiddenLabel
                id="filled-hidden-label-small"
                defaultValue={event.event.getDescription()}
                variant="filled"
                size="small"
                fullWidth
                onBlur={async (e) => {
                  await updateEventDesc(e.target.value);
                }}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    (e.target as HTMLElement).blur();
                  }
                }}
              />
            </div>
          </Fragment>

          {event.event
            .getCustomizedFieldsMap()
            .toArray()
            .map(([key, value]: string[]) => (
              <Fragment key={key}>
                <div className={classes.eventMetadata}>
                  <HighlightedText text={key ?? ""} highlight={filter} />
                </div>
                <div className={classes.eventMetadata}>
                  <HighlightedText text={value ?? ""} highlight={filter} />
                </div>
              </Fragment>
            ))}

          <div className={classes.spacer} />
        </div>
      </div>
      <Snackbar open={open} autoHideDuration={6000} onClose={handleClose}>
        <Alert onClose={handleClose} severity={toastInfo.type} style={{ width: "100%" }}>
          {toastInfo.message}
        </Alert>
      </Snackbar>
    </div>
  );
}

export const EventView = React.memo(EventViewComponent);
