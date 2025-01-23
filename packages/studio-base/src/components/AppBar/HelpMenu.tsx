// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  // ChatBubblesQuestion24Regular,
  // Cloud24Regular,
  SlideLayout24Regular,
} from "@fluentui/react-icons";
import {
  // Divider,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  PopoverOrigin,
  PopoverPosition,
  PopoverReference,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import { useCurrentUserType } from "@foxglove/studio-base/context/CurrentUserContext";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";

const useStyles = makeStyles()((theme) => ({
  subheader: {
    bgcolor: "transparent",
    border: "none",
  },
  paper: {
    width: 280,
  },
  icon: {
    color: theme.palette.primary.main,
    flex: "none",
  },
  menuItem: {
    gap: theme.spacing(1),
  },
  menuText: {
    whiteSpace: "normal",
    flex: "0 1 auto",
  },
}));

type HelpMenuProps = {
  anchorEl?: HTMLElement;
  anchorOrigin?: PopoverOrigin;
  anchorPosition?: PopoverPosition;
  anchorReference?: PopoverReference;
  disablePortal?: boolean;
  handleClose: () => void;
  open: boolean;
  transformOrigin?: PopoverOrigin;
};

export function HelpMenu(props: HelpMenuProps): React.JSX.Element {
  const {
    anchorEl,
    anchorOrigin,
    anchorPosition,
    anchorReference,
    disablePortal,
    handleClose,
    open,
    transformOrigin,
  } = props;
  const { classes } = useStyles();
  const currentUserType = useCurrentUserType();
  const analytics = useAnalytics();
  const { t } = useTranslation();

  return (
    <Menu
      classes={{ paper: classes.paper }}
      id="help-menu"
      anchorEl={anchorEl}
      anchorOrigin={anchorOrigin}
      anchorReference={anchorReference}
      anchorPosition={anchorPosition}
      disablePortal={disablePortal}
      open={open}
      onClose={handleClose}
      transformOrigin={transformOrigin}
      MenuListProps={{
        "aria-labelledby": "help-button",
      }}
    >
      <ListSubheader className={classes.subheader}>Documentation</ListSubheader>
      <MenuItem
        href="https://docs.coscene.cn/docs/category/%E6%95%B0%E6%8D%AE%E5%8F%AF%E8%A7%86%E5%8C%96/"
        className={classes.menuItem}
        component="a"
        target="_blank"
        onClick={() => {
          void analytics.logEvent(AppEvent.HELP_MENU_CLICK_CTA, {
            user: currentUserType,
            cta: "docs-studio",
          });
          handleClose();
        }}
      >
        <SlideLayout24Regular className={classes.icon} />
        <ListItemText
          primary={t("dataVisualization", { ns: "cosHelp" })}
          secondary={t("visualizeMachineDataAndAnalysis", { ns: "cosHelp" })}
          secondaryTypographyProps={{ className: classes.menuText }}
        />
      </MenuItem>
      {/* <MenuItem
        href="https://foxglove.dev/docs/data-platform"
        className={classes.menuItem}
        component="a"
        target="_blank"
        onClick={() => {
          void analytics.logEvent(AppEvent.HELP_MENU_CLICK_CTA, {
            user: currentUserType,
            cta: "docs-data-platform",
          });
          handleClose();
        }}
      >
        <Cloud24Regular className={classes.icon} />
        <ListItemText
          primary="Data Platform"
          secondary="Scalable data management platform"
          secondaryTypographyProps={{ className: classes.menuText }}
        />
      </MenuItem> */}
      {/* <Divider />
      <ListSubheader className={classes.subheader}>Community</ListSubheader>
      <MenuItem
        href="https://foxglove.dev/slack"
        className={classes.menuItem}
        component="a"
        target="_blank"
        onClick={() => {
          void analytics.logEvent(AppEvent.HELP_MENU_CLICK_CTA, {
            user: currentUserType,
            cta: "join-slack",
          });
          handleClose();
        }}
      >
        <ChatBubblesQuestion24Regular className={classes.icon} />
        <ListItemText
          primary="Join us on Slack"
          secondary="Give us feedback, ask questions, and collaborate with other users"
          secondaryTypographyProps={{ className: classes.menuText }}
        />
      </MenuItem> */}
    </Menu>
  );
}
