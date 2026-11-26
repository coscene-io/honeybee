// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { createStore } from "zustand";
import type { StoreApi } from "zustand";

import type { SidebarItem } from "@foxglove/studio-base/components/Sidebars";
import type { LeftSidebarItemKey } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";

/**
 * Extension points that let a feature add to shared workspace chrome (app bar, playback bar,
 * keyboard shortcuts dialog, moment fields) without the shared code importing the feature.
 *
 * A feature registers while it is mounted (`useWorkspaceSlot`); shared code reads the slot and
 * falls back to its own behavior when nothing is registered. The slots live in a store created by
 * `WorkspaceSlotsProvider` and reached through React context; without a provider nothing can be
 * registered and every slot reads as empty.
 */

export type PlaybackStepModifiers = { altKey: boolean; shiftKey: boolean };

/**
 * Replaces the playback bar's back/forward step, e.g. to step one camera's frames while
 * annotating. `step` returns `{ handled: true }` when it took over, or the modifiers for the
 * player's own time step otherwise.
 */
export type PlaybackStepOverride = {
  /** Tooltip label for the backward / forward buttons. */
  backwardLabel: string;
  forwardLabel: string;
  step: (
    direction: 1 | -1,
    modifiers: PlaybackStepModifiers | undefined,
    seek: (logTimeNs: bigint) => void,
    clockNs: bigint,
    /** False after another seek or a player change invalidates this step. */
    isPlaybackCurrent: () => boolean,
  ) => { handled: true } | { handled: false; modifiers: PlaybackStepModifiers | undefined };
};

export type ShortcutRow = { label: string; keys: readonly string[] };
export type ShortcutSection = { title: string; rows: readonly ShortcutRow[] };
/** An extra column in the keyboard shortcuts dialog. */
export type ShortcutColumn = { title: string; sections: readonly ShortcutSection[] };

/** Renders a moment metadata value, or returns undefined to keep the default rendering. */
export type MomentValueRenderer = (props: {
  value: string;
  highlight?: string;
}) => React.ReactNode | undefined;

/** An end adornment for a moment metadata value field. */
export type MomentValueAdornment = React.ComponentType<{
  /** The record that is actually open; undefined when none is. */
  recordName?: string;
  value: string;
  onChange: (value: string) => void;
}>;

/** A left sidebar tab, shown after the built-in Moment tab. */
export type LeftSidebarSlotItem = { key: LeftSidebarItemKey; item: SidebarItem };

export type Slots = {
  appBarItems: Readonly<Record<string, React.ComponentType>>;
  leftSidebarItems: Readonly<Record<string, LeftSidebarSlotItem>>;
  playbackStep: Readonly<Record<string, PlaybackStepOverride>>;
  shortcutColumns: Readonly<Record<string, ShortcutColumn>>;
  momentValueRenderers: Readonly<Record<string, MomentValueRenderer>>;
  momentValueAdornments: Readonly<Record<string, MomentValueAdornment>>;
};

export type WorkspaceSlotName = keyof Slots;

export function createWorkspaceSlotsStore(): StoreApi<Slots> {
  return createStore<Slots>(() => ({
    appBarItems: {},
    leftSidebarItems: {},
    playbackStep: {},
    shortcutColumns: {},
    momentValueRenderers: {},
    momentValueAdornments: {},
  }));
}

export const WorkspaceSlotsContext = createContext<StoreApi<Slots> | undefined>(undefined);

/** Owns the slot registry for everything below it (the Workspace mounts one). */
export function WorkspaceSlotsProvider({
  children,
  store: provided,
}: {
  children?: ReactNode;
  /** Tests pass their own store to inspect what was registered. */
  store?: StoreApi<Slots>;
}): React.JSX.Element {
  const [owned] = useState(createWorkspaceSlotsStore);
  return (
    <WorkspaceSlotsContext.Provider value={provided ?? owned}>
      {children}
    </WorkspaceSlotsContext.Provider>
  );
}

/** The slot store, or undefined outside a `WorkspaceSlotsProvider`. */
export function useWorkspaceSlotsStore(): StoreApi<Slots> | undefined {
  return useContext(WorkspaceSlotsContext);
}

/**
 * Registers `value` under `id` in `slot`; the returned function removes it again.
 *
 * Slots read back in registration order. Objects list integer-like keys first in numeric order, so
 * such ids are rejected rather than silently reordered.
 */
export function registerWorkspaceSlot<K extends WorkspaceSlotName>(
  store: StoreApi<Slots>,
  slot: K,
  id: string,
  value: Slots[K][string],
): () => void {
  if (/^(0|[1-9]\d*)$/.test(id)) {
    throw new Error(`Workspace slot id "${id}" must not be an integer`);
  }
  store.setState((slots) => ({ [slot]: { ...slots[slot], [id]: value } }));
  return () => {
    store.setState((slots) => {
      if (slots[slot][id] !== value) {
        return {};
      }
      const { [id]: _removed, ...rest } = slots[slot];
      return { [slot]: rest };
    });
  };
}

/** Keeps `value` registered under `id` while the calling component is mounted. */
export function useWorkspaceSlot<K extends WorkspaceSlotName>(
  slot: K,
  id: string,
  value: Slots[K][string] | undefined,
): void {
  const store = useWorkspaceSlotsStore();
  useEffect(
    () =>
      store == undefined || value == undefined
        ? undefined
        : registerWorkspaceSlot(store, slot, id, value),
    [store, slot, id, value],
  );
}

const NO_ENTRIES: Readonly<Record<string, never>> = Object.freeze({});
const noSubscribe = () => () => {};

/** The registered `[id, value]` pairs of one slot, in registration order. */
export function useWorkspaceSlotEntries<K extends WorkspaceSlotName>(
  slot: K,
): [string, Slots[K][string]][] {
  const store = useWorkspaceSlotsStore();
  const entries = useSyncExternalStore(store ? store.subscribe : noSubscribe, () =>
    store ? store.getState()[slot] : NO_ENTRIES,
  );
  return useMemo(() => Object.entries(entries) as [string, Slots[K][string]][], [entries]);
}

/** The registered values of one slot, in registration order. */
export function useWorkspaceSlotValues<K extends WorkspaceSlotName>(slot: K): Slots[K][string][] {
  const entries = useWorkspaceSlotEntries(slot);
  return useMemo(() => entries.map(([, value]) => value), [entries]);
}
