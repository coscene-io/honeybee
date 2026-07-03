// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { ReactNode, useContext, useRef } from "react";
import { DeepPartial } from "ts-essentials";
import { StoreApi, createStore, useStore } from "zustand";
import { persist } from "zustand/middleware";

import { CoreDataContext, CoreDataStore } from "@foxglove/studio-base/context/CoreDataContext";
import {
  WorkspaceContext,
  WorkspaceContextStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { migrateV0WorkspaceState } from "@foxglove/studio-base/context/Workspace/migrations";
import {
  SHARE_MANIFEST_PANEL_DEFAULTS,
  SHARE_MANIFEST_WORKSPACE_PERSIST_KEY,
} from "@foxglove/studio-base/context/Workspace/shareManifestWorkspaceDefaults";
import {
  SHARE_MANIFEST_DATA_SOURCE_ID,
  windowIsShareManifestMode,
} from "@foxglove/studio-base/util/shareManifest";

/**
 * Which data-source-scoped workspace preference store to use. `coscene-share-manifest`
 * gets its own isolated store; every other data source shares the normal store.
 */
type WorkspaceStoreKind = "normal" | "shareManifest";

const NORMAL_WORKSPACE_PERSIST_KEY = "fox.workspace";

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
  options?: { disablePersistence?: boolean; kind?: WorkspaceStoreKind },
): StoreApi<WorkspaceContextStore> {
  // The `coscene-share-manifest` store gets its own default panel layout (sidebars
  // hidden, timeline at minimum height) and its own persistence key, so a share
  // viewer's panel/playback adjustments persist independently and never mutate the
  // normal-mode `fox.workspace` store (and vice versa).
  const shareManifestMode = options?.kind === "shareManifest";
  const stateCreator = () => {
    const store: WorkspaceContextStore = _.merge(
      {},
      makeWorkspaceContextInitialState(),
      shareManifestMode ? SHARE_MANIFEST_PANEL_DEFAULTS : undefined,
      initialState,
    );
    return store;
  };
  if (options?.disablePersistence === true) {
    return createStore<WorkspaceContextStore>()(stateCreator);
  }
  return createStore<WorkspaceContextStore>()(
    persist(stateCreator, {
      name: shareManifestMode ? SHARE_MANIFEST_WORKSPACE_PERSIST_KEY : NORMAL_WORKSPACE_PERSIST_KEY,
      version: 1,
      migrate: migrateV0WorkspaceState,
      partialize: (state) => {
        // Note that this is an opt-in list of keys from the store that we
        // include and restore when persisting to and from localStorage. Because each
        // data-source-scoped store persists under its own key, this whole slice
        // (sidebars, playbackControls, featureTours) is isolated per store.
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

/**
 * Reads the active data source id from CoreDataContext when present. Returns undefined
 * when there is no CoreDataProvider ancestor (e.g. isolated unit tests / storybook), so
 * this provider stays usable standalone.
 */
// Only `dataSource` is ever read from this fallback; the rest of CoreDataStore is
// intentionally absent (this store exists solely so `useStore` has something to read
// when there is no CoreDataProvider).
const EMPTY_CORE_DATA_STORE = createStore<CoreDataStore>()(
  () => ({ dataSource: undefined }) as CoreDataStore,
);

const selectDataSourceId = (state: CoreDataStore): string | undefined => state.dataSource?.id;

function useActiveDataSourceId(): string | undefined {
  const coreDataStore = useContext(CoreDataContext);
  return useStore(coreDataStore ?? EMPTY_CORE_DATA_STORE, selectDataSourceId);
}

/**
 * Resolves which data-source-scoped store kind is active. Prefers the resolved data
 * source id; before a data source has been selected (startup), falls back to the URL so
 * a share-manifest tab uses the isolated store immediately and never touches
 * `fox.workspace`.
 */
function resolveStoreKind(dataSourceId: string | undefined): WorkspaceStoreKind {
  if (dataSourceId != undefined) {
    return dataSourceId === SHARE_MANIFEST_DATA_SOURCE_ID ? "shareManifest" : "normal";
  }
  return windowIsShareManifestMode() ? "shareManifest" : "normal";
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

  // Bind the workspace preference store to the ACTIVE data source type rather than
  // choosing once at mount. `coscene-share-manifest` uses an isolated store; all other
  // data sources share the normal store. Switching data source within the same tab
  // swaps which cached store is active — each kind keeps its own persisted state, so a
  // share session never inherits (or overwrites) normal-mode preferences and vice versa.
  const kind = resolveStoreKind(useActiveDataSourceId());

  // One store per kind, created lazily on first activation and cached for the lifetime
  // of this provider. A never-activated kind is never created, so e.g. a pure
  // share-manifest tab never reads or writes `fox.workspace`.
  const storesRef = useRef<Map<WorkspaceStoreKind, StoreApi<WorkspaceContextStore>>>(new Map());
  let store = storesRef.current.get(kind);
  if (store == undefined) {
    store = workspaceStoreCreator
      ? workspaceStoreCreator(initialState, { disablePersistence })
      : createWorkspaceContextStore(initialState, { disablePersistence, kind });
    storesRef.current.set(kind, store);
  }

  return <WorkspaceContext.Provider value={store}>{children}</WorkspaceContext.Provider>;
}
