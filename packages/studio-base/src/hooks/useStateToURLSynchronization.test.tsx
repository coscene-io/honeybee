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

import { renderHook } from "@testing-library/react";
import { ReactNode } from "react";

import { useMessagePipeline } from "@foxglove/studio-base/components/MessagePipeline";
import { useStateToURLSynchronization } from "@foxglove/studio-base/hooks/useStateToURLSynchronization";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";

jest.mock("@foxglove/studio-base/context/CurrentLayoutContext");
jest.mock("@foxglove/studio-base/components/MessagePipeline");

describe("useStateToURLSynchronization", () => {
  it("updates the url with a stable source time", () => {
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
