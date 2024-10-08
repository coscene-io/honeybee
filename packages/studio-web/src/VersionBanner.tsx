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
  if (currentVersion >= MINIMUM_CHROME_VERSION) {
    return ReactNull;
  }

  const prompt = isChrome ? t("outdatedVersion") : t("unsupportedBrowser");

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
              {prompt + ", "} {t("requireChrome")}
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
