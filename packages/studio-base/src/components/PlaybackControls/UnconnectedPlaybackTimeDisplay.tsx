// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CheckIcon from "@mui/icons-material/Check";
import WarningIcon from "@mui/icons-material/Warning";
import {
  TextField,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
  filledInputClasses,
  iconButtonClasses,
  inputBaseClasses,
} from "@mui/material";
import { useState, useCallback, useMemo, useEffect, MouseEvent, useRef } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { Time, isTimeInRangeInclusive, subtract } from "@foxglove/rostime";
import Stack from "@foxglove/studio-base/components/Stack";
import { IAppTimeFormat } from "@foxglove/studio-base/hooks/useAppTimeFormat";
import { TimeDisplayMethod } from "@foxglove/studio-base/types/panels";
import {
  formatDate,
  formatTime,
  formatSourceTime,
  getValidatedTimeAndMethodFromString,
} from "@foxglove/studio-base/util/formatTime";
import {
  formatPlaybackDuration,
  formatRelativeTime,
} from "@foxglove/studio-base/util/relativeTime";
import { formatTimeRaw } from "@foxglove/studio-base/util/time";

type PlaybackTimeDisplayMethodProps = {
  compact?: boolean;
  appTimeFormat: IAppTimeFormat;
  currentTime?: Time;
  startTime?: Time;
  endTime?: Time;
  timezone?: string;
  onSeek: (arg0: Time) => void;
  onPause: () => void;
  isPlaying: boolean;
};

const useStyles = makeStyles<{
  timeDisplayMethod: TimeDisplayMethod;
  compact: boolean;
  relativeTimeWidth: number;
}>()((theme, { timeDisplayMethod, compact, relativeTimeWidth }) => ({
  textField: {
    borderRadius: theme.shape.borderRadius,

    "&.Mui-disabled": {
      [`.${filledInputClasses.root}`]: {
        backgroundColor: "transparent",
      },
    },
    "&:not(.Mui-disabled):hover": {
      backgroundColor: theme.palette.action.hover,

      [`.${iconButtonClasses.root}`]: {
        visibility: "visible",
      },
    },
    [`.${filledInputClasses.root}`]: {
      backgroundColor: "transparent",

      ":hover": {
        backgroundColor: "transparent",
      },
    },
    [`.${inputBaseClasses.input}`]: {
      fontFeatureSettings: `${theme.typography.fontFeatureSettings}, 'zero' !important`,
      fontFamily: theme.typography.fontMonospace,
      fontVariantNumeric: "tabular-nums",
      fontSize: 12,
      minWidth: 0,
      width:
        timeDisplayMethod === "REL"
          ? `${relativeTimeWidth}ch`
          : compact
            ? "12ch"
            : timeDisplayMethod === "TOD"
              ? "32ch"
              : "20ch",
      color:
        timeDisplayMethod === "REL"
          ? theme.palette.mode === "dark"
            ? theme.palette.info.main
            : theme.palette.primary.main
          : undefined,
      paddingBlock: 6,
    },
    [`.${iconButtonClasses.root}`]: {
      borderTopLeftRadius: 0,
      borderBottomLeftRadius: 0,
      borderLeft: `1px solid ${theme.palette.background.paper}`,
      visibility: "visible",
      marginRight: theme.spacing(-1),
    },
  },
  totalDuration: {
    color: theme.palette.text.secondary,
    fontFamily: theme.typography.fontMonospace,
    fontVariantNumeric: "tabular-nums",
    fontSize: 12,
    whiteSpace: "nowrap",
    marginRight: theme.spacing(1),
  },
  textFieldError: {
    outline: `1px solid ${theme.palette.error.main}`,
    outlineOffset: -1,

    [`.${inputBaseClasses.root}`]: {
      color: theme.palette.error.main,
      borderLeftColor: theme.palette.error.main,
      [`& .${inputBaseClasses.input}`]: { color: theme.palette.error.main },
    },
  },
}));

