// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Button, TextField, Typography, inputBaseClasses } from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { Updater } from "use-immer";

import Stack from "@foxglove/studio-base/components/Stack";

import { ButtonType, Config, ButtonsState } from "./types";

type Props = {
  type: ButtonType;
  config: Config;
  buttonsState: ButtonsState;
  supportCallService: boolean;
  callServiceClicked: (buttonType: ButtonType) => Promise<void>;
  setConfig: Updater<Config>;
};

const useStyles = makeStyles<{ buttonColor?: string }>()((theme, { buttonColor }) => {
  const augmentedButtonColor = buttonColor
    ? theme.palette.augmentColor({
        color: { main: buttonColor },
      })
    : undefined;

  return {
    button: {
      backgroundColor: augmentedButtonColor?.main,
      color: augmentedButtonColor?.contrastText,

      "&:hover": {
        backgroundColor: augmentedButtonColor?.dark,
      },
    },
    textarea: {
      height: "100%",

      [`.${inputBaseClasses.root}`]: {
        backgroundColor: theme.palette.background.paper,
        height: "100%",
        overflow: "hidden",
        padding: theme.spacing(1, 0.5),
        textAlign: "left",
        width: "100%",

        [`.${inputBaseClasses.input}`]: {
          height: "100% !important",
          lineHeight: 1.4,
          fontFamily: theme.typography.fontMonospace,
          overflow: "auto !important",
          resize: "none",
        },
      },
    },
  };
});

function parseInput(value: string): { error?: string; parsedObject?: unknown } {
  let parsedObject;
  let error = undefined;
  try {
    const parsedAny: unknown = JSON.parse(value);
    if (Array.isArray(parsedAny)) {
      error = "Request content must be an object, not an array";
    } else if (parsedAny == undefined) {
      error = "Request content must be an object, not null";
    } else if (typeof parsedAny !== "object") {
      error = `Request content must be an object, not ‘${typeof parsedAny}’`;
    } else {
      parsedObject = parsedAny;
    }
  } catch (e) {
    error = value.length !== 0 ? e.message : "Enter valid request content as JSON";
  }
  return { error, parsedObject };
}

export function CallService(props: Props): React.JSX.Element {
  const { type, config, buttonsState, supportCallService, callServiceClicked, setConfig } = props;

  const { t } = useTranslation("dataCollection");

  const { requestPayload, showRequest, color, state } = useMemo(() => {
    return {
      requestPayload: config.buttons[type].requestPayload,
      showRequest: config.buttons[type].showRequest,
      color: config.buttons[type].color,
      state: buttonsState[type],
    };
  }, [config, buttonsState, type]);

  const { classes } = useStyles({ buttonColor: color });

  const { error: requestParseError, parsedObject } = useMemo(
    () => parseInput(requestPayload),
    [requestPayload],
  );

  const canCallService = Boolean(
    supportCallService &&
      requestPayload &&
      parsedObject != undefined &&
      state?.status !== "requesting",
  );

  return (
    <Stack flex="auto" gap={1} padding={1.5} position="relative" fullHeight>
      <Stack gap={1} flexGrow="1">
        {showRequest && (
          <Stack flexGrow="1">
            <Typography variant="caption" noWrap>
              {t("requestDetails")}
            </Typography>
            <TextField
              variant="outlined"
              className={classes.textarea}
              multiline
              size="small"
              placeholder="Enter service request as JSON"
              value={requestPayload}
              onChange={(event) => {
                setConfig((draft) => {
                  draft.buttons[type].requestPayload = event.target.value;
                });
              }}
              error={requestParseError != undefined}
            />
            {requestParseError && (
              <Typography variant="caption" noWrap color={requestParseError ? "error" : undefined}>
                {requestParseError}
              </Typography>
            )}
          </Stack>
        )}
      </Stack>
      <Stack
        direction="row"
        justifyContent="center"
        alignItems="center"
        overflow="hidden"
        flexGrow={0}
        gap={1.5}
      >
        <span>
          <Button
            className={classes.button}
            variant="contained"
            disabled={!canCallService}
            onClick={async () => {
              await callServiceClicked(type);
            }}
            data-testid="call-service-button"
          >
            {t(type)}
          </Button>
        </span>
      </Stack>
    </Stack>
  );
}
