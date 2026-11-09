// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { presentationFrameAt, segmentationSourceKey } from "./imageSource";

it("selects actual VFR presentations at the bounds and sparse gaps using integer timestamps", () => {
  const frames = [0n, 300_000_000n, 900_000_000n].map((timestampNs) => ({ timestampNs }));
  expect(
    [-1n, 0n, 99_999_999n, 299_999_999n, 300_000_000n, 899_999_999n, 1_000_000_000n].map((time) =>
      presentationFrameAt(frames, time),
    ),
  ).toEqual([-1, 0, 0, 0, 1, 1, 2]);
  expect(presentationFrameAt([], 0n)).toBe(-1);
});
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
