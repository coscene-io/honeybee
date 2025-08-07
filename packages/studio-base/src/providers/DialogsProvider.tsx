// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ReactNode, useState } from "react";
import { createStore } from "zustand";

import { DialogsStore, DialogsContext } from "@foxglove/studio-base/context/DialogsContext";

function CreateDialogsStore() {
  return createStore<DialogsStore>((set, get) => ({
    dialogs: new Map(),
    addDialog: ({ key, dialog }) => {
      const currentDialogs = get().dialogs;
      const newDialogs = new Map(currentDialogs);
      newDialogs.set(key, dialog);
      set({ dialogs: newDialogs });
    },
    removeDialog: ({ key }) => {
      const currentDialogs = get().dialogs;
      const newDialogs = new Map(currentDialogs);
      newDialogs.delete(key);
      set({ dialogs: newDialogs });
    },
  }));
}

export default function DialogsProvider({ children }: { children?: ReactNode }): React.JSX.Element {
  const [store] = useState(CreateDialogsStore);

  return <DialogsContext.Provider value={store}>{children}</DialogsContext.Provider>;
}
