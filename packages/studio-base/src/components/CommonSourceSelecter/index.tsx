// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Button } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

const useStyles = makeStyles()((theme) => ({
  styledButton: {
    backgroundColor: theme.palette.action.hover,
    borderRadius: theme.shape.borderRadius,
    border: "none",
    color: theme.palette.text.primary,
    textTransform: "none",
    justifyContent: "center",
    paddingTop: theme.spacing(0.5),
    paddingBottom: theme.spacing(0.5),

    "&:hover": {
      backgroundColor: theme.palette.action.selected,
    },

    "&.MuiButton-root": {
      minHeight: "auto",
    },
  },
}));

interface CommonSourceSelecterProps {
  value?: string;
  onChange: (value?: string) => void;
}

export default function CommonSourceSelecter({
  value,
  onChange,
}: CommonSourceSelecterProps): React.JSX.Element {
  const { t } = useTranslation("cosSettings");
  const { classes } = useStyles();

  return (
    <>
      <Button className={classes.styledButton} fullWidth variant="text">
        {value ?? t("selectCommonSource")}
      </Button>
    </>
  );
}
