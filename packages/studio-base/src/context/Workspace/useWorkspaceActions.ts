// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Draft, produce } from "immer";
import * as _ from "lodash-es";
import { useSnackbar } from "notistack";
import path from "path";
import { Dispatch, SetStateAction, useCallback, useMemo } from "react";
import { useMountedState } from "react-use";
import useAsyncFn from "react-use/lib/useAsyncFn";

import { useGuaranteedContext } from "@foxglove/hooks";
import { AppSettingsTab } from "@foxglove/studio-base/components/AppSettingsDialog/AppSettingsDialog";
import { useUnsavedChangesPrompt } from "@foxglove/studio-base/components/CoSceneLayoutBrowser/CoSceneUnsavedChangesPrompt";
import { useLayoutBrowserReducer } from "@foxglove/studio-base/components/CoSceneLayoutBrowser/coSceneReducer";
import { DataSourceDialogItem } from "@foxglove/studio-base/components/DataSourceDialog";
import { useAnalytics } from "@foxglove/studio-base/context/AnalyticsContext";
import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CoSceneCurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CoSceneCurrentLayoutContext/actions";
import { useLayoutManager } from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import {
  IDataSourceFactory,
  usePlayerSelection,
} from "@foxglove/studio-base/context/CoScenePlayerSelectionContext";
import useCallbackWithToast from "@foxglove/studio-base/hooks/useCallbackWithToast";
import { Layout, layoutIsShared } from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import { AppEvent } from "@foxglove/studio-base/services/IAnalytics";
import { downloadTextFile } from "@foxglove/studio-base/util/download";
import showOpenFilePicker from "@foxglove/studio-base/util/showOpenFilePicker";
import { Immutable } from "@foxglove/studio";

import {
  WorkspaceContext,
  WorkspaceContextStore,
  LeftSidebarItemKey,
  LeftSidebarItemKeys,
  RightSidebarItemKey,
  RightSidebarItemKeys,
  SessionProblem,
} from "./WorkspaceContext";
import { useOpenFile } from "./useOpenFile";

export type WorkspaceActions = {
  dialogActions: {
    dataSource: {
      close: () => void;
      open: (item: DataSourceDialogItem, dataSource?: IDataSourceFactory) => void;
    };
    openFile: {
      open: () => Promise<void>;
    };
    preferences: {
      close: () => void;
      open: (initialTab?: AppSettingsTab) => void;
    };
  };

  featureTourActions: {
    startTour: (tour: string) => void;
    finishTour: (tour: string) => void;
  };

  openPanelSettings: () => void;

  playbackControlActions: {
    setRepeat: Dispatch<SetStateAction<boolean>>;
  };

  sessionActions: {
    clearProblem: (tag: string) => void;
    setProblem: (tag: string, problem: Immutable<SessionProblem>) => void;
  };

  sidebarActions: {
    left: {
      selectItem: (item: undefined | LeftSidebarItemKey) => void;
      setOpen: Dispatch<SetStateAction<boolean>>;
      setSize: (size: undefined | number) => void;
    };
    right: {
      selectItem: (item: undefined | RightSidebarItemKey) => void;
      setOpen: Dispatch<SetStateAction<boolean>>;
      setSize: (size: undefined | number) => void;
    };
  };

  layoutActions: {
    // Open a dialog for the user to select a layout file to import
    // This will replace the current layout with the imported layout
    importFromFile: () => void;
    // Export the current layout to a file
    // This will perform a browser download of the current layout to a file
    exportToFile: (layout: Layout) => void;
  };
};

function setterValue<T>(action: SetStateAction<T>, value: T): T {
  if (action instanceof Function) {
    return action(value);
  }

  return action;
}

const selectedLayoutIdSelector = (state: LayoutState) => state.selectedLayout?.id;

/**
 * Provides various actions to manipulate the workspace state.
 */
