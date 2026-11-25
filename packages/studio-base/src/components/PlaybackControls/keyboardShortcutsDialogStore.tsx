// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useCallback, useContext, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { createStore } from "zustand";
import type { StoreApi } from "zustand";

type KeyboardShortcutsDialogStore = { open: boolean };

export function createKeyboardShortcutsDialogStore(): StoreApi<KeyboardShortcutsDialogStore> {
  return createStore<KeyboardShortcutsDialogStore>(() => ({ open: false }));
}

export const KeyboardShortcutsDialogContext = createContext<
  StoreApi<KeyboardShortcutsDialogStore> | undefined
>(undefined);

/**
 * Owns the open flag of the single keyboard shortcuts dialog. Triggers (toolbar button, ••• menu,
 * annotation canvas) only flip this flag, so the dialog is mounted once and can never open twice.
 */
export function KeyboardShortcutsDialogProvider({
  children,
  store: provided,
}: {
  children?: ReactNode;
  /** Tests pass their own store to open or inspect the dialog. */
  store?: StoreApi<KeyboardShortcutsDialogStore>;
}): React.JSX.Element {
  const [owned] = useState(createKeyboardShortcutsDialogStore);
  return (
    <KeyboardShortcutsDialogContext.Provider value={provided ?? owned}>
      {children}
    </KeyboardShortcutsDialogContext.Provider>
  );
}

const noSubscribe = () => () => {};

/** Whether the dialog is open. Outside a provider there is no dialog: always closed. */
export function useKeyboardShortcutsDialogOpen(): boolean {
  const store = useContext(KeyboardShortcutsDialogContext);
  return useSyncExternalStore(
    store ? store.subscribe : noSubscribe,
    () => store?.getState().open ?? false,
  );
}

/** Stable callback that opens the dialog (does nothing outside a provider). */
export function useOpenKeyboardShortcuts(): () => void {
  const store = useContext(KeyboardShortcutsDialogContext);
  return useCallback(() => {
    store?.setState({ open: true });
  }, [store]);
}

/** Stable callback that closes the dialog (does nothing outside a provider). */
export function useCloseKeyboardShortcuts(): () => void {
  const store = useContext(KeyboardShortcutsDialogContext);
  return useCallback(() => {
    store?.setState({ open: false });
  }, [store]);
}
