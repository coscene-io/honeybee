// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CoalescingRemoteReadable } from "./CoalescingRemoteReadable";

describe("CoalescingRemoteReadable", () => {
  it("uses the manifest-provided size without probing the URL with HEAD", async () => {
    const fetchMock = jest.fn();
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      const readable = new CoalescingRemoteReadable("https://example.com/shard.mcap", 1024, 4096);

      await readable.open();

      expect(await readable.size()).toBe(4096n);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
