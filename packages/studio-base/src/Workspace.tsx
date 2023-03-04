// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { Link, Typography } from "@mui/material";
import { useSnackbar } from "notistack";
import { extname } from "path";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useLayoutEffect,
  useContext,
} from "react";
import { useTranslation } from "react-i18next";
import { usePrevious } from "react-use";
import { makeStyles } from "tss-react/mui";

import Logger from "@foxglove/log";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import AccountSettings from "@foxglove/studio-base/components/AccountSettingsSidebar/AccountSettings";
import { DataSourceSidebar } from "@foxglove/studio-base/components/DataSourceSidebar";
import { MESSAGE_PATH_SYNTAX_HELP_INFO } from "@foxglove/studio-base/components/HelpSidebar";
import KeyListener from "@foxglove/studio-base/components/KeyListener";
import LayoutBrowser from "@foxglove/studio-base/components/LayoutBrowser";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@foxglove/studio-base/components/MessagePipeline";
import MultiProvider from "@foxglove/studio-base/components/MultiProvider";
import { OpenDialog, OpenDialogViews } from "@foxglove/studio-base/components/OpenDialog";
import PanelLayout from "@foxglove/studio-base/components/PanelLayout";
import PanelList from "@foxglove/studio-base/components/PanelList";
import PanelSettings from "@foxglove/studio-base/components/PanelSettings";
import PlaybackControls from "@foxglove/studio-base/components/PlaybackControls";
import Preferences from "@foxglove/studio-base/components/Preferences";
import RemountOnValueChange from "@foxglove/studio-base/components/RemountOnValueChange";
import Sidebar, { SidebarItem } from "@foxglove/studio-base/components/Sidebar";
import { SidebarContent } from "@foxglove/studio-base/components/SidebarContent";
import { SignInFormModal } from "@foxglove/studio-base/components/SignInFormModal";
import Stack from "@foxglove/studio-base/components/Stack";
import { StudioLogsSettingsSidebar } from "@foxglove/studio-base/components/StudioLogsSettingsSidebar";
import { SyncAdapters } from "@foxglove/studio-base/components/SyncAdapters";
import { useAssets } from "@foxglove/studio-base/context/AssetsContext";
import {
  IDataSourceFactory,
  usePlayerSelection,
} from "@foxglove/studio-base/context/CoScenePlayerSelectionContext";
import ConsoleApiContext from "@foxglove/studio-base/context/ConsoleApiContext";
import {
  LayoutState,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { useCurrentUser } from "@foxglove/studio-base/context/CurrentUserContext";
import { useExtensionCatalog } from "@foxglove/studio-base/context/ExtensionCatalogContext";
import LinkHandlerContext from "@foxglove/studio-base/context/LinkHandlerContext";
import { useNativeAppMenu } from "@foxglove/studio-base/context/NativeAppMenuContext";
import { useWorkspace, WorkspaceContext } from "@foxglove/studio-base/context/WorkspaceContext";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks";
import useAddPanel from "@foxglove/studio-base/hooks/useAddPanel";
import { useCalloutDismissalBlocker } from "@foxglove/studio-base/hooks/useCalloutDismissalBlocker";
import { useDefaultWebLaunchPreference } from "@foxglove/studio-base/hooks/useDefaultWebLaunchPreference";
import useElectronFilesToOpen from "@foxglove/studio-base/hooks/useElectronFilesToOpen";
import { useInitialDeepLinkState } from "@foxglove/studio-base/hooks/useInitialDeepLinkState";
import useNativeAppMenuEvent from "@foxglove/studio-base/hooks/useNativeAppMenuEvent";
import { PlayerPresence } from "@foxglove/studio-base/players/types";
import { HelpInfoStore, useHelpInfo } from "@foxglove/studio-base/providers/HelpInfoProvider";
import { PanelStateContextProvider } from "@foxglove/studio-base/providers/PanelStateContextProvider";

const log = Logger.getLogger(__filename);

const useStyles = makeStyles()({
  container: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    flex: "1 1 100%",
    outline: "none",
    overflow: "hidden",
  },
});

type SidebarItemKey =
  | "connection"
  | "add-panel"
  | "panel-settings"
  | "variables"
  | "extensions"
  | "account"
  | "layouts"
  | "preferences"
  | "help"
  | "studio-logs-settings";

const selectedLayoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;

function activeElementIsInput() {
  return (
    document.activeElement instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLTextAreaElement
  );
}

function keyboardEventHasModifier(event: KeyboardEvent) {
  if (navigator.userAgent.includes("Mac")) {
    return event.metaKey;
  } else {
    return event.ctrlKey;
  }
}

