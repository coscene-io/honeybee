// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useState } from "react";
import { createStore } from "zustand";

import {
  CoSceneCurrentUserContext,
  OrganizationRoleEnum,
  OrganizationRoleWeight,
  ProjectRoleEnum,
  ProjectRoleWeight,
  UserStore,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";

function createCurrentUserStore() {
  const authToken = localStorage.getItem("coScene_org_jwt");

  return createStore<UserStore>((set) => ({
    user: undefined,
    role: {
      organizationRole: OrganizationRoleWeight[OrganizationRoleEnum.ORGANIZATION_READER],
      projectRole: ProjectRoleWeight[ProjectRoleEnum.ANONYMOUS_USER],
    },
    loginStatus: authToken != undefined ? "alreadyLogin" : "notLogin",
    setUser: (user) => {
      set({ user });
    },
    setRole: (organizationRole, projectRole) => {
      set({
        role: {
          organizationRole:
            organizationRole ?? OrganizationRoleWeight[OrganizationRoleEnum.ORGANIZATION_READER],
          projectRole: projectRole ?? ProjectRoleWeight[ProjectRoleEnum.ANONYMOUS_USER],
        },
      });
    },
    setLoginStatus: (loginStatus) => {
      set({ loginStatus });
    },
  }));
}

export default function CoSceneUserProvider({
  children,
  loginStatusKey,
}: React.PropsWithChildren<{ loginStatusKey?: number }>): React.JSX.Element {
  const [store] = useState(createCurrentUserStore);

  useEffect(() => {
    const authToken = localStorage.getItem("coScene_org_jwt");
    if (authToken != undefined) {
      store.setState({ loginStatus: "alreadyLogin" });
    } else {
      store.setState({ loginStatus: "notLogin" });
    }
  }, [loginStatusKey, store]);

  return (
    <CoSceneCurrentUserContext.Provider value={store}>
      {children}
    </CoSceneCurrentUserContext.Provider>
  );
}
