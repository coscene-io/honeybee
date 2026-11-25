/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ThemeProvider } from "@mui/material/styles";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { createMuiTheme } from "@foxglove/theme";

import { SegmentationActionMenu } from "../components/SegmentationActionMenu";
import { SegmentationPropagateButton } from "../components/SegmentationPropagateButton";
import { polygonsOf } from "../maskGeometry";
import { buildCanvasPropagationScope } from "../propagationSeeds";
import { frameInstanceKey } from "../service";
import { render, testHost, installSegmentationTestHost } from "../testing/host";
import { createMockSegmentationRuntime } from "../testing/mockRuntime";
import { createSeedDocument, setMockControls } from "../testing/mockService";
import type { SegmentationDocument } from "../types";

installSegmentationTestHost();

const theme = createMuiTheme("light", "en");
const polygon = (id: string, x: number) => ({
  id,
  points: [
    { x, y: 0.2 },
    { x: x + 0.1, y: 0.2 },
    { x: x + 0.05, y: 0.6 },
  ],
});

/** P and Q on instance-1, R on instance-2, all on frame-0. */
function seed(document: SegmentationDocument): void {
  for (const [instanceId, polygons] of [
    ["instance-1", [polygon("P", 0.1), polygon("Q", 0.3)]],
    ["instance-2", [polygon("R", 0.6)]],
  ] as const) {
    document.annotations[frameInstanceKey("frame-0", instanceId)] = {
      frameId: "frame-0",
      instanceId,
      kind: "polygons",
      polygons: [...polygons],
    };
  }
}

async function setup(options: { open?: boolean; seeded?: boolean } = {}) {
  const document = createSeedDocument();
  if (options.seeded !== false) {
    seed(document);
  } else {
    // No observation on any frame: nothing to seed.
    document.annotations = {};
    document.annotationSummaries = {};
  }
  const runtime = createMockSegmentationRuntime(document);
  setMockControls(runtime.service, { delayMs: 0, streamDelayMs: 0 });
  await runtime.initialize();
  testHost().session.setState({
    runtime,
    open: options.open ?? true,
    panelId: "canvas-a",
    sourceReady: true,
    surfaces: { "canvas-a": { frameId: "frame-0", sourceReady: true } },
  });
  render(
    <ThemeProvider theme={theme}>
      <SegmentationPropagateButton panelId="canvas-a" />
    </ThemeProvider>,
  );
  return runtime;
}

afterEach(() => {
  cleanup();
  testHost().session.setState({
    runtime: undefined,
    open: false,
    panelId: undefined,
    surfaces: {},
  });
});

describe("canvas propagation", () => {
  it("lists every instance with a polygon on the frame and ignores tree selection", async () => {
    const document = createSeedDocument();
    seed(document);
    const scope = buildCanvasPropagationScope(document, "frame-0");
    expect(scope?.videoId).toBe(document.frames.find((frame) => frame.id === "frame-0")!.videoId);
    expect(
      scope?.seeds.map((item) => [item.instanceId, polygonsOf(item).map((p) => p.id)]),
    ).toEqual([
      ["instance-1", ["P", "Q"]],
      ["instance-2", ["R"]],
    ]);
    expect(buildCanvasPropagationScope(document, "missing")).toBeUndefined();
  });

  it("renders no propagate button without an open session", async () => {
    await setup({ open: false });
    expect(screen.queryByRole("button", { name: "Propagate" })).toBeNull();
  });

  it("disables the button when the frame has no seeded instance", async () => {
    await setup({ seeded: false });
    expect(screen.getByRole("button", { name: "Propagate" })).toHaveProperty("disabled", true);
  });

  it("sends one request with every seeded instance of the canvas's video", async () => {
    const runtime = await setup();
    const online = jest.spyOn(runtime.service, "propagate");
    fireEvent.click(screen.getByRole("button", { name: "Propagate" }));
    expect(screen.getByText("2 instances · 3 polygons")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "1 s" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start propagation" })).toHaveProperty(
        "disabled",
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Start propagation" }));
    await waitFor(() => {
      expect(online).toHaveBeenCalledTimes(1);
    });
    expect(online.mock.calls[0]![0].seeds?.map((seed) => seed.instanceId)).toEqual([
      "instance-1",
      "instance-2",
    ]);
    await waitFor(() => {
      expect(runtime.store.getState().propagation.status).not.toBe("running");
    });
  });

  it("describes the source frame by its number, not its internal id", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Propagate" }));
    const range = screen.getByLabelText("Effective propagation range");
    expect(range.textContent).toContain("Source frame 1");
    expect(range.textContent).not.toContain("frame-0");
  });

  it("the app bar no longer offers Propagate", async () => {
    const runtime = await setup();
    cleanup();
    render(<SegmentationActionMenu />);
    expect(screen.queryByRole("button", { name: /^Propagate/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Submit/ })).toBeTruthy();
    act(() => {
      runtime.dispose();
    });
  });
});
