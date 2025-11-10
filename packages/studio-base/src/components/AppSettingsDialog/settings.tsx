// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { JsonValue } from "@bufbuild/protobuf";
import { Value } from "@bufbuild/protobuf";
import Brightness5Icon from "@mui/icons-material/Brightness5";
import ComputerIcon from "@mui/icons-material/Computer";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import HelpIcon from "@mui/icons-material/HelpOutlined";
import QuestionAnswerOutlinedIcon from "@mui/icons-material/QuestionAnswerOutlined";
import WebIcon from "@mui/icons-material/Web";
import {
  Autocomplete,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  Link,
  MenuItem,
  Select,
  SelectChangeEvent,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  ToggleButtonGroupProps,
  Tooltip,
  Typography,
} from "@mui/material";
import moment from "moment-timezone";
import { MouseEvent, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { filterMap } from "@foxglove/den/collection";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import OsContextSingleton from "@foxglove/studio-base/OsContextSingleton";
import Stack from "@foxglove/studio-base/components/Stack";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";
import { useAppTimeFormat } from "@foxglove/studio-base/hooks";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks/useAppConfigurationValue";
import { Language } from "@foxglove/studio-base/i18n";
import { reportError } from "@foxglove/studio-base/reportError";
import { LaunchPreferenceValue } from "@foxglove/studio-base/types/LaunchPreferenceValue";
import { TimeDisplayMethod } from "@foxglove/studio-base/types/panels";
import { getAppConfig } from "@foxglove/studio-base/util/appConfig";
import { formatTime } from "@foxglove/studio-base/util/formatTime";
import { getDocsLink } from "@foxglove/studio-base/util/getDocsLink";
import { formatTimeRaw } from "@foxglove/studio-base/util/time";

const INFINITY_TIME = 1000 * 60 * 60 * 24 * 365 * 100;
const TIMEOUT_MINUTES = [10, 20, 30, 60, 120, INFINITY_TIME];
const RETENTION_WINDOW_MS = [
  0,
  10 * 1000,
  20 * 1000,
  30 * 1000,
  1 * 60 * 1000,
  2 * 60 * 1000,
  3 * 60 * 1000,
  5 * 60 * 1000,
];
const PERSONAL_INFO_CONFIG_ID = "personalInfo";

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
}));

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
            slotProps={{
              htmlInput: { ...params.inputProps, className: classes.autocompleteInput },
            }}
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

export function StudioRemoteConfigUrl(): React.ReactElement {
  const [remoteConfigUrl, setRemoteConfigUrl] = useAppConfigurationValue<string>(
    AppSetting.REMOTE_CONFIG_URL,
  );
  const { t } = useTranslation("cosSettings");

  const initialValueRef = useRef(remoteConfigUrl ?? "");
  const isChanged = (remoteConfigUrl ?? "") !== initialValueRef.current;

  const appConfig = getAppConfig();
  const env = appConfig.VITE_APP_PROJECT_ENV;

  const placeholder =
    env === "aws" || env === "gcp"
      ? `${t("example")}: https://coscene.io/`
      : `${t("example")}: https://coscene.cn/`;

  const invalid = useMemo(() => {
    const value = (remoteConfigUrl ?? "").trim();
    if (value === "") {
      return false;
    }
    const pattern = /^https:\/\/(?:[a-z0-9-]+\.)*coscene\.(?:io|cn)\/?$/i;
    return !pattern.test(value);
  }, [remoteConfigUrl]);

  return (
    <Stack>
      <FormLabel>
        <Stack direction="row" alignItems="center" gap={0.5}>
          {t("domain")} :
          <Tooltip title={t("domainDescription")}>
            <HelpIcon fontSize="small" />
          </Tooltip>
        </Stack>
      </FormLabel>

      <TextField
        fullWidth
        placeholder={placeholder}
        value={remoteConfigUrl ?? ""}
        onChange={(event) => void setRemoteConfigUrl(event.target.value)}
        error={invalid}
        helperText={
          invalid
            ? t("invalidDomain")
            : isChanged && (
                <Trans
                  t={t}
                  i18nKey="willTakeEffectOnTheNextStartup"
                  components={{
                    Link: (
                      <Link
                        href="#"
                        onClick={() => {
                          window.location.reload();
                        }}
                      />
                    ),
                  }}
                />
              )
        }
      />
    </Stack>
  );
}

const selectUser = (store: UserStore) => store.user;

