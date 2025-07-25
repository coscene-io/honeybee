// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  Typography,
} from "@mui/material";
import { ReactElement, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { useSessionStorageValue } from "@foxglove/hooks";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import Stack from "@foxglove/studio-base/components/Stack";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks";
import { LaunchPreferenceValue } from "@foxglove/studio-base/types/LaunchPreferenceValue";

const useStyles = makeStyles()((theme) => ({
  button: {
    textAlign: "left",
    justifyContent: "flex-start",
    padding: theme.spacing(2),
    gap: theme.spacing(1.5),
    borderColor: theme.palette.divider,
    height: "100%",
  },
  paper: {
    maxWidth: 480,
  },
  dialogTitle: {
    textAlign: "center",
    fontSize: theme.typography.h2.fontSize,
    paddingBlock: theme.spacing(3),
  },
}));

export function LaunchPreferenceScreen(): ReactElement {
  const { classes } = useStyles();
  const [globalPreference, setGlobalPreference] = useAppConfigurationValue<string | undefined>(
    AppSetting.LAUNCH_PREFERENCE,
  );
  const [, setSessionPreference] = useSessionStorageValue(AppSetting.LAUNCH_PREFERENCE);
  const [rememberPreference, setRememberPreference] = useState(globalPreference != undefined);

  async function launchInWeb() {
    setSessionPreference(LaunchPreferenceValue.WEB); // always set session preference to allow overriding the URL param
    await setGlobalPreference(rememberPreference ? LaunchPreferenceValue.WEB : undefined);
  }

  async function launchInDesktop() {
    setSessionPreference(LaunchPreferenceValue.DESKTOP); // always set session preference to allow overriding the URL param
    await setGlobalPreference(rememberPreference ? LaunchPreferenceValue.DESKTOP : undefined);
  }

  function toggleRememberPreference() {
    setRememberPreference(!rememberPreference);
  }

  const actions = [
    {
      key: LaunchPreferenceValue.WEB,
      primary: "Web",
      secondary: "Requires Chrome v76+",
      onClick: () => void launchInWeb(),
    },
    {
      key: LaunchPreferenceValue.DESKTOP,
      primary: "Desktop App",
      secondary: "For Linux, Windows, and macOS",
      onClick: () => void launchInDesktop(),
    },
  ];

  return (
    <Dialog open classes={{ paper: classes.paper }}>
      <DialogTitle className={classes.dialogTitle}>Launch coScene Studio</DialogTitle>
      <DialogContent>
        <Grid container spacing={1}>
          {actions.map((action) => (
            <Grid key={action.key} size={{ xs: 12, sm: 6 }}>
              <Button
                className={classes.button}
                fullWidth
                color="inherit"
                variant="outlined"
                onClick={action.onClick}
              >
                <Stack flex="auto" zeroMinWidth>
                  <Typography variant="subtitle1" color="text.primary">
                    {action.primary}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {action.secondary}
                  </Typography>
                </Stack>
              </Button>
            </Grid>
          ))}
          <Grid size={{ xs: 12 }}>
            <FormControlLabel
              label="Remember my preference"
              control={
                <Checkbox
                  color="primary"
                  checked={rememberPreference}
                  onChange={toggleRememberPreference}
                />
              }
            />
          </Grid>
        </Grid>
      </DialogContent>
    </Dialog>
  );
}