export function useWorkspaceActions(): WorkspaceActions {
  const { setState } = useGuaranteedContext(WorkspaceContext);
  const layoutManager = useLayoutManager();
  const { openUnsavedChangesPrompt } = useUnsavedChangesPrompt();
  const currentLayoutId = useCurrentLayoutSelector(selectedLayoutIdSelector);
  const { enqueueSnackbar } = useSnackbar();
  const { setSelectedLayoutId } = useCurrentLayoutActions();
  const [, dispatch] = useLayoutBrowserReducer({
    lastSelectedId: currentLayoutId,
    busy: layoutManager.isBusy,
    error: layoutManager.error,
    online: layoutManager.isOnline,
  });

  const { availableSources } = usePlayerSelection();

  const analytics = useAnalytics();

  const isMounted = useMountedState();
  // const { getCurrentLayoutState, setCurrentLayout } = useCurrentLayoutActions();

  const openFile = useOpenFile(availableSources);

  const set = useCallback(
    (setter: (draft: Draft<WorkspaceContextStore>) => void) => {
      setState(produce<WorkspaceContextStore>(setter));
    },
    [setState],
  );

  const [layouts] = useAsyncFn(
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

  const onExportLayout = useCallbackWithToast(
    async (item: Layout) => {
      const content = JSON.stringify(item.working?.data ?? item.baseline.data, undefined, 2) ?? "";
      downloadTextFile(content, `${item.name}.json`);
      void analytics.logEvent(AppEvent.LAYOUT_EXPORT, { permission: item.permission });
    },
    [analytics],
  );

  const importLayout = useCallbackWithToast(async () => {
    if (!(await promptForUnsavedChanges())) {
      return;
    }
    const fileHandles = await showOpenFilePicker({
      multiple: true,
      excludeAcceptAllOption: false,
      types: [
        {
          description: "JSON Files",
          accept: {
            "application/json": [".json"],
          },
        },
      ],
    });
    if (fileHandles.length === 0) {
      return;
    }

    const newLayouts = await Promise.all(
      fileHandles.map(async (fileHandle) => {
        const file = await fileHandle.getFile();
        const layoutName = path.basename(file.name, path.extname(file.name));
        const content = await file.text();

        if (!isMounted()) {
          return;
        }

        let parsedState: unknown;
        try {
          parsedState = JSON.parse(content);
        } catch (err) {
          enqueueSnackbar(`${file.name} is not a valid layout: ${err.message}`, {
            variant: "error",
          });
          return;
        }

        if (typeof parsedState !== "object" || !parsedState) {
          enqueueSnackbar(`${file.name} is not a valid layout`, { variant: "error" });
          return;
        }

        const data = parsedState as LayoutData;
        const newLayout = await layoutManager.saveNewLayout({
          name: layoutName,
          data,
          permission: "CREATOR_WRITE",
        });
        return newLayout;
      }),
    );

    if (!isMounted()) {
      return;
    }
    const newLayout = newLayouts.find((layout) => layout != undefined);
    if (newLayout) {
      void onSelectLayout(newLayout);
    }
    void analytics.logEvent(AppEvent.LAYOUT_IMPORT, { numLayouts: fileHandles.length });
  }, [
    analytics,
    enqueueSnackbar,
    isMounted,
    layoutManager,
    onSelectLayout,
    promptForUnsavedChanges,
  ]);

  // const exportAction = useCallback(() => onExportLayout(layout), [layout, onExport]);

  return useMemo(() => {
    return {
      dialogActions: {
        dataSource: {
          close: () => {
            set((draft) => {
              draft.dialogs.dataSource = {
                activeDataSource: undefined,
                item: undefined,
                open: false,
              };
            });
          },

          open: (
            selectedDataSourceDialogItem: DataSourceDialogItem,
            dataSource?: IDataSourceFactory,
          ) => {
            set((draft) => {
              // This cast is necessary to keep typescript from complaining about type depth.
              (draft as WorkspaceContextStore).dialogs.dataSource.activeDataSource = dataSource;
              draft.dialogs.dataSource.item = selectedDataSourceDialogItem;
              draft.dialogs.dataSource.open = true;
            });
          },
        },

        openFile: {
          open: openFile,
        },

        preferences: {
          close: () => {
            set((draft) => {
              draft.dialogs.preferences = { open: false, initialTab: undefined };
            });
          },
          open: (initialTab?: AppSettingsTab) => {
            set((draft) => {
              draft.dialogs.preferences = { open: true, initialTab };
            });
          },
        },
      },

      featureTourActions: {
        startTour: (tour: string) => {
          set((draft) => {
            draft.featureTours.active = tour;
          });
        },
        finishTour: (tour: string) => {
          set((draft) => {
            draft.featureTours.active = undefined;
            draft.featureTours.shown = _.union(draft.featureTours.shown, [tour]);
          });
        },
      },

      openPanelSettings: () => {
        set((draft) => {
          draft.sidebars.left.item = "panel-settings";
          draft.sidebars.left.open = true;
        });
      },

      playbackControlActions: {
        setRepeat: (setter: SetStateAction<boolean>) => {
          set((draft) => {
            const repeat = setterValue(setter, draft.playbackControls.repeat);
            draft.playbackControls.repeat = repeat;
          });
        },
      },

      sessionActions: {
        clearProblem: (tag: string) => {
          set((draft) => {
            draft.session.problems = draft.session.problems.filter((prob) => prob.tag !== tag);
          });
        },

        setProblem: (tag: string, problem: Immutable<SessionProblem>) => {
          set((draft) => {
            draft.session.problems = draft.session.problems.filter((prob) => prob.tag !== tag);
            draft.session.problems.unshift(problem);
          });
        },
      },

      sidebarActions: {
        left: {
          selectItem: (selectedLeftSidebarItem: undefined | LeftSidebarItemKey) => {
            set((draft) => {
              draft.sidebars.left.item = selectedLeftSidebarItem;
              draft.sidebars.left.open = selectedLeftSidebarItem != undefined;
            });
          },

          setOpen: (setter: SetStateAction<boolean>) => {
            set((draft) => {
              const leftSidebarOpen = setterValue(setter, draft.sidebars.left.open);
              if (leftSidebarOpen) {
                const oldItem = LeftSidebarItemKeys.find(
                  (item) => item === draft.sidebars.left.item,
                );
                draft.sidebars.left.open = leftSidebarOpen;
                draft.sidebars.left.item = oldItem ?? "panel-settings";
              } else {
                draft.sidebars.left.open = false;
              }
            });
          },

          setSize: (leftSidebarSize: undefined | number) => {
            set((draft) => {
              draft.sidebars.left.size = leftSidebarSize;
            });
          },
        },
        right: {
          selectItem: (selectedRightSidebarItem: undefined | RightSidebarItemKey) => {
            set((draft) => {
              draft.sidebars.right.item = selectedRightSidebarItem;
              draft.sidebars.right.open = selectedRightSidebarItem != undefined;
            });
          },

          setOpen: (setter: SetStateAction<boolean>) => {
            set((draft) => {
              const rightSidebarOpen = setterValue(setter, draft.sidebars.right.open);
              const oldItem = RightSidebarItemKeys.find(
                (item) => item === draft.sidebars.right.item,
              );
              if (rightSidebarOpen) {
                draft.sidebars.right.open = rightSidebarOpen;
                draft.sidebars.right.item = oldItem ?? "variables";
              } else {
                draft.sidebars.right.open = false;
              }
            });
          },

          setSize: (rightSidebarSize: undefined | number) => {
            set((draft) => {
              draft.sidebars.right.size = rightSidebarSize;
            });
          },
        },
      },

      layoutActions: {
        importFromFile: importLayout,
        exportToFile: onExportLayout,
      },
    };
  }, [onExportLayout, importLayout, openFile, set]);
}
