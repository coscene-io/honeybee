// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { ReactNode, useState } from "react";
import { DeepPartial } from "ts-essentials";
import { StoreApi, createStore } from "zustand";
import { persist } from "zustand/middleware";

import {
  WorkspaceContext,
  WorkspaceContextStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { migrateV0WorkspaceState } from "@foxglove/studio-base/context/Workspace/migrations";

/**
 * Creates the default initial state for the workspace store.
 */
export function makeWorkspaceContextInitialState(): WorkspaceContextStore {
  return {
    dialogs: {
      dataSource: {
        activeDataSource: undefined,
        item: undefined,
        open: false,
      },
      preferences: {
        initialTab: undefined,
        open: false,
      },
    },
    featureTours: {
      active: undefined,
      shown: [],
    },
    sidebars: {
      left: {
        item: "playlist",
        open: true,
        size: undefined,
      },
      right: {
        item: undefined,
        open: false,
        size: undefined,
      },
    },
    playbackControls: {
      repeat: false,
      rollingEditEnabled: true,
      speed: 1,
      timelineHeight: 200,
      momentSubtitle: {
        enabled: false,
        fontSize: 16,
        position: undefined,
      },
    },
    layoutDrawer: {
      open: false,
    },
  };
}

function createWorkspaceContextStore(
  initialState?: DeepPartial<WorkspaceContextStore>,
  options?: { disablePersistence?: boolean },
): StoreApi<WorkspaceContextStore> {
  const stateCreator = () => {
    const store: WorkspaceContextStore = _.merge(
      {},
      makeWorkspaceContextInitialState(),
      initialState,
    );
    return store;
  };
  if (options?.disablePersistence === true) {
    return createStore<WorkspaceContextStore>()(stateCreator);
  }
  return createStore<WorkspaceContextStore>()(
    persist(stateCreator, {
      name: "fox.workspace",
      version: 1,
      migrate: migrateV0WorkspaceState,
      partialize: (state) => {
        // Note that this is an opt-in list of keys from the store that we
        // include and restore when persisting to and from localStorage.
        return _.pick(state, ["featureTours", "playbackControls", "sidebars"]);
      },
      merge(persistedState, currentState) {
        // Use a deep merge to ensure that defaults are filled in for nested values if the values
        // were not present in localStorage.
        return _.merge(currentState, persistedState);
      },
    }),
  );
}

export type WorkspaceContextProviderProps = {
  children?: ReactNode;
  disablePersistence?: boolean;
  initialState?: DeepPartial<WorkspaceContextStore>;
  workspaceStoreCreator?: (
    initialState?: DeepPartial<WorkspaceContextStore>,
    options?: { disablePersistence?: boolean },
  ) => StoreApi<WorkspaceContextStore>;
};

export default function WorkspaceContextProvider(
  props: WorkspaceContextProviderProps,
): React.JSX.Element {
  const { children, initialState, workspaceStoreCreator, disablePersistence } = props;

  const [store] = useState(() =>
    workspaceStoreCreator
      ? workspaceStoreCreator(initialState, { disablePersistence })
      : createWorkspaceContextStore(initialState, { disablePersistence }),
  );

  return <WorkspaceContext.Provider value={store}>{children}</WorkspaceContext.Provider>;
}
