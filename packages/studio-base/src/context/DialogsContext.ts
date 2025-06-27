// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { createContext } from "react";
import { StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";

export type Dialog = {
  dialogs: Map<string, React.ReactNode>;
  addDialog: ({ key, dialog }: { key: string; dialog: React.ReactNode }) => void;
  removeDialog: ({ key }: { key: string }) => void;
};

export type DialogsStore = {
  dialogs: Map<string, React.ReactNode>;
  addDialog: ({ key, dialog }: { key: string; dialog: React.ReactNode }) => void;
  removeDialog: ({ key }: { key: string }) => void;
};

export const DialogsContext = createContext<undefined | StoreApi<DialogsStore>>(undefined);

export function useDialogs<T>(selector: (store: DialogsStore) => T): T {
  const context = useGuaranteedContext(DialogsContext);
  return useStore(context, selector);
}
