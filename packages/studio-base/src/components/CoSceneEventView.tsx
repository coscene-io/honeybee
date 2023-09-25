// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Event } from "@coscene-io/coscene/proto/v1alpha2";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";
import { alpha, Alert, TextField } from "@mui/material";
import Snackbar from "@mui/material/Snackbar";
import { FieldMask } from "google-protobuf/google/protobuf/field_mask_pb";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";

import { toRFC3339String, fromDate } from "@foxglove/rostime";
import { HighlightedText } from "@foxglove/studio-base/components/HighlightedText";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  TimelinePositionedEvent,
  EventsStore,
  useEvents,
} from "@foxglove/studio-base/context/EventsContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { confirmTypes } from "@foxglove/studio-base/hooks/useConfirm";

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
      wordBreak: "break-all",
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
      gridTemplateColumns: "1fr 3fr",
      overflowY: "auto",
      wordBreak: "break-all",
    },
    toast: {
      bottom: "85px !important",
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
  confirm: confirmTypes;
}): JSX.Element {
  const { event, filter, isHovered, isSelected, onClick, onHoverStart, onHoverEnd, confirm } =
    params;
  const { classes, cx } = useStyles();
  const consoleApi = useConsoleApi();
  const refreshEvents = useEvents(selectRefreshEvents);
  const [open, setOpen] = useState(false);
  const { formatTime } = useAppTimeFormat();
  const { t } = useTranslation("cosEvent");
  const [toastInfo, setToastInfo] = useState<{
    message: string;
    type: "success" | "error";
  }>({
    message: "",
    type: "success",
  });
  const [show, setShow] = useState(true);

  const handleClose = (
    _event: globalThis.Event | React.SyntheticEvent<unknown>,
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
      message: t("momentDeleted"),
      type: "success",
    });
    refreshEvents();
  }, [consoleApi, event, refreshEvents, t]);

  const confirmDelete = useCallback(async () => {
    const response = await confirm({
      title: t("deleteConfirmTitle"),
      prompt: t("deleteConfirmPrompt"),
      ok: t("delete"),
      cancel: t("cancel"),
      variant: "danger",
    });
    if (response !== "ok") {
      return;
    }

    void deleteEvent();
  }, [confirm, deleteEvent, t]);

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
        message: t("momentUpdated"),
        type: "success",
      });
      refreshEvents();
    },
    [consoleApi, event, refreshEvents, t],
  );

  const displayName = event.event.getDisplayName();
  const triggerTime = formatTime(fromDate(event.event.getTriggerTime()!.toDate()));
  const duration = `${event.event.getDuration().toString()} s`;
  const description = event.event.getDescription();
  const metadataMap = event.event.getCustomizedFieldsMap().toArray();

  useEffect(() => {
    if (deletedEvent.error) {
      setToastInfo({
        message: t("errorDeletingEvent"),
        type: "error",
      });
      setOpen(true);
    }

    if (updatedEventDesc.error) {
      setToastInfo({
        message: t("errorUpdatingEvent"),
        type: "error",
      });
      setOpen(true);
    }
  }, [deletedEvent, updatedEventDesc, t]);

  useEffect(() => {
    if (!filter) {
      setShow(true);
      return;
    }
    const filteredText = [displayName, triggerTime, duration, description].find((item) => {
      return item.toLowerCase().includes(filter.toLowerCase());
    });

    const filteredMap = metadataMap.find((item) => {
      return (
        item[0].toLowerCase().includes(filter.toLowerCase()) ||
        item[1].toLowerCase().includes(filter.toLowerCase())
      );
    });

    if (filteredMap || filteredText) {
      setShow(true);
    } else {
      setShow(false);
    }
  }, [displayName, triggerTime, duration, description, metadataMap, filter]);

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
      message: t("copiedMomentToClipboard"),
      type: "success",
    });
  };

  return show ? (
    <div
      className={classes.eventBox}
      onClick={() => {
        onClick(event);
      }}
      onMouseEnter={() => {
        onHoverStart(event);
      }}
      onMouseLeave={() => {
        onHoverEnd(event);
      }}
    >
      <div className={classes.eventTitle}>
        <div>
          <HighlightedText text={displayName} highlight={filter} />
        </div>
        <div
          className={classes.eventTitleIcons}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <ShareIcon fontSize="small" onClick={handleShareEvent} />
          <DeleteIcon fontSize="small" onClick={confirmDelete} />
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
              <HighlightedText text={triggerTime} highlight={filter} />
            </div>
          </Fragment>

          <Fragment key="duration">
            <div className={classes.eventMetadata}>
              <HighlightedText text={t("duration")} highlight={filter} />
            </div>
            <div className={classes.eventMetadata}>
              <HighlightedText text={duration} highlight={filter} />
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
                defaultValue={description}
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

          {metadataMap.map(([key, value]: string[]) => (
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
      <Snackbar open={open} autoHideDuration={6000} onClose={handleClose} className={classes.toast}>
        <Alert onClose={handleClose} severity={toastInfo.type} style={{ width: "100%" }}>
          {toastInfo.message}
        </Alert>
      </Snackbar>
    </div>
  ) : (
    <></>
  );
}

export const EventView = React.memo(EventViewComponent);
