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

import { useEffect, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { AppBarProps, AppBar } from "@foxglove/studio-base/components/AppBar";
import { CustomWindowControlsProps } from "@foxglove/studio-base/components/AppBar/CustomWindowControls";
import {
  DataSourceDialog,
  DataSourceDialogItem,
} from "@foxglove/studio-base/components/DataSourceDialog";
import { DeepLinksSyncAdapter } from "@foxglove/studio-base/components/DeepLinksSyncAdapter";
import DocumentDropListener from "@foxglove/studio-base/components/DocumentDropListener";
import { EventsList } from "@foxglove/studio-base/components/Events/EventsList";
import ExtensionsSettings from "@foxglove/studio-base/components/ExtensionsSettings";
import KeyListener from "@foxglove/studio-base/components/KeyListener";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@foxglove/studio-base/components/MessagePipeline";
import PanelLayout from "@foxglove/studio-base/components/PanelLayout";
import PanelSettings from "@foxglove/studio-base/components/PanelSettings";
import PlaybackControls, {
  RealtimeVizPlaybackControls,
} from "@foxglove/studio-base/components/PlaybackControls";
import { Playlist } from "@foxglove/studio-base/components/Playlist";
import { ProblemsList } from "@foxglove/studio-base/components/ProblemsList";
import RecordInfo from "@foxglove/studio-base/components/RecordInfo";
import RemountOnValueChange from "@foxglove/studio-base/components/RemountOnValueChange";
import { SidebarContent } from "@foxglove/studio-base/components/SidebarContent";
import { Sidebars, SidebarItem } from "@foxglove/studio-base/components/Sidebars";
import Stack from "@foxglove/studio-base/components/Stack";
import { StudioLogsSettings } from "@foxglove/studio-base/components/StudioLogsSettings";
import { SyncAdapters } from "@foxglove/studio-base/components/SyncAdapters";
import TaskDetailDrawer from "@foxglove/studio-base/components/Tasks/TaskDetailDrawer";
import { TasksList } from "@foxglove/studio-base/components/Tasks/TasksList";
import { TopicList } from "@foxglove/studio-base/components/TopicList";
import VariablesList from "@foxglove/studio-base/components/VariablesList";
import { WorkspaceDialogs } from "@foxglove/studio-base/components/WorkspaceDialogs";
import { useAppContext } from "@foxglove/studio-base/context/AppContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";
import { SubscriptionEntitlementStore } from "@foxglove/studio-base/context/SubscriptionEntitlementContext";
import {
  LeftSidebarItemKey,
  RightSidebarItemKey,
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks";
import { useDefaultWebLaunchPreference } from "@foxglove/studio-base/hooks/useDefaultWebLaunchPreference";
import useElectronFilesToOpen from "@foxglove/studio-base/hooks/useElectronFilesToOpen";
import { useHandleFiles } from "@foxglove/studio-base/hooks/useHandleFiles";
import { Language } from "@foxglove/studio-base/i18n";
import { PlayerPresence } from "@foxglove/studio-base/players/types";
import { PanelStateContextProvider } from "@foxglove/studio-base/providers/PanelStateContextProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

import { useSubscriptionEntitlement } from "./context/SubscriptionEntitlementContext";
import { useWorkspaceActions } from "./context/Workspace/useWorkspaceActions";
import useNativeAppMenuEvent from "./hooks/useNativeAppMenuEvent";

const PERSONAL_INFO_CONFIG_ID = "personalInfo";

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

const selectWorkspaceDataSourceDialog = (store: WorkspaceContextStore) => store.dialogs.dataSource;
const selectWorkspaceLeftSidebarItem = (store: WorkspaceContextStore) => store.sidebars.left.item;
const selectWorkspaceLeftSidebarOpen = (store: WorkspaceContextStore) => store.sidebars.left.open;
const selectWorkspaceLeftSidebarSize = (store: WorkspaceContextStore) => store.sidebars.left.size;
const selectWorkspaceRightSidebarItem = (store: WorkspaceContextStore) => store.sidebars.right.item;
const selectWorkspaceRightSidebarOpen = (store: WorkspaceContextStore) => store.sidebars.right.open;
const selectWorkspaceRightSidebarSize = (store: WorkspaceContextStore) => store.sidebars.right.size;

const selectUser = (store: UserStore) => store.user;
const selectUserLoginStatus = (store: UserStore) => store.loginStatus;

const selectEnableList = (store: CoreDataStore) => store.getEnableList();
const selectDataSource = (state: CoreDataStore) => state.dataSource;
const selectPaid = (store: SubscriptionEntitlementStore) => store.paid;

function WorkspaceContent(props: WorkspaceProps): React.JSX.Element {
  const { PerformanceSidebarComponent } = useAppContext();
  const { classes } = useStyles();
  const containerRef = useRef<HTMLDivElement>(ReactNull);
  const { availableSources } = usePlayerSelection();
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const playerProblems = useMessagePipeline(selectPlayerProblems);
  const { dropHandler, handleFilesRef } = useHandleFiles();

  const dataSourceDialog = useWorkspaceStore(selectWorkspaceDataSourceDialog);
  const leftSidebarItem = useWorkspaceStore(selectWorkspaceLeftSidebarItem);
  const leftSidebarOpen = useWorkspaceStore(selectWorkspaceLeftSidebarOpen);
  const leftSidebarSize = useWorkspaceStore(selectWorkspaceLeftSidebarSize);
  const rightSidebarItem = useWorkspaceStore(selectWorkspaceRightSidebarItem);
  const rightSidebarOpen = useWorkspaceStore(selectWorkspaceRightSidebarOpen);
  const rightSidebarSize = useWorkspaceStore(selectWorkspaceRightSidebarSize);

  const enableList = useCoreData(selectEnableList);
  const dataSource = useCoreData(selectDataSource);

  const paid = useSubscriptionEntitlement(selectPaid);

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

  // files the main thread told us to open
  const filesToOpen = useElectronFilesToOpen();

  useEffect(() => {
    if (filesToOpen && filesToOpen.length > 0) {
      void handleFilesRef.current(Array.from(filesToOpen));
    }
  }, [filesToOpen, handleFilesRef]);

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
          hidden: !paid || enableList.event === "DISABLE",
        },
      ],
      [
        "tasks",
        {
          title: t("tasks", { ns: "cosWorkspace" }),
          component: TasksList,
          hidden: !paid || enableList.task === "DISABLE",
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
  }, [enableList.event, enableList.playlist, enableList.task, playerProblems, t, paid]);

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
      <DeepLinksSyncAdapter deepLinks={props.deepLinks} />
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
        {dataSource?.id === "coscene-websocket" && (
          <div style={{ flexShrink: 0 }}>
            <RealtimeVizPlaybackControls />
          </div>
        )}
      </div>
      {/* Splat to avoid requiring unique a `key` on each item in workspaceExtensions */}
      {...workspaceExtensions}
      <WorkspaceDialogs />
      <TaskDetailDrawer />
    </PanelStateContextProvider>
  );
}

