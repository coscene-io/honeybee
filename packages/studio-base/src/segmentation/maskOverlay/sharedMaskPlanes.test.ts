// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createSharedMaskPlanes } from "./sharedMaskPlanes";

describe("shared mask planes", () => {
  it("keeps its planes while panels come and go; the host disposes them", () => {
    const planes = createSharedMaskPlanes();
    const cache = planes.get();
    const dispose = jest.spyOn(cache, "dispose");
    cache.addConsumer({})();
    expect(planes.get()).toBe(cache);
    expect(dispose).not.toHaveBeenCalled();
    planes.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(planes.get()).not.toBe(cache);
    planes.dispose();
  });
});
