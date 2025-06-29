// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import WarningIcon from "@mui/icons-material/Warning";
import { Typography, Button, ThemeProvider as MuiThemeProvider } from "@mui/material";
import { useMemo, ReactElement, PropsWithChildren, CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import Stack from "@foxglove/studio-base/components/Stack";
import { createMuiTheme } from "@foxglove/theme";

const MINIMUM_CHROME_VERSION = 104;

const BannerContainer = (props: PropsWithChildren<{ isDismissable: boolean }>) => {
  const { isDismissable, children } = props;

  const style: CSSProperties = {
    display: "flex",
    width: "100%",
    height: "40px",
    alignItems: "center",
    backgroundColor: "#fff7ed",
    zIndex: 100,
    ...(!isDismissable && {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      height: "100vh",
    }),
  };

  return <div style={style}>{children}</div>;
};

// if chrome version is too low, in this case, i18next cannot be init, so we hard code the text
const FullSizeStack = () => {
  const style: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    width: "100vw",
    height: "100vh",
    backgroundColor: "#fff7ed",
  };

  const browserLang =
    navigator.language || (navigator as unknown as { userLanguage: string }).userLanguage;

  return (
    <div style={style}>
      <Stack alignItems="center" fullHeight fullWidth justifyContent="center" gap={3}>
        <img src="/viz/logo-with-text.svg" alt="logo" />
        <Typography align="center" color="#111827" variant="body1">
          {browserLang === "zh-CN"
            ? "当前使用的 Chrome 版本过低，建议升级至最新版本以获得最佳体验"
            : "You’re using an outdated version of Chrome. Please upgrade to the latest version for the best experience."}
        </Typography>

        <Button
          href="https://www.google.cn/chrome/"
          target="_blank"
          rel="noreferrer"
          variant="contained"
          style={{
            textTransform: "none",
          }}
        >
          {browserLang === "zh-CN" ? "下载Chrome" : "Download Chrome"}
        </Button>
      </Stack>
    </div>
  );
};

const VersionBanner = function ({
  isChrome,
  currentVersion,
  isDismissable,
}: {
  isChrome: boolean;
  currentVersion: number;
  isDismissable: boolean;
}): ReactElement | ReactNull {
  const { i18n, t } = useTranslation("cosVersionBanner");

  const muiTheme = useMemo(() => createMuiTheme("dark", i18n.language), [i18n.language]);
  // high version chrome
  if (isChrome && currentVersion >= MINIMUM_CHROME_VERSION) {
    return ReactNull;
  }

  // low version chrome
  if (isChrome) {
    return <FullSizeStack />;
  }

  // other browser
  return (
    <MuiThemeProvider theme={muiTheme}>
      <BannerContainer isDismissable={isDismissable}>
        <Stack
          paddingX={2}
          gap={1.5}
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          fullWidth
        >
          <Stack direction="row" alignItems="center" gap={1}>
            <WarningIcon color="warning" />
            <Typography align="center" color="#111827" variant="body1">
              {t("browserVersionError")}
            </Typography>
          </Stack>

          <Typography align="center" variant="body1">
            <Button
              href="https://www.google.cn/chrome/"
              target="_blank"
              rel="noreferrer"
              variant="text"
            >
              {t("download")} Chrome
            </Button>
          </Typography>
        </Stack>
      </BannerContainer>
    </MuiThemeProvider>
  );
};

export default VersionBanner;
