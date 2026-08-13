/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";

import {
  LoginStatus,
  User,
  UserStore,
  useCurrentUser,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import CoSceneCurrentUserProvider from "@foxglove/studio-base/providers/CoSceneCurrentUserProvider";

type ObservedUserState = Pick<UserStore, "loginStatus" | "role" | "user">;

const cachedUser: User = {
  userId: "users/cached-user",
  nickName: "Cached user",
  avatarUrl: "https://example.com/avatar.png",
  phoneNumber: "",
  agreedAgreement: "true",
  role: "user",
  email: "cached@example.com",
  targetSite: "",
};

const cachedRole = {
  organizationRole: 3,
  projectRole: 4,
};

function CurrentUserObserver({
  onChange,
}: {
  onChange: (state: ObservedUserState) => void;
}): ReactNull {
  const loginStatus = useCurrentUser((state) => state.loginStatus);
  const user = useCurrentUser((state) => state.user);
  const role = useCurrentUser((state) => state.role);

  useEffect(() => {
    onChange({ loginStatus, role, user });
  }, [loginStatus, onChange, role, user]);

  return ReactNull;
}

function seedPersistedUserStore(loginStatus: LoginStatus): void {
  localStorage.setItem(
    "user-storage",
    JSON.stringify({
      state: {
        user: cachedUser,
        role: cachedRole,
        loginStatus,
      },
      version: 0,
    }),
  );
}

describe("<CoSceneCurrentUserProvider />", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses the token when legacy persisted state says the user is logged out", () => {
    localStorage.setItem("coScene_org_jwt", "token");
    seedPersistedUserStore("notLogin");
    const observedStates: ObservedUserState[] = [];

    render(
      <CoSceneCurrentUserProvider>
        <CurrentUserObserver onChange={(state) => observedStates.push(state)} />
      </CoSceneCurrentUserProvider>,
    );

    expect(observedStates[0]?.loginStatus).toBe("alreadyLogin");
  });

  it("uses the missing token when legacy persisted state says the user is logged in", () => {
    seedPersistedUserStore("alreadyLogin");
    const observedStates: ObservedUserState[] = [];

    render(
      <CoSceneCurrentUserProvider>
        <CurrentUserObserver onChange={(state) => observedStates.push(state)} />
      </CoSceneCurrentUserProvider>,
    );

    expect(observedStates[0]?.loginStatus).toBe("notLogin");
  });

  it("restores cached user data and removes loginStatus on the next persisted write", async () => {
    localStorage.setItem("coScene_org_jwt", "token");
    seedPersistedUserStore("notLogin");
    const observedStates: ObservedUserState[] = [];

    render(
      <CoSceneCurrentUserProvider>
        <CurrentUserObserver onChange={(state) => observedStates.push(state)} />
      </CoSceneCurrentUserProvider>,
    );

    expect(observedStates[0]).toEqual({
      loginStatus: "alreadyLogin",
      role: cachedRole,
      user: cachedUser,
    });
    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem("user-storage") ?? "null") as {
        state?: Record<string, unknown>;
      };
      expect(persisted.state).toEqual({
        role: cachedRole,
        user: {
          agreedAgreement: cachedUser.agreedAgreement,
          email: cachedUser.email,
          nickName: cachedUser.nickName,
          phoneNumber: cachedUser.phoneNumber,
          role: cachedUser.role,
          targetSite: cachedUser.targetSite,
          userId: cachedUser.userId,
        },
      });
      expect(persisted.state).not.toHaveProperty("loginStatus");
    });
  });
});
