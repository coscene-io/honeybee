// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useState } from "react";
import { createStore } from "zustand";

import {
  CoSceneCurrentUserContext,
  UserStore,
  User,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";

function createCurrentUserStore() {
  return createStore<UserStore>((set) => ({
    user:
      localStorage.getItem("current_user") != undefined
        ? (JSON.parse(localStorage.getItem("current_user")!) as User)
        : undefined,
    role: {
      organizationRole: "ORGANIZATION_READER",
      projectRole: "PROJECT_READER",
    },
    setUser: (user) => {
      set({ user });
    },
    setRole: (organizationRole, projectRole) => {
      set({ role: { organizationRole, projectRole } });
    },
  }));
}

export default function CoSceneUserProvider({ children }: React.PropsWithChildren): JSX.Element {
  const [store] = useState(createCurrentUserStore);
  return (
    <CoSceneCurrentUserContext.Provider value={store}>
      {children}
    </CoSceneCurrentUserContext.Provider>
  );
}
