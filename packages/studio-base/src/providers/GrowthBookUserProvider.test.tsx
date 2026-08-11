/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Organization } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/organization_pb";
import { act, render, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { createStore } from "zustand";

import { CoSceneCurrentUserContext } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import type { UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";

import GrowthBookUserProvider, {
  resolveGrowthBookLocationHostname,
} from "./GrowthBookUserProvider";

const mockSetAttributes = jest.fn();

function CoreDataSeeder({ organizationSlug }: { organizationSlug?: string }): ReactNull {
  const setOrganization = useCoreData((state) => state.setOrganization);

  useLayoutEffect(() => {
    setOrganization(
      organizationSlug
        ? { loading: false, value: { slug: organizationSlug } as Organization }
        : { loading: true, value: undefined },
    );
  }, [organizationSlug, setOrganization]);

  return ReactNull;
}

jest.mock("@foxglove/studio-base/providers/GrowthBookProvider", () => ({
  getGrowthBookClient: () => ({ setAttributes: mockSetAttributes }),
}));

describe("GrowthBookUserProvider", () => {
  afterEach(() => {
    mockSetAttributes.mockClear();
    window.cosConfigRemoteHostname = undefined;
  });

  it("updates targeting attributes and clears stale identity and organization data", async () => {
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

    const renderProviders = (organizationSlug?: string) => (
      <CoreDataProvider>
        <CoreDataSeeder organizationSlug={organizationSlug} />
        <CoSceneCurrentUserContext.Provider value={store}>
          <GrowthBookUserProvider>
            <div />
          </GrowthBookUserProvider>
        </CoSceneCurrentUserContext.Provider>
      </CoreDataProvider>
    );

    const view = render(renderProviders("coscene-lark"));

    await waitFor(() => {
      expect(mockSetAttributes).toHaveBeenLastCalledWith({
        email: "user@example.com",
        id: "user-1",
        locationHostName: "localhost",
        nickName: "Example User",
        organizationSlug: "coscene-lark",
        phoneNumber: "1234",
        platform: "honeybee",
        userId: "user-1",
      });
    });

    view.rerender(renderProviders("second-organization"));

    await waitFor(() => {
      expect(mockSetAttributes).toHaveBeenLastCalledWith(
        expect.objectContaining({ organizationSlug: "second-organization" }),
      );
    });

    view.rerender(renderProviders());

    await waitFor(() => {
      expect(mockSetAttributes).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ organizationSlug: expect.anything() }),
      );
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

  it("uses the remote config hostname for desktop targeting", () => {
    expect(resolveGrowthBookLocationHostname("", "tenant.coscene.io")).toBe("tenant.coscene.io");
  });
});