function PlaybackTimeMethodMenu({
  timeFormat,
  timeRawString,
  timeOfDayString,
  relativeTimeString,
  setTimeFormat,
}: {
  timeFormat: TimeDisplayMethod;
  timeRawString?: string;
  timeOfDayString?: string;
  relativeTimeString?: string;
  setTimeFormat: (format: TimeDisplayMethod) => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation(["general", "appSettings"]);
  const [anchorEl, setAnchorEl] = useState<undefined | HTMLElement>(undefined);
  const open = Boolean(anchorEl);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(undefined);
  };

  return (
    <>
      <IconButton
        id="playback-time-display-toggle-button"
        aria-label={t("timeDisplayFormat")}
        aria-controls={open ? "playback-time-display-toggle-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
        onClick={handleClick}
        size="small"
      >
        <ArrowDropDownIcon fontSize="small" />
      </IconButton>
      <Menu
        id="playback-time-display-toggle-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        slotProps={{ list: { dense: true } }}
        data-tourid="playback-time-display"
        aria-labelledby="playback-time-display-toggle-button"
      >
        {[
          { key: "TOD", label: t("appSettings:dateTime"), preview: timeOfDayString },
          { key: "SEC", label: t("appSettings:unixTime"), preview: timeRawString },
          { key: "REL", label: t("appSettings:relativeTime"), preview: relativeTimeString },
        ].map((option) => (
          <MenuItem
            key={option.key}
            selected={timeFormat === option.key}
            onClick={async () => {
              await setTimeFormat(option.key as TimeDisplayMethod);
              handleClose();
            }}
          >
            {timeFormat === option.key && (
              <ListItemIcon>
                <CheckIcon fontSize="small" />
              </ListItemIcon>
            )}
            <ListItemText
              inset={timeFormat !== option.key}
              primary={option.label}
              secondary={option.preview}
              slotProps={{
                primary: {
                  variant: "inherit",
                },
              }}
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export function UnconnectedPlaybackTimeDisplay({
  compact = false,
  appTimeFormat,
  currentTime,
  startTime,
  endTime,
  timezone,
  onSeek,
  onPause,
  isPlaying,
}: PlaybackTimeDisplayMethodProps): React.JSX.Element {
  const { t } = useTranslation("general");
  const inputRef = useRef<HTMLInputElement>(ReactNull);
  const editingRef = useRef(false);
  const originalInputRef = useRef<string>();
  const timeOutID = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const timeRawString = useMemo(
    () => (currentTime ? formatTimeRaw(currentTime) : undefined),
    [currentTime],
  );
  const timeOfDayString = useMemo(
    () =>
      currentTime
        ? `${formatDate(currentTime, timezone)} ${formatTime(currentTime, timezone)}`
        : undefined,
    [currentTime, timezone],
  );
  const relativeTimeString = useMemo(
    () => (currentTime ? formatRelativeTime(currentTime, startTime) : undefined),
    [currentTime, startTime],
  );
  const totalDuration = useMemo(
    () =>
      startTime && endTime ? formatPlaybackDuration(subtract(endTime, startTime)) : "--:--:--.---",
    [startTime, endTime],
  );
  const { classes, cx } = useStyles({
    timeDisplayMethod: appTimeFormat.timeFormat,
    compact,
    relativeTimeWidth: Math.max(12, totalDuration.length),
  });
  const currentTimeString =
    appTimeFormat.timeFormat === "REL"
      ? relativeTimeString
      : appTimeFormat.timeFormat === "SEC"
        ? timeRawString
        : timeOfDayString;
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [inputText, setInputText] = useState<string | undefined>(currentTimeString ?? undefined);
  const [hasError, setHasError] = useState<boolean>(false);

  const commitInput = useCallback(() => {
    if (!editingRef.current) {
      return true;
    }
    if (inputText === originalInputRef.current || !inputText?.trim()) {
      editingRef.current = false;
      setHasError(false);
      return true;
    }
    if (!startTime || !endTime) {
      return false;
    }
    const parsed = getValidatedTimeAndMethodFromString({
      text: inputText,
      timezone,
      timeFormat: appTimeFormat.timeFormat,
      playbackOrigin: startTime,
    });
    if (!parsed?.time || !isTimeInRangeInclusive(parsed.time, startTime, endTime)) {
      setHasError(true);
      return false;
    }
    editingRef.current = false;
    setHasError(false);
    onSeek(parsed.time);
    if (parsed.method !== appTimeFormat.timeFormat) {
      void appTimeFormat.setTimeFormat(parsed.method);
    }
    return true;
  }, [inputText, startTime, endTime, timezone, onSeek, appTimeFormat]);

  const onSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (commitInput()) {
        setIsEditing(false);
        inputRef.current?.blur();
      }
    },
    [commitInput],
  );

  useEffect(() => {
    editingRef.current = false;
    setIsEditing(false);
    setHasError(false);
  }, [appTimeFormat.timeFormat, startTime?.sec, startTime?.nsec]);

  useEffect(() => {
    // If user submits an empty input field or resumes playback, clear error state and show current timestamp
    if (hasError && (inputText == undefined || inputText.length === 0 || isPlaying)) {
      setIsEditing(false);
      setHasError(false);
    }

    return () => {
      if (timeOutID.current != undefined) {
        clearTimeout(timeOutID.current);
      }
    };
  }, [hasError, inputText, isPlaying]);

  return (
    <Stack direction="row" alignItems="center" flexGrow={0} gap={0.5}>
      {currentTime ? (
        <form onSubmit={onSubmit} style={{ width: "100%" }}>
          <Tooltip
            title={
              !isEditing
                ? appTimeFormat.timeFormat === "REL"
                  ? formatSourceTime(currentTime, timezone)
                  : currentTimeString
                : ""
            }
          >
            <TextField
              className={cx(classes.textField, { [classes.textFieldError]: hasError })}
              aria-label="Playback Time Method"
              data-testid="PlaybackTime-text"
              inputRef={inputRef}
              value={
                isEditing
                  ? inputText
                  : compact && appTimeFormat.timeFormat === "TOD"
                    ? formatTime(currentTime, timezone)
                    : currentTimeString
              }
              error={hasError}
              variant="filled"
              size="small"
              onFocus={(e) => {
                onPause();
                if (timeOutID.current != undefined) {
                  clearTimeout(timeOutID.current);
                }
                editingRef.current = true;
                originalInputRef.current = currentTimeString;
                setHasError(false);
                setIsEditing(true);
                setInputText(currentTimeString);
                e.target.select();
              }}
              onBlur={(e) => {
                e.preventDefault();
                commitInput();
                editingRef.current = false;
                setIsEditing(false);
                timeOutID.current = setTimeout(() => {
                  setHasError(false);
                }, 600);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  editingRef.current = false;
                  setHasError(false);
                  setIsEditing(false);
                  inputRef.current?.blur();
                }
              }}
              onChange={(event) => {
                setInputText(event.target.value);
              }}
              slotProps={{
                htmlInput: {
                  "aria-label":
                    appTimeFormat.timeFormat === "REL" ? t("elapsedTime") : t("playbackTime"),
                },
                input: {
                  startAdornment: hasError ? <WarningIcon color="error" /> : undefined,
                  endAdornment: (
                    <>
                      {appTimeFormat.timeFormat === "REL" && (
                        <Typography
                          component="span"
                          className={classes.totalDuration}
                          aria-label={t("totalDuration")}
                          data-testid="playback-total-duration"
                        >
                          / {totalDuration}
                        </Typography>
                      )}
                      <PlaybackTimeMethodMenu
                        {...{
                          currentTime,
                          timezone,
                          timeOfDayString,
                          timeRawString,
                          relativeTimeString,
                          timeFormat: appTimeFormat.timeFormat,
                          setTimeFormat: appTimeFormat.setTimeFormat,
                        }}
                      />
                    </>
                  ),
                },
              }}
            />
          </Tooltip>
        </form>
      ) : (
        <TextField
          className={cx(classes.textField, "Mui-disabled")}
          disabled
          variant="filled"
          size="small"
          defaultValue={
            appTimeFormat.timeFormat === "REL"
              ? "--:--:--.--- / --:--:--.---"
              : appTimeFormat.timeFormat === "SEC"
                ? "0000000000.000000000"
                : "0000-00-00 00:00:00.000"
          }
          slotProps={{
            input: {
              endAdornment: (
                <IconButton edge="end" size="small" disabled>
                  <ArrowDropDownIcon fontSize="small" />
                </IconButton>
              ),
            },
          }}
        />
      )}
    </Stack>
  );
}