export default function Workspace(props: WorkspaceProps): React.JSX.Element {
  const [showOpenDialogOnStartup = true] = useAppConfigurationValue<boolean>(
    AppSetting.SHOW_OPEN_DIALOG_ON_STARTUP,
  );
  const { i18n } = useTranslation();
  const [, setSelectedLanguage] = useAppConfigurationValue<Language>(AppSetting.LANGUAGE);
  const consoleApi = useConsoleApi();
  const currentUser = useCurrentUser(selectUser);
  const loginStatus = useCurrentUser(selectUserLoginStatus);

  const { workspaceStoreCreator } = useAppContext();

  const isPlayerPresent = useMessagePipeline(selectPlayerIsPresent);

  const syncLanguageWithOrgConfigMap = useCallback(async () => {
    // Only sync language if user is logged in
    if (loginStatus !== "alreadyLogin" || !currentUser?.userId) {
      return;
    }

    const configName = `users/${currentUser.userId}/configMaps/${PERSONAL_INFO_CONFIG_ID}`;

    const userConfig = await consoleApi.getOrgConfigMap({
      name: configName,
    });

    const userLanguage = (
      userConfig.value?.toJson() as
        | {
            settings?: {
              language?: string;
            };
          }
        | undefined
    )?.settings?.language;

    if (userLanguage != undefined && userLanguage !== i18n.language) {
      void i18n.changeLanguage(userLanguage);

      void setSelectedLanguage(userLanguage as Language);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginStatus, currentUser?.userId]);

  useEffect(() => {
    void syncLanguageWithOrgConfigMap();
  }, [syncLanguageWithOrgConfigMap]);

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