function AddPanel() {
  const addPanel = useAddPanel();
  const { openLayoutBrowser } = useWorkspace();
  const selectedLayoutId = useCurrentLayoutSelector(selectedLayoutIdSelector);
  const { t } = useTranslation("addPanel");

  return (
    <SidebarContent disablePadding={selectedLayoutId != undefined} title={t("addPanel")}>
      {selectedLayoutId == undefined ? (
        <Typography color="text.secondary">
          <Link onClick={openLayoutBrowser}>Select a layout</Link> to get started!
        </Typography>
      ) : (
        <PanelList onPanelSelect={addPanel} />
      )}
    </SidebarContent>
  );
}

type WorkspaceProps = {
  deepLinks?: string[];
  disableSignin?: boolean;
};

const DEFAULT_DEEPLINKS = Object.freeze([]);

const selectPlayerPresence = ({ playerState }: MessagePipelineContext) => playerState.presence;
const selectPlayerProblems = ({ playerState }: MessagePipelineContext) => playerState.problems;
const selectIsPlaying = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.isPlaying === true;
const selectPause = (ctx: MessagePipelineContext) => ctx.pausePlayback;
const selectPlay = (ctx: MessagePipelineContext) => ctx.startPlayback;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectPlayUntil = (ctx: MessagePipelineContext) => ctx.playUntil;
const selectPlayerId = (ctx: MessagePipelineContext) => ctx.playerState.playerId;

const selectSetHelpInfo = (store: HelpInfoStore) => store.setHelpInfo;

