// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ChevronDown12Filled } from "@fluentui/react-icons";
import { ButtonBase, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { APP_BAR_HEIGHT } from "@foxglove/studio-base/components/AppBar/constants";
import Stack from "@foxglove/studio-base/components/Stack";
import TextMiddleTruncate from "@foxglove/studio-base/components/TextMiddleTruncate";
import { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

const useStyles = makeStyles()((theme) => ({
  textTruncate: {
    maxWidth: "18vw",
    overflow: "hidden",
    color: theme.palette.text.primary,
  },
  subheader: {
    fontSize: 8,
    opacity: 0.6,
    color: theme.palette.text.secondary,
  },
  layoutButton: {
    font: "inherit",
    height: APP_BAR_HEIGHT - 2,
    fontSize: theme.typography.body2.fontSize,
    justifyContent: "space-between",
    minWidth: 120,
    padding: theme.spacing(1.125, 1.5),
    gap: theme.spacing(1.5),
    borderRadius: 0,

    ":hover": {
      backgroundColor: theme.palette.background.hover,
    },
    "&.Mui-selected": {
      backgroundColor: theme.palette.background.hover,
    },
  },
}));

interface LayoutButtonProps {
  currentLayout?: Layout;
  loading?: boolean;
  onClick: () => void;
}

export function LayoutButton({
  currentLayout,
  loading,
  onClick,
}: LayoutButtonProps): React.JSX.Element {
  const { t } = useTranslation("cosLayout");
  const { classes } = useStyles();

  const getDisplayText = (): string => {
    if (loading === true) {
      return t("loading");
    }

    if (!currentLayout) {
      return t("noLayouts");
    }

    return currentLayout.displayName;
  };

  const getSubheader = () => {
    if (loading === true) {
      return undefined;
    }

    return t("layout");
  };

  return (
    <ButtonBase
      className={classes.layoutButton}
      aria-haspopup="true"
      onClick={onClick}
      disabled={loading}
    >
      <Stack alignItems="flex-start">
        {getSubheader() && (
          <Typography variant="overline" className={classes.subheader}>
            {getSubheader()}
          </Typography>
        )}
        <div className={classes.textTruncate}>
          <TextMiddleTruncate text={getDisplayText()} />
        </div>
      </Stack>
      {/* <ChevronDown12Filled color={theme.palette.text.secondary} /> */}
    </ButtonBase>
  );
}
