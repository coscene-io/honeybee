/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act } from "@testing-library/react";

import { fromNanoSec } from "@foxglove/rostime";

import { AnnotationPreview } from "./AnnotationPreview";
import {
  createTestBridge,
  render,
  testHost,
  installSegmentationTestHost,
  testSources,
  type TestImage,
} from "../testing/host";
import { createMockSegmentationRuntime } from "../testing/mockRuntime";
import { createSeedDocument, setMockControls } from "../testing/mockService";

installSegmentationTestHost();

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
  const runtime = createMockSegmentationRuntime(document);
  setMockControls(runtime.service, { delayMs: 0 });
  await runtime.initialize();
  await runtime.store.getState().loadFrameWindow("video-1", 0, 1);
  const topic = document.videos.find((video) => video.id === "video-1")!.topic!;
  testHost().session.setState({ open: false, previewRuntime: runtime, previewFrames: {} });
  const nativeContainer = window.document.createElement("div");
  const canvas = window.document.createElement("canvas");
  nativeContainer.append(canvas);
  const containerRef = { current: nativeContainer };
  const bridge = createTestBridge();
  const result = render(
    <AnnotationPreview topic={topic} containerRef={containerRef} bridge={bridge} />,
  );
  let image: TestImage | undefined = {
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
  const capturePixels = jest.fn(() => image);
  bridge.publish(testSources({ image: capturePixels, imageMetadata: () => image }));
  act(() => {
    bridge.notifyFrame();
  });
  // The playhead is 150ms later, but the native renderer still displays frame0.
  expect(result.container.querySelector("svg")?.getAttribute("data-log-time-ns")).toBe(
    "1700000000000000000",
  );
  expect(result.container.querySelector("svg > g")?.getAttribute("transform")).toBe(
    "matrix(0.5 0 0 0.5 10 20)",
  );
  expect(testHost().session.getState().previewFrames[topic]).toBe("frame-0");
  image = undefined; // Native seek invalidates the image identity before the next decode.
  act(() => {
    bridge.notifyFrame();
  });
  expect(result.container.querySelector("svg")).toBeNull();
  expect(testHost().session.getState().previewFrames[topic]).toBeUndefined();
  expect(capturePixels).not.toHaveBeenCalled();
  result.unmount();
  runtime.dispose();
  testHost().session.setState({ previewRuntime: undefined, previewFrames: {} });
});