export function LanguageSettings(): React.ReactElement {
  const { t, i18n } = useTranslation("appSettings");

  const [, setSelectedLanguage] = useAppConfigurationValue<Language>(AppSetting.LANGUAGE);
  const selectedLanguage: Language = useMemo(() => i18n.language as Language, [i18n.language]);

  const appConfig = getAppConfig();
  const consoleApi = useConsoleApi();
  const currentUser = useCurrentUser(selectUser);

  const LANGUAGE_OPTIONS: { key: Language; value: string }[] = useMemo(
    () =>
      [
        { key: "en", value: "English" },
        { key: "zh", value: "中文" },
        { key: "ja", value: "日本語" },
      ].filter((language) => appConfig.LANGUAGE?.options.includes(language.key)),
    [appConfig.LANGUAGE?.options],
  ) as { key: Language; value: string }[];

  const onChangeLanguage = useCallback(
    async (event: SelectChangeEvent<Language>) => {
      const lang = event.target.value;

      void setSelectedLanguage(lang);
      await i18n.changeLanguage(lang).catch((error: unknown) => {
        console.error("Failed to switch languages", error);
        reportError(error as Error);
      });

      // Only sync to config map if user is logged in and has permission
      if (consoleApi.upsertOrgConfigMap.permission() && currentUser?.userId) {
        const configName = `users/${currentUser.userId}/configMaps/${PERSONAL_INFO_CONFIG_ID}`;

        const userConfig = await consoleApi.getOrgConfigMap({
          name: configName,
        });

        const settings = {
          ...(userConfig.value?.toJson() as
            | {
                settings?: {
                  language?: string;
                };
              }
            | undefined),
          settings: {
            language: lang,
          },
        };

        void consoleApi.upsertOrgConfigMap({
          configMap: {
            name: configName,
            value:
              Object.keys(settings).length > 0 ? Value.fromJson(settings as JsonValue) : undefined,
          },
        });
      }
    },

    [consoleApi, currentUser?.userId, i18n, setSelectedLanguage],
  );

  const options: { key: string; text: string; data: string }[] = useMemo(
    () =>
      LANGUAGE_OPTIONS.map((language) => ({
        key: language.key,
        text: language.value,
        data: language.key,
      })),
    [LANGUAGE_OPTIONS],
  );

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

export function CompatibilityMode(): React.ReactElement {
  const [tfCompatibilityMode, setTfCompatibilityMode] = useAppConfigurationValue<string>(
    AppSetting.TF_COMPATIBILITY_MODE,
  );
  const { t } = useTranslation("appSettings");
  const { reloadCurrentSource } = usePlayerSelection();

  return (
    <Stack>
      <FormLabel>
        <Stack direction="row" alignItems="center" gap={0.5}>
          {t("tfCompatibilityMode")} :
          <Tooltip
            title={
              <Trans
                t={t}
                i18nKey="tfCompatibilityModeHelp"
                components={{
                  Link: <Link href={getDocsLink("/viz/options")} />,
                }}
              />
            }
          >
            <HelpIcon fontSize="small" />
          </Tooltip>
        </Stack>
      </FormLabel>
      <ToggleButtonGroup
        color="primary"
        size="small"
        fullWidth
        exclusive
        value={tfCompatibilityMode === "true" ? "true" : "false"}
        onChange={(_, value?: string) => {
          if (value != undefined) {
            void setTfCompatibilityMode(value);

            void reloadCurrentSource();
          }
        }}
      >
        <ToggleButton value="false" data-testid="timeformat-seconds">
          {t("off")}
        </ToggleButton>
        <ToggleButton value="true" data-testid="timeformat-local">
          {t("on")}
        </ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}

export function InactivityTimeout(): React.ReactElement {
  const { t } = useTranslation("appSettings");
  const [timeoutMinutes, setTimeoutMinutes] = useAppConfigurationValue<number>(AppSetting.TIMEOUT);
  const options = useMemo(
    () =>
      TIMEOUT_MINUTES.map((minutes) => ({
        key: minutes,
        text: minutes === INFINITY_TIME ? t("neverDisconnect") : `${minutes}`,
        data: minutes,
      })),
    [t],
  );

  return (
    <Stack>
      <FormLabel>
        <Stack direction="row" alignItems="center" gap={0.5}>
          {t("inactivityTimeout")} ({t("minutes")}):
          <Tooltip title={t("inactivityTimeoutDescription")}>
            <HelpIcon fontSize="small" />
          </Tooltip>
        </Stack>
      </FormLabel>
      <Select
        value={timeoutMinutes ?? 30}
        fullWidth
        onChange={(event) => void setTimeoutMinutes(event.target.value)}
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

const selectDataSource = (state: CoreDataStore) => state.dataSource;

export function RetentionWindowMs(): React.ReactElement {
  const { t } = useTranslation("appSettings");
  const [retentionWindowMs, setRetentionWindowMs] = useAppConfigurationValue<number>(
    AppSetting.RETENTION_WINDOW_MS,
  );
  const dataSource = useCoreData(selectDataSource);
  const [showTips, setShowTips] = useState(false);
  const { reloadCurrentSource } = usePlayerSelection();

  const { theme } = useStyles();
  const getDurationText = useCallback(
    (ms: number) => {
      switch (ms) {
        case 0:
          return t("noCache");
        case 10 * 1000:
          return `10 ${t("seconds")}`;
        case 20 * 1000:
          return `20 ${t("seconds")}`;
        case 30 * 1000:
          return `30 ${t("seconds")}`;
        case 60 * 1000:
          return `1 ${t("minutes")}`;
        case 1 * 60 * 1000:
          return `1 ${t("minutes")}`;
        case 2 * 60 * 1000:
          return `2 ${t("minutes")}`;
        case 3 * 60 * 1000:
          return `3 ${t("minutes")}`;
        case 5 * 60 * 1000:
          return `5 ${t("minutes")}`;
        default:
          return "";
      }
    },
    [t],
  );

  const options = useMemo(
    () =>
      RETENTION_WINDOW_MS.map((ms) => ({
        key: ms,
        text: getDurationText(ms),
        data: ms,
      })),
    [getDurationText],
  );

  return (
    <Stack>
      <FormLabel>
        <Stack direction="row" alignItems="center" gap={0.5}>
          {t("retentionWindowMs")}:
          <Tooltip title={t("retentionWindowDescription")}>
            <HelpIcon fontSize="small" />
          </Tooltip>
        </Stack>
      </FormLabel>
      <Select
        value={retentionWindowMs ?? 30 * 1000}
        fullWidth
        onChange={(event) => {
          void setRetentionWindowMs(event.target.value);
          if (dataSource?.id === "coscene-websocket") {
            setShowTips(true);
          }
        }}
      >
        {options.map((option) => (
          <MenuItem key={option.key} value={option.key}>
            {option.text}
          </MenuItem>
        ))}
      </Select>
      {showTips && (
        <Stack>
          <Typography color={theme.palette.warning.main}>
            <Trans
              t={t}
              i18nKey="retentionWindowNextEffectiveNotice"
              components={{
                Link: (
                  <Link
                    href="#"
                    onClick={async () => {
                      await reloadCurrentSource();
                      setShowTips(false);
                    }}
                  />
                ),
              }}
            />
          </Typography>
        </Stack>
      )}
    </Stack>
  );
}

export function RequestWindow(): React.ReactElement {
  const [requestWindow, setRequestWindow] = useAppConfigurationValue<number>(
    AppSetting.REQUEST_WINDOW,
  );

  return (
    <TextField
      fullWidth
      label="单次请求的秒数:"
      value={requestWindow ?? ""}
      type="number"
      onChange={(event) => void setRequestWindow(Number(event.target.value))}
    />
  );
}

export function ReadAheadDuration(): React.ReactElement {
  const [readAheadDuration, setReadAheadDuration] = useAppConfigurationValue<number>(
    AppSetting.READ_AHEAD_DURATION,
  );

  return (
    <TextField
      fullWidth
      label="预读的秒数:"
      value={readAheadDuration ?? ""}
      type="number"
      onChange={(event) => void setReadAheadDuration(Number(event.target.value))}
    />
  );
}

export function AutoConnectToLan(): React.ReactElement {
  const { t } = useTranslation("appSettings");
  const [autoConnectToLan = true, setAutoConnectToLan] = useAppConfigurationValue<boolean>(
    AppSetting.AUTO_CONNECT_LAN,
  );

  return (
    <Stack>
      <FormLabel>
        <Stack direction="row" alignItems="center" gap={0.5}>
          {t("autoConnectToLan")} :
          <Tooltip title={t("autoConnectToLanDescription")}>
            <HelpIcon fontSize="small" />
          </Tooltip>
        </Stack>
      </FormLabel>
      <ToggleButtonGroup
        color="primary"
        size="small"
        fullWidth
        exclusive
        value={String(autoConnectToLan)}
        onChange={(_, value?: string) => {
          void setAutoConnectToLan(value === "true");
        }}
      >
        <ToggleButton value="false" data-testid="timeformat-seconds">
          {t("off")}
        </ToggleButton>
        <ToggleButton value="true" data-testid="timeformat-local">
          {t("on")}
        </ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  );
}
