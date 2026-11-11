// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { timestampDate, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { DiagnosisRule } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/diagnosis_rule_pb";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import RepeatOneOutlinedIcon from "@mui/icons-material/RepeatOneOutlined";
import ShareIcon from "@mui/icons-material/ShareOutlined";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import VisibilityIcon from "@mui/icons-material/VisibilityOutlined";
import { alpha, Stack, IconButton, Link, Typography, type PopoverPosition } from "@mui/material";
import { useCallback, useEffect, useRef, memo, Fragment, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";

import Logger from "@foxglove/log";
import { toRFC3339String, fromDate, areEqual } from "@foxglove/rostime";
import { CustomFieldValuesFields } from "@foxglove/studio-base/components/CustomFieldProperty/field/CustomFieldValuesFields";
import { EventDetails } from "@foxglove/studio-base/components/Events/EventDetails";
import { deleteEventWithFile } from "@foxglove/studio-base/components/Events/deleteEventWithFile";
import {
  DOUBTFUL_MOMENT_COLOR,
  isMomentDoubtful,
} from "@foxglove/studio-base/components/Events/momentDoubtful";
import { HighlightedText } from "@foxglove/studio-base/components/HighlightedText";
import {
  useMessagePipeline,
  MessagePipelineContext,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import {
  TimelinePositionedEvent,
  EventsStore,
  useEvents,
  ToModifyEvent,
} from "@foxglove/studio-base/context/EventsContext";
import { useTimelineInteractionState } from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import { usePlaybackTimeFormat } from "@foxglove/studio-base/hooks";
import { confirmTypes } from "@foxglove/studio-base/hooks/useConfirm";
import { durationToSeconds } from "@foxglove/studio-base/util/time";

import { eventListDetails } from "./eventListModel";

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
    gap: "4px",
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

  layout1: {
    flexDirection: "row",
    paddingRight: theme.spacing(2),
  },

  layout2: {
    marginLeft: theme.spacing(2.5),
    marginRight: theme.spacing(1.5),
    gap: theme.spacing(0.5),
    alignItems: "center",
  },

  layout3: {
    width: "1px",
    height: "15px",
  },

  layout4: {
    width: "1px",
    flex: "1",
  },

  layout5: {
    flex: 1,
    gap: theme.spacing(1),
    width: "0",
  },

  layout6: {
    flexDirection: "row",
    fontSize: "14px",
    justifyContent: "space-between",
  },

  layout7: {
    fontWeight: "400",
  },

  layout8: {
    minWidth: "75px",
    flexDirection: "row",
    gap: theme.spacing(0.5),
  },

  layout9: {
    gap: theme.spacing(1),
    fontSize: "12px",
  },

  layout10: {
    lineHeight: "1.5",
  },

  layout11: {
    gap: theme.spacing(1),
  },

  layout12: {
    alignItems: "center",
    flexDirection: "row",
  },

  layout13: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(0.5),
  },

  layout14: {
    width: "4px",
    height: "4px",
    minWidth: "4px",
    minHeight: "4px",
    borderRadius: "100%",
  },

  layout15: {
    marginRight: theme.spacing(1),
  },

  layout16: {
    flexDirection: "row",
    gap: theme.spacing(1),
    fontSize: "12px",
  },

  layout17: {
    justifyContent: "center",
  },

  layout18: {
    alignItems: "center",
    flexDirection: "row",
    fontSize: "12px",
  },

  layout19: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(0.5),
  },

  layout20: {
    justifyContent: "center",
  },

  layout21: {
    marginRight: theme.spacing(1),
  },

  layout22: {
    paddingTop: theme.spacing(2),
    gap: theme.spacing(2),
  },
}));

const selectRefreshEvents = (store: EventsStore) => store.refreshEvents;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectCustomFieldSchema = (store: EventsStore) => store.customFieldSchema;
const selectRecord = (store: CoreDataStore) => store.record;

const selectProject = (store: CoreDataStore) => store.project;
const selectOrganization = (store: CoreDataStore) => store.organization;

const log = Logger.getLogger(__filename);

