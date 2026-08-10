/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render, waitFor } from "@testing-library/react";
import { createStore } from "zustand";

import { CoSceneCurrentUserContext } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import type { UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";

import GrowthBookUserProvider from "./GrowthBookUserProvider";

const mockSetAttributes = jest.fn();

jest.mock("@foxglove/studio-base/providers/GrowthBookProvider", () => ({
  getGrowthBookClient: () => ({ setAttributes: mockSetAttributes }),
}));

describe("GrowthBookUserProvider", () => {
  it("updates targeting attributes and clears stale identity after logout", async () => {
    const store = createStore<UserStore>(() => ({
      loginStatus: "alreadyLogin",
      role: { organizationRole: 0, projectRole: 0 },
      setLoginStatus: jest.fn(),
      setRole: jest.fn(),
      setUser: jest.fn(),
      user: {
        agreedAgreement: "",
        avatarUrl: "",
        email: "user@example.com",
        nickName: "Example User",
        phoneNumber: "1234",
        role: "",
        targetSite: "",
        userId: "user-1",
      },
    }));

    render(
      <CoSceneCurrentUserContext.Provider value={store}>
        <GrowthBookUserProvider>
          <div />
        </GrowthBookUserProvider>
      </CoSceneCurrentUserContext.Provider>,
    );

    await waitFor(() => {
      expect(mockSetAttributes).toHaveBeenLastCalledWith({
        email: "user@example.com",
        locationHostName: "localhost",
        nickName: "Example User",
        phoneNumber: "1234",
        platform: "honeybee",
        userId: "user-1",
      });
    });

    act(() => {
      store.setState({ loginStatus: "notLogin" });
    });

    await waitFor(() => {
      expect(mockSetAttributes).toHaveBeenLastCalledWith({
        locationHostName: "localhost",
        platform: "honeybee",
      });
    });
  });
});
