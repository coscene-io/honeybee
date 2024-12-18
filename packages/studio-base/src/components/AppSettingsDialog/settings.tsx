// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Brightness5Icon from "@mui/icons-material/Brightness5";
import ComputerIcon from "@mui/icons-material/Computer";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import QuestionAnswerOutlinedIcon from "@mui/icons-material/QuestionAnswerOutlined";
import WebIcon from "@mui/icons-material/Web";
import {
  Autocomplete,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  ToggleButtonGroupProps,
} from "@mui/material";
import moment from "moment-timezone";
import { Dispatch, MouseEvent, SetStateAction, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { filterMap } from "@foxglove/den/collection";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import OsContextSingleton from "@foxglove/studio-base/OsContextSingleton";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks/useAppConfigurationValue";
import { Language } from "@foxglove/studio-base/i18n";
import { reportError } from "@foxglove/studio-base/reportError";
import { UserPersonalInfo } from "@foxglove/studio-base/services/CoSceneConsoleApi";
import { LaunchPreferenceValue } from "@foxglove/studio-base/types/LaunchPreferenceValue";
import { PrefixDisplayMedia, TimeDisplayMethod } from "@foxglove/studio-base/types/panels";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";
import { formatTime } from "@foxglove/studio-base/util/formatTime";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";
import { formatTimeRaw } from "@foxglove/studio-base/util/time";

const MESSAGE_RATES = [1, 3, 5, 10, 15, 20, 30, 60];
const LANGUAGE_OPTIONS: { key: Language; value: string }[] = [
  { key: "en", value: "English" },
  { key: "zh", value: "中文" },
  { key: "ja", value: "日本語" },
];

const useStyles = makeStyles()((theme) => ({
  autocompleteInput: {
    "&.MuiOutlinedInput-input": {
      padding: 0,
    },
  },
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
  toggleButton: {
    display: "flex !important",
    flexDirection: "column",
    gap: theme.spacing(0.75),
    lineHeight: "1 !important",
  },
  // versionText: {
  //   color: theme.palette.text.secondary,
  //   fontSize: theme.typography.caption.fontSize,
  //   marginBottom: theme.spacing(1),
  // },
}));

const selectUser = (store: UserStore) => store.user;

function formatTimezone(name: string) {
  const tz = moment.tz(name);
  const zoneAbbr = tz.zoneAbbr();
  const offset = tz.utcOffset();
  const offsetStr =
    (offset >= 0 ? "+" : "") + moment.duration(offset, "minutes").format("hh:mm", { trim: false });
  if (name === zoneAbbr) {
    return `${zoneAbbr} (${offsetStr})`;
  }
  return `${name} (${zoneAbbr}, ${offsetStr})`;
}

export function ColorSchemeSettings(): React.JSX.Element {
  const { classes } = useStyles();
  const [colorScheme = "system", setColorScheme] = useAppConfigurationValue<string>(
    AppSetting.COLOR_SCHEME,
  );
  const { t } = useTranslation("appSettings");

  const handleChange = useCallback(
    (_event: MouseEvent<HTMLElement>, value?: string) => {
      if (value != undefined) {
        void setColorScheme(value);
      }
    },
    [setColorScheme],
  );

  return (
    <Stack>
      <FormLabel>{t("colorScheme")}:</FormLabel>
      <ToggleButtonGroup
        color="primary"
        size="small"
        fullWidth
        exclusive
        value={colorScheme}
        onChange={handleChange}
      >
        <ToggleButton className={classes.toggleButton} value="dark">
          <DarkModeIcon /> {t("dark")}
        </ToggleButton>
        <ToggleButton className={classes.toggleButton} value="light">
          <Brightness5Icon /> {t("light")}
        </ToggleButton>
        <ToggleButton className={classes.toggleButton} value="system">
          <ComputerIcon /> {t("followSystem")}
        </ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}

export function TimezoneSettings(): React.ReactElement {
  type Option = { key: string; label: string; data?: string; divider?: boolean };

  const { classes } = useStyles();

  const { t } = useTranslation("appSettings");
  const [timezone, setTimezone] = useAppConfigurationValue<string>(AppSetting.TIMEZONE);
  const detectItem: Option = useMemo(
    () => ({
      key: "detect",
      label: `Detect from system: ${formatTimezone(moment.tz.guess())}`,
      data: undefined,
    }),
    [],
  );
  const fixedItems: Option[] = useMemo(
    () => [
      detectItem,
      { key: "zone:UTC", label: formatTimezone("UTC"), data: "UTC" },
      {
        key: "sep",
        label: "",
        divider: true,
      },
    ],
    [detectItem],
  );

  const timezoneItems: Option[] = useMemo(
    () =>
      filterMap(moment.tz.names(), (name) => {
        // UTC is always hoisted to the top in fixedItems
        if (name === "UTC") {
          return undefined;
        }
        return { key: `zone:${name}`, label: formatTimezone(name), data: name };
      }),
    [],
  );

  const allItems = useMemo(() => [...fixedItems, ...timezoneItems], [fixedItems, timezoneItems]);

  const selectedItem = useMemo(() => {
    if (timezone != undefined) {
      return allItems.find((item) => item.data === timezone) ?? detectItem;
    }
    return detectItem;
  }, [allItems, detectItem, timezone]);

  return (
    <FormControl fullWidth>
      <FormLabel>{t("displayTimestampsIn")}:</FormLabel>
      <Autocomplete
        options={[...fixedItems, ...timezoneItems]}
        value={selectedItem}
        renderOption={(props, option: Option) =>
          option.divider === true ? (
            <Divider key={option.key} />
          ) : (
            <li {...props} key={option.key}>
              {option.label}
            </li>
          )
        }
        renderInput={(params) => (
          <TextField
            {...params}
            inputProps={{ ...params.inputProps, className: classes.autocompleteInput }}
          />
        )}
        onChange={(_event, value) => void setTimezone(value?.data)}
      />
    </FormControl>
  );
}

export function TimeFormat({
  orientation = "vertical",
}: {
  orientation?: ToggleButtonGroupProps["orientation"];
}): React.ReactElement {
  const { timeFormat, setTimeFormat } = useAppTimeFormat();

  const { t } = useTranslation("appSettings");

  const [timezone] = useAppConfigurationValue<string>(AppSetting.TIMEZONE);

  const exampleTime = { sec: 946713600, nsec: 0 };

  return (
    <Stack>
      <FormLabel>{t("timestampFormat")}:</FormLabel>
      <ToggleButtonGroup
        color="primary"
        size="small"
        orientation={orientation}
        fullWidth
        exclusive
        value={timeFormat}
        onChange={(_, value?: TimeDisplayMethod) => value != undefined && void setTimeFormat(value)}
      >
        <ToggleButton value="SEC" data-testid="timeformat-seconds">
          {formatTimeRaw(exampleTime)}
        </ToggleButton>
        <ToggleButton value="TOD" data-testid="timeformat-local">
          {formatTime(exampleTime, timezone)}
        </ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}

export function LaunchDefault(): React.ReactElement {
  const { classes } = useStyles();
  const { t } = useTranslation("appSettings");
  const [preference, setPreference] = useAppConfigurationValue<string | undefined>(
    AppSetting.LAUNCH_PREFERENCE,
  );
  let sanitizedPreference: LaunchPreferenceValue;
  switch (preference) {
    case LaunchPreferenceValue.WEB:
    case LaunchPreferenceValue.DESKTOP:
    case LaunchPreferenceValue.ASK:
      sanitizedPreference = preference;
      break;
    default:
      sanitizedPreference = LaunchPreferenceValue.WEB;
  }

  return (
    <Stack>
      <FormLabel>{t("openLinksIn")}:</FormLabel>
      <ToggleButtonGroup
        color="primary"
        size="small"
        fullWidth
        exclusive
        value={sanitizedPreference}
        onChange={(_, value?: string) => value != undefined && void setPreference(value)}
      >
        <ToggleButton value={LaunchPreferenceValue.WEB} className={classes.toggleButton}>
          <WebIcon /> {t("webApp")}
        </ToggleButton>
        <ToggleButton value={LaunchPreferenceValue.DESKTOP} className={classes.toggleButton}>
          <ComputerIcon /> {t("desktopApp")}
        </ToggleButton>
        <ToggleButton value={LaunchPreferenceValue.ASK} className={classes.toggleButton}>
          <QuestionAnswerOutlinedIcon /> {t("askEachTime")}
        </ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}

export function MessageFramerate(): React.ReactElement {
  const { t } = useTranslation("appSettings");
  const [messageRate, setMessageRate] = useAppConfigurationValue<number>(AppSetting.MESSAGE_RATE);
  const options = useMemo(
    () => MESSAGE_RATES.map((rate) => ({ key: rate, text: `${rate}`, data: rate })),
    [],
  );

  return (
    <Stack>
      <FormLabel>{t("messageRate")} (Hz):</FormLabel>
      <Select
        value={messageRate ?? 60}
        fullWidth
        onChange={(event) => void setMessageRate(event.target.value as number)}
      >
        {options.map((option) => (
          <MenuItem key={option.key} value={option.key}>
            {option.text}
          </MenuItem>
        ))}
      </Select>
    </Stack>
  );
}

export function AutoUpdate(): React.ReactElement {
  const { t } = useTranslation("appSettings");
  const [updatesEnabled = true, setUpdatedEnabled] = useAppConfigurationValue<boolean>(
    AppSetting.UPDATES_ENABLED,
  );

  const { classes } = useStyles();

  return (
    <>
      <FormLabel>{t("updates")}:</FormLabel>
      <FormControlLabel
        className={classes.formControlLabel}
        control={
          <Checkbox
            className={classes.checkbox}
            checked={updatesEnabled}
            onChange={(_event, checked) => void setUpdatedEnabled(checked)}
          />
        }
        label={t("automaticallyInstallUpdates")}
      />
    </>
  );
}

export function RosPackagePath(): React.ReactElement {
  const [rosPackagePath, setRosPackagePath] = useAppConfigurationValue<string>(
    AppSetting.ROS_PACKAGE_PATH,
  );

  const rosPackagePathPlaceholder = useMemo(
    () => OsContextSingleton?.getEnvVar("ROS_PACKAGE_PATH"),
    [],
  );

  return (
    <TextField
      fullWidth
      label="ROS_PACKAGE_PATH"
      placeholder={rosPackagePathPlaceholder}
      value={rosPackagePath ?? ""}
      onChange={(event) => void setRosPackagePath(event.target.value)}
    />
  );
}

export function LanguageSettings(): React.ReactElement {
  const { t, i18n } = useTranslation("appSettings");
  const consoleApi = useConsoleApi();

  const [selectedLanguage = "en", setSelectedLanguage] = useAppConfigurationValue<Language>(
    AppSetting.LANGUAGE,
  );
  const userInfo = useCurrentUser(selectUser);

  const onChangeLanguage = useCallback(
    async (event: SelectChangeEvent<Language>) => {
      const lang = event.target.value as Language;

      if (!isDesktopApp()) {
        const userConfigMap = await consoleApi.getUserConfigMap({
          userId: userInfo?.userId ?? "",
          configId: "personalInfo",
        });

        const userConfig = userConfigMap?.value?.toJson() as UserPersonalInfo | undefined;
        if ((lang === "zh" || lang === "en") && userConfig != undefined) {
          await consoleApi.upsertUserConfig({
            userId: userInfo?.userId ?? "",
            configId: "personalInfo",
            obj: {
              ...userConfig,
              settings: { ...userConfig.settings, language: lang },
            },
          });
        }
      }

      void setSelectedLanguage(lang);
      await i18n.changeLanguage(lang).catch((error: unknown) => {
        console.error("Failed to switch languages", error);
        reportError(error as Error);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i18n, setSelectedLanguage],
  );

  const options: { key: string; text: string; data: string }[] = useMemo(
    () =>
      LANGUAGE_OPTIONS.map((language) => ({
        key: language.key,
        text: language.value,
        data: language.key,
      })),
    [],
  );

  // <div className={classes.versionText}>
  //   {t("lastUpdated")}: {dayjs(APP_CONFIG.LAST_BUILD_TIME).format("YYYY-MM-DD HH:mm:ss")}
  // </div>;

  return (
    <Stack>
      <FormLabel>{t("language")}:</FormLabel>
      <Select<Language> value={selectedLanguage} fullWidth onChange={onChangeLanguage}>
        {options.map((option) => (
          <MenuItem key={option.key} value={option.key}>
            {option.text}
          </MenuItem>
        ))}
      </Select>
    </Stack>
  );
}

export function AddTopicPrefix({
  setConfirmFunctions,
}: {
  setConfirmFunctions: Dispatch<SetStateAction<Record<string, () => void>>>;
}): React.ReactElement {
  const addPrefix =
    localStorage.getItem("CoScene_addTopicPrefix") ??
    APP_CONFIG.DEFAULT_TOPIC_PREFIX_OPEN[window.location.hostname] ??
    "false";
  const [tempVal, setTempVal] = useState<PrefixDisplayMedia>(addPrefix as PrefixDisplayMedia);

  const { t } = useTranslation("appSettings");

  return (
    <Stack>
      <FormLabel>{t("addTopicPrefix", { ns: "cosAppSettings" })}:</FormLabel>
      <ToggleButtonGroup
        color="primary"
        size="small"
        fullWidth
        exclusive
        value={tempVal}
        onChange={(_, value?: PrefixDisplayMedia) => {
          if (value != undefined) {
            setTempVal(value);
            if (addPrefix !== value) {
              setConfirmFunctions((prev) => {
                return {
                  ...prev,
                  addPrefix: () => {
                    localStorage.setItem("CoScene_addTopicPrefix", value);
                    window.location.reload();
                  },
                };
              });
            } else {
              setConfirmFunctions((prev) => {
                return {
                  ...prev,
                  addPrefix: () => {},
                };
              });
            }
          }
        }}
      >
        <ToggleButton value="false" data-testid="timeformat-seconds">
          {t("off", { ns: "cosAppSettings" })}
        </ToggleButton>
        <ToggleButton value="true" data-testid="timeformat-local">
          {t("on", { ns: "cosAppSettings" })}
        </ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}
