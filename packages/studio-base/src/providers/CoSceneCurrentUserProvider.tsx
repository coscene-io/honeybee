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
  User,
  UserStore,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { getBrowserSession } from "@foxglove/studio-base/util/browserSession";
import {
  getDesktopSession,
  subscribeDesktopSession,
} from "@foxglove/studio-base/util/desktopSession";

function getLoginStatus(): UserStore["loginStatus"] {
  const desktop = getDesktopSession();
  if (desktop != undefined) {
    return desktop.credential ? "alreadyLogin" : "notLogin";
  }
  const session = getBrowserSession();
  if (session != undefined) {
    return session.credential && session.getStatus() === "current" ? "alreadyLogin" : "notLogin";
  }
  return localStorage.getItem("coScene_org_jwt") != undefined ? "alreadyLogin" : "notLogin";
}

type PersistedUserStore = Pick<UserStore, "role"> & {
  user: (Omit<User, "avatarUrl"> & { avatarUrl?: string }) | undefined;
};

function mergePersistedUserStore(persistedState: unknown, currentState: UserStore): UserStore {
  // Active sessions verify their identity before initializing protected data. Shared cached
  // profile and permission data can belong to the account that a peer just replaced.
  if (getBrowserSession() != undefined || getDesktopSession() != undefined) {
    return currentState;
  }
  if (persistedState == undefined || typeof persistedState !== "object") {
    return currentState;
  }

  const persistedUserStore = persistedState as Partial<PersistedUserStore>;
  return {
    ...currentState,
    ...(persistedUserStore.user != undefined
      ? {
          user: {
            ...persistedUserStore.user,
            avatarUrl: persistedUserStore.user.avatarUrl ?? "",
          },
        }
      : {}),
    ...(persistedUserStore.role != undefined ? { role: persistedUserStore.role } : {}),
  };
}

function createCurrentUserStore() {
  return createStore<UserStore>()(
    persist<UserStore, [], [], PersistedUserStore>(
      (set) => ({
        user: undefined,
        role: {
          organizationRole: OrganizationRoleWeight[OrganizationRoleEnum.ORGANIZATION_READER],
          projectRole: ProjectRoleWeight[ProjectRoleEnum.ANONYMOUS_USER],
        },
        loginStatus: getLoginStatus(),
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
          user: state.user == undefined ? undefined : { ...state.user, avatarUrl: undefined },
          role: state.role,
        }),
        // loginStatus is derived from coScene_org_jwt. Ignore the legacy persisted value so a
        // stale user-storage entry cannot override the token state during hydration.
        merge: mergePersistedUserStore,
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
    const syncLoginStatus = () => {
      store.setState({ loginStatus: getLoginStatus() });
    };
    syncLoginStatus();
    if (getDesktopSession() != undefined) {
      return subscribeDesktopSession(() => {
        store.setState({
          loginStatus: getLoginStatus(),
          user: undefined,
          role: { organizationRole: 0, projectRole: 0 },
        });
      });
    }
    return getBrowserSession()?.subscribe(syncLoginStatus);
  }, [loginStatusKey, store]);

  return (
    <CoSceneCurrentUserContext.Provider value={store}>
      {children}
    </CoSceneCurrentUserContext.Provider>
  );
}
