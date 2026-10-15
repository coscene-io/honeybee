// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { DesktopAuthBroker } from "./DesktopAuthBroker";

const link = (credential: string) =>
  `coscene://signin-complete?jwt=${encodeURIComponent(btoa(credential))}`;

it.each(["argv", "open-url"])(
  "retains a cold %s callback until renderer listeners are ready",
  () => {
    const broker = new DesktopAuthBroker();
    expect(broker.acceptLink(link("Bearer cold-start"))).toBe(true);
    const send = jest.fn();
    broker.ready(1, send);
    expect(send).toHaveBeenCalledWith(
      "auth-token",
      "Bearer cold-start",
      expect.stringMatching(/:1$/),
    );
  },
);

it("broadcasts warm legacy login and logout to every ready window", () => {
  const broker = new DesktopAuthBroker();
  const first = jest.fn();
  const second = jest.fn();
  broker.ready(1, first);
  broker.ready(2, second);
  broker.acceptLink(link("Basic legacy"));
  const sessionId = first.mock.calls[0]![2] as string;
  expect(second).toHaveBeenCalledWith("auth-token", "Basic legacy", sessionId);
  broker.logout("Basic legacy", sessionId);
  expect(first).toHaveBeenLastCalledWith("auth-signout", "Basic legacy", sessionId);
  const reopened = jest.fn();
  broker.ready(3, reopened);
  expect(reopened).not.toHaveBeenCalled();
});

it("keeps the latest pending login and ignores a delayed older logout", () => {
  const broker = new DesktopAuthBroker();
  const send = jest.fn();
  broker.ready(1, send);
  broker.acceptLink(link("Bearer first"));
  const firstId = send.mock.calls[0]![2] as string;
  broker.acceptLink(link("Bearer second"));
  broker.logout("Bearer first", firstId);
  const fresh = jest.fn();
  broker.ready(2, fresh);
  expect(fresh).toHaveBeenCalledWith("auth-token", "Bearer second", expect.stringMatching(/:2$/));
  broker.remove(1);
  send.mockClear();
  broker.acceptLink(link("Bearer third"));
  expect(send).not.toHaveBeenCalled();
});
