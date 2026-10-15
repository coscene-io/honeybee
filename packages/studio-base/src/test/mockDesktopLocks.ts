// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/** Model Web Locks' origin-wide queue in jsdom, which does not implement the API. */
export function mockDesktopLocks(): void {
  let tail: Promise<unknown> = Promise.resolve();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: jest.fn(async (_name: string, callback: () => unknown) => {
        const result = tail.then(callback);
        tail = result.catch(() => undefined);
        return await result;
      }),
    },
  });
}
