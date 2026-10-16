/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { act, renderHook } from "@testing-library/react";
import { ReactNode } from "react";

import { useMessagePipeline } from "@foxglove/studio-base/components/MessagePipeline";
import { useStateToURLSynchronization } from "@foxglove/studio-base/hooks/useStateToURLSynchronization";
import { useSyncTimeFromUrl } from "@foxglove/studio-base/hooks/useSyncTimeFromUrl";
import { PlayerPresence } from "@foxglove/studio-base/players/types";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import { parseAppURLState } from "@foxglove/studio-base/util/appURLState";
import * as browserSession from "@foxglove/studio-base/util/browserSession";

jest.mock("@foxglove/studio-base/util/browserSession", () => ({
  ...jest.requireActual("@foxglove/studio-base/util/browserSession"),
  getBrowserSession: jest.fn(),
}));
jest.mock("@foxglove/studio-base/context/CurrentLayoutContext");
jest.mock("@foxglove/studio-base/components/MessagePipeline");

describe("useStateToURLSynchronization", () => {
  it.each([
    { capabilities: [], presence: PlayerPresence.NOT_PRESENT },
    { capabilities: [], presence: PlayerPresence.INITIALIZING },
    { capabilities: [], presence: PlayerPresence.BUFFERING },
    { capabilities: [], presence: PlayerPresence.RECONNECTING },
    { capabilities: [], presence: PlayerPresence.ERROR },
    { capabilities: ["playbackControl"], presence: PlayerPresence.INITIALIZING },
  ])("preserves a launch seek while the player is not ready (%j)", ({ capabilities, presence }) => {
    const originalUrl =
      "http://localhost/viz?ds=coscene-data-platform&ds.key=record&layoutId=layout&time=2025-04-07T02%3A08%3A22.721000000Z#detail";
    window.history.replaceState(undefined, "", originalUrl);
    (useMessagePipeline as jest.Mock).mockImplementation((selector) =>
      selector({
        playerState: { activeData: undefined, capabilities, presence },
      }),
    );
    renderHook(useStateToURLSynchronization, {
      wrapper: ({ children }) => <EventsProvider>{children}</EventsProvider>,
    });
    expect(window.location.href).toBe(originalUrl);
  });

  it("clears the recording time only when its replacement is ready and cannot seek", () => {
    const originalUrl =
      "http://localhost/viz?ds=coscene-websocket&ds.key=live&time=2025-04-07T02%3A08%3A22.721000000Z#detail";
    window.history.replaceState(undefined, "", originalUrl);
    let presence = PlayerPresence.INITIALIZING;
    (useMessagePipeline as jest.Mock).mockImplementation((selector) =>
      selector({ playerState: { capabilities: [], presence } }),
    );
    const { rerender } = renderHook(useStateToURLSynchronization);
    expect(window.location.href).toBe(originalUrl);
    presence = PlayerPresence.PRESENT;
    rerender();
    const expected = new URL(originalUrl);
    expected.searchParams.delete("time");
    expect(window.location.href).toBe(expected.href);
  });

  it("does not apply a discarded live-source seek to a later recording", () => {
    window.history.replaceState(undefined, "", "http://localhost/viz?time=1970-01-01T00:00:01Z");
    const state: { seekPlayback?: jest.Mock } = {};
    (useMessagePipeline as jest.Mock).mockImplementation((selector) =>
      selector({
        playerState: {
          presence: PlayerPresence.PRESENT,
          capabilities: state.seekPlayback == undefined ? [] : ["playbackControl"],
        },
        seekPlayback: state.seekPlayback,
      }),
    );
    const { rerender } = renderHook(() => {
      useSyncTimeFromUrl({ time: { sec: 1, nsec: 0 } });
      useStateToURLSynchronization();
    });
    expect(new URL(window.location.href).searchParams.has("time")).toBe(false);
    state.seekPlayback = jest.fn();
    rerender();
    expect(state.seekPlayback).not.toHaveBeenCalled();
  });

  it("applies the launch seek once when an initializing recording becomes ready", () => {
    const seekPlayback = jest.fn();
    let presence = PlayerPresence.INITIALIZING;
    (useMessagePipeline as jest.Mock).mockImplementation((selector) =>
      selector({
        playerState: {
          presence,
          capabilities: presence === PlayerPresence.PRESENT ? ["playbackControl"] : [],
        },
        seekPlayback: presence === PlayerPresence.PRESENT ? seekPlayback : undefined,
      }),
    );
    const target = { time: { sec: 1, nsec: 0 } };
    const { rerender } = renderHook(() => {
      useSyncTimeFromUrl(target);
    });
    expect(seekPlayback).not.toHaveBeenCalled();
    presence = PlayerPresence.PRESENT;
    rerender();
    expect(seekPlayback).toHaveBeenCalledTimes(1);
    expect(seekPlayback).toHaveBeenCalledWith(target.time);
    rerender();
    expect(seekPlayback).toHaveBeenCalledTimes(1);
  });

  it("updates the url with a stable source time", () => {
    window.history.replaceState(undefined, "", "http://localhost/");
    const spy = jest.spyOn(window.history, "replaceState");

    (useMessagePipeline as jest.Mock).mockImplementation((selector) =>
      selector({
        playerState: {
          activeData: {
            currentTime: { sec: 1, nsec: 1 },
          },
          capabilities: ["playbackControl"],
          urlState: {
            sourceId: "test-source",
            parameters: { a: "one", b: "two" },
          },
        },
      }),
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <EventsProvider>{children}</EventsProvider>
    );

    renderHook(useStateToURLSynchronization, { wrapper });

    expect(spy).toHaveBeenCalledWith(
      undefined,
      "",
      "http://localhost/?time=1970-01-01T00%3A00%3A01.000000001Z",
    );
  });
});

it("captures the latest position on a session boundary and does not erase it during teardown", () => {
  localStorage.setItem("coScene_org_jwt", "Bearer initial");
  const session = new browserSession.BrowserSession();
  jest.mocked(browserSession.getBrowserSession).mockReturnValue(session);
  window.history.replaceState(undefined, "", "/viz?ds.key=record&layoutId=layout#panel");
  let currentTime = { sec: 1, nsec: 0 };
  let capabilities = ["playbackControl"];
  (useMessagePipeline as jest.Mock).mockImplementation((selector) =>
    selector({
      playerState: { activeData: { currentTime }, capabilities, presence: PlayerPresence.PRESENT },
    }),
  );
  const { rerender } = renderHook(useStateToURLSynchronization);
  currentTime = { sec: 5, nsec: 123 };
  rerender();
  act(() => {
    localStorage.setItem("coScene_org_jwt", "Bearer replacement");
    session.reconcile();
  });
  capabilities = [];
  rerender();
  expect(parseAppURLState(new URL(window.location.href))?.time).toEqual(currentTime);
  expect(window.location.hash).toBe("#panel");
  expect(new URL(window.location.href).searchParams.get("ds.key")).toBe("record");
  localStorage.removeItem("coScene_org_jwt");
});
