// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { previewWindowNeedsLoad, previewWindowStartSec } from "./segmentationWindow";

describe("annotation samples", () => {
  it("loads a window only from frames inside that window", () => {
    expect(previewWindowStartSec(15.2)).toBe(10);
    expect(previewWindowStartSec(Number.NaN)).toBeUndefined();
    const frames = [{ timestampSec: 9.8 }, { timestampSec: 10.2 }];
    expect(previewWindowNeedsLoad(frames, (frame) => frame.timestampSec < 10, 10, 40)).toBe(true);
    expect(previewWindowNeedsLoad([{ timestampSec: 9.8 }], () => true, 10, 40)).toBe(false);
  });
});
