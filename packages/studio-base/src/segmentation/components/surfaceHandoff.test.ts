// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createSegmentationSession } from "../runtime";
import { removeSegmentationSurface } from "./surfaceHandoff";
import { createMockSegmentationRuntime } from "../testing/mockRuntime";
import { createSeedDocument, setMockControls } from "../testing/mockService";

async function openSession() {
  const runtime = createMockSegmentationRuntime(createSeedDocument());
  setMockControls(runtime.service, { delayMs: 0 });
  await runtime.initialize();
  runtime.store.getState().setCurrentFrame("frame-0");
  const session = createSegmentationSession();
  session.setState({
    open: true,
    runtime,
    panelId: "front",
    surfaces: {
      front: { frameId: "frame-0", sourceReady: true },
      side: { frameId: "side-0", sourceReady: true },
    },
  });
  return { runtime, session };
}

describe("removing an Image panel's surface", () => {
  it("hands the edit to the remaining panel and moves the store to its frame", async () => {
    const { runtime, session } = await openSession();
    removeSegmentationSurface(session, "front", runtime);
    expect(session.getState().panelId).toBe("side");
    expect(session.getState().surfaces).toEqual({
      side: { frameId: "side-0", sourceReady: true },
    });
    // Frame-scoped actions now act on the camera that is still shown.
    expect(runtime.store.getState().currentFrameId).toBe("side-0");
    runtime.dispose();
  });

  it("closes the session when the last panel goes, and leaves others' edits alone", async () => {
    const { runtime, session } = await openSession();
    // A panel that does not hold the edit only removes its own surface.
    removeSegmentationSurface(session, "side", undefined);
    expect(session.getState().panelId).toBe("front");
    expect(runtime.store.getState().currentFrameId).toBe("frame-0");
    removeSegmentationSurface(session, "front", runtime);
    expect(session.getState()).toMatchObject({ open: false, panelId: undefined, surfaces: {} });
    runtime.dispose();
  });
});
