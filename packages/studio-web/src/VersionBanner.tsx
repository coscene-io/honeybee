// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import {
  IconButton,
  Typography,
  Button,
  ThemeProvider as MuiThemeProvider,
  useTheme,
} from "@mui/material";
import { useState, useMemo, ReactElement, PropsWithChildren, CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { withStyles } from "tss-react/mui";

import Stack from "@foxglove/studio-base/components/Stack";
import { createMuiTheme } from "@foxglove/theme";

const MINIMUM_CHROME_VERSION = 104;

const BannerContainer = (props: PropsWithChildren<{ isDismissable: boolean }>) => {
  const { isDismissable, children } = props;

  const theme = useTheme();
  const style: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    backgroundColor: "#2563EB",
    color: theme.palette.primary.contrastText,
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

const DismissButton = withStyles(IconButton, (theme) => ({
  root: {
    position: "absolute",
    margin: theme.spacing(1),
    right: 0,
    top: 0,
  },
}));

const VersionBanner = function ({
  isChrome,
  currentVersion,
  isDismissable,
}: {
  isChrome: boolean;
  currentVersion: number;
  isDismissable: boolean;
}): ReactElement | ReactNull {
  const [showBanner, setShowBanner] = useState(true);
  const { i18n, t } = useTranslation("cosVersionBanner");
  const muiTheme = useMemo(() => createMuiTheme("dark", i18n.language), [i18n.language]);
  if (!showBanner || currentVersion >= MINIMUM_CHROME_VERSION) {
    return ReactNull;
  }

  const prompt = isChrome ? t("outdatedVersion") : t("unsupportedBrowser");

  return (
    <MuiThemeProvider theme={muiTheme}>
      <BannerContainer isDismissable={isDismissable}>
        <Stack padding={2} gap={1.5} alignItems="center">
          {isDismissable && (
            <DismissButton
              color="inherit"
              onClick={() => {
                setShowBanner(false);
              }}
            >
              <CloseIcon />
            </DismissButton>
          )}

          <div>
            <Typography align="center" variant="h6">
              {prompt + ", "} {t("requireChrome")}
            </Typography>
          </div>

          <Button
            href="https://www.google.cn/chrome/"
            target="_blank"
            rel="noreferrer"
            color="inherit"
            variant="outlined"
          >
            {t("download")} Chrome
          </Button>
        </Stack>
      </BannerContainer>
    </MuiThemeProvider>
  );
};

export default VersionBanner;
