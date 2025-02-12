// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Alert,
  Dialog,
  DialogProps,
  DialogTitle,
  IconButton,
  Link,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { MouseEvent, SyntheticEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import OsContextSingleton from "@foxglove/studio-base/OsContextSingleton";
import { CoSceneTextLogo } from "@foxglove/studio-base/components/CoSceneLogo";
import CopyButton from "@foxglove/studio-base/components/CopyButton";
import { ExperimentalFeatureSettings } from "@foxglove/studio-base/components/ExperimentalFeatureSettings";
import Stack from "@foxglove/studio-base/components/Stack";
import { useAppContext } from "@foxglove/studio-base/context/AppContext";
import {
  useWorkspaceStore,
  WorkspaceContextStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

import {
  AutoUpdate,
  ColorSchemeSettings,
  LanguageSettings,
  MessageFramerate,
  TimeFormat,
  TimezoneSettings,
  AddTopicPrefix,
  CompatibilityMode,
} from "./settings";

const useStyles = makeStyles()((theme) => ({
  layoutGrid: {
    display: "grid",
    gap: theme.spacing(2),
    height: "70vh",
    paddingLeft: theme.spacing(1),
    overflowY: "hidden",
    [theme.breakpoints.up("sm")]: {
      gridTemplateColumns: "auto minmax(0, 1fr)",
    },
  },
  tabPanel: {
    display: "none",
    marginRight: "-100%",
    width: "100%",
    padding: theme.spacing(0, 4, 4),
  },
  tabPanelActive: {
    display: "block",
  },
  tab: {
    svg: {
      fontSize: "inherit",
    },
    "> span, > .MuiSvgIcon-root": {
      display: "flex",
      color: theme.palette.primary.main,
      marginRight: theme.spacing(1.5),
      height: theme.typography.pxToRem(21),
      width: theme.typography.pxToRem(21),
    },
    [theme.breakpoints.up("sm")]: {
      textAlign: "right",
      flexDirection: "row",
      justifyContent: "flex-start",
      alignItems: "center",
      minHeight: "auto",
      paddingTop: theme.spacing(1.5),
      paddingBottom: theme.spacing(1.5),
    },
  },
  indicator: {
    [theme.breakpoints.up("sm")]: {
      right: 0,
      width: "100%",
      backgroundColor: theme.palette.action.hover,
      borderRadius: theme.shape.borderRadius,
    },
  },
  dialogTitle: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: theme.typography.h3.fontSize,
  },
}));

const TERMS_DOC_URL = "https://coscene0.feishu.cn/wiki/wikcnA1CuBWbcU6PH2aXYLGhjrb";
const PRIVACY_DOC_URL = "https://coscene0.feishu.cn/wiki/wikcnzZNZ5kAuIw0stvaXxqkFAV";
const SECURITY_DOC_URL = "https://coscene0.feishu.cn/wiki/wikcnxpT8beRnb3JMLYxRMcBnq0";
const CONTACT_EMAIL = "contact@coscene.io";
const LICENSE_URL = "https://github.com/coscene-io/honeybee/blob/main/LICENSE";

const showLanguageOptions = APP_CONFIG.LANGUAGE.options.length > 1;

type SectionKey = "contact" | "legal";

export type AppSettingsTab =
  | "general"
  | "privacy"
  | "extensions"
  | "experimental-features"
  | "about";

const selectWorkspaceInitialActiveTab = (store: WorkspaceContextStore) =>
  store.dialogs.preferences.initialTab;

export function AppSettingsDialog(
  props: DialogProps & { activeTab?: AppSettingsTab },
): React.JSX.Element {
  const { t } = useTranslation("appSettings");
  const { activeTab: _activeTab } = props;
  const initialActiveTab = useWorkspaceStore(selectWorkspaceInitialActiveTab);
  const [activeTab, setActiveTab] = useState<AppSettingsTab>(
    _activeTab ?? initialActiveTab ?? "general",
  );

  const aboutItems = new Map<
    SectionKey,
    {
      subheader: string;
      links: { title: string; url?: string }[];
    }
  >([
    [
      "contact",
      {
        subheader: t("contact"),
        links: [{ title: t("contact"), url: `mailto:${CONTACT_EMAIL}` }],
      },
    ],
    [
      "legal",
      {
        subheader: t("legal"),
        links: [
          {
            title: t("licenseTerms"),
            url: LICENSE_URL,
          },
          { title: t("privacyPolicy"), url: PRIVACY_DOC_URL },
          { title: t("termsOfService"), url: TERMS_DOC_URL },
          { title: t("security"), url: SECURITY_DOC_URL },
        ],
      },
    ],
  ]);

  // const [debugModeEnabled = false, setDebugModeEnabled] = useAppConfigurationValue<boolean>(
  //   AppSetting.SHOW_DEBUG_PANELS,
  // );
  const { classes, cx, theme } = useStyles();
  const smUp = useMediaQuery(theme.breakpoints.up("sm"));

  const { extensionSettings } = useAppContext();

  // automatic updates are a desktop-only setting
  //
  // electron-updater does not provide a way to detect if we are on a supported update platform
  // so we hard-code linux as an _unsupported_ auto-update platform since we cannot auto-update
  // with our .deb package install method on linux.
  const supportsAppUpdates = isDesktopApp() && OsContextSingleton?.platform !== "linux";

  const handleTabChange = (_event: SyntheticEvent, newValue: AppSettingsTab) => {
    setActiveTab(newValue);
  };

  const handleClose = (event: MouseEvent<HTMLElement>) => {
    if (props.onClose != undefined) {
      props.onClose(event, "backdropClick");
    }
  };

  return (
    <Dialog {...props} fullWidth maxWidth="md" data-testid={`AppSettingsDialog--${activeTab}`}>
      <DialogTitle className={classes.dialogTitle}>
        {t("settings")}
        <IconButton edge="end" onClick={handleClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <div className={classes.layoutGrid}>
        <Tabs
          classes={{ indicator: classes.indicator }}
          value={activeTab}
          orientation={smUp ? "vertical" : "horizontal"}
          onChange={handleTabChange}
        >
          <Tab className={classes.tab} label={t("general")} value="general" />
          {/* CoScene */}
          {/* <Tab className={classes.tab} label={t("privacy")} value="privacy" /> */}
          {extensionSettings && (
            <Tab className={classes.tab} label={t("extensions")} value="extensions" />
          )}
          {/* <Tab
            className={classes.tab}
            label={t("experimentalFeatures")}
            value="experimental-features"
          /> */}
          <Tab className={classes.tab} label={t("about")} value="about" />
        </Tabs>
        <Stack direction="row" fullHeight overflowY="auto">
          <section
            className={cx(classes.tabPanel, {
              [classes.tabPanelActive]: activeTab === "general",
            })}
          >
            <Stack gap={2}>
              <ColorSchemeSettings />
              <TimezoneSettings />
              <TimeFormat orientation={smUp ? "horizontal" : "vertical"} />
              <AddTopicPrefix />
              <CompatibilityMode />
              <MessageFramerate />
              {showLanguageOptions && <LanguageSettings />}
              {supportsAppUpdates && <AutoUpdate />}
              {/* CoScene */}
              {/* {!isDesktopApp() && <LaunchDefault />} */}
              {/* {isDesktopApp() && <RosPackagePath />} */}
              {/* <Stack>
                <FormLabel>{t("advanced")}:</FormLabel>
                <FormControlLabel
                  className={classes.formControlLabel}
                  control={
                    <Checkbox
                      className={classes.checkbox}
                      checked={debugModeEnabled}
                      onChange={(_, checked) => {
                        void setDebugModeEnabled(checked);
                      }}
                    />
                  }
                  label={t("debugModeDescription")}
                />
              </Stack> */}
            </Stack>
          </section>

          {extensionSettings && (
            <section
              className={cx(classes.tabPanel, {
                [classes.tabPanelActive]: activeTab === "extensions",
              })}
            >
              <Stack gap={2}>{extensionSettings}</Stack>
            </section>
          )}

          <section
            className={cx(classes.tabPanel, {
              [classes.tabPanelActive]: activeTab === "experimental-features",
            })}
          >
            <Stack gap={2}>
              <Alert color="warning" icon={<WarningAmberIcon />}>
                {t("experimentalFeaturesDescription")}
              </Alert>
              <Stack paddingLeft={2}>
                <ExperimentalFeatureSettings />
              </Stack>
            </Stack>
          </section>

          <section
            className={cx(classes.tabPanel, { [classes.tabPanelActive]: activeTab === "about" })}
          >
            <Stack gap={2} alignItems="flex-start">
              <header>
                <CoSceneTextLogo />
              </header>
              <Stack direction="row" alignItems="center" gap={1}>
                <Typography variant="body2">
                  coScene Studio version {FOXGLOVE_STUDIO_VERSION}
                </Typography>
                <CopyButton
                  size="small"
                  getText={() => FOXGLOVE_STUDIO_VERSION?.toString() ?? ""}
                />
              </Stack>
              {[aboutItems.get("contact"), aboutItems.get("legal")].map((item) => {
                return (
                  <Stack key={item?.subheader} gap={1}>
                    {item?.subheader && <Typography>{item.subheader}</Typography>}
                    {item?.links.map((link) => (
                      <Link
                        variant="body2"
                        underline="hover"
                        key={link.title}
                        data-testid={link.title}
                        href={link.url}
                        target="_blank"
                      >
                        {link.title}
                      </Link>
                    ))}
                  </Stack>
                );
              })}
            </Stack>
          </section>
        </Stack>
      </div>
    </Dialog>
  );
}
