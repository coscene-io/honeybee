/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Record } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/record_pb";
import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";
import { act, renderHook } from "@testing-library/react";

import {
  openRecordName,
  SEGMENTATION_FEATURE_FLAG,
  segmentationAvailable,
  useSegmentationFlag,
} from "./featureFlag";
import { allowSlowRunner } from "./testing/slowRunner";

allowSlowRunner();

const RECORD = "warehouses/w/projects/p/records/r";

afterEach(() => {
  window.cosConfig = undefined;
});

describe("segmentation rollout flag", () => {
  it("is off by default, also without a GrowthBook provider", () => {
    expect(renderHook(() => useSegmentationFlag()).result.current).toBe(false);
  });

  it("reads the deployment fallback from cos-config", () => {
    window.cosConfig = {
      FEATURE_FLAG_GROWTHBOOK: { [SEGMENTATION_FEATURE_FLAG]: true },
    } as typeof window.cosConfig;
    expect(renderHook(() => useSegmentationFlag()).result.current).toBe(true);
  });

  it("follows the GrowthBook feature when a provider is mounted", () => {
    const growthbook = new GrowthBook({
      features: { [SEGMENTATION_FEATURE_FLAG]: { defaultValue: true } },
    });
    const { result } = renderHook(() => useSegmentationFlag(), {
      wrapper: ({ children }) => (
        <GrowthBookProvider growthbook={growthbook}>{children}</GrowthBookProvider>
      ),
    });
    expect(result.current).toBe(true);
  });

  it("needs the flag, a cloud record and the cloud data source", () => {
    const cloud = "coscene-data-platform";
    const available = (args: {
      flagOn: boolean;
      recordName: string | undefined;
      dataSourceId: string | undefined;
    }) => segmentationAvailable(args);
    expect(available({ flagOn: true, recordName: RECORD, dataSourceId: cloud })).toBe(true);
    expect(available({ flagOn: false, recordName: RECORD, dataSourceId: cloud })).toBe(false);
    expect(available({ flagOn: true, recordName: undefined, dataSourceId: cloud })).toBe(false);
    expect(available({ flagOn: true, recordName: "file:///local.mcap", dataSourceId: cloud })).toBe(
      false,
    );
    // A local file opened after a cloud record leaves the old record in Core Data.
    expect(available({ flagOn: true, recordName: RECORD, dataSourceId: "remote-file" })).toBe(
      false,
    );
    expect(available({ flagOn: true, recordName: RECORD, dataSourceId: undefined })).toBe(false);
  });

  it("updates when GrowthBook's value changes after the first render", async () => {
    const growthbook = new GrowthBook({
      features: { [SEGMENTATION_FEATURE_FLAG]: { defaultValue: false } },
    });
    const { result } = renderHook(() => useSegmentationFlag(), {
      wrapper: ({ children }) => (
        <GrowthBookProvider growthbook={growthbook}>{children}</GrowthBookProvider>
      ),
    });
    expect(result.current).toBe(false);
    await act(async () => {
      await growthbook.setPayload({
        features: { [SEGMENTATION_FEATURE_FLAG]: { defaultValue: true } },
      });
    });
    expect(result.current).toBe(true);
  });

  it("names no record while another record is being opened", () => {
    const previous = { name: "warehouses/w/projects/p/records/a" } as Record;
    const config = { warehouseId: "w", projectId: "p", recordId: "b" };
    // Switching to b: Core Data still holds a while b is read.
    expect(
      openRecordName({ record: { loading: true, value: previous }, externalInitConfig: config }),
    ).toBeUndefined();
    const next = { name: "warehouses/w/projects/p/records/b" } as Record;
    expect(
      openRecordName({ record: { loading: false, value: next }, externalInitConfig: config }),
    ).toBe(next.name);
    // Reloading the open record keeps it, so an open session is not torn down.
    expect(
      openRecordName({ record: { loading: true, value: next }, externalInitConfig: config }),
    ).toBe(next.name);
    // Without a requested record (no external config), the value is the record.
    expect(openRecordName({ record: { loading: false, value: previous } })).toBe(previous.name);
  });
});
