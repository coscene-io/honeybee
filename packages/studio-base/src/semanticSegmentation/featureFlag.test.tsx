/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";
import { renderHook } from "@testing-library/react";

import {
  SEMANTIC_SEGMENTATION_FEATURE_FLAG,
  semanticSegmentationAvailable,
  useSemanticSegmentationFlag,
} from "./featureFlag";

const RECORD = "warehouses/w/projects/p/records/r";

afterEach(() => {
  window.cosConfig = undefined;
});

describe("semantic segmentation rollout flag", () => {
  it("is off by default, also without a GrowthBook provider", () => {
    expect(renderHook(() => useSemanticSegmentationFlag()).result.current).toBe(false);
  });

  it("reads the deployment fallback from cos-config", () => {
    window.cosConfig = {
      FEATURE_FLAG_GROWTHBOOK: { [SEMANTIC_SEGMENTATION_FEATURE_FLAG]: true },
    } as typeof window.cosConfig;
    expect(renderHook(() => useSemanticSegmentationFlag()).result.current).toBe(true);
  });

  it("follows the GrowthBook feature when a provider is mounted", () => {
    const growthbook = new GrowthBook({
      features: { [SEMANTIC_SEGMENTATION_FEATURE_FLAG]: { defaultValue: true } },
    });
    const { result } = renderHook(() => useSemanticSegmentationFlag(), {
      wrapper: ({ children }) => (
        <GrowthBookProvider growthbook={growthbook}>{children}</GrowthBookProvider>
      ),
    });
    expect(result.current).toBe(true);
  });

  it("needs both the flag and a cloud record", () => {
    expect(semanticSegmentationAvailable({ flagOn: true, recordName: RECORD })).toBe(true);
    expect(semanticSegmentationAvailable({ flagOn: false, recordName: RECORD })).toBe(false);
    expect(semanticSegmentationAvailable({ flagOn: true, recordName: undefined })).toBe(false);
    expect(semanticSegmentationAvailable({ flagOn: true, recordName: "file:///local.mcap" })).toBe(
      false,
    );
  });
});
