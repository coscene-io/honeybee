// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { segmentationSourceKey } from "./imageSource";

describe("imageSource", () => {
  it("uses stable URL parameters across reload, while isolating changed sources and file identities", () => {
    const a = {
      playerId: "a",
      urlState: { sourceId: "remote-mp4", parameters: { url: "a.mp4", topic: "/front" } },
    };
    expect(segmentationSourceKey(a)).toBe(
      segmentationSourceKey({
        ...a,
        playerId: "b",
        urlState: { sourceId: "remote-mp4", parameters: { topic: "/front", url: "a.mp4" } },
      }),
    );
    expect(segmentationSourceKey(a)).not.toBe(
      segmentationSourceKey({
        ...a,
        urlState: { sourceId: "remote-mp4", parameters: { url: "b.mp4" } },
      }),
    );
    expect(segmentationSourceKey({ playerId: "a", filename: "local.mp4", sizeBytes: "10" })).toBe(
      segmentationSourceKey({ playerId: "b", filename: "local.mp4", sizeBytes: "10" }),
    );
  });
});
