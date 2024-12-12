// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ReactNode, useState } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { createStore } from "zustand";

import {
  CoSceneBaseStore,
  BaseInfo,
  CoSceneBaseContext,
} from "@foxglove/studio-base/context/CoSceneBaseContext";

function CreateBaseStore() {
  return createStore<CoSceneBaseStore>((set) => ({
    baseInfo: { loading: false, value: {} },
    setBaseInfo: (baseInfo: AsyncState<BaseInfo>) => {
      set({ baseInfo });
    },
  }));
}

export default function CoSceneBaseProvider({
  children,
}: {
  children?: ReactNode;
}): React.JSX.Element {
  const [store] = useState(CreateBaseStore);

  return <CoSceneBaseContext.Provider value={store}>{children}</CoSceneBaseContext.Provider>;
}
