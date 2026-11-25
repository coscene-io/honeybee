/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ThemeProvider } from "@mui/material/styles";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

import { createMuiTheme } from "@foxglove/theme";

import { frameInstanceKey } from "../service";
import type { SegmentationDocument, SegmentationFrame } from "../types";
import { CameraFrameStrip } from "./CameraFrameStrip";
import { render, testHost, installSegmentationTestHost } from "../testing/host";

// jsdom UI tests run 10-20x slower on a loaded CI runner than locally; the default 5 s is too tight.
jest.setTimeout(30_000);

installSegmentationTestHost();

const theme = createMuiTheme("light", "en");
const BASE = 1_774_926_583_567_900_570n;

function headFrames(count: number): SegmentationFrame[] {
  return Array.from({ length: count }, (_, index) => {
    const at = BASE + BigInt(index) * 33_197_332n + (index % 3 === 0 ? 2_000_000n : 0n);
    return {
      id: `head:${at}`,
      videoId: "head",
      index: 0,
      timestampSec: 0,
      logTimeNs: at.toString(),
      imageUrl: "",
    };
  });
}

function documentWith(frames: SegmentationFrame[], annotated: string[]): SegmentationDocument {
  return {
    frames,
    videos: [],
    annotationSummaries: Object.fromEntries(
      annotated.map((id) => [
        frameInstanceKey(id, "instance-1"),
        { polygonCount: 1, pointCount: 6 },
      ]),
    ),
  } as unknown as SegmentationDocument;
}

describe("CameraFrameStrip", () => {
  afterEach(() => {
    cleanup();
    testHost().session.setState({ seek: undefined });
  });

  it("seeks the clock to a cell's exact log time and marks unread frames", () => {
    const frames = headFrames(60);
    const seek = jest.fn();
    testHost().session.setState({ seek });
    const readUpTo = BigInt(frames[35]!.logTimeNs);
    testHost().sourceFrames.register({
      videoId: "head",
      ensureRange: async () => {},
      ensureFollowing: async () => {},
      isLoaded: (_from, to) => to <= readUpTo,
      subscribe: () => () => {},
      dispose: () => {},
    });
    render(
      <ThemeProvider theme={theme}>
        <CameraFrameStrip
          document={documentWith(frames, [frames[30]!.id, frames[33]!.id])}
          instanceId="instance-1"
          sourceFrames={testHost().sourceFrames}
          frameId={frames[30]!.id}
          camera="front"
          color="#f00"
          disabled={false}
        />
      </ThemeProvider>,
    );
    const group = screen.getByRole("group", { name: "front, 20 frames on each side" });
    const cells = group.querySelectorAll("button");
    expect(cells).toHaveLength(41);
    expect(cells[23]!.dataset.state).toBe("annotated");
    expect(cells[26]!.dataset.state).toBe("unloaded");
    expect(cells[26]!.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "front +3 frames: annotated" }));
    expect(seek).toHaveBeenCalledWith(BigInt(frames[33]!.logTimeNs));
  });

  it("is hidden when the instance never appears near the shown frame", () => {
    const frames = headFrames(10);
    render(
      <ThemeProvider theme={theme}>
        <CameraFrameStrip
          document={documentWith(frames, [])}
          instanceId="instance-1"
          sourceFrames={testHost().sourceFrames}
          frameId={frames[5]!.id}
          camera="front"
          color="#f00"
          disabled={false}
        />
      </ThemeProvider>,
    );
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("marks cells as read when a loader finishes a window that adds no frames", () => {
    const frames = headFrames(10);
    let readUpTo = BigInt(frames[5]!.logTimeNs);
    let finishRead = () => {};
    testHost().sourceFrames.register({
      videoId: "head",
      ensureRange: async () => {},
      ensureFollowing: async () => {},
      isLoaded: (_from, to) => to <= readUpTo,
      subscribe: (listener) => {
        finishRead = listener;
        return () => {};
      },
      dispose: () => {},
    });
    render(
      <ThemeProvider theme={theme}>
        <CameraFrameStrip
          document={documentWith(frames, [frames[5]!.id])}
          instanceId="instance-1"
          sourceFrames={testHost().sourceFrames}
          frameId={frames[5]!.id}
          camera="front"
          color="#f00"
          disabled={false}
        />
      </ThemeProvider>,
    );
    const cells = screen
      .getByRole("group", { name: "front, 20 frames on each side" })
      .querySelectorAll("button");
    expect(cells[22]!.dataset.state).toBe("unloaded");
    act(() => {
      readUpTo = BigInt(frames[9]!.logTimeNs);
      finishRead();
    });
    expect(cells[22]!.dataset.state).toBe("empty");
  });
});
