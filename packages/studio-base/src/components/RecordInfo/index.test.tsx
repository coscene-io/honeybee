/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import type { Organization } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/organization_pb";
import { ProjectSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/project_pb";
import { DeviceSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/device_pb";
import { RecordSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/record_pb";
import { render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { createStore } from "zustand";

import RecordInfo from "@foxglove/studio-base/components/RecordInfo";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import {
  SubscriptionEntitlementContext,
  SubscriptionEntitlementStore,
} from "@foxglove/studio-base/context/SubscriptionEntitlementContext";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import type ConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

jest.mock("@foxglove/studio-base/components/RecordInfo/ProjectDeviceSelector", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: () => React.createElement(React.Fragment),
  };
});

const deviceId = "e7bf6e9d-e95e-42f4-9ce3-fcb86674d785";
const device = create(DeviceSchema, {
  name: `devices/${deviceId}`,
  serialNumber: "bag-noetic_043",
});

const subscriptionStore = createStore<SubscriptionEntitlementStore>(() => ({
  paid: true,
  subscription: undefined,
  setSubscription: jest.fn(),
  getEntitlement: jest.fn(),
}));

function CoreDataSeeder(): ReactNull {
  const setOrganization = useCoreData((state) => state.setOrganization);
  const setProject = useCoreData((state) => state.setProject);
  const setRecord = useCoreData((state) => state.setRecord);

  useLayoutEffect(() => {
    setOrganization({
      loading: false,
      value: { slug: "coscene-lark" } as Organization,
    });
    setProject({
      loading: false,
      value: create(ProjectSchema, { slug: "bubbl" }),
    });
    setRecord({
      loading: false,
      value: create(RecordSchema, {
        name: "warehouses/warehouse/projects/project/records/record",
        device,
      }),
    });
  }, [setOrganization, setProject, setRecord]);

  return ReactNull;
}

describe("<RecordInfo />", () => {
  it("links a record device to its project-device details page", async () => {
    const consoleApi = {
      getDevice: jest.fn(async () => device),
      updateRecord: Object.assign(jest.fn(), { permission: () => true }),
    } as unknown as ConsoleApi;

    const root = render(
      <CoSceneConsoleApiContext.Provider value={consoleApi}>
        <SubscriptionEntitlementContext.Provider value={subscriptionStore}>
          <CoreDataProvider>
            <CoreDataSeeder />
            <ThemeProvider isDark>
              <RecordInfo />
            </ThemeProvider>
          </CoreDataProvider>
        </SubscriptionEntitlementContext.Provider>
      </CoSceneConsoleApiContext.Provider>,
    );

    const deviceLink = await root.findByRole("link", { name: device.serialNumber });

    expect(deviceLink.getAttribute("href")).toBe(
      `/coscene-lark/bubbl/devices/project-devices/${deviceId}`,
    );
  });
});
