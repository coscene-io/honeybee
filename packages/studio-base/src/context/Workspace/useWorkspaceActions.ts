// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Draft, produce } from "immer";
import * as _ from "lodash-es";
import { Dispatch, SetStateAction, useCallback, useMemo } from "react";

import { useGuaranteedContext } from "@foxglove/hooks";
import { AppSettingsTab } from "@foxglove/studio-base/components/AppSettingsDialog/AppSettingsDialog";
import { DataSourceDialogItem } from "@foxglove/studio-base/components/DataSourceDialog";
import { TIMELINE_MIN_HEIGHT_PX } from "@foxglove/studio-base/components/PlaybackControls/constants";
import {
  IDataSourceFactory,
  usePlayerSelection,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import { PlaybackSpeed } from "@foxglove/studio-base/players/types";

import {
  LeftSidebarItemKey,
  LeftSidebarItemKeys,
  type MomentSubtitlePosition,
  RightSidebarItemKey,
  RightSidebarItemKeys,
  WorkspaceContext,
  WorkspaceContextStore,
} from "./WorkspaceContext";
import { SHARE_MANIFEST_PANEL_DEFAULTS } from "./shareManifestWorkspaceDefaults";
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

  layoutDrawer: {
    close: () => void;
    open: () => void;
  };

  playbackControlActions: {
    setRepeat: Dispatch<SetStateAction<boolean>>;
    setRollingEditEnabled: Dispatch<SetStateAction<boolean>>;
    setSpeed: Dispatch<SetStateAction<PlaybackSpeed>>;
    setTimelineHeight: Dispatch<SetStateAction<number>>;
    setMomentSubtitleEnabled: Dispatch<SetStateAction<boolean>>;
    setMomentSubtitleFontSize: Dispatch<SetStateAction<number>>;
    setMomentSubtitlePosition: Dispatch<SetStateAction<undefined | MomentSubtitlePosition>>;
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

  /**
   * Reset panel visibility + size to the share-manifest default layout: left and
   * right sidebars hidden, timeline panel at minimum height. Sidebar tab selection
   * and other playback settings are left untouched.
   */
  resetPanels: () => void;
};

function setterValue<T>(action: SetStateAction<T>, value: T): T {
  if (action instanceof Function) {
    return action(value);
  }

  return action;
}

/**
 * Provides various actions to manipulate the workspace state.
 */
export function useWorkspaceActions(): WorkspaceActions {
  const { setState } = useGuaranteedContext(WorkspaceContext);

  const { availableSources } = usePlayerSelection();

  const openFile = useOpenFile(availableSources);

  const set = useCallback(
    (setter: (draft: Draft<WorkspaceContextStore>) => void) => {
      setState(produce<WorkspaceContextStore>(setter));
    },
    [setState],
  );

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

      layoutDrawer: {
        close: () => {
          set((draft) => {
            draft.layoutDrawer.open = false;
          });
        },
        open: () => {
          set((draft) => {
            draft.layoutDrawer.open = true;
          });
        },
      },

      playbackControlActions: {
        setRepeat: (setter: SetStateAction<boolean>) => {
          set((draft) => {
            const repeat = setterValue(setter, draft.playbackControls.repeat);
            draft.playbackControls.repeat = repeat;
          });
        },
        setRollingEditEnabled: (setter: SetStateAction<boolean>) => {
          set((draft) => {
            const rollingEditEnabled = setterValue(
              setter,
              draft.playbackControls.rollingEditEnabled,
            );
            draft.playbackControls.rollingEditEnabled = rollingEditEnabled;
          });
        },
        setSpeed: (setter: SetStateAction<PlaybackSpeed>) => {
          set((draft) => {
            const speed = setterValue(setter, draft.playbackControls.speed);
            draft.playbackControls.speed = speed;
          });
        },
        setTimelineHeight: (setter: SetStateAction<number>) => {
          set((draft) => {
            const timelineHeight = setterValue(setter, draft.playbackControls.timelineHeight);
            draft.playbackControls.timelineHeight = timelineHeight;
          });
        },
        setMomentSubtitleEnabled: (setter: SetStateAction<boolean>) => {
          set((draft) => {
            const enabled = setterValue(setter, draft.playbackControls.momentSubtitle.enabled);
            draft.playbackControls.momentSubtitle.enabled = enabled;
          });
        },
        setMomentSubtitleFontSize: (setter: SetStateAction<number>) => {
          set((draft) => {
            const fontSize = setterValue(setter, draft.playbackControls.momentSubtitle.fontSize);
            draft.playbackControls.momentSubtitle.fontSize = fontSize;
          });
        },
        setMomentSubtitlePosition: (setter: SetStateAction<undefined | MomentSubtitlePosition>) => {
          set((draft) => {
            const position = setterValue(setter, draft.playbackControls.momentSubtitle.position);
            draft.playbackControls.momentSubtitle.position = position;
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

      resetPanels: () => {
        set((draft) => {
          // Single source of truth: every field is read from SHARE_MANIFEST_PANEL_DEFAULTS
          // so first-load defaults and reset can never diverge. Fallbacks satisfy the
          // DeepPartial typing but are never hit — the constant defines all of them.
          const { sidebars, playbackControls } = SHARE_MANIFEST_PANEL_DEFAULTS;

          draft.sidebars.left.open = sidebars?.left?.open ?? false;
          draft.sidebars.left.size = sidebars?.left?.size;
          draft.sidebars.right.open = sidebars?.right?.open ?? false;
          draft.sidebars.right.size = sidebars?.right?.size;
          draft.playbackControls.timelineHeight =
            playbackControls?.timelineHeight ?? TIMELINE_MIN_HEIGHT_PX;
        });
      },
    };
  }, [openFile, set]);
}
