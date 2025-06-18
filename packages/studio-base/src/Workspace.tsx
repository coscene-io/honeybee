// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

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

import * as _ from "lodash-es";
import { useSnackbar } from "notistack";
import { extname } from "path";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import Logger from "@foxglove/log";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { AppBarProps, AppBar } from "@foxglove/studio-base/components/AppBar";
import { CustomWindowControlsProps } from "@foxglove/studio-base/components/AppBar/CustomWindowControls";
import { EventsList } from "@foxglove/studio-base/components/CoSceneEventsList";
import {
  DataSourceDialog,
  DataSourceDialogItem,
} from "@foxglove/studio-base/components/DataSourceDialog";
import DocumentDropListener from "@foxglove/studio-base/components/DocumentDropListener";
import ExtensionsSettings from "@foxglove/studio-base/components/ExtensionsSettings";
import KeyListener from "@foxglove/studio-base/components/KeyListener";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@foxglove/studio-base/components/MessagePipeline";
import PanelLayout from "@foxglove/studio-base/components/PanelLayout";
import PanelSettings from "@foxglove/studio-base/components/PanelSettings";
import PlaybackControls from "@foxglove/studio-base/components/PlaybackControls";
import { Playlist } from "@foxglove/studio-base/components/Playlist";
import { ProblemsList } from "@foxglove/studio-base/components/ProblemsList";
import RecordInfo from "@foxglove/studio-base/components/RecordInfo";
import RemountOnValueChange from "@foxglove/studio-base/components/RemountOnValueChange";
import { SidebarContent } from "@foxglove/studio-base/components/SidebarContent";
import { Sidebars, SidebarItem } from "@foxglove/studio-base/components/Sidebars";
import Stack from "@foxglove/studio-base/components/Stack";
import { StudioLogsSettings } from "@foxglove/studio-base/components/StudioLogsSettings";
import { SyncAdapters } from "@foxglove/studio-base/components/SyncAdapters";
import { TopicList } from "@foxglove/studio-base/components/TopicList";
import VariablesList from "@foxglove/studio-base/components/VariablesList";
import { WorkspaceDialogs } from "@foxglove/studio-base/components/WorkspaceDialogs";
import { useAppContext } from "@foxglove/studio-base/context/AppContext";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
import { useExtensionCatalog } from "@foxglove/studio-base/context/ExtensionCatalogContext";
import {
  DataSourceArgs,
  usePlayerSelection,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import {
  LeftSidebarItemKey,
  RightSidebarItemKey,
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks";
import { useInitialDeepLinkState } from "@foxglove/studio-base/hooks/useCoSceneInitialDeepLinkState";
import { useDefaultWebLaunchPreference } from "@foxglove/studio-base/hooks/useDefaultWebLaunchPreference";
import useElectronFilesToOpen from "@foxglove/studio-base/hooks/useElectronFilesToOpen";
import { PlayerPresence } from "@foxglove/studio-base/players/types";
import { PanelStateContextProvider } from "@foxglove/studio-base/providers/PanelStateContextProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";
import { parseAppURLState } from "@foxglove/studio-base/util/appURLState";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

import { useWorkspaceActions } from "./context/Workspace/useWorkspaceActions";
import useNativeAppMenuEvent from "./hooks/useNativeAppMenuEvent";

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

type WorkspaceProps = CustomWindowControlsProps & {
  deepLinks?: readonly string[];
  appBarLeftInset?: number;
  onAppBarDoubleClick?: () => void;
  // eslint-disable-next-line react/no-unused-prop-types
  disablePersistenceForStorybook?: boolean;
  AppBarComponent?: (props: AppBarProps) => React.JSX.Element;
};

const DEFAULT_DEEPLINKS = Object.freeze([]);

const selectPlayerPresence = ({ playerState }: MessagePipelineContext) => playerState.presence;
const selectPlayerIsPresent = ({ playerState }: MessagePipelineContext) =>
  playerState.presence !== PlayerPresence.NOT_PRESENT;
const selectPlayerProblems = ({ playerState }: MessagePipelineContext) => playerState.problems;
const selectIsPlaying = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.isPlaying === true;
const selectRepeatEnabled = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.repeatEnabled === true;
const selectPause = (ctx: MessagePipelineContext) => ctx.pausePlayback;
const selectPlay = (ctx: MessagePipelineContext) => ctx.startPlayback;
const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectEnableRepeat = (ctx: MessagePipelineContext) => ctx.enableRepeatPlayback;
const selectPlayUntil = (ctx: MessagePipelineContext) => ctx.playUntil;
const selectPlayerId = (ctx: MessagePipelineContext) => ctx.playerState.playerId;
const selectSelectEvent = (store: EventsStore) => store.selectEvent;

const selectWorkspaceDataSourceDialog = (store: WorkspaceContextStore) => store.dialogs.dataSource;
const selectWorkspaceLeftSidebarItem = (store: WorkspaceContextStore) => store.sidebars.left.item;
const selectWorkspaceLeftSidebarOpen = (store: WorkspaceContextStore) => store.sidebars.left.open;
const selectWorkspaceLeftSidebarSize = (store: WorkspaceContextStore) => store.sidebars.left.size;
const selectWorkspaceRightSidebarItem = (store: WorkspaceContextStore) => store.sidebars.right.item;
const selectWorkspaceRightSidebarOpen = (store: WorkspaceContextStore) => store.sidebars.right.open;
const selectWorkspaceRightSidebarSize = (store: WorkspaceContextStore) => store.sidebars.right.size;

const selectUser = (store: UserStore) => store.user;
const selectUserLoginStatus = (store: UserStore) => store.loginStatus;

const selectEnableList = (store: CoSceneBaseStore) => store.getEnableList();
const selectDataSource = (state: CoSceneBaseStore) => state.dataSource;

function WorkspaceContent(props: WorkspaceProps): React.JSX.Element {
  const { PerformanceSidebarComponent } = useAppContext();
  const { classes } = useStyles();
  const containerRef = useRef<HTMLDivElement>(ReactNull);
  const { availableSources, selectSource } = usePlayerSelection();
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerProblems = useMessagePipeline(selectPlayerProblems);

  const dataSourceDialog = useWorkspaceStore(selectWorkspaceDataSourceDialog);
  const leftSidebarItem = useWorkspaceStore(selectWorkspaceLeftSidebarItem);
  const leftSidebarOpen = useWorkspaceStore(selectWorkspaceLeftSidebarOpen);
  const leftSidebarSize = useWorkspaceStore(selectWorkspaceLeftSidebarSize);
  const rightSidebarItem = useWorkspaceStore(selectWorkspaceRightSidebarItem);
  const rightSidebarOpen = useWorkspaceStore(selectWorkspaceRightSidebarOpen);
  const rightSidebarSize = useWorkspaceStore(selectWorkspaceRightSidebarSize);

  const enableList = useBaseInfo(selectEnableList);

  const dataSource = useBaseInfo(selectDataSource);

  // coScene set demo layout in demo mode

  const { dialogActions, sidebarActions } = useWorkspaceActions();

  const { t } = useTranslation("workspace");
  const { AppBarComponent = AppBar } = props;

  // file types we support for drag/drop
  const allowedDropExtensions = useMemo(() => {
    const extensions = [".foxe", ".coe"];
    for (const source of availableSources) {
      if (source.type === "file" && source.supportedFileTypes) {
        extensions.push(...source.supportedFileTypes);
      }
    }
    return extensions;
  }, [availableSources]);

  // We use playerId to detect when a player changes for RemountOnValueChange below
  // see comment below above the RemountOnValueChange component
  const playerId = useMessagePipeline(selectPlayerId);

  const currentUser = useCurrentUser(selectUser);
  const loginStatus = useCurrentUser(selectUserLoginStatus);

  useDefaultWebLaunchPreference();

  const [enableDebugMode = false] = useAppConfigurationValue<boolean>(AppSetting.SHOW_DEBUG_PANELS);

  const { workspaceExtensions = [] } = useAppContext();

  // When a player is activated, hide the open dialog.
  useLayoutEffect(() => {
    if (
      playerPresence === PlayerPresence.PRESENT ||
      playerPresence === PlayerPresence.INITIALIZING
    ) {
      dialogActions.dataSource.close();
    }
  }, [dialogActions.dataSource, playerPresence]);

  useEffect(() => {
    // Focus on page load to enable keyboard interaction.
    if (containerRef.current) {
      containerRef.current.focus();
    }
  }, []);

  useNativeAppMenuEvent(
    "open-help-general",
    useCallback(() => {
      dialogActions.preferences.open("general");
    }, [dialogActions.preferences]),
  );

  const { enqueueSnackbar } = useSnackbar();

  const installExtension = useExtensionCatalog((state) => state.installExtension);

  const openHandle = useCallback(
    async (
      handle: FileSystemFileHandle /* foxglove-depcheck-used: @types/wicg-file-system-access */,
    ) => {
      log.debug("open handle", handle);
      const file = await handle.getFile();

      if (file.name.endsWith(".foxe") || file.name.endsWith(".coe")) {
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
      }

      // Look for a source that supports the file extensions
      const matchedSource = availableSources.find((source) => {
        const ext = extname(file.name);
        return source.supportedFileTypes?.includes(ext);
      });
      if (matchedSource) {
        selectSource(matchedSource.id, { type: "file", handle });
      }
    },
    [availableSources, enqueueSnackbar, installExtension, selectSource],
  );

  // This function is called when coStudio is launched by clicking on a file.
  const openFiles = useCallback(
    async (files: File[]) => {
      const otherFiles: File[] = [];
      log.debug("open files", files);

      for (const file of files) {
        if (file.name.endsWith(".foxe") || file.name.endsWith(".coe")) {
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
          otherFiles.push(file);
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
    [availableSources, enqueueSnackbar, installExtension, selectSource],
  );

  // files the main thread told us to open
  const filesToOpen = useElectronFilesToOpen();
  useEffect(() => {
    if (filesToOpen) {
      void openFiles(Array.from(filesToOpen));
    }
  }, [filesToOpen, openFiles]);

  const dropHandler = useCallback(
    (event: { files?: File[]; handles?: FileSystemFileHandle[] }) => {
      log.debug("drop event", event);
      const handle = event.handles?.[0];
      // When selecting sources with handles we can only select with a single handle since we haven't
      // written the code to store multiple handles for recents. When there are multiple handles, we
      // fall back to opening regular files.
      if (handle && event.handles?.length === 1) {
        void openHandle(handle);
      } else if (event.files) {
        void openFiles(event.files);
      }
    },
    [openFiles, openHandle],
  );

  const leftSidebarItems = useMemo(() => {
    const items: [LeftSidebarItemKey, SidebarItem][] = [
      [
        "playlist",
        {
          title: t("playlist", { ns: "cosWorkspace" }),
          component: Playlist,
          hidden: enableList.playlist === "DISABLE",
        },
      ],
      ["panel-settings", { title: t("panel", { ns: "cosWorkspace" }), component: PanelSettings }],
      ["topics", { title: t("topics", { ns: "cosWorkspace" }), component: TopicList }],
      [
        "moment",
        {
          title: t("moment", { ns: "cosWorkspace" }),
          component: EventsList,
          hidden: enableList.event === "DISABLE",
        },
      ],
      [
        "problems",
        {
          title: t("problems"),
          component: ProblemsList,
          badge:
            playerProblems != undefined && playerProblems.length > 0
              ? {
                  count: playerProblems.length,
                  color: "error",
                }
              : undefined,
        },
      ],
    ];

    const cleanItems = new Map<LeftSidebarItemKey, SidebarItem>(
      items.filter(([, item]) => item.hidden == undefined || !item.hidden),
    );
    return cleanItems;
  }, [enableList.event, enableList.playlist, playerProblems, t]);

  useEffect(() => {
    if (playerProblems != undefined && playerProblems.length > 0) {
      sidebarActions.left.setOpen(true);
      sidebarActions.left.selectItem("problems");
    }
  }, [playerProblems, sidebarActions.left]);

  const rightSidebarItems = useMemo(() => {
    const items = new Map<RightSidebarItemKey, SidebarItem>([
      [
        "record-info",
        {
          title: t("recordInfo"),
          component: RecordInfo,
          hidden: dataSource == undefined || dataSource.id !== "coscene-data-platform",
        },
      ],
      ["variables", { title: t("variables"), component: VariablesList }],
      ["extensions", { title: t("extensions"), component: ExtensionsSidebar }],
    ]);

    if (enableDebugMode) {
      if (PerformanceSidebarComponent) {
        items.set("performance", {
          title: t("performance"),
          component: PerformanceSidebarComponent,
        });
      }
      items.set("studio-logs-settings", { title: t("studioLogs"), component: StudioLogsSettings });
    }

    // 过滤掉 hidden === true 的项目
    const filteredItems = new Map<RightSidebarItemKey, SidebarItem>();
    for (const [key, item] of items) {
      if (item.hidden !== true) {
        filteredItems.set(key, item);
      }
    }

    return filteredItems;
  }, [t, dataSource, enableDebugMode, PerformanceSidebarComponent]);

  const keyboardEventHasModifier = (event: KeyboardEvent) =>
    navigator.userAgent.includes("Mac") ? event.metaKey : event.ctrlKey;

  function ExtensionsSidebar() {
    return (
      <SidebarContent title="Extensions" disablePadding>
        <ExtensionsSettings />
      </SidebarContent>
    );
  }

  const keyDownHandlers = useMemo(() => {
    return {
      "[": () => {
        sidebarActions.left.setOpen((oldValue) => !oldValue);
      },
      "]": () => {
        sidebarActions.right.setOpen((oldValue) => !oldValue);
      },
      o: (ev: KeyboardEvent) => {
        if (!keyboardEventHasModifier(ev)) {
          return;
        }
        ev.preventDefault();
        if (ev.shiftKey) {
          dialogActions.dataSource.open("connection");
          return;
        }
        void dialogActions.openFile.open().catch(console.error);
      },
    };
  }, [dialogActions.dataSource, dialogActions.openFile, sidebarActions.left, sidebarActions.right]);

  const play = useMessagePipeline(selectPlay);
  const playUntil = useMessagePipeline(selectPlayUntil);
  const pause = useMessagePipeline(selectPause);
  const seek = useMessagePipeline(selectSeek);
  const enableRepeat = useMessagePipeline(selectEnableRepeat);
  const repeatEnabled = useMessagePipeline(selectRepeatEnabled);
  const isPlaying = useMessagePipeline(selectIsPlaying);
  const getMessagePipeline = useMessagePipelineGetter();
  const getTimeInfo = useCallback(
    () => getMessagePipeline().playerState.activeData ?? {},
    [getMessagePipeline],
  );

  const targetUrlState = useMemo(() => {
    const deepLinks = props.deepLinks ?? [];

    if (deepLinks[0] == undefined) {
      return undefined;
    }

    const url = new URL(deepLinks[0]);
    const parsedUrl = parseAppURLState(url);

    if (
      isDesktopApp() &&
      parsedUrl?.ds === "coscene-data-platform" &&
      url.hostname !== APP_CONFIG.DOMAIN_CONFIG.default?.webDomain
    ) {
      dialogActions.dataSource.close();
      setTimeout(() => {
        toast.error(t("invalidDomain", { domain: APP_CONFIG.DOMAIN_CONFIG.default?.webDomain }));
      }, 1000);
      return undefined;
    }

    return parsedUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.deepLinks, t]);

  const [unappliedSourceArgs, setUnappliedSourceArgs] = useState(
    targetUrlState ? { ds: targetUrlState.ds, dsParams: targetUrlState.dsParams } : undefined,
  );

  // Ensure that the data source is initialised only once
  const currentSource = useRef<(DataSourceArgs & { id: string }) | undefined>(undefined);

  const selectEvent = useEvents(selectSelectEvent);

  const debouncedPleaseLoginFirstToast = React.useMemo(() => {
    return _.debounce(() => {
      toast.error(t("pleaseLoginFirst", { ns: "openDialog" }));
    }, 1000);
  }, [t]);

  // Load data source from URL.
  useEffect(() => {
    if (unappliedSourceArgs?.ds == undefined) {
      return;
    }

    if (dataSourceDialog.open) {
      dialogActions.dataSource.close();
    }

    if (loginStatus === "notLogin" && unappliedSourceArgs.ds === "coscene-data-platform") {
      debouncedPleaseLoginFirstToast();
      return;
    }

    // sync user info need time, so in some case, loginStatus is alreadyLogin but currentUser is undefined
    if (currentUser?.userId == undefined) {
      return;
    }

    // Apply any available data source args
    log.debug("Initialising source from url", unappliedSourceArgs);
    const sourceParams: DataSourceArgs = {
      type: "connection",
      params: {
        ...currentUser,
        ...unappliedSourceArgs.dsParams,
      },
    };

    if (_.isEqual({ id: unappliedSourceArgs.ds, ...sourceParams }, currentSource.current)) {
      return;
    }

    currentSource.current = { id: unappliedSourceArgs.ds, ...sourceParams };

    selectSource(unappliedSourceArgs.ds, sourceParams);

    selectEvent(unappliedSourceArgs.dsParams?.eventId);
    setUnappliedSourceArgs({ ds: undefined, dsParams: undefined });
  }, [
    currentUser,
    selectEvent,
    selectSource,
    unappliedSourceArgs,
    setUnappliedSourceArgs,
    currentSource,
    loginStatus,
    t,
    dialogActions.dataSource,
    dataSourceDialog.open,
    debouncedPleaseLoginFirstToast,
  ]);

  const appBar = useMemo(
    () => (
      <AppBarComponent
        leftInset={props.appBarLeftInset}
        onDoubleClick={props.onAppBarDoubleClick}
        showCustomWindowControls={props.showCustomWindowControls}
        isMaximized={props.isMaximized}
        initialZoomFactor={props.initialZoomFactor}
        onMinimizeWindow={props.onMinimizeWindow}
        onMaximizeWindow={props.onMaximizeWindow}
        onUnmaximizeWindow={props.onUnmaximizeWindow}
        onCloseWindow={props.onCloseWindow}
      />
    ),
    [
      AppBarComponent,
      props.appBarLeftInset,
      props.isMaximized,
      props.initialZoomFactor,
      props.onAppBarDoubleClick,
      props.onCloseWindow,
      props.onMaximizeWindow,
      props.onMinimizeWindow,
      props.onUnmaximizeWindow,
      props.showCustomWindowControls,
    ],
  );

  return (
    <PanelStateContextProvider>
      {dataSourceDialog.open && <DataSourceDialog />}
      <DocumentDropListener onDrop={dropHandler} allowedExtensions={allowedDropExtensions} />
      <SyncAdapters />
      <KeyListener global keyDownHandlers={keyDownHandlers} />
      <div className={classes.container} ref={containerRef} tabIndex={0}>
        {appBar}
        <Sidebars
          leftItems={leftSidebarItems}
          selectedLeftKey={leftSidebarOpen ? leftSidebarItem : undefined}
          onSelectLeftKey={sidebarActions.left.selectItem}
          leftSidebarSize={leftSidebarSize}
          setLeftSidebarSize={sidebarActions.left.setSize}
          rightItems={rightSidebarItems}
          selectedRightKey={rightSidebarOpen ? rightSidebarItem : undefined}
          onSelectRightKey={sidebarActions.right.selectItem}
          rightSidebarSize={rightSidebarSize}
          setRightSidebarSize={sidebarActions.right.setSize}
        >
          {/* To ensure no stale player state remains, we unmount all panels when players change */}
          <RemountOnValueChange value={playerId}>
            <Stack>
              <PanelLayout />
            </Stack>
          </RemountOnValueChange>
        </Sidebars>
        {play != undefined &&
          pause != undefined &&
          seek != undefined &&
          enableRepeat != undefined && (
            <div style={{ flexShrink: 0 }}>
              <PlaybackControls
                play={play}
                pause={pause}
                seek={seek}
                playUntil={playUntil}
                isPlaying={isPlaying}
                repeatEnabled={repeatEnabled}
                enableRepeatPlayback={enableRepeat}
                getTimeInfo={getTimeInfo}
              />
            </div>
          )}
      </div>
      {/* Splat to avoid requiring unique a `key` on each item in workspaceExtensions */}
      {...workspaceExtensions}
      <WorkspaceDialogs />
    </PanelStateContextProvider>
  );
}

export default function Workspace(props: WorkspaceProps): React.JSX.Element {
  const [showOpenDialogOnStartup = true] = useAppConfigurationValue<boolean>(
    AppSetting.SHOW_OPEN_DIALOG_ON_STARTUP,
  );

  useInitialDeepLinkState(props.deepLinks ?? DEFAULT_DEEPLINKS);

  const { workspaceStoreCreator } = useAppContext();

  const isPlayerPresent = useMessagePipeline(selectPlayerIsPresent);

  const initialItem: undefined | DataSourceDialogItem =
    isPlayerPresent || !showOpenDialogOnStartup ? undefined : "start";

  const initialState: Pick<WorkspaceContextStore, "dialogs"> = {
    dialogs: {
      dataSource: {
        activeDataSource: undefined,
        open: initialItem != undefined && isDesktopApp(),
        item: initialItem,
      },
      preferences: {
        initialTab: undefined,
        open: false,
      },
    },
  };

  return (
    <WorkspaceContextProvider
      initialState={initialState}
      workspaceStoreCreator={workspaceStoreCreator}
      disablePersistenceForStorybook={props.disablePersistenceForStorybook}
    >
      <WorkspaceContent {...props} />
    </WorkspaceContextProvider>
  );
}
