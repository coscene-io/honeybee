// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useState } from "react";
import { createStore } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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

  return createStore<UserStore>()(
    persist(
      (set) => ({
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
                organizationRole ??
                OrganizationRoleWeight[OrganizationRoleEnum.ORGANIZATION_READER],
              projectRole: projectRole ?? ProjectRoleWeight[ProjectRoleEnum.ANONYMOUS_USER],
            },
          });
        },
        setLoginStatus: (loginStatus) => {
          set({ loginStatus });
        },
      }),
      {
        // 持久化配置
        name: "user-storage", // 存储的键名
        storage: createJSONStorage(() => localStorage), // 使用 localStorage
        // 可选：只持久化特定字段
        partialize: (state) => ({
          user: { ...state.user, avatarUrl: undefined },
          role: state.role,
          loginStatus: state.loginStatus,
        }),
      },
    ),
  );
}

export default function CoSceneCurrentUserProvider({
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
