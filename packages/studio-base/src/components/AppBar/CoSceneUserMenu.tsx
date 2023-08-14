// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Menu, MenuItem, PaperProps, PopoverPosition, PopoverReference } from "@mui/material";
import { useCallback } from "react";
import { makeStyles } from "tss-react/mui";

import { AppSettingsTab } from "@foxglove/studio-base/components/AppSettingsDialog/AppSettingsDialog";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import { useCurrentUserType } from "@foxglove/studio-base/context/CurrentUserContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

const useStyles = makeStyles()({
  menuList: {
    minWidth: 200,
  },
});

export type UserInfo = {
  agreedAgreement: string;
  avatarUrl: string;
  nickName: string;
  phoneNumber: string;
  role: string;
  userId: string;
};

type UserMenuProps = {
  handleClose: () => void;
  anchorEl?: HTMLElement;
  anchorReference?: PopoverReference;
  anchorPosition?: PopoverPosition;
  disablePortal?: boolean;
  userInfo?: UserInfo;
  open: boolean;
};

export function UserMenu({
  anchorEl,
  anchorReference,
  anchorPosition,
  disablePortal,
  handleClose,
  userInfo,
  open,
}: UserMenuProps): JSX.Element {
  const { classes } = useStyles();
  const currentUserType = useCurrentUserType();
  const analytics = useAnalytics();
  const [confirm, confirmModal] = useConfirm();

  const { dialogActions } = useWorkspaceActions();

  const beginSignOut = useCallback(() => {
    window.location.href = `${APP_CONFIG.CS_HONEYBEE_BASE_URL}/login`;
  }, []);

  const onSignoutClick = useCallback(() => {
    void confirm({
      title: "Are you sure you want to sign out?",
      ok: "Sign out",
    }).then((response) => {
      if (response === "ok") {
        beginSignOut();
      }
    });
  }, [beginSignOut, confirm]);

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
    window.open(
      "https://docs.coscene.cn/docs/category/%E6%95%B0%E6%8D%AE%E5%8F%AF%E8%A7%86%E5%8C%96",
      "_blank",
    );
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
        PaperProps={
          {
            "data-tourid": "user-menu",
          } as Partial<PaperProps & { "data-tourid"?: string }>
        }
      >
        <MenuItem disabled>{userInfo?.nickName ?? "unknown"}</MenuItem>
        <MenuItem onClick={() => onSettingsClick()}>Settings</MenuItem>
        <MenuItem onClick={onDocsClick}>Documentation</MenuItem>
        <MenuItem onClick={onSignoutClick}>Sign out</MenuItem>
      </Menu>
      {confirmModal}
    </>
  );
}
