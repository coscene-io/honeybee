/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";

import {
  LoginStatus,
  User,
  UserStore,
  useCurrentUser,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import CoSceneCurrentUserProvider from "@foxglove/studio-base/providers/CoSceneCurrentUserProvider";
import { BrowserSession, getBrowserSession } from "@foxglove/studio-base/util/browserSession";

jest.mock("@foxglove/studio-base/util/browserSession", () => ({
  ...jest.requireActual("@foxglove/studio-base/util/browserSession"),
  getBrowserSession: jest.fn(),
}));

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
  const persistedState = JSON.stringify({
    state: {
      user: cachedUser,
      role: cachedRole,
      loginStatus,
    },
    version: 0,
  });
  if (persistedState == undefined) {
    throw new Error("Unable to serialize persisted user state");
  }
  localStorage.setItem("user-storage", persistedState);
}

describe("<CoSceneCurrentUserProvider />", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    jest.mocked(getBrowserSession).mockReturnValue(undefined);
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

  it("updates login status for local playback when the browser session expires", () => {
    localStorage.setItem("coScene_org_jwt", "Bearer initial");
    const session = new BrowserSession();
    session.setLocalPlayback({ local: true });
    jest.mocked(getBrowserSession).mockReturnValue(session);
    const observedStates: ObservedUserState[] = [];
    render(
      <CoSceneCurrentUserProvider>
        <CurrentUserObserver onChange={(state) => observedStates.push(state)} />
      </CoSceneCurrentUserProvider>,
    );
    expect(observedStates.at(-1)?.loginStatus).toBe("alreadyLogin");
    act(() => {
      session.rejectCredential("Bearer initial");
    });
    expect(observedStates.at(-1)?.loginStatus).toBe("notLogin");
    expect(session.preservesPlayback()).toBe(true);
  });

  it("does not hydrate another account's cached identity or permissions in a browser document", () => {
    localStorage.setItem("coScene_org_jwt", "Bearer replacement");
    seedPersistedUserStore("alreadyLogin");
    jest.mocked(getBrowserSession).mockReturnValue(new BrowserSession());
    const observedStates: ObservedUserState[] = [];
    render(
      <CoSceneCurrentUserProvider>
        <CurrentUserObserver onChange={(state) => observedStates.push(state)} />
      </CoSceneCurrentUserProvider>,
    );
    expect(observedStates[0]?.loginStatus).toBe("alreadyLogin");
    expect(observedStates[0]?.user).toBeUndefined();
    expect(observedStates[0]?.role).not.toEqual(cachedRole);
  });
});
