// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "zustand";

type KeyboardShortcutsDialogStore = { open: boolean };

/**
 * App-wide open flag for the single keyboard shortcuts dialog. Triggers (toolbar button, ••• menu,
 * annotation canvas) only flip this flag, so the dialog is mounted once and can never open twice.
 */
export const useKeyboardShortcutsDialogStore = create<KeyboardShortcutsDialogStore>(() => ({
  open: false,
}));

export function openKeyboardShortcuts(): void {
  useKeyboardShortcutsDialogStore.setState({ open: true });
}

export function closeKeyboardShortcuts(): void {
  useKeyboardShortcutsDialogStore.setState({ open: false });
}
