// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Divider, Menu, MenuItem, PopoverPosition, PopoverReference } from "@mui/material";
import { useSnackbar } from "notistack";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import Logger from "@foxglove/log";
import { AppSettingsTab } from "@foxglove/studio-base/components/AppSettingsDialog/AppSettingsDialog";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import {
  useCurrentUser,
  useCurrentUserType,
} from "@foxglove/studio-base/context/CurrentUserContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";

const log = Logger.getLogger(__filename);

const useStyles = makeStyles()({
  menuList: {
    minWidth: 200,
  },
});

type UserMenuProps = {
  handleClose: () => void;
  anchorEl?: HTMLElement;
  anchorReference?: PopoverReference;
  anchorPosition?: PopoverPosition;
  disablePortal?: boolean;
  open: boolean;
};

export function UserMenu({
  anchorEl,
  anchorReference,
  anchorPosition,
  disablePortal,
  handleClose,
  open,
}: UserMenuProps): React.JSX.Element {
  const { classes } = useStyles();
  const { currentUser, signIn, signOut } = useCurrentUser();
  const currentUserType = useCurrentUserType();
  const analytics = useAnalytics();
  const { enqueueSnackbar } = useSnackbar();
  const confirm = useConfirm();
  const { t } = useTranslation("appBar");

  const { dialogActions } = useWorkspaceActions();

  const beginSignOut = useCallback(async () => {
    try {
      await signOut?.();
    } catch (error) {
      log.error(error);
      enqueueSnackbar((error as Error).toString(), { variant: "error" });
    }
  }, [enqueueSnackbar, signOut]);

  const onSignoutClick = useCallback(() => {
    void confirm({
      title: "Are you sure you want to sign out?",
      ok: "Sign out",
    }).then((response) => {
      if (response === "ok") {
        void beginSignOut();
      }
    });
  }, [beginSignOut, confirm]);

  const onSignInClick = useCallback(() => {
    void analytics.logEvent(AppEvent.APP_BAR_CLICK_CTA, {
      user: currentUserType,
      cta: "sign-in",
    });
    signIn?.();
  }, [analytics, currentUserType, signIn]);

  const onSettingsClick = useCallback(
    (tab?: AppSettingsTab) => {
      void analytics.logEvent(AppEvent.APP_BAR_CLICK_CTA, {
        user: currentUserType,
        cta: "app-settings-dialog",
      });
      dialogActions.preferences.open(tab);
    },
    [analytics, currentUserType, dialogActions.preferences],
  );

  const onProfileClick = useCallback(() => {
    void analytics.logEvent(AppEvent.APP_BAR_CLICK_CTA, {
      user: currentUserType,
      cta: "profile",
    });
    window.open(process.env.FOXGLOVE_ACCOUNT_PROFILE_URL, "_blank");
  }, [analytics, currentUserType]);

  const onDocsClick = useCallback(() => {
    void analytics.logEvent(AppEvent.APP_BAR_CLICK_CTA, {
      user: currentUserType,
      cta: "docs",
    });
    window.open("https://foxglove.dev/docs", "_blank");
  }, [analytics, currentUserType]);

  const onSlackClick = useCallback(() => {
    void analytics.logEvent(AppEvent.APP_BAR_CLICK_CTA, {
      user: currentUserType,
      cta: "join-slack",
    });
    window.open("https://foxglove.dev/slack", "_blank");
  }, [analytics, currentUserType]);

  return (
    <>
      <Menu
        anchorEl={anchorEl}
        anchorReference={anchorReference}
        anchorPosition={anchorPosition}
        disablePortal={disablePortal}
        id="user-menu"
        open={open}
        onClose={handleClose}
        onClick={handleClose}
        data-tourid="user-menu"
        slotProps={{
          list: {
            className: classes.menuList,
            dense: true,
          },
        }}
      >
        {currentUser && <MenuItem disabled>{currentUser.email}</MenuItem>}
        <MenuItem
          onClick={() => {
            onSettingsClick();
          }}
        >
          {t("settings")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            onSettingsClick("extensions");
          }}
        >
          {t("extensions")}
        </MenuItem>
        {currentUser && <MenuItem onClick={onProfileClick}>{t("userProfile")}</MenuItem>}
        <Divider variant="middle" />
        <MenuItem onClick={onDocsClick}>{t("documentation")}</MenuItem>
        <MenuItem onClick={onSlackClick}>{t("joinSlackCommunity")}</MenuItem>
        {signIn != undefined && <Divider variant="middle" />}
        {currentUser ? (
          <MenuItem onClick={onSignoutClick}>{t("signOut")}</MenuItem>
        ) : signIn != undefined ? (
          <MenuItem onClick={onSignInClick}>{t("signIn")}</MenuItem>
        ) : undefined}
      </Menu>
    </>
  );
}
