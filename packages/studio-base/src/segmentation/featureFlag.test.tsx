/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";
import { renderHook } from "@testing-library/react";

import {
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
});
