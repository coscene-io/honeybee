/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render } from "@testing-library/react";

import { fromNanoSec } from "@foxglove/rostime";

import { segmentationImageSources, type SegmentationImage } from "../imageSource";
import { createSeedDocument } from "../mockService";
import { createSegmentationRuntime, segmentationSession } from "../runtime";
import { AnnotationPreview } from "./AnnotationPreview";

const pipeline = {
  playerState: { activeData: { currentTime: fromNanoSec(1700000000150000000n) } },
};
const getPipeline = () => pipeline;
jest.mock("@foxglove/studio-base/components/MessagePipeline", () => ({
  useMessagePipeline: (selector: (state: typeof pipeline) => unknown) => selector(pipeline),
  useMessagePipelineGetter: () => getPipeline,
}));

it("uses exact displayed log time and native transform for preview and read-only tree", async () => {
  const document = createSeedDocument();
  const runtime = createSegmentationRuntime(document);
  runtime.service.setControls({ delayMs: 0 });
  await runtime.initialize();
  await runtime.store.getState().loadFrameWindow("video-1", 0, 1);
  const topic = document.videos.find((video) => video.id === "video-1")!.topic!;
  segmentationSession.setState({ open: false, previewRuntime: runtime, previewFrames: {} });
  const nativeContainer = window.document.createElement("div");
  const canvas = window.document.createElement("canvas");
  nativeContainer.append(canvas);
  const containerRef = { current: nativeContainer };
  const result = render(<AnnotationPreview topic={topic} containerRef={containerRef} />);
  let image: SegmentationImage | undefined = {
    topic,
    imageUrl: "data:image/png;base64,test",
    decodedIdentity: {},
    timestamp: fromNanoSec(1700000000000000000n),
    receiveTime: fromNanoSec(1700000000000000000n),
    nativeView: {
      width: 800,
      height: 600,
      imageWidth: 960,
      imageHeight: 540,
      matrix: [0.5, 0, 0, 0.5, 10, 20],
    },
  };
  segmentationImageSources.set(canvas, () => image);
  act(() => {
    canvas.dispatchEvent(new Event("segmentation-frame"));
  });
  // The playhead is 150ms later, but the native renderer still displays frame0.
  expect(result.container.querySelector("svg")?.getAttribute("data-log-time-ns")).toBe(
    "1700000000000000000",
  );
  expect(result.container.querySelector("svg > g")?.getAttribute("transform")).toBe(
    "matrix(0.5 0 0 0.5 10 20)",
  );
  expect(segmentationSession.getState().previewFrames[topic]).toBe("frame-0");
  image = undefined; // Native seek invalidates the image identity before the next decode.
  act(() => {
    canvas.dispatchEvent(new Event("segmentation-frame"));
  });
  expect(result.container.querySelector("svg")).toBeNull();
  expect(segmentationSession.getState().previewFrames[topic]).toBeUndefined();
  result.unmount();
  runtime.dispose();
  segmentationSession.setState({ previewRuntime: undefined, previewFrames: {} });
});
