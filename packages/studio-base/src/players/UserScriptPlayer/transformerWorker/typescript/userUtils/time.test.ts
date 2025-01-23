// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { subtractTimes, compare } from "./time";

describe("time", () => {
  it("subtractTimes", () => {
    expect(subtractTimes({ sec: 1, nsec: 1 }, { sec: 1, nsec: 1 })).toEqual({ sec: 0, nsec: 0 });
    expect(subtractTimes({ sec: 1, nsec: 2 }, { sec: 2, nsec: 1 })).toEqual({ sec: -1, nsec: 1 });
    expect(subtractTimes({ sec: 5, nsec: 100 }, { sec: 2, nsec: 10 })).toEqual({
      sec: 3,
      nsec: 90,
    });
    expect(subtractTimes({ sec: 1, nsec: 1e8 }, { sec: 0, nsec: 5e8 })).toEqual({
      sec: 0,
      nsec: 600000000,
    });
    expect(subtractTimes({ sec: 1, nsec: 0 }, { sec: 0, nsec: 1e9 - 1 })).toEqual({
      sec: 0,
      nsec: 1,
    });
    expect(subtractTimes({ sec: 0, nsec: 0 }, { sec: 0, nsec: 1 })).toEqual({
      sec: -1,
      nsec: 1e9 - 1,
    });
  });
  it("compare", () => {
    expect(compare({ sec: 2, nsec: 1 }, { sec: 1, nsec: 1 })).toEqual(1);
    expect(compare({ sec: 1, nsec: 1 }, { sec: 2, nsec: 1 })).toEqual(-1);
    expect(compare({ sec: 1, nsec: 1 }, { sec: 1, nsec: 1 })).toEqual(0);
  });
});
