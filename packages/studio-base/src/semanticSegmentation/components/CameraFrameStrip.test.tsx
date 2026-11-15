/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ThemeProvider } from "@mui/material/styles";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { createMuiTheme } from "@foxglove/theme";

import { segmentationSession } from "../runtime";
import { frameInstanceKey } from "../service";
import { sourceFrameLoaders } from "../sourceFrames";
import type { SegmentationDocument, SegmentationFrame } from "../types";
import { CameraFrameStrip } from "./CameraFrameStrip";

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
    sourceFrameLoaders.clear();
    segmentationSession.setState({ seek: undefined });
  });

  it("seeks the clock to a cell's exact log time and marks unread frames", () => {
    const frames = headFrames(60);
    const seek = jest.fn();
    segmentationSession.setState({ seek });
    const readUpTo = BigInt(frames[35]!.logTimeNs);
    sourceFrameLoaders.set("head", {
      videoId: "head",
      ensureRange: async () => {},
      ensureFollowing: async () => {},
      isLoaded: (_from, to) => to <= readUpTo,
      dispose: () => {},
    });
    render(
      <ThemeProvider theme={theme}>
        <CameraFrameStrip
          document={documentWith(frames, [frames[30]!.id, frames[33]!.id])}
          instanceId="instance-1"
          frameId={frames[30]!.id}
          camera="head_rgbd"
          color="#f00"
          disabled={false}
        />
      </ThemeProvider>,
    );
    const group = screen.getByRole("group", { name: "head_rgbd 前后 20 帧" });
    const cells = group.querySelectorAll("button");
    expect(cells).toHaveLength(41);
    expect(cells[23]!.dataset.state).toBe("annotated");
    expect(cells[26]!.dataset.state).toBe("unloaded");
    expect(cells[26]!.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "head_rgbd +3 帧：有标注" }));
    expect(seek).toHaveBeenCalledWith(BigInt(frames[33]!.logTimeNs));
  });

  it("is hidden when the instance never appears near the shown frame", () => {
    const frames = headFrames(10);
    render(
      <ThemeProvider theme={theme}>
        <CameraFrameStrip
          document={documentWith(frames, [])}
          instanceId="instance-1"
          frameId={frames[5]!.id}
          camera="head_rgbd"
          color="#f00"
          disabled={false}
        />
      </ThemeProvider>,
    );
    expect(screen.queryByRole("group")).toBeNull();
  });
});
