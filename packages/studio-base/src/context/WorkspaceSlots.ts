// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo } from "react";
import { create } from "zustand";

import type { SidebarItem } from "@foxglove/studio-base/components/Sidebars";
import type { LeftSidebarItemKey } from "@foxglove/studio-base/context/Workspace/WorkspaceContext";

/**
 * Extension points that let a feature add to shared workspace chrome (app bar, playback bar,
 * keyboard shortcuts dialog) without the shared code importing the feature.
 *
 * A feature registers while it is mounted (`useWorkspaceSlot`); shared code reads the slot and
 * falls back to its own behavior when nothing is registered.
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
  ) => { handled: true } | { handled: false; modifiers: PlaybackStepModifiers | undefined };
};

export type ShortcutRow = { label: string; keys: readonly string[] };
export type ShortcutSection = { title: string; rows: readonly ShortcutRow[] };
/** An extra column in the keyboard shortcuts dialog. */
export type ShortcutColumn = { title: string; sections: readonly ShortcutSection[] };

/** A left sidebar tab, shown after the built-in Moment tab. */
export type LeftSidebarSlotItem = { key: LeftSidebarItemKey; item: SidebarItem };

type Slots = {
  appBarItems: Readonly<Record<string, React.ComponentType>>;
  leftSidebarItems: Readonly<Record<string, LeftSidebarSlotItem>>;
  playbackStep: Readonly<Record<string, PlaybackStepOverride>>;
  shortcutColumns: Readonly<Record<string, ShortcutColumn>>;
};

export type WorkspaceSlotName = keyof Slots;

export const useWorkspaceSlots = create<Slots>(() => ({
  appBarItems: {},
  leftSidebarItems: {},
  playbackStep: {},
  shortcutColumns: {},
}));

/** Registers `value` under `id` in `slot`; an undefined value registers nothing. */
export function registerWorkspaceSlot<K extends WorkspaceSlotName>(
  slot: K,
  id: string,
  value: Slots[K][string],
): () => void {
  useWorkspaceSlots.setState((slots) => ({ [slot]: { ...slots[slot], [id]: value } }));
  return () => {
    useWorkspaceSlots.setState((slots) => {
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
  useEffect(
    () => (value == undefined ? undefined : registerWorkspaceSlot(slot, id, value)),
    [slot, id, value],
  );
}

/** The registered entries of one slot, in registration order. */
export function useWorkspaceSlotValues<K extends WorkspaceSlotName>(slot: K): Slots[K][string][] {
  const entries = useWorkspaceSlots((slots) => slots[slot]);
  return useMemo(() => Object.values(entries) as Slots[K][string][], [entries]);
}
