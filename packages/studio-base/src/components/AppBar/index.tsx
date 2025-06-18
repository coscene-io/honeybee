// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  PanelLeft24Filled,
  PanelLeft24Regular,
  PanelRight24Filled,
  PanelRight24Regular,
  SlideAdd24Regular,
  QuestionCircle24Regular,
  ChevronDown12Regular,
  Desktop24Regular,
} from "@fluentui/react-icons";
import PersonIcon from "@mui/icons-material/Person";
import { Avatar, Checkbox, IconButton, Link, Tooltip, Typography } from "@mui/material";
import { useCallback, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import tc from "tinycolor2";
import { makeStyles } from "tss-react/mui";

import { CoSceneLayoutButton } from "@foxglove/studio-base/components/AppBar/CoSceneLayoutButton";
import { CoSceneLogo } from "@foxglove/studio-base/components/CoSceneLogo";
import Stack from "@foxglove/studio-base/components/Stack";
import { useAppContext } from "@foxglove/studio-base/context/AppContext";
import {
  useCurrentUser as useCoSceneCurrentUser,
  UserStore,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import {
  LayoutState,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { useCurrentUser } from "@foxglove/studio-base/context/CurrentUserContext";
import {
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import {
  checkSupportCoStudioDownload,
  downloadLatestStudio,
} from "@foxglove/studio-base/util/download";
import { getDocsLink } from "@foxglove/studio-base/util/getDocsLink";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

import { AddPanelMenu } from "./AddPanelMenu";
import { AppBarContainer } from "./AppBarContainer";
import { AppBarIconButton } from "./AppBarIconButton";
import { AppMenu } from "./AppMenu";
import { AppStateBar } from "./AppStateBar";
import { UserMenu } from "./CoSceneUserMenu";
import { CustomWindowControls, CustomWindowControlsProps } from "./CustomWindowControls";
import { DataSource } from "./DataSource";

const useStyles = makeStyles<{ debugDragRegion?: boolean }, "avatar">()((
  theme,
  { debugDragRegion = false },
  classes,
) => {
  const NOT_DRAGGABLE_STYLE: Record<string, string> = { WebkitAppRegion: "no-drag" };
  if (debugDragRegion) {
    NOT_DRAGGABLE_STYLE.backgroundColor = "red";
  }
  return {
    toolbar: {
      display: "grid",
      width: "100%",
      gridTemplateAreas: `"start middle end"`,
      gridTemplateColumns: "1fr auto 1fr",
      alignItems: "center",
    },
    logo: {
      padding: theme.spacing(0.75, 0.5),
      fontSize: "2rem",
      color: theme.palette.appBar.primary,
      borderRadius: 0,

      "svg:not(.MuiSvgIcon-root)": {
        fontSize: "1em",
      },
      "&:hover": {
        backgroundColor: theme.palette.background.hover,
      },
      "&.Mui-selected": {
        backgroundColor: theme.palette.background.hover,
        color: theme.palette.common.white,
      },
      "&.Mui-disabled": {
        color: "currentColor",
        opacity: theme.palette.action.disabledOpacity,
      },
    },
    dropDownIcon: {
      fontSize: "12px !important",
    },
    start: {
      gridArea: "start",
      display: "flex",
      flex: 1,
      alignItems: "center",
    },
    startInner: {
      display: "flex",
      alignItems: "center",
      ...NOT_DRAGGABLE_STYLE, // make buttons clickable for desktop app
    },
    middle: {
      gridArea: "middle",
      justifySelf: "center",
      overflow: "hidden",
      maxWidth: "100%",
      ...NOT_DRAGGABLE_STYLE, // make buttons clickable for desktop app
    },
    end: {
      gridArea: "end",
      flex: 1,
      display: "flex",
      justifyContent: "flex-end",
    },
    endInner: {
      display: "flex",
      alignItems: "center",
      ...NOT_DRAGGABLE_STYLE, // make buttons clickable for desktop app
    },
    keyEquivalent: {
      fontFamily: theme.typography.fontMonospace,
      background: tc(theme.palette.common.white).darken(45).toString(),
      padding: theme.spacing(0, 0.5),
      aspectRatio: 1,
      borderRadius: theme.shape.borderRadius,
      marginLeft: theme.spacing(1),
    },
    tooltip: {
      marginTop: `${theme.spacing(0.5)} !important`,
    },
    avatar: {
      color: theme.palette.common.white,
      height: theme.spacing(3.5),
      width: theme.spacing(3.5),
    },
    iconButton: {
      padding: theme.spacing(0.75),
      margin: theme.spacing(0, 0.5),

      borderRadius: 0,

      "&:hover": {
        backgroundColor: theme.palette.background.hover,

        [`.${classes.avatar}`]: {
          backgroundColor: tc(theme.palette.appBar.main).lighten(20).toString(),
        },
      },
      "&.Mui-selected": {
        backgroundColor: theme.palette.background.hover,

        [`.${classes.avatar}`]: {
          backgroundColor: tc(theme.palette.appBar.main).setAlpha(0.3).toString(),
        },
      },
    },
  };
});

export type AppBarProps = CustomWindowControlsProps & {
  leftInset?: number;
  onDoubleClick?: () => void;
  debugDragRegion?: boolean;
};

const selectHasCurrentLayout = (state: LayoutState) => state.selectedLayout != undefined;
const selectLeftSidebarOpen = (store: WorkspaceContextStore) => store.sidebars.left.open;
const selectRightSidebarOpen = (store: WorkspaceContextStore) => store.sidebars.right.open;

const selectUser = (store: UserStore) => store.user;

export function AppBar(props: AppBarProps): React.JSX.Element {
  const {
    debugDragRegion,
    isMaximized,
    leftInset,
    onCloseWindow,
    onDoubleClick,
    onMaximizeWindow,
    onMinimizeWindow,
    onUnmaximizeWindow,
    showCustomWindowControls = false,
  } = props;
  const { classes, cx, theme } = useStyles({ debugDragRegion });
  const { currentUser } = useCurrentUser();
  const { t } = useTranslation("appBar");

  const { appBarLayoutButton } = useAppContext();

  const hasCurrentLayout = useCurrentLayoutSelector(selectHasCurrentLayout);

  const leftSidebarOpen = useWorkspaceStore(selectLeftSidebarOpen);
  const rightSidebarOpen = useWorkspaceStore(selectRightSidebarOpen);

  const { sidebarActions } = useWorkspaceActions();

  const [appMenuEl, setAppMenuEl] = useState<undefined | HTMLElement>(undefined);
  const [userAnchorEl, setUserAnchorEl] = useState<undefined | HTMLElement>(undefined);
  const [panelAnchorEl, setPanelAnchorEl] = useState<undefined | HTMLElement>(undefined);

  const appMenuOpen = Boolean(appMenuEl);
  const userMenuOpen = Boolean(userAnchorEl);
  const panelMenuOpen = Boolean(panelAnchorEl);
  const userInfo = useCoSceneCurrentUser(selectUser);
  const [confirm, confirmModal] = useConfirm();

  const handleOpenInCoStudio = useCallback(async () => {
    const skipConfirm = localStorage.getItem("openInCoStudioDoNotShowAgain") === "true";
    if (skipConfirm) {
      const url = window.location.href;
      const studioUrl = url.replace(/^https?:\/\//i, "coscene://");
      window.open(studioUrl, "_self");
      return;
    }

    let doNotShowAgain = false;
    const response = await confirm({
      title: t("openInCoStudio"),
      prompt: (
        <>
          <Trans
            t={t}
            ns="appBar"
            i18nKey="openInCoStudioPrompt"
            components={{
              download: <Link href="#" onClick={downloadLatestStudio} />,
            }}
          />

          <Stack direction="row" alignItems="center">
            <Checkbox
              onChange={(e) => {
                doNotShowAgain = e.target.checked;
              }}
            />
            <Typography>{t("doNotShowAgain")}</Typography>
          </Stack>
        </>
      ),
      ok: t("openByCoStudio"),
      cancel: t("cancel", { ns: "cosGeneral" }),
    });
    if (response !== "ok") {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (doNotShowAgain) {
      localStorage.setItem("openInCoStudioDoNotShowAgain", "true");
    }
    const url = window.location.href;
    const studioUrl = url.replace(/^https?:\/\//i, "coscene://");
    window.open(studioUrl, "_self");
  }, [confirm, t]);

  return (
    <>
      <AppBarContainer onDoubleClick={onDoubleClick} leftInset={leftInset}>
        <div className={classes.toolbar}>
          <div className={classes.start}>
            <div className={classes.startInner}>
              <IconButton
                className={cx(classes.logo, { "Mui-selected": appMenuOpen })}
                color="inherit"
                id="app-menu-button"
                title={t("menu", {
                  ns: "cosAppBar",
                })}
                aria-controls={appMenuOpen ? "app-menu" : undefined}
                aria-haspopup="true"
                aria-expanded={appMenuOpen ? "true" : undefined}
                data-tourid="app-menu-button"
                onClick={(event) => {
                  if (isDesktopApp()) {
                    setAppMenuEl(event.currentTarget);
                  } else {
                    window.open(window.location.origin, "_blank");
                  }
                }}
              >
                <CoSceneLogo />
                {isDesktopApp() && <ChevronDown12Regular className={classes.dropDownIcon} />}
              </IconButton>
              <AppMenu
                open={appMenuOpen}
                anchorEl={appMenuEl}
                handleClose={() => {
                  setAppMenuEl(undefined);
                }}
              />
              <AppBarIconButton
                className={cx({ "Mui-selected": panelMenuOpen })}
                color="inherit"
                disabled={!hasCurrentLayout}
                id="add-panel-button"
                data-tourid="add-panel-button"
                title={t("addPanel")}
                aria-label="Add panel button"
                aria-controls={panelMenuOpen ? "add-panel-menu" : undefined}
                aria-haspopup="true"
                aria-expanded={panelMenuOpen ? "true" : undefined}
                onClick={(event) => {
                  setPanelAnchorEl(event.currentTarget);
                }}
              >
                <SlideAdd24Regular color={theme.palette.appBar.icon} />
              </AppBarIconButton>
            </div>
          </div>

          <div className={classes.middle}>
            <DataSource />
          </div>

          <div className={classes.end}>
            <div className={classes.endInner}>
              {appBarLayoutButton}
              <CoSceneLayoutButton />
              <Stack direction="row" alignItems="center" data-tourid="sidebar-button-group">
                {checkSupportCoStudioDownload() && (
                  <AppBarIconButton
                    title={t("openInCoStudio")}
                    aria-label={t("openInCoStudio")}
                    onClick={() => {
                      void handleOpenInCoStudio();
                    }}
                    data-tourid="open-in-coStudio"
                  >
                    <Desktop24Regular
                      color={theme.palette.appBar.icon}
                      style={{ marginLeft: "2px" }}
                    />
                  </AppBarIconButton>
                )}
                <AppBarIconButton
                  title={
                    <>
                      {leftSidebarOpen ? t("hideLeftSidebar") : t("showLeftSidebar")}{" "}
                      <kbd className={classes.keyEquivalent}>[</kbd>
                    </>
                  }
                  aria-label={leftSidebarOpen ? t("hideLeftSidebar") : t("showLeftSidebar")}
                  onClick={() => {
                    sidebarActions.left.setOpen(!leftSidebarOpen);
                  }}
                  data-tourid="left-sidebar-button"
                >
                  {leftSidebarOpen ? (
                    <PanelLeft24Filled color={theme.palette.appBar.icon} />
                  ) : (
                    <PanelLeft24Regular color={theme.palette.appBar.icon} />
                  )}
                </AppBarIconButton>
                <AppBarIconButton
                  title={
                    <>
                      {rightSidebarOpen ? t("hideRightSidebar") : t("showRightSidebar")}{" "}
                      <kbd className={classes.keyEquivalent}>]</kbd>
                    </>
                  }
                  aria-label={rightSidebarOpen ? t("hideRightSidebar") : t("showRightSidebar")}
                  onClick={() => {
                    sidebarActions.right.setOpen(!rightSidebarOpen);
                  }}
                  data-tourid="right-sidebar-button"
                >
                  {rightSidebarOpen ? (
                    <PanelRight24Filled color={theme.palette.appBar.icon} />
                  ) : (
                    <PanelRight24Regular color={theme.palette.appBar.icon} />
                  )}
                </AppBarIconButton>
                <AppBarIconButton
                  title={t("help")}
                  aria-label={t("help")}
                  onClick={() => {
                    const safeUrl = new URL(getDocsLink()).toString();
                    window.open(safeUrl, "_blank");
                  }}
                  data-tourid="help-button"
                >
                  <QuestionCircle24Regular color={theme.palette.appBar.icon} />
                </AppBarIconButton>
              </Stack>
              <Tooltip
                classes={{ tooltip: classes.tooltip }}
                title={currentUser?.email ?? "Profile"}
                arrow={false}
              >
                <IconButton
                  className={cx(classes.iconButton, { "Mui-selected": userMenuOpen })}
                  aria-label="User profile menu button"
                  color="inherit"
                  id="user-button"
                  data-tourid="user-button"
                  aria-controls={userMenuOpen ? "user-menu" : undefined}
                  aria-haspopup="true"
                  aria-expanded={userMenuOpen ? "true" : undefined}
                  onClick={(event) => {
                    setUserAnchorEl(event.currentTarget);
                  }}
                  data-testid="user-button"
                >
                  <Avatar
                    src={
                      userInfo?.avatarUrl != undefined && userInfo.avatarUrl !== ""
                        ? userInfo.avatarUrl
                        : undefined
                    }
                    className={classes.avatar}
                    variant="rounded"
                  >
                    {userInfo?.avatarUrl == undefined ||
                      (userInfo.avatarUrl === "" && <PersonIcon color="secondary" />)}
                  </Avatar>
                </IconButton>
              </Tooltip>
              {showCustomWindowControls && (
                <CustomWindowControls
                  onMinimizeWindow={onMinimizeWindow}
                  isMaximized={isMaximized}
                  onUnmaximizeWindow={onUnmaximizeWindow}
                  onMaximizeWindow={onMaximizeWindow}
                  onCloseWindow={onCloseWindow}
                />
              )}
            </div>
          </div>
        </div>
      </AppBarContainer>

      <AppStateBar />

      <AddPanelMenu
        anchorEl={panelAnchorEl}
        open={panelMenuOpen}
        handleClose={() => {
          setPanelAnchorEl(undefined);
        }}
      />
      <UserMenu
        anchorEl={userAnchorEl}
        open={userMenuOpen}
        handleClose={() => {
          setUserAnchorEl(undefined);
        }}
      />
      {confirmModal}
    </>
  );
}
