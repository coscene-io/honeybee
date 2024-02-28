// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import CancelIcon from "@mui/icons-material/Cancel";
import SearchIcon from "@mui/icons-material/Search";
import {
  Menu,
  PaperProps,
  Divider,
  MenuItem as MuiMenuItem,
  IconButton,
  TextField,
} from "@mui/material";
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
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  LayoutState,
  useCurrentLayoutSelector,
  LayoutID,
  useCurrentLayoutActions,
} from "@foxglove/studio-base/context/CoSceneCurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CoSceneCurrentLayoutContext/actions";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import useCallbackWithToast from "@foxglove/studio-base/hooks/useCallbackWithToast";
import { usePrompt } from "@foxglove/studio-base/hooks/useCoScenePrompt";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { defaultPlaybackConfig } from "@foxglove/studio-base/providers/CoSceneCurrentLayoutProvider/reducers";
import { Layout, layoutIsShared } from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import { downloadTextFile } from "@foxglove/studio-base/util/download";

import LayoutSection from "./LayoutSection";
import SelectLayoutTemplateModal from "./SelectLayoutTemplateModal";

const log = Logger.getLogger(__filename);
const selectedLayoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;
const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;

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

export function CoSceneLayoutButton(): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const { classes, cx } = useStyles();
  const anchorEl = useRef<HTMLButtonElement>(ReactNull);
  const { t } = useTranslation("cosLayout");
  const [searchQuery, setSearchQuery] = useState("");
  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const query = event.target.value;
    setSearchQuery(query);
  }, []);
  const { layoutActions } = useWorkspaceActions();
  const currentLayoutId = useCurrentLayoutSelector(selectedLayoutIdSelector);
  const { enqueueSnackbar } = useSnackbar();
  const { unsavedChangesPrompt, openUnsavedChangesPrompt } = useUnsavedChangesPrompt();
  const { setSelectedLayoutId } = useCurrentLayoutActions();
  const analytics = useAnalytics();
  const [prompt, promptModal] = usePrompt();
  const [confirm, confirmModal] = useConfirm();
  const [selectLayoutTemplateModalOpen, setSelectLayoutTemplateModalOpen] = useState(false);

  const layoutManager = useLayoutManager();

  const consoleApi = useConsoleApi();

  const asyncBaseInfo = useBaseInfo(selectBaseInfo);
  const baseInfo = useMemo(() => asyncBaseInfo.value ?? {}, [asyncBaseInfo]);

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

  useEffect(() => {
    const listener = () => void reloadLayouts();
    layoutManager.on("change", listener);
    return () => {
      layoutManager.off("change", listener);
    };
  }, [layoutManager, reloadLayouts]);

  // Start loading on first mount
  useEffect(() => {
    reloadLayouts().catch((err) => {
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
              const layout = await layoutManager.getLayout(id as LayoutID);
              if (layout) {
                await layoutManager.saveNewLayout({
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

    processAction().catch((err) => {
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
      currentLayoutId != undefined ? await layoutManager.getLayout(currentLayoutId) : undefined;
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
      const name = await prompt({
        title: t("shareDialogTitle"),
        subText: t("shareDialogDescription"),
        initialValue: item.name,
        label: t("layoutName"),
      });
      if (name != undefined) {
        const newLayout = await layoutManager.saveNewLayout({
          name,
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
          title: `Update “${item.name}”?`,
          prompt:
            "Your changes will overwrite this layout for all organization members. This cannot be undone.",
          ok: "Save",
        });
        if (response !== "ok") {
          return;
        }
      }
      await layoutManager.overwriteLayout({ id: item.id });
      void analytics.logEvent(AppEvent.LAYOUT_OVERWRITE, { permission: item.permission });
    },
    [analytics, confirm, dispatch, layoutManager, state.selectedIds.length],
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
    const name = `Unnamed layout ${moment().format("l")} at ${moment().format("LT")}`;
    const layoutData: Omit<LayoutData, "name" | "id"> = {
      configById: {},
      globalVariables: {},
      userNodes: {},
      playbackConfig: defaultPlaybackConfig,
    };
    const newLayout = await layoutManager.saveNewLayout({
      name,
      data: layoutData as LayoutData,
      permission: "CREATOR_WRITE",
    });
    void onSelectLayout(newLayout);

    void analytics.logEvent(AppEvent.LAYOUT_CREATE);
  }, [promptForUnsavedChanges, layoutManager, onSelectLayout, analytics]);

  const onRecommendedToProjectLayout = useCallbackWithToast(
    async (item: Layout) => {
      const currentProjectId = baseInfo.projectId;
      const currentRecommendedLayouts = layouts.value?.shared
        .filter((layout) => layout.isProjectRecommended)
        .map((layout) => layout.id);
      if (currentRecommendedLayouts != undefined && currentProjectId != undefined) {
        if (item.isProjectRecommended) {
          const nextRecommendedLayouts = currentRecommendedLayouts.filter((id) => id !== item.id);
          await consoleApi.setProjectRecommendedLayouts(nextRecommendedLayouts, currentProjectId);
        } else {
          const nextRecommendedLayouts = [...currentRecommendedLayouts, item.id];
          await consoleApi.setProjectRecommendedLayouts(nextRecommendedLayouts, currentProjectId);
        }

        await layoutManager.updateLayout({ id: item.id });
      }
    },
    [baseInfo.projectId, consoleApi, layoutManager, layouts.value?.shared],
  );

  const onCopyToRecordDefaultLayout = useCallbackWithToast(
    async (item: Layout) => {
      const name = await prompt({
        title: t("copyToRecordDefaultLayoutTitle"),
        subText: t("copyToRecordDefaultLayoutDesc"),
        initialValue: item.name,
        label: t("layoutName"),
      });
      if (name != undefined) {
        const newLayout = await layoutManager.saveNewLayout({
          name,
          data: item.working?.data ?? item.baseline.data,
          permission: "ORG_WRITE",
          isRecordDefaultLayout: true,
        });
        void analytics.logEvent(AppEvent.LAYOUT_SHARE, { permission: item.permission });
        await onSelectLayout(newLayout);
      }
    },
    [analytics, t, layoutManager, onSelectLayout, prompt],
  );

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
        layoutActions.importFromFile();
        setMenuOpen(false);
      },
    },
    {
      type: "item",
      key: "CreateLayoutFromTemplate",
      label: t("createLayoutFromTemplate"),
      onClick: () => {
        setMenuOpen(false);
        setSelectLayoutTemplateModalOpen(true);
      },
    },
    { type: "divider" },
  ];

  const handleCloseLayoutTemplateModal = useCallback(() => {
    setSelectLayoutTemplateModalOpen(false);
  }, [setSelectLayoutTemplateModalOpen]);

  const handleSelectLayoutTemplate = async (layout: LayoutData, layoutName: string) => {
    setSelectLayoutTemplateModalOpen(false);
    const newLayout = await layoutManager.saveNewLayout({
      name: layoutName,
      data: layout,
      permission: "CREATOR_WRITE",
    });
    void onSelectLayout(newLayout);

    void analytics.logEvent(AppEvent.LAYOUT_CREATE);
  };

  return (
    <>
      <AppBarDropdownButton
        subheader={t("layout")}
        title={currentLayouts?.name ?? t("noLayouts")}
        selected={menuOpen}
        onClick={() => {
          setMenuOpen((open) => !open);
        }}
        ref={anchorEl}
      />
      {promptModal}
      {confirmModal}
      {unsavedChangesPrompt}
      <Menu
        id="add-panel-menu"
        anchorEl={anchorEl.current}
        open={menuOpen}
        onClose={() => {
          setMenuOpen(false);
        }}
        MenuListProps={{
          dense: true,
          disablePadding: true,
          "aria-labelledby": "add-panel-button",
          className: classes.menuList,
        }}
        anchorOrigin={{
          horizontal: "right",
          vertical: "bottom",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        PaperProps={
          {
            "data-tourid": "add-panel-menu",
          } as Partial<PaperProps & { "data-tourid"?: string }>
        }
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
            InputProps={{
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
            onCopyToRecordDefaultLayout={onCopyToRecordDefaultLayout}
          />
          {layoutManager.supportsSharing && (
            <LayoutSection
              title={t("organization")}
              emptyText={t("noOrgnizationLayouts")}
              // Layout of top recommendations
              items={layouts.value?.shared.sort((a) =>
                a.isRecordRecommended ? -2 : a.isProjectRecommended ? -1 : 1,
              )}
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
              onRecommendedToProjectLayout={onRecommendedToProjectLayout}
              onCopyToRecordDefaultLayout={onCopyToRecordDefaultLayout}
            />
          )}
          <Stack flexGrow={1} />
        </Stack>
      </Menu>
      <SelectLayoutTemplateModal
        open={selectLayoutTemplateModalOpen}
        onClose={handleCloseLayoutTemplateModal}
        onSelectedLayout={handleSelectLayoutTemplate}
      />
    </>
  );
}
