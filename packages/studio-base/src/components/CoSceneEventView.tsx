// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { DiagnosisRule } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha2/resources/diagnosis_rule_pb";
import { File } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha3/resources/file_pb";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import RepeatOneOutlinedIcon from "@mui/icons-material/RepeatOneOutlined";
import ShareIcon from "@mui/icons-material/ShareOutlined";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import { alpha, Stack, IconButton, Link, Typography } from "@mui/material";
import { useCallback, useEffect, useRef, useState, Fragment, useMemo } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";

import Logger from "@foxglove/log";
import { toRFC3339String, fromDate, areEqual } from "@foxglove/rostime";
import { HighlightedText } from "@foxglove/studio-base/components/HighlightedText";
import {
  useMessagePipeline,
  MessagePipelineContext,
} from "@foxglove/studio-base/components/MessagePipeline";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
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

const useStyles = makeStyles<void, "eventSelected">()((theme, _params) => ({
  event: {
    display: "flex",
    wordBreak: "break-all",
    flexDirection: "column",
    cursor: "pointer",
    padding: "12px",
    borderRadius: "4px",
    backgroundColor: theme.palette.background.default,
    "&:hover": {
      backgroundColor: alpha(theme.palette.info.main, theme.palette.action.hoverOpacity),
    },
  },
  eventSelected: {
    backgroundColor: alpha(theme.palette.info.main, theme.palette.action.activatedOpacity),
    boxShadow: `0 0 0 1px ${theme.palette.info.main}`,
  },
  eventHovered: {
    backgroundColor: alpha(theme.palette.info.main, theme.palette.action.hoverOpacity),
  },
  eventTitle: {
    padding: "12px 0 0 0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eventTitleIcons: {
    display: "flex",
    gap: "5px",
    alignItems: "start",
  },
  eventImg: {
    maxWidth: "100%",
  },
  line: {
    backgroundColor: theme.palette.divider,
  },
  ring: {
    height: "8px",
    width: "8px",
    borderRadius: "14px",
    border: "2px solid",
  },
  truncate: {
    display: "flex",
    flex: 1,
    width: 0,
    alignItems: "center",
    gap: theme.spacing(1),
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
}));

const selectRefreshEvents = (store: EventsStore) => store.refreshEvents;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;

const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;

const log = Logger.getLogger(__filename);

function EventViewComponent(params: {
  event: TimelinePositionedEvent;
  filter: string;
  isHovered: boolean;
  isSelected: boolean;
  isLoopedEvent: boolean;
  variant: "small" | "learge";
  disabledScroll?: boolean;
  diagnosisRuleData?: DiagnosisRule;
  onClick: (event: TimelinePositionedEvent) => void;
  onHoverStart: (event: TimelinePositionedEvent) => void;
  onHoverEnd: (event: TimelinePositionedEvent) => void;
  onEdit: (event: ToModifyEvent) => void;
  onSetLoopedEvent: (event: TimelinePositionedEvent | undefined) => void;
  confirm: confirmTypes;
}): React.JSX.Element {
  const {
    event,
    filter,
    isHovered,
    isSelected,
    isLoopedEvent,
    variant,
    diagnosisRuleData,
    onClick,
    onHoverStart,
    onHoverEnd,
    confirm,
    onEdit,
    onSetLoopedEvent,
    disabledScroll = false,
  } = params;
  const { classes, cx, theme } = useStyles();
  const consoleApi = useConsoleApi();
  const refreshEvents = useEvents(selectRefreshEvents);
  const { formatTime } = useAppTimeFormat();
  const { t } = useTranslation("cosEvent");

  const asyncBaseInfo = useBaseInfo(selectBaseInfo);
  const baseInfo = useMemo(() => asyncBaseInfo.value ?? {}, [asyncBaseInfo]);

  const seek = useMessagePipeline(selectSeek);

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

  const handleLoopEvent = () => {
    if (isLoopedEvent) {
      onSetLoopedEvent(undefined);
    } else {
      if (seek != undefined) {
        seek(event.startTime);
        // seek needs some time to take effect
        // if set looped event immediately, current time will be out of the event
        // then the event will be unselected
        setTimeout(() => {
          onSetLoopedEvent(event);
        }, 1000);
      }
    }
  };

  const ruleNavAddress: React.JSX.Element | undefined = useMemo(() => {
    const rule = event.event.rule;

    if (event.event.rule?.name == undefined || event.event.rule?.name == "") {
      return undefined;
    }

    if (diagnosisRuleData == undefined || rule == undefined) {
      return <Typography noWrap>{event.event.rule?.name}</Typography>;
    }

    const ruleIndex = diagnosisRuleData.rules.findIndex((diagnosisRule) =>
      diagnosisRule.rules.find((r) => r.id === rule.id),
    );

    const address = `/${baseInfo.organizationSlug}/${baseInfo.projectSlug}/data-collection-diagnosis/${ruleIndex}/${rule.id}`;

    return (
      <Link href={address} target="_blank">
        <Typography noWrap>{event.event.rule?.name}</Typography>
      </Link>
    );
  }, [diagnosisRuleData, event.event.rule, baseInfo]);

  const deviceCreator = useMemo(() => {
    if (event.event.device?.name && event.event.device.name.length > 0) {
      const deviceNavAddress = `/${baseInfo.organizationSlug}/${
        baseInfo.projectSlug
      }/devices/${event.event.device.name.split("/").pop()}`;

      return (
        <Link href={deviceNavAddress} target="_blank">
          <Typography noWrap>{event.event.device.displayName}</Typography>
        </Link>
      );
    }
    return undefined;
  }, [baseInfo.organizationSlug, baseInfo.projectSlug, event.event.device]);

  const [humanCreator, getHumanCreator] = useAsyncFn(async () => {
    const user = await consoleApi.getUser(event.event.creator);
    return user.nickname;
  }, [consoleApi, event.event.creator]);

  useEffect(() => {
    getHumanCreator().catch((err: unknown) => {
      log.error("getHumanCreator", err);
    });
  }, [getHumanCreator]);

  return show ? (
    <Stack flexDirection="row" paddingRight={2} ref={scrollRef}>
      <Stack marginLeft={2.5} marginRight={1.5} gap={0.5} alignItems="center">
        <Stack width="1px" height="15px" className={classes.line} />
        <div
          className={classes.ring}
          style={{
            borderColor: event.color,
          }}
        />
        <Stack width="1px" flex="1" className={classes.line} />
      </Stack>

      <Stack flex={1} gap={1} width="0">
        <div className={classes.eventTitle}>
          <div>
            <HighlightedText text={triggerTime} highlight={filter} />
          </div>
          <div
            className={classes.eventTitleIcons}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <IconButton
              size="small"
              color={isLoopedEvent ? "warning" : "default"}
              onClick={handleLoopEvent}
              disabled={areEqual(event.startTime, event.endTime)}
              title={t("loopPlay")}
            >
              <RepeatOneOutlinedIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={handleEditEvent} title={t("editMoment")}>
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={handleShareEvent} title={t("share")}>
              <ShareIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={confirmDelete} title={t("delete")}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </div>
        </div>

        <div
          data-testid="sidebar-event"
          className={cx(classes.event, {
            [classes.eventSelected]: isSelected,
            [classes.eventHovered]: isHovered,
          })}
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
          <Stack flexDirection="row" fontSize="14px" justifyContent="space-between">
            <Stack fontWeight="400" color={theme.palette.text.primary}>
              <HighlightedText text={displayName} highlight={filter} />
            </Stack>

            <Stack
              color={theme.palette.text.secondary}
              minWidth="75px"
              flexDirection="row"
              gap={0.5}
            >
              <TimerOutlinedIcon fontSize="small" />
              <HighlightedText text={duration} highlight={filter} />
            </Stack>
          </Stack>

          {variant === "learge" && (
            <Stack
              gap={1}
              fontSize="12px"
              color={theme.palette.text.secondary}
              marginTop={description || imgUrl || metadataMap.length > 0 ? "12px" : undefined}
            >
              {description && (
                <Stack lineHeight="1.5">
                  <HighlightedText text={description} highlight={filter} />
                </Stack>
              )}
              {imgUrl && (
                <Fragment key="img">
                  <img src={imgUrl} className={classes.eventImg} />
                </Fragment>
              )}
              <Stack gap={1}>
                {metadataMap.map(([key, value]: string[], index) => (
                  <Stack key={index} alignItems="center" flexDirection="row">
                    <Stack flexDirection="row" alignItems="center" gap={0.5}>
                      <Stack
                        width="4px"
                        height="4px"
                        minWidth="4px"
                        minHeight="4px"
                        borderRadius="100%"
                        style={{ backgroundColor: theme.palette.text.secondary }}
                      />
                      <span>
                        <HighlightedText text={key ?? ""} highlight={filter} />
                      </span>
                    </Stack>
                    <Stack marginRight={1}>:</Stack>
                    <Stack>
                      <HighlightedText text={value ?? ""} highlight={filter} />
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            </Stack>
          )}
        </div>

        {ruleNavAddress != undefined && (
          <Stack flexDirection="row" gap={1}>
            <Stack justifyContent="center">{t("rule")}:</Stack>
            <Stack>{ruleNavAddress}</Stack>
          </Stack>
        )}

        <Stack flexDirection="row" gap={1}>
          <Stack justifyContent="center">{t("creater")}:</Stack>
          <Typography noWrap>{deviceCreator ?? humanCreator.value}</Typography>
        </Stack>
      </Stack>
    </Stack>
  ) : (
    <></>
  );
}

export const EventView = EventViewComponent;
