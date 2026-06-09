// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Dismiss20Filled } from "@fluentui/react-icons";
import { CardHeader, CardHeaderProps, IconButton } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

const useStyles = makeStyles()({
  cardHeader: {
    alignItems: "flex-start",
    "& .MuiCardHeader-content": {
      minWidth: 0,
      overflow: "hidden",
    },
    "& .MuiCardHeader-action": {
      alignSelf: "flex-start",
      marginTop: 0,
      marginRight: 0,
      flexShrink: 0,
    },
  },
});

export const SidebarHeader = ({
  title,
  subheader,
  onClose,
}: {
  title: string;
  subheader?: CardHeaderProps["subheader"];
  onClose: () => void;
}): React.JSX.Element => {
  const { classes } = useStyles();
  const { t } = useTranslation("userScriptEditor");
  return (
    <CardHeader
      className={classes.cardHeader}
      title={title}
      slotProps={{
        title: {
          variant: "subtitle1",
          fontWeight: "600",
        },
        subheader: {
          variant: "body2",
          color: "text.secondary",
        },
      }}
      subheader={subheader}
      action={
        <IconButton size="small" onClick={onClose} title={t("collapse")} aria-label={t("collapse")}>
          <Dismiss20Filled />
        </IconButton>
      }
    />
  );
};