export default function Workspace(props: WorkspaceProps): JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("addPanel");
  const containerRef = useRef<HTMLDivElement>(ReactNull);
  const { availableSources, selectSource } = usePlayerSelection();
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerProblems = useMessagePipeline(selectPlayerProblems);

  const supportsAccountSettings =
    useContext(ConsoleApiContext) != undefined && props.disableSignin !== true;

  // We use playerId to detect when a player changes for RemountOnValueChange below
  // see comment below above the RemountOnValueChange component
  const playerId = useMessagePipeline(selectPlayerId);

  const isPlayerPresent = playerPresence !== PlayerPresence.NOT_PRESENT;

  const { currentUser } = useCurrentUser();

  const { currentUserRequired } = useInitialDeepLinkState(props.deepLinks ?? DEFAULT_DEEPLINKS);

  useDefaultWebLaunchPreference();

  const [showOpenDialogOnStartup = true] = useAppConfigurationValue<boolean>(
    AppSetting.SHOW_OPEN_DIALOG_ON_STARTUP,
  );

  const [enableStudioLogsSidebar = false] = useAppConfigurationValue<boolean>(
    AppSetting.SHOW_DEBUG_PANELS,
  );

  const showSignInForm = currentUserRequired && currentUser == undefined;

  const [showOpenDialog, setShowOpenDialog] = useState<
    { view: OpenDialogViews; activeDataSource?: IDataSourceFactory } | undefined
  >(isPlayerPresent || !showOpenDialogOnStartup || showSignInForm ? undefined : { view: "start" });

  const [selectedSidebarItem, setSelectedSidebarItem] = useState<SidebarItemKey | undefined>(
    "connection",
  );
  const prevSelectedSidebarItem = usePrevious(selectedSidebarItem);

  // When a player is present we hide the connection sidebar. To prevent hiding the connection sidebar
  // when the user wants to select a new connection we track whether the sidebar item opened
  const userSelectSidebarItem = useRef(false);

  const selectSidebarItem = useCallback((item: SidebarItemKey | undefined) => {
    userSelectSidebarItem.current = true;
    setSelectedSidebarItem(item);
  }, []);

  // When a player is activated, hide the open dialog.
  useLayoutEffect(() => {
    if (
      playerPresence === PlayerPresence.PRESENT ||
      playerPresence === PlayerPresence.INITIALIZING
    ) {
      setShowOpenDialog(undefined);
    }
  }, [playerPresence]);

  const setHelpInfo = useHelpInfo(selectSetHelpInfo);

  const handleInternalLink = useCallback(
    (event: React.MouseEvent, href: string) => {
      if (href === "#help:message-path-syntax") {
        event.preventDefault();
        setSelectedSidebarItem("help");
        setHelpInfo(MESSAGE_PATH_SYNTAX_HELP_INFO);
      }
    },
    [setHelpInfo],
  );

  useEffect(() => {
    // Focus on page load to enable keyboard interaction.
    if (containerRef.current) {
      containerRef.current.focus();
    }
  }, []);

  useCalloutDismissalBlocker();

  useNativeAppMenuEvent(
    "open-layouts",
    useCallback(() => {
      setSelectedSidebarItem("layouts");
    }, []),
  );

  useNativeAppMenuEvent(
    "open-add-panel",
    useCallback(() => {
      setSelectedSidebarItem("add-panel");
    }, []),
  );

  useNativeAppMenuEvent(
    "open-panel-settings",
    useCallback(() => {
      setSelectedSidebarItem("panel-settings");
    }, []),
  );

  useNativeAppMenuEvent(
    "open-variables",
    useCallback(() => {
      setSelectedSidebarItem("variables");
    }, []),
  );

  useNativeAppMenuEvent(
    "open-extensions",
    useCallback(() => {
      setSelectedSidebarItem("extensions");
    }, []),
  );

  useNativeAppMenuEvent(
    "open-account",
    useCallback(() => {
      setSelectedSidebarItem("account");
    }, []),
  );

  useNativeAppMenuEvent(
    "open-preferences",
    useCallback(() => {
      setSelectedSidebarItem("preferences");
    }, []),
  );

  useNativeAppMenuEvent(
    "open-file",
    useCallback(() => {
      setShowOpenDialog({ view: "file" });
    }, []),
  );

  useNativeAppMenuEvent(
    "open-remote-file",
    useCallback(() => {
      setShowOpenDialog({ view: "remote" });
    }, []),
  );

  useNativeAppMenuEvent(
    "open-sample-data",
    useCallback(() => {
      setShowOpenDialog({ view: "demo" });
    }, []),
  );

  const nativeAppMenu = useNativeAppMenu();

  const connectionSources = useMemo(() => {
    return availableSources.filter((source) => source.type === "connection");
  }, [availableSources]);

  useEffect(() => {
    if (!nativeAppMenu) {
      return;
    }

    for (const item of connectionSources) {
      nativeAppMenu.addFileEntry(item.displayName, () => {
        setShowOpenDialog({ view: "connection", activeDataSource: item });
      });
    }

    return () => {
      for (const item of connectionSources) {
        nativeAppMenu.removeFileEntry(item.displayName);
      }
    };
  }, [connectionSources, nativeAppMenu, selectSource]);

  const { enqueueSnackbar } = useSnackbar();

  const { loadFromFile } = useAssets();

  const installExtension = useExtensionCatalog((state) => state.installExtension);

  const openFiles = useCallback(
    async (files: File[]) => {
      const otherFiles: File[] = [];
      log.debug("open files", files);

      for (const file of files) {
        // electron extends File with a `path` field which is not available in browsers
        const basePath = (file as { path?: string }).path ?? "";

        if (file.name.endsWith(".foxe")) {
          // Extension installation
          try {
            const arrayBuffer = await file.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);
            const extension = await installExtension("local", data);
            enqueueSnackbar(`Installed extension ${extension.id}`, { variant: "success" });
          } catch (err) {
            log.error(err);
            enqueueSnackbar(`Failed to install extension ${file.name}: ${err.message}`, {
              variant: "error",
            });
          }
        } else {
          try {
            if (!(await loadFromFile(file, { basePath }))) {
              otherFiles.push(file);
            }
          } catch (err) {
            log.error(err);
            enqueueSnackbar(`Failed to load ${file.name}: ${err.message}`, { variant: "error" });
          }
        }
      }

      if (otherFiles.length > 0) {
        // Look for a source that supports the dragged file extensions
        for (const source of availableSources) {
          const filteredFiles = otherFiles.filter((file) => {
            const ext = extname(file.name);
            return source.supportedFileTypes?.includes(ext);
          });

          // select the first source that has files that match the supported extensions
          if (filteredFiles.length > 0) {
            selectSource(source.id, { type: "file", files: otherFiles });
            break;
          }
        }
      }
    },
    [availableSources, enqueueSnackbar, installExtension, loadFromFile, selectSource],
  );

  // files the main thread told us to open
  const filesToOpen = useElectronFilesToOpen();
  useEffect(() => {
    if (filesToOpen) {
      void openFiles(Array.from(filesToOpen));
    }
  }, [filesToOpen, openFiles]);

  const workspaceActions = useMemo(
    () => ({
      panelSettingsOpen: selectedSidebarItem === "panel-settings",
      openPanelSettings: () => setSelectedSidebarItem("panel-settings"),
      openHelp: () => setSelectedSidebarItem("help"),
      openAccountSettings: () => supportsAccountSettings && setSelectedSidebarItem("account"),
      openLayoutBrowser: () => setSelectedSidebarItem("layouts"),
    }),
    [selectedSidebarItem, supportsAccountSettings],
  );

  // Since the _component_ field of a sidebar item entry is a component and accepts no additional
  // props we need to wrap our DataSourceSidebar component to connect the open data source action to
  // open the data source dialog.
  const DataSourceSidebarItem = useMemo(() => {
    return function DataSourceSidebarItemImpl() {
      return <DataSourceSidebar />;
    };
  }, []);

  const [sidebarItems, sidebarBottomItems] = useMemo(() => {
    const topItems = new Map<SidebarItemKey, SidebarItem>([
      [
        "connection",
        {
          iconName: "DatabaseSettings",
          title: t("dataSource"),
          component: DataSourceSidebarItem,
          badge:
            playerProblems && playerProblems.length > 0
              ? { count: playerProblems.length }
              : undefined,
        },
      ],
      ["layouts", { iconName: "FiveTileGrid", title: t("layouts"), component: LayoutBrowser }],
      ["add-panel", { iconName: "RectangularClipping", title: t("addPanel"), component: AddPanel }],
      [
        "panel-settings",
        { iconName: "PanelSettings", title: t("panelSettings"), component: PanelSettings },
      ],
    ]);

    if (enableStudioLogsSidebar) {
      topItems.set("studio-logs-settings", {
        iconName: "BacklogList",
        title: t("studioLogsSettings"),
        component: StudioLogsSettingsSidebar,
      });
    }

    const bottomItems = new Map<SidebarItemKey, SidebarItem>([
      [
        "help",
        {
          iconName: "QuestionCircle",
          title: t("helpCenter"),
          component: () => {
            window.open("https://docs.coscene.cn/docs/get-started/create-project-flow/");
            setSelectedSidebarItem(prevSelectedSidebarItem);
            return <></>;
          },
        },
      ],
    ]);

    if (supportsAccountSettings) {
      bottomItems.set("account", {
        iconName: currentUser != undefined ? "BlockheadFilled" : "Blockhead",
        title: currentUser != undefined ? `${t("signInAs")} ${currentUser.email}` : t("account"),
        component: AccountSettings,
      });
    }

    bottomItems.set("preferences", {
      iconName: "Settings",
      title: t("preferences"),
      component: Preferences,
    });

    return [topItems, bottomItems];
  }, [
    DataSourceSidebarItem,
    playerProblems,
    enableStudioLogsSidebar,
    t,
    supportsAccountSettings,
    prevSelectedSidebarItem,
    currentUser,
  ]);

  const keyDownHandlers = useMemo(
    () => ({
      b: (ev: KeyboardEvent) => {
        if (
          !keyboardEventHasModifier(ev) ||
          activeElementIsInput() ||
          selectedSidebarItem == undefined
        ) {
          return;
        }

        ev.preventDefault();
        setSelectedSidebarItem(undefined);
      },
    }),
    [selectedSidebarItem],
  );

  const play = useMessagePipeline(selectPlay);
  const playUntil = useMessagePipeline(selectPlayUntil);
  const pause = useMessagePipeline(selectPause);
  const seek = useMessagePipeline(selectSeek);
  const isPlaying = useMessagePipeline(selectIsPlaying);
  const getMessagePipeline = useMessagePipelineGetter();
  const getTimeInfo = useCallback(
    () => getMessagePipeline().playerState.activeData ?? {},
    [getMessagePipeline],
  );

  return (
    <MultiProvider
      providers={[
        /* eslint-disable react/jsx-key */
        <LinkHandlerContext.Provider value={handleInternalLink} />,
        <WorkspaceContext.Provider value={workspaceActions} />,
        <PanelStateContextProvider />,
        /* eslint-enable react/jsx-key */
      ]}
    >
      {showSignInForm && <SignInFormModal />}
      {showOpenDialog != undefined && (
        <OpenDialog
          activeView={showOpenDialog.view}
          activeDataSource={showOpenDialog.activeDataSource}
          onDismiss={() => setShowOpenDialog(undefined)}
        />
      )}
      <SyncAdapters />
      <KeyListener global keyDownHandlers={keyDownHandlers} />
      <div className={classes.container} ref={containerRef} tabIndex={0}>
        <Sidebar
          items={sidebarItems}
          bottomItems={sidebarBottomItems}
          selectedKey={selectedSidebarItem}
          onSelectKey={selectSidebarItem}
        >
          {/* To ensure no stale player state remains, we unmount all panels when players change */}
          <RemountOnValueChange value={playerId}>
            <Stack>
              <PanelLayout />
              {play && pause && seek && (
                <div style={{ flexShrink: 0 }}>
                  <PlaybackControls
                    play={play}
                    pause={pause}
                    seek={seek}
                    playUntil={playUntil}
                    isPlaying={isPlaying}
                    getTimeInfo={getTimeInfo}
                  />
                </div>
              )}
            </Stack>
          </RemountOnValueChange>
        </Sidebar>
      </div>
    </MultiProvider>
  );
}
