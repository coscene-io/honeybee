// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { Checkbox, FormControlLabel, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import Stack from "@foxglove/studio-base/components/Stack";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks/useAppConfigurationValue";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";

const useStyles = makeStyles()({
  checkbox: {
    "&.MuiCheckbox-root": {
      paddingTop: 0,
    },
  },
  formControlLabel: {
    "&.MuiFormControlLabel-root": {
      alignItems: "start",
    },
  },
});

type Feature = {
  key: AppSetting;
  name: string;
  description: string;
};

const features: Feature[] = [
  {
    key: AppSetting.SHOW_DEBUG_PANELS,
    name: "studioDebugPanels",
    description: "studioDebugPanelsDescription",
  },
  {
    key: AppSetting.ENABLE_LEGACY_PLOT_PANEL,
    name: "legacyPlotPanel",
    description: "legacyPlotPanelDescription",
  },
  {
    key: AppSetting.ENABLE_MEMORY_USE_INDICATOR,
    name: "memoryUseIndicator",
    description: "memoryUseIndicatorDecription",
  },
  {
    key: AppSetting.ENABLE_PLOT_PANEL_SERIES_SETTINGS,
    name: "plotPanelSeriesInSettings",
    description: "plotPanelSeriesInSettingsDescription",
  },
];
if (process.env.NODE_ENV === "development") {
  features.push({
    key: AppSetting.ENABLE_LAYOUT_DEBUGGING,
    name: "layoutDebugging",
    description: "layoutDebuggingDescription",
  });
}

function ExperimentalFeatureItem(props: { feature: Feature }) {
  const { feature } = props;
  const { classes } = useStyles();
  const analytics = useAnalytics();
  const { t } = useTranslation("preferences");

  const [enabled, setEnabled] = useAppConfigurationValue<boolean>(feature.key);
  return (
    <FormControlLabel
      className={classes.formControlLabel}
      control={
        <Checkbox
          className={classes.checkbox}
          checked={enabled ?? false}
          onChange={(_, checked) => {
            void setEnabled(checked);
            void analytics.logEvent(AppEvent.EXPERIMENTAL_FEATURE_TOGGLE, {
              feature: feature.key,
              checked,
            });
          }}
        />
      }
      label={
        <Stack gap={0.25} paddingLeft={0.5}>
          <Typography fontWeight={600}>{t(feature.name)}</Typography>
          <Typography variant="body2" color="text.secondary">
            <>{t(feature.description)}</>
          </Typography>
        </Stack>
      }
    />
  );
}

export const ExperimentalFeatureSettings = (): React.ReactElement => (
  <Stack gap={2}>
    {features.length === 0 && (
      <Typography fontStyle="italic">Currently there are no experimental features.</Typography>
    )}
    {features.map((feature) => (
      <ExperimentalFeatureItem key={feature.key} feature={feature} />
    ))}
  </Stack>
);
