// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SegmentationDocument } from "@foxglove/studio-base/semanticSegmentation/types";
import { AnnotationService } from "@foxglove/studio-base/services/api/spatial-annotation";

import { createLiveSemanticSegmentationService } from "./annotation";

const document: SegmentationDocument = {
  record: { id: "r", name: "r" },
  videos: [],
  frames: [],
  classes: [],
  instances: [],
  annotations: {},
  annotationSummaries: {},
};
const recordName = "warehouses/w/projects/p/records/r";

describe("createLiveSemanticSegmentationService", () => {
  it("takes its client from the console API, which carries the desktop session", () => {
    const rpcClient = jest.fn().mockReturnValue({});
    const service = createLiveSemanticSegmentationService({
      consoleApi: { rpcClient },
      recordName,
      startNs: 0n,
      document,
    });
    expect(service?.backend).toBe("live");
    expect(rpcClient).toHaveBeenCalledWith(AnnotationService);
  });

  it("creates nothing without a console API or a cloud record", () => {
    expect(
      createLiveSemanticSegmentationService({
        consoleApi: undefined,
        recordName,
        startNs: 0n,
        document,
      }),
    ).toBeUndefined();
    const rpcClient = jest.fn();
    expect(
      createLiveSemanticSegmentationService({
        consoleApi: { rpcClient },
        recordName: "local.mcap",
        startNs: 0n,
        document,
      }),
    ).toBeUndefined();
    expect(rpcClient).not.toHaveBeenCalled();
  });
});
