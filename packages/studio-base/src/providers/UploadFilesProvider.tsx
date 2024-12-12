// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ReactNode, useState } from "react";
import { createStore } from "zustand";

import {
  UploadFileInfo,
  UploadFilesContext,
  UploadFilesStore,
} from "@foxglove/studio-base/context/UploadFilesContext";

function createUploadFilesStore() {
  return createStore<UploadFilesStore>((set) => ({
    currentFile: undefined,
    uploadingFiles: {},
    setCurrentFile: (file: File | undefined) => {
      set({ currentFile: file });
    },
    setUpdateUploadingFiles: (name: string, info: UploadFileInfo) => {
      set((state) => ({ uploadingFiles: { ...state.uploadingFiles, [name]: info } }));
    },
  }));
}

export default function UploadFilesProvider({
  children,
}: {
  children?: ReactNode;
}): React.JSX.Element {
  const [store] = useState(createUploadFilesStore);

  return <UploadFilesContext.Provider value={store}>{children}</UploadFilesContext.Provider>;
}
