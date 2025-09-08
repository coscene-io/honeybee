// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import CancelIcon from "@mui/icons-material/Cancel";
import SearchIcon from "@mui/icons-material/Search";
import { Menu, Divider, MenuItem as MuiMenuItem, IconButton, TextField } from "@mui/material";
import * as _ from "lodash-es";
import moment from "moment";
import { useSnackbar } from "notistack";
import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import useAsyncFn from "react-use/lib/useAsyncFn";
import { makeStyles } from "tss-react/mui";

import Logger from "@foxglove/log";
import { AppBarDropdownButton } from "@foxglove/studio-base/components/AppBar/AppBarDropdownButton";
import { useUnsavedChangesPrompt } from "@foxglove/studio-base/components/CoSceneLayoutBrowser/CoSceneUnsavedChangesPrompt";
import { useLayoutBrowserReducer } from "@foxglove/studio-base/components/CoSceneLayoutBrowser/coSceneReducer";
import Stack from "@foxglove/studio-base/components/Stack";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
// import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  ProjectRoleEnum,
  ProjectRoleWeight,
  useCurrentUser,
  UserStore,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
// import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import {
  LayoutState,
  useCurrentLayoutSelector,
  LayoutID,
  useCurrentLayoutActions,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import {
  useWorkspaceStore,
  WorkspaceContextStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import useCallbackWithToast from "@foxglove/studio-base/hooks/useCallbackWithToast";
import { usePrompt } from "@foxglove/studio-base/hooks/useCoScenePrompt";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { Layout, layoutIsShared } from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import { downloadTextFile } from "@foxglove/studio-base/util/download";

import LayoutSection from "./LayoutSection";

const log = Logger.getLogger(__filename);
const selectedLayoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;
// const selectExternalInitConfig = (state: CoreDataStore) => state.externalInitConfig;
const selectUserRole = (store: UserStore) => store.role;

const useStyles = makeStyles()((theme) => {
  const { spacing, palette } = theme;

  return {
    menuList: {
      minWidth: 320,
      // padding: theme.spacing(1),
      paddingBottom: theme.spacing(1),
    },
    toolbar: {
      position: "sticky",
      top: -0.5, // yep that's a half pixel to avoid a gap between the appbar and panel top
      zIndex: 100,
      display: "flex",
      justifyContent: "stretch",
      padding: theme.spacing(1),
      backgroundImage: `linear-gradient(to top, transparent, ${palette.background.paper} ${spacing(
        1.5,
      )}) !important`,
    },
    toolbarMenu: {
      backgroundImage: `linear-gradient(to top, transparent, ${palette.background.menu} ${spacing(
        1.5,
      )}) !important`,
    },
  };
});

const selectLayoutMenuOpen = (store: WorkspaceContextStore) => store.layoutDrawer.open;
export function CoSceneLayoutButton(): React.JSX.Element {
  const menuOpen = useWorkspaceStore(selectLayoutMenuOpen);
  const { classes, cx } = useStyles();
  const anchorEl = useRef<HTMLButtonElement>(ReactNull);
  const { t } = useTranslation("cosLayout");
  const [searchQuery, setSearchQuery] = useState("");
  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const query = event.target.value;
    setSearchQuery(query);
  }, []);
  // const { layoutActions } = useWorkspaceActions();
  const { layoutDrawer } = useWorkspaceActions();

  const currentLayoutId = useCurrentLayoutSelector(selectedLayoutIdSelector);
  const { enqueueSnackbar } = useSnackbar();
  const { unsavedChangesPrompt, openUnsavedChangesPrompt } = useUnsavedChangesPrompt();
  const { setSelectedLayoutId } = useCurrentLayoutActions();
  const analytics = useAnalytics();
  const [prompt, promptModal] = usePrompt();
  const confirm = useConfirm();
  const layoutManager = useLayoutManager();

  // const consoleApi = useConsoleApi();

  // const externalInitConfig = useCoreData(selectExternalInitConfig);
  const currentUserRole = useCurrentUser(selectUserRole);

  const [layouts, reloadLayouts] = useAsyncFn(
    async () => {
      const [shared, personal] = _.partition(
        await layoutManager.getLayouts(),
        layoutManager.supportsSharing ? layoutIsShared : () => false,
      );
      return {
        personal: personal.sort((a, b) => a.name.localeCompare(b.name)),
        shared: shared.sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
    [layoutManager],
    { loading: true },
  );

  const setMenuOpen = useCallback(
    // eslint-disable-next-line @foxglove/no-boolean-parameters
    (open: boolean) => {
      // openLayoutBrowser();
    },
    [],
  );

  useEffect(() => {
    const listener = () => void reloadLayouts();
    layoutManager.on("change", listener);
    return () => {
      layoutManager.off("change", listener);
    };
  }, [layoutManager, reloadLayouts]);

  // Start loading on first mount
  useEffect(() => {
    reloadLayouts().catch((err: unknown) => {
      log.error(err);
    });
  }, [reloadLayouts]);

  const currentLayouts = useMemo(() => {
    return [...(layouts.value?.personal ?? []), ...(layouts.value?.shared ?? [])].find(
      (layout) => layout.id === currentLayoutId,
    );
  }, [layouts, currentLayoutId]);

  const [state, dispatch] = useLayoutBrowserReducer({
    lastSelectedId: currentLayoutId,
    busy: layoutManager.isBusy,
    error: layoutManager.error,
    online: layoutManager.isOnline,
  });

  const pendingMultiAction = state.multiAction?.ids != undefined;

  const anySelectedModifiedLayouts = useMemo(() => {
    return [layouts.value?.personal ?? [], layouts.value?.shared ?? []]
      .flat()
      .some((layout) => layout.working != undefined && state.selectedIds.includes(layout.id));
  }, [layouts, state.selectedIds]);

  useLayoutEffect(() => {
    const busyListener = () => {
      dispatch({ type: "set-busy", value: layoutManager.isBusy });
    };
    const onlineListener = () => {
      dispatch({ type: "set-online", value: layoutManager.isOnline });
    };
    const errorListener = () => {
      dispatch({ type: "set-error", value: layoutManager.error });
    };
    busyListener();
    onlineListener();
    errorListener();
    layoutManager.on("busychange", busyListener);
    layoutManager.on("onlinechange", onlineListener);
    layoutManager.on("errorchange", errorListener);
    return () => {
      layoutManager.off("busychange", busyListener);
      layoutManager.off("onlinechange", onlineListener);
      layoutManager.off("errorchange", errorListener);
    };
  }, [dispatch, layoutManager]);

  useEffect(() => {
    const processAction = async () => {
      if (!state.multiAction) {
        return;
      }

      const id = state.multiAction.ids[0];
      if (id) {
        try {
          switch (state.multiAction.action) {
            case "delete":
              await layoutManager.deleteLayout({ id: id as LayoutID });
              dispatch({ type: "shift-multi-action" });
              break;
            case "duplicate": {
              const layout = await layoutManager.getLayout({ id: id as LayoutID });
              if (layout) {
                await layoutManager.saveNewLayout({
                  folder: layout.folder,
                  name: `${layout.name} copy`,
                  data: layout.working?.data ?? layout.baseline.data,
                  permission: "CREATOR_WRITE",
                });
              }
              dispatch({ type: "shift-multi-action" });
              break;
            }
            case "revert":
              await layoutManager.revertLayout({ id: id as LayoutID });
              dispatch({ type: "shift-multi-action" });
              break;
            case "save":
              await layoutManager.overwriteLayout({ id: id as LayoutID });
              dispatch({ type: "shift-multi-action" });
              break;
          }
        } catch (err) {
          enqueueSnackbar(`Error processing layouts: ${err.message}`, { variant: "error" });
          dispatch({ type: "clear-multi-action" });
        }
      }
    };

    processAction().catch((err: unknown) => {
      log.error(err);
    });
  }, [dispatch, enqueueSnackbar, layoutManager, state.multiAction]);

  /**
   * Don't allow the user to switch away from a personal layout if they have unsaved changes. This
   * currently has a race condition because of the throttled save in CurrentLayoutProvider -- it's
   * possible to make changes and switch layouts before they're sent to the layout manager.
   * @returns true if the original action should continue, false otherwise
   */
  const promptForUnsavedChanges = useCallback(async () => {
    const currentLayout =
      currentLayoutId != undefined
        ? await layoutManager.getLayout({ id: currentLayoutId })
        : undefined;
    if (
      currentLayout != undefined &&
      layoutIsShared(currentLayout) &&
      currentLayout.working != undefined
    ) {
      const result = await openUnsavedChangesPrompt(currentLayout);
      switch (result.type) {
        case "cancel":
          return false;
        case "discard":
          await layoutManager.revertLayout({ id: currentLayout.id });
          void analytics.logEvent(AppEvent.LAYOUT_REVERT, {
            permission: currentLayout.permission,
            context: "UnsavedChangesPrompt",
          });
          return true;
        case "overwrite":
          await layoutManager.overwriteLayout({ id: currentLayout.id });
          void analytics.logEvent(AppEvent.LAYOUT_OVERWRITE, {
            permission: currentLayout.permission,
            context: "UnsavedChangesPrompt",
          });
          return true;
        case "makePersonal":
          // We don't use onMakePersonalCopy() here because it might need to prompt for unsaved changes, and we don't want to select the newly created layout
          await layoutManager.makePersonalCopy({
            id: currentLayout.id,
            name: result.name,
          });
          void analytics.logEvent(AppEvent.LAYOUT_MAKE_PERSONAL_COPY, {
            permission: currentLayout.permission,
            syncStatus: currentLayout.syncInfo?.status,
            context: "UnsavedChangesPrompt",
          });
          return true;
      }
    }
    return true;
  }, [analytics, currentLayoutId, layoutManager, openUnsavedChangesPrompt]);

  const onSelectLayout = useCallbackWithToast(
    async (
      item: Layout,
      { selectedViaClick = false, event }: { selectedViaClick?: boolean; event?: MouseEvent } = {},
    ) => {
      if (selectedViaClick) {
        if (!(await promptForUnsavedChanges())) {
          return;
        }
        void analytics.logEvent(AppEvent.LAYOUT_SELECT, { permission: item.permission });
      }
      if (event?.ctrlKey === true || event?.metaKey === true || event?.shiftKey === true) {
        if (item.id !== currentLayoutId) {
          dispatch({
            type: "select-id",
            id: item.id,
            layouts: layouts.value,
            modKey: event.ctrlKey || event.metaKey,
            shiftKey: event.shiftKey,
          });
        }
      } else {
        setSelectedLayoutId(item.id);
        dispatch({ type: "select-id", id: item.id });
        setMenuOpen(false);
      }
    },
    [
      analytics,
      currentLayoutId,
      dispatch,
      layouts.value,
      promptForUnsavedChanges,
      setMenuOpen,
      setSelectedLayoutId,
    ],
  );

  const onRenameLayout = useCallbackWithToast(
    async (item: Layout, newName: string) => {
      await layoutManager.updateLayout({ id: item.id, name: newName });
      void analytics.logEvent(AppEvent.LAYOUT_RENAME, { permission: item.permission });
    },
    [analytics, layoutManager],
  );

  const onDuplicateLayout = useCallbackWithToast(
    async (item: Layout) => {
      if (state.selectedIds.length > 1) {
        dispatch({ type: "queue-multi-action", action: "duplicate" });
        return;
      }

      if (!(await promptForUnsavedChanges())) {
        return;
      }
      const newLayout = await layoutManager.saveNewLayout({
        folder: item.folder,
        name: `${item.name} copy`,
        data: item.working?.data ?? item.baseline.data,
        permission: "CREATOR_WRITE",
      });
      await onSelectLayout(newLayout);
      void analytics.logEvent(AppEvent.LAYOUT_DUPLICATE, { permission: item.permission });
    },
    [
      analytics,
      dispatch,
      layoutManager,
      onSelectLayout,
      promptForUnsavedChanges,
      state.selectedIds.length,
    ],
  );

  const onDeleteLayout = useCallbackWithToast(
    async (item: Layout) => {
      if (state.selectedIds.length > 1) {
        dispatch({ type: "queue-multi-action", action: "delete" });
        return;
      }

      void analytics.logEvent(AppEvent.LAYOUT_DELETE, { permission: item.permission });

      // If the layout was selected, select a different available layout.
      //
      // When a users current layout is deleted, we display a notice. By selecting a new layout
      // before deleting their current layout we avoid the weirdness of displaying a notice that the
      // user just deleted their current layout which is somewhat obvious to the user.
      if (currentLayoutId === item.id) {
        const storedLayouts = await layoutManager.getLayouts();
        const targetLayout = storedLayouts.find((layout) => layout.id !== currentLayoutId);
        setSelectedLayoutId(targetLayout?.id);
        dispatch({ type: "select-id", id: targetLayout?.id });
      }
      await layoutManager.deleteLayout({ id: item.id });
    },
    [
      analytics,
      currentLayoutId,
      dispatch,
      layoutManager,
      setSelectedLayoutId,
      state.selectedIds.length,
    ],
  );

  const onShareLayout = useCallbackWithToast(
    async (item: Layout) => {
      const displayName = await prompt({
        title: t("shareDialogTitle"),
        subText: t("shareDialogDescription"),
        initialValue: item.name,
        label: t("layoutName"),
      });
      if (displayName != undefined) {
        const newLayout = await layoutManager.saveNewLayout({
          folder: item.folder,
          name: displayName,
          data: item.working?.data ?? item.baseline.data,
          permission: "ORG_WRITE",
        });
        void analytics.logEvent(AppEvent.LAYOUT_SHARE, { permission: item.permission });
        await onSelectLayout(newLayout);
      }
    },
    [analytics, t, layoutManager, onSelectLayout, prompt],
  );

  const onExportLayout = useCallbackWithToast(
    async (item: Layout) => {
      const content = JSON.stringify(item.working?.data ?? item.baseline.data, undefined, 2) ?? "";
      downloadTextFile(content, `${item.name}.json`);
      void analytics.logEvent(AppEvent.LAYOUT_EXPORT, { permission: item.permission });
    },
    [analytics],
  );

  const onOverwriteLayout = useCallbackWithToast(
    async (item: Layout) => {
      // We don't need to confirm the multiple selection case because we force users to save
      // or abandon changes before selecting another layout with unsaved changes to the current
      // shared layout.
      if (state.selectedIds.length > 1) {
        dispatch({ type: "queue-multi-action", action: "save" });
        return;
      }

      if (layoutIsShared(item)) {
        const response = await confirm({
          title: `${t("update")} " ${item.name}"?`,
          prompt: t("updateRemoteLayoutConfirm"),
          ok: t("save", {
            ns: "cosGeneral",
          }),
          cancel: t("cancel", {
            ns: "cosGeneral",
          }),
        });
        if (response !== "ok") {
          return;
        }
      }
      await layoutManager.overwriteLayout({ id: item.id });
      void analytics.logEvent(AppEvent.LAYOUT_OVERWRITE, { permission: item.permission });
    },
    [analytics, confirm, dispatch, layoutManager, state.selectedIds.length, t],
  );

  const onRevertLayout = useCallbackWithToast(
    async (item: Layout) => {
      if (state.selectedIds.length > 1) {
        dispatch({ type: "queue-multi-action", action: "revert" });
        return;
      }

      await layoutManager.revertLayout({ id: item.id });
      void analytics.logEvent(AppEvent.LAYOUT_REVERT, { permission: item.permission });
    },
    [analytics, dispatch, layoutManager, state.selectedIds.length],
  );

  const onMakePersonalCopy = useCallbackWithToast(
    async (item: Layout) => {
      const newLayout = await layoutManager.makePersonalCopy({
        id: item.id,
        name: `${item.name} copy`,
      });
      await onSelectLayout(newLayout);
      void analytics.logEvent(AppEvent.LAYOUT_MAKE_PERSONAL_COPY, {
        permission: item.permission,
        syncStatus: item.syncInfo?.status,
      });
    },
    [analytics, layoutManager, onSelectLayout],
  );

  const createNewLayout = useCallbackWithToast(async () => {
    if (!(await promptForUnsavedChanges())) {
      return;
    }
    const displayName = `Unnamed layout ${moment().format("l")} at ${moment().format("LT")}`;
    const layoutData: LayoutData = {
      configById: {},
      globalVariables: {},
      userNodes: {},
    };
    const newLayout = await layoutManager.saveNewLayout({
      folder: "", // todo: get folder
      name: displayName,
      data: layoutData,
      permission: "CREATOR_WRITE",
    });
    void onSelectLayout(newLayout);

    void analytics.logEvent(AppEvent.LAYOUT_CREATE);
  }, [promptForUnsavedChanges, layoutManager, onSelectLayout, analytics]);

  const appBarMenuItems = [
    {
      type: "item",
      key: "createNewLayout",
      label: t("createBlankLayout"),
      onClick: () => {
        void createNewLayout();
      },
    },
    {
      type: "item",
      key: "importFromFile",
      label: t("importFromFile"),
      onClick: () => {
        // layoutActions.importFromFile();
        setMenuOpen(false);
      },
    },
    { type: "divider" },
  ];

  const sortedRemoteLayouts = useMemo(() => {
    // return layouts.value?.shared.sort((a, b) => {
    //   // 计算优先级分数：isRecordRecommended 权重为 2，isProjectRecommended 权重为 1
    //   const priorityA = (a.isRecordRecommended ? 2 : 0) + (a.isProjectRecommended ? 1 : 0);
    //   const priorityB = (b.isRecordRecommended ? 2 : 0) + (b.isProjectRecommended ? 1 : 0);

    //   // 优先级高的排在前面
    //   return priorityB - priorityA;
    // });
    return layouts.value?.shared;
  }, [layouts.value?.shared]);

  // if current user project role is AUTHENTICATED_USER, all record and project recommended layouts is from public org
  const orgLayouts = useMemo(() => {
    if (currentUserRole.projectRole !== ProjectRoleWeight[ProjectRoleEnum.AUTHENTICATED_USER]) {
      return sortedRemoteLayouts;
    }

    return sortedRemoteLayouts; // todo: check
    // return sortedRemoteLayouts?.filter(
    //   (layout) => !layout.isProjectRecommended && !layout.isRecordRecommended,
    // );
  }, [currentUserRole.projectRole, sortedRemoteLayouts]);

  const publicLayouts = useMemo(() => {
    if (currentUserRole.projectRole !== ProjectRoleWeight[ProjectRoleEnum.AUTHENTICATED_USER]) {
      return [];
    }
    // return sortedRemoteLayouts?.filter(
    //   (layout) => layout.isProjectRecommended || layout.isRecordRecommended,
    // );
    return sortedRemoteLayouts; // todo: check
  }, [currentUserRole.projectRole, sortedRemoteLayouts]);

  return (
    <>
      <AppBarDropdownButton
        subheader={t("layout")}
        title={currentLayouts?.name ?? t("noLayouts")}
        selected={menuOpen}
        onClick={() => {
          setMenuOpen(!menuOpen);
        }}
        ref={anchorEl}
      />
      {promptModal}
      {unsavedChangesPrompt}
      {/* {layoutActions.unsavedChangesPrompt} */}
      <Menu
        id="add-panel-menu"
        anchorEl={anchorEl.current}
        open={menuOpen}
        onClose={() => {
          setMenuOpen(false);
        }}
        anchorOrigin={{
          horizontal: "right",
          vertical: "bottom",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        aria-labelledby="add-panel-menu"
        data-tourid="add-panel-menu"
        slotProps={{
          list: {
            className: classes.menuList,
            dense: true,
            disablePadding: true,
          },
        }}
      >
        <div className={cx(classes.toolbar, classes.toolbarMenu)}>
          <TextField
            fullWidth
            variant="filled"
            placeholder={t("searchPanels", { ns: "addPanel" })}
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={(event) => {
              event.stopPropagation();
            }}
            autoFocus
            data-testid="panel-list-textfield"
            slotProps={{
              input: {
                startAdornment: <SearchIcon fontSize="small" />,
                endAdornment: searchQuery && (
                  <IconButton
                    size="small"
                    edge="end"
                    onClick={() => {
                      setSearchQuery("");
                    }}
                  >
                    <CancelIcon fontSize="small" />
                  </IconButton>
                ),
              },
            }}
          />
        </div>
        {appBarMenuItems.map((item, idx) =>
          item.type === "divider" ? (
            <Divider key={`divider${idx}`} />
          ) : (
            <MuiMenuItem key={item.key} onClick={item.onClick}>
              {item.label}
            </MuiMenuItem>
          ),
        )}
        <Stack fullHeight gap={2} style={{ pointerEvents: pendingMultiAction ? "none" : "auto" }}>
          <LayoutSection
            title={layoutManager.supportsSharing ? t("personal") : undefined}
            emptyText={t("noPersonalLayouts")}
            items={layouts.value?.personal}
            anySelectedModifiedLayouts={anySelectedModifiedLayouts}
            multiSelectedIds={state.selectedIds}
            selectedId={currentLayoutId}
            onSelect={onSelectLayout}
            onRename={onRenameLayout}
            onDuplicate={onDuplicateLayout}
            onDelete={onDeleteLayout}
            onShare={onShareLayout}
            onExport={onExportLayout}
            onOverwrite={onOverwriteLayout}
            onRevert={onRevertLayout}
            onMakePersonalCopy={onMakePersonalCopy}
            searchQuery={searchQuery}
          />
          {layoutManager.supportsSharing && orgLayouts != undefined && orgLayouts.length > 0 && (
            <LayoutSection
              title={t("organization")}
              emptyText={t("noOrgnizationLayouts")}
              // Layout of top recommendations
              items={orgLayouts}
              anySelectedModifiedLayouts={anySelectedModifiedLayouts}
              multiSelectedIds={state.selectedIds}
              selectedId={currentLayoutId}
              onSelect={onSelectLayout}
              onRename={onRenameLayout}
              onDuplicate={onDuplicateLayout}
              onDelete={onDeleteLayout}
              onShare={onShareLayout}
              onExport={onExportLayout}
              onOverwrite={onOverwriteLayout}
              onRevert={onRevertLayout}
              onMakePersonalCopy={onMakePersonalCopy}
              searchQuery={searchQuery}
            />
          )}
          {layoutManager.supportsSharing &&
            publicLayouts != undefined &&
            publicLayouts.length > 0 && (
              <LayoutSection
                title={t("publicLayouts")}
                emptyText={t("noPublicLayouts")}
                items={publicLayouts}
                anySelectedModifiedLayouts={anySelectedModifiedLayouts}
                multiSelectedIds={state.selectedIds}
                selectedId={currentLayoutId}
                onSelect={onSelectLayout}
                onDuplicate={onDuplicateLayout}
                onShare={onShareLayout}
                onExport={onExportLayout}
                onMakePersonalCopy={onMakePersonalCopy}
                searchQuery={searchQuery}
              />
            )}
          <Stack flexGrow={1} />
        </Stack>
      </Menu>
    </>
  );
}
