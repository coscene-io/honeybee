/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act } from "@testing-library/react";
import { Profiler } from "react";

import { createSemanticSegmentationStore } from "../store";
import { SegmentationCanvas } from "./SegmentationCanvas/SegmentationCanvas";
import { SpatialTree } from "./SegmentationTree/SpatialTree";
import { render, installSegmentationTestHost } from "../testing/host";
import { createMockSemanticSegmentationService, createSeedDocument } from "../testing/mockService";
import { TEST_DECODED_FRAME } from "../testing/nativeFrame";

installSegmentationTestHost();

// The canvas and the tree subscribed to the whole store, so every queue, error and
// propagation-progress update re-rendered thousands of lines of UI.
it("does not re-render the canvas or the tree for state they do not show", async () => {
  const store = createSemanticSegmentationStore(
    createMockSemanticSegmentationService({
      document: createSeedDocument(),
      controls: { delayMs: 0 },
    }),
  );
  await store.getState().initialize();
  const renders = { tree: 0, canvas: 0 };
  render(
    <>
      <Profiler id="tree" onRender={() => (renders.tree += 1)}>
        <SpatialTree store={store} />
      </Profiler>
      <Profiler id="canvas" onRender={() => (renders.canvas += 1)}>
        <SegmentationCanvas decodedFrame={TEST_DECODED_FRAME} store={store} />
      </Profiler>
    </>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const before = { ...renders };

  act(() => {
    store.setState({ error: "unrelated", canRedo: true, submissionQueue: [] });
    store.setState((state) => ({
      propagation: { ...state.propagation, processedFrames: state.propagation.processedFrames + 1 },
    }));
  });

  expect(renders).toEqual(before);
  store.getState().dispose();
});