function EventViewComponent(params: {
  event: TimelinePositionedEvent;
  filter: string;
  isHovered: boolean;
  isSelected: boolean;
  isLoopedEvent: boolean;
  variant: "small" | "learge";
  disabledScroll?: boolean;
  details?: ReturnType<typeof eventListDetails>;
  getCreator?: (name: string) => Promise<string>;
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
    getCreator,
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
  const customFieldSchema = useEvents(selectCustomFieldSchema);

  const { formatTime } = usePlaybackTimeFormat();
  const { t } = useTranslation("event");

  const project = useCoreData(selectProject);
  const record = useCoreData(selectRecord);
  const organization = useCoreData(selectOrganization);

  const organizationSlug = useMemo(() => organization.value?.slug, [organization]);
  const projectSlug = useMemo(() => project.value?.slug, [project]);
  const projectIsArchived = useMemo(() => project.value?.isArchived, [project]);
  const recordIsArchived = useMemo(() => record.value?.isArchived, [record]);

  const seek = useMessagePipeline(selectSeek);
  const focusEvent = useTimelineInteractionState((store) => store.setEventToFocus);
  const [viewPosition, setViewPosition] = useState<PopoverPosition>();
  const canEditEvent =
    consoleApi.updateEvent.permission() &&
    projectIsArchived === false &&
    recordIsArchived === false;

  const scrollRef = useRef<HTMLDivElement>(ReactNull);

  useEffect(() => {
    if ((isSelected || isHovered) && !disabledScroll) {
      if (scrollRef.current) {
        scrollRef.current.scrollIntoView({ block: "center" });
      }
    }
  }, [isSelected, isHovered, disabledScroll]);

  const deleteEvent = useCallback(async () => {
    try {
      await deleteEventWithFile({ consoleApi, event });
      toast.success(t("momentDeleted"));
      refreshEvents();
    } catch {
      // The initiating row may have left the virtual window while the request was pending.
      toast.error(t("errorDeletingEvent"));
    }
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
  const { triggerTime, duration } = params.details ?? eventListDetails(event, formatTime);
  const description = event.event.description;
  const metadataMap = Object.entries(event.event.customizedFields).filter(
    ([key]) => key !== "_doubtful",
  );
  const imgUrl = event.imgUrl;

  const handleShareEvent = async () => {
    const link = window.location.href;
    const copyLink = link.replace(
      /time=.+Z&|time=.+Z$/,
      `time=${encodeURIComponent(
        toRFC3339String(
          fromDate(
            timestampDate(
              event.event.triggerTime ?? create(TimestampSchema, { seconds: BigInt(0), nanos: 0 }),
            ),
          ),
        ),
      )}&`,
    );

    await navigator.clipboard.writeText(copyLink);

    toast.success(t("copiedMomentToClipboard"));
  };

  const handleEditEvent = () => {
    onEdit({
      name: event.event.name,
      eventName: event.event.displayName,
      startTime: event.startTime,
      duration: durationToSeconds(event.event.duration),
      durationUnit: "sec",
      description: event.event.description,
      metadataEntries: Object.entries(event.event.customizedFields).map(([key, value]) => ({
        key,
        value,
      })),
      enabledCreateNewTask: false,
      fileName: "",
      imgUrl: event.imgUrl,
      files: event.event.files,
      record: event.event.record,
      customFieldValues: event.event.customFieldValues,
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

    if (event.event.rule?.name == undefined || event.event.rule.name === "") {
      return undefined;
    }

    if (diagnosisRuleData == undefined || rule == undefined) {
      return <Typography noWrap>{event.event.rule.name}</Typography>;
    }

    const ruleIndex = diagnosisRuleData.rules.findIndex((diagnosisRule) =>
      diagnosisRule.rules.find((r) => r.id === rule.id),
    );

    const address = `/${organizationSlug}/${projectSlug}/data-collection-diagnosis/${ruleIndex}/${rule.id}`;

    return (
      <Link href={address} target="_blank">
        <Typography noWrap>{event.event.rule.name}</Typography>
      </Link>
    );
  }, [diagnosisRuleData, event.event.rule, organizationSlug, projectSlug]);

  const deviceCreator = useMemo(() => {
    if (event.event.device?.name && event.event.device.name.length > 0) {
      const deviceNavAddress = `/${organizationSlug}/${projectSlug}/devices/project-devices/${event.event.device.name
        .split("/")
        .pop()}`;

      return (
        <Link href={deviceNavAddress} target="_blank">
          <Typography noWrap>{event.event.device.displayName}</Typography>
        </Link>
      );
    }
    return undefined;
  }, [organizationSlug, projectSlug, event.event.device]);

  const [humanCreator, getHumanCreator] = useAsyncFn(async () => {
    if (getCreator != undefined) {
      return await getCreator(event.event.creator);
    }
    const users = await consoleApi.batchGetUsers([event.event.creator]);
    const user = users.users[0];
    return user?.nickname ?? "";
  }, [consoleApi, event.event.creator, getCreator]);

  useEffect(() => {
    getHumanCreator().catch((err: unknown) => {
      log.error("getHumanCreator", err);
    });
  }, [getHumanCreator]);

  return (
    <Stack ref={scrollRef} className={classes.layout1}>
      <Stack className={classes.layout2}>
        <Stack className={cx(classes.line, classes.layout3)} />
        <div
          className={classes.ring}
          style={{
            borderColor: isMomentDoubtful(event.event.customizedFields)
              ? DOUBTFUL_MOMENT_COLOR
              : event.color,
          }}
        />
        <Stack className={cx(classes.line, classes.layout4)} />
      </Stack>

      {viewPosition && (
        <EventDetails
          event={event}
          anchorPosition={viewPosition}
          onClose={() => {
            setViewPosition(undefined);
          }}
        />
      )}
      <Stack className={classes.layout5}>
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

            <IconButton
              size="small"
              title={t("focusMoment")}
              onClick={() => {
                focusEvent(event);
              }}
            >
              <FitScreenIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              title={t(canEditEvent ? "editMoment" : "viewMoment")}
              onClick={(click) => {
                if (canEditEvent) {
                  handleEditEvent();
                } else {
                  const rect = click.currentTarget.getBoundingClientRect();
                  setViewPosition({ top: rect.bottom, left: rect.left });
                }
              }}
            >
              {canEditEvent ? <EditIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
            </IconButton>

            <IconButton size="small" onClick={handleShareEvent} title={t("share")}>
              <ShareIcon fontSize="small" />
            </IconButton>

            {consoleApi.deleteEvent.permission() &&
              projectIsArchived === false &&
              recordIsArchived === false && (
                <IconButton size="small" onClick={confirmDelete} title={t("delete")}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              )}
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
          <Stack className={classes.layout6}>
            <Stack
              className={classes.layout7}
              style={{
                color: theme.palette.text.primary,
              }}
            >
              <HighlightedText text={displayName} highlight={filter} />
            </Stack>

            <Stack
              className={classes.layout8}
              style={{
                color: theme.palette.text.secondary,
              }}
            >
              <TimerOutlinedIcon fontSize="small" />
              <HighlightedText text={duration} highlight={filter} />
            </Stack>
          </Stack>

          {variant === "learge" && (
            <>
              <Stack
                className={classes.layout9}
                style={{
                  color: theme.palette.text.secondary,
                  marginTop: description || imgUrl || metadataMap.length > 0 ? "8px" : undefined,
                }}
              >
                {description && (
                  <Stack className={classes.layout10}>
                    <HighlightedText text={description} highlight={filter} />
                  </Stack>
                )}
                {imgUrl && (
                  <Fragment key="img">
                    <img src={imgUrl} className={classes.eventImg} />
                  </Fragment>
                )}
                <Stack className={classes.layout11}>
                  {metadataMap.map(([key, value]: string[], index) => (
                    <Stack key={index} className={classes.layout12}>
                      <Stack className={classes.layout13}>
                        <Stack
                          style={{ backgroundColor: theme.palette.text.secondary }}
                          className={classes.layout14}
                        />
                        <span>
                          <HighlightedText text={key ?? ""} highlight={filter} />
                        </span>
                      </Stack>
                      <Stack className={classes.layout15}>:</Stack>
                      <Stack>
                        <HighlightedText text={value ?? ""} highlight={filter} />
                      </Stack>
                    </Stack>
                  ))}
                </Stack>
              </Stack>

              {ruleNavAddress != undefined && (
                <Stack
                  className={classes.layout16}
                  style={{
                    color: theme.palette.text.secondary,
                  }}
                >
                  <Stack className={classes.layout17}>{t("rule")}:</Stack>
                  <Stack
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    {ruleNavAddress}
                  </Stack>
                </Stack>
              )}

              <Stack
                className={classes.layout18}
                style={{
                  color: theme.palette.text.secondary,
                }}
              >
                <Stack className={classes.layout19}>
                  <Stack className={classes.layout20}>{t("creator")}</Stack>
                </Stack>
                <Stack className={classes.layout21}>:</Stack>
                <Stack>
                  <Typography noWrap>{deviceCreator ?? humanCreator.value}</Typography>
                </Stack>
              </Stack>

              <Stack className={classes.layout22}>
                {/* custom field */}
                <CustomFieldValuesFields
                  variant="secondary"
                  properties={customFieldSchema?.properties ?? []}
                  customFieldValues={event.event.customFieldValues}
                  readonly
                  ignoreProperties
                />
              </Stack>
            </>
          )}
        </div>
      </Stack>
    </Stack>
  );
}

export const EventView = memo(EventViewComponent);
