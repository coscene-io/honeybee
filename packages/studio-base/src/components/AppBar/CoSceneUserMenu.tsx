// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Menu,
  MenuItem,
  PaperProps,
  PopoverPosition,
  PopoverReference,
  Stack,
  Typography,
} from "@mui/material";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { AppSettingsTab } from "@foxglove/studio-base/components/AppSettingsDialog/AppSettingsDialog";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import {
  useCurrentUser as useCoSceneCurrentUser,
  UserStore,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { useCurrentUserType } from "@foxglove/studio-base/context/CurrentUserContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";
import {
  downloadLatestStudio,
  getCoStudioVersion,
  checkSupportCoStudioDownload,
} from "@foxglove/studio-base/util/download";
import { getDocsLink } from "@foxglove/studio-base/util/getDocsLink";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

const useStyles = makeStyles()(() => ({
  menuList: {
    minWidth: 200,
  },
}));

type UserMenuProps = {
  handleClose: () => void;
  anchorEl?: HTMLElement;
  anchorReference?: PopoverReference;
  anchorPosition?: PopoverPosition;
  disablePortal?: boolean;
  open: boolean;
};

const selectUser = (store: UserStore) => store.user;
const selectSetUser = (store: UserStore) => store.setUser;
const selectLoginStatus = (store: UserStore) => store.loginStatus;
const selectSetLoginStatus = (store: UserStore) => store.setLoginStatus;

export function UserMenu({
  anchorEl,
  anchorReference,
  anchorPosition,
  disablePortal,
  handleClose,
  open,
}: UserMenuProps): React.JSX.Element {
  const { classes } = useStyles();
  const currentUserType = useCurrentUserType();
  const analytics = useAnalytics();
  const [confirm, confirmModal] = useConfirm();
  const { t } = useTranslation("cosAppBar");
  const [latestVersion, setLatestVersion] = useState("");
  const setUser = useCoSceneCurrentUser(selectSetUser);

  useEffect(() => {
    if (APP_CONFIG.COSTUDIO_DOWNLOAD_URL) {
      void getCoStudioVersion().then((version) => {
        setLatestVersion(version);
      });
    }
  }, []);

  const { dialogActions } = useWorkspaceActions();

  const isDesktop = isDesktopApp();

  const userInfo = useCoSceneCurrentUser(selectUser);
  const loginStatus = useCoSceneCurrentUser(selectLoginStatus);
  const setLoginStatus = useCoSceneCurrentUser(selectSetLoginStatus);

  const posthog = usePostHog();

  const beginSignOut = useCallback(async () => {
    if (isDesktop) {
      localStorage.removeItem("coScene_org_jwt");
      setLoginStatus("notLogin");
      setUser(undefined);
      toast.success(t("signoutSuccess"));
    } else {
      window.location.href = "/login";
    }
  }, [isDesktop, setLoginStatus, t, setUser]);

  const onSignoutClick = useCallback(() => {
    void confirm({
      title: t("signOutConfirmTitle"),
      ok: t("signOutConfirmOk"),
      cancel: t("signOutConfirmCancel"),
    }).then((response) => {
      if (response === "ok") {
        void beginSignOut();
        posthog.reset();
      }
    });
  }, [beginSignOut, confirm, t, posthog]);

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

  const onDocsClick = useCallback(() => {
    const safeUrl = new URL(getDocsLink("/viz/about-viz")).toString();
    window.open(safeUrl, "_blank");
  }, []);

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
        MenuListProps={{ className: classes.menuList, dense: true }}
        slotProps={{
          paper: {
            "data-tourid": "user-menu",
          } as Partial<PaperProps & { "data-tourid"?: string }>,
        }}
      >
        {loginStatus === "alreadyLogin" && (
          <MenuItem disabled>{userInfo?.nickName ?? "unknow"}</MenuItem>
        )}

        <MenuItem
          onClick={() => {
            onSettingsClick();
          }}
        >
          {t("settings")}
        </MenuItem>
        <MenuItem onClick={onDocsClick}>{t("documentation")}</MenuItem>

        {checkSupportCoStudioDownload() && (
          <MenuItem onClick={downloadLatestStudio} className="test">
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              width="100%"
              gap={1}
            >
              <span>{t("downloadLatestStudio")}</span>
              <Typography variant="caption" color="text.secondary">
                {latestVersion ? `v${latestVersion}` : "latest"}
              </Typography>
            </Stack>
          </MenuItem>
        )}

        {(isDesktop || loginStatus === "alreadyLogin") && (
          <MenuItem
            onClick={() => {
              if (isDesktop && loginStatus === "notLogin") {
                window.open(
                  `https://${APP_CONFIG.DOMAIN_CONFIG["default"]?.webDomain}/studio/login`,
                );
              } else {
                onSignoutClick();
              }
            }}
          >
            {loginStatus === "alreadyLogin" ? t("signOut") : t("login")}
          </MenuItem>
        )}
      </Menu>
      {confirmModal}
    </>
  );
}
