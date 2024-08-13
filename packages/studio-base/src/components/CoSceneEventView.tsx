// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { File } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/file_pb";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ShareIcon from "@mui/icons-material/Share";
import { alpha } from "@mui/material";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
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
  ToModifyEvent,
} from "@foxglove/studio-base/context/EventsContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { confirmTypes } from "@foxglove/studio-base/hooks/useConfirm";
import { durationToSeconds } from "@foxglove/studio-base/util/time";

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
    eventImg: {
      maxWidth: "100%",
    },
  }),
);

const selectRefreshEvents = (store: EventsStore) => store.refreshEvents;

function EventViewComponent(params: {
  event: TimelinePositionedEvent;
  filter: string;
  isHovered: boolean;
  isSelected: boolean;
  disabledScroll?: boolean;
  onClick: (event: TimelinePositionedEvent) => void;
  onHoverStart: (event: TimelinePositionedEvent) => void;
  onHoverEnd: (event: TimelinePositionedEvent) => void;
  onEdit: (event: ToModifyEvent) => void;
  confirm: confirmTypes;
}): JSX.Element {
  const {
    event,
    filter,
    isHovered,
    isSelected,
    onClick,
    onHoverStart,
    onHoverEnd,
    confirm,
    onEdit,
    disabledScroll = false,
  } = params;
  const { classes, cx } = useStyles();
  const consoleApi = useConsoleApi();
  const refreshEvents = useEvents(selectRefreshEvents);
  const { formatTime } = useAppTimeFormat();
  const { t } = useTranslation("cosEvent");

  const scrollRef = useRef<HTMLDivElement>(ReactNull);

  useEffect(() => {
    if ((isSelected || isHovered) && !disabledScroll) {
      if (scrollRef.current) {
        scrollRef.current.scrollIntoView({ block: "center" });
      }
    }
  }, [isSelected, isHovered, disabledScroll]);

  const [show, setShow] = useState(true);

  const [deletedEvent, deleteEvent] = useAsyncFn(async () => {
    if (event.event.files[0]) {
      try {
        await consoleApi.deleteFile(new File({ name: event.event.files[0] }));
      } catch (error) {
        console.error("Error deleting file", error);
      }
    }

    await consoleApi.deleteEvent({ eventName: event.event.name });

    toast.success(t("momentDeleted"));
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

  const displayName = event.event.displayName;
  const triggerTime = formatTime(fromDate(event.event.triggerTime?.toDate() ?? new Date()));
  const duration = `${durationToSeconds(event.event.duration).toFixed(3)} s`;
  const description = event.event.description;
  const metadataMap = Object.entries(event.event.customizedFields);
  const imgUrl = event.imgUrl;

  useEffect(() => {
    if (deletedEvent.error) {
      toast.error(t("errorDeletingEvent"));
    }
  }, [deletedEvent, t]);

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
        toRFC3339String(fromDate(event.event.triggerTime?.toDate() ?? new Date())),
      )}&`,
    );

    await navigator.clipboard.writeText(copyLink);

    toast.success(t("copiedMomentToClipboard"));
  };

  const handleEditEvent = () => {
    onEdit({
      name: event.event.name,
      eventName: event.event.displayName,
      startTime: event.event.triggerTime?.toDate() ?? new Date(),
      duration: durationToSeconds(event.event.duration),
      durationUnit: "sec",
      description: event.event.description,
      metadataEntries: metadataMap.map(([key, value]: string[]) => {
        return {
          key: key ?? "",
          value: value ?? "",
        };
      }),
      enabledCreateNewTask: false,
      fileName: "",
      imgUrl: event.imgUrl,
      record: event.event.record,
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
      ref={scrollRef}
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
          <EditIcon fontSize="small" onClick={handleEditEvent} />
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
              <HighlightedText text={description} highlight={filter} />
            </div>
          </Fragment>

          {imgUrl && (
            <Fragment key="img">
              <div className={classes.eventMetadata}>{t("photo")}</div>
              <div className={classes.eventMetadata}>
                <img src={imgUrl} className={classes.eventImg} />
              </div>
            </Fragment>
          )}

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
    </div>
  ) : (
    <></>
  );
}

export const EventView = React.memo(EventViewComponent);
