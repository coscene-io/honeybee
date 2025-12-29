// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { createStore } from "zustand";

import {
  CoSceneCurrentUserContext,
  UserStore,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";

const coSceneUserStore = createStore<UserStore>((set) => ({
  loginStatus: "alreadyLogin",
  user: {
    userId: "mock-user",
    nickName: "Mock User",
    avatarUrl: "",
    phoneNumber: "",
    agreedAgreement: "",
    role: "",
    email: "mock@example.com",
    targetSite: "",
  },
  role: { organizationRole: 0, projectRole: 0 },
  setUser: (user) => {
    set({ user });
  },
  setRole: (organizationRole = 0, projectRole = 0) => {
    set({ role: { organizationRole, projectRole } });
  },
  setLoginStatus: (loginStatus) => {
    set({ loginStatus });
  },
}));

function MockCoSceneCurrentUserProvider({ children }: React.PropsWithChildren): React.JSX.Element {
  return (
    <CoSceneCurrentUserContext.Provider value={coSceneUserStore}>
      {children}
    </CoSceneCurrentUserContext.Provider>
  );
}

export default MockCoSceneCurrentUserProvider;
