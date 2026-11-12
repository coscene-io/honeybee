/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";

import { fromNanoSec } from "@foxglove/rostime";

import { deferred } from "./fixtures";
import { SegmentationImageEntry } from "../../components/SegmentationImageEntry";
import { segmentationImageSources, type SegmentationImage } from "../../imageSource";
import { segmentationSession } from "../../runtime";

const selectItem = jest.fn();
const maximize = jest.fn();
let mockUserId = "fixture-user";
let mockFile:
  | { dataAssetName: string; name: string; filename: string; sizeBytes: bigint }
  | undefined;
const pipeline = {
  playerState: {
    playerId: "image-player",
    name: "Remote camera",
    urlState: { sourceId: "remote-mp4", parameters: { url: "fixture.mp4" } },
    progress: {},
    activeData: {
      startTime: fromNanoSec(0n),
      endTime: fromNanoSec(1_000_000_000n),
      currentTime: fromNanoSec(99_999_999n),
      lastSeekTime: 0,
      messages: [],
    },
  },
  pausePlayback: jest.fn(),
};
const getPipeline = () => pipeline;
jest.mock("@foxglove/studio-base/components/MessagePipeline", () => ({
  useMessagePipeline: (selector: (state: typeof pipeline) => unknown) => selector(pipeline),
  useMessagePipelineGetter: () => getPipeline,
}));
jest.mock("@foxglove/studio-base/context/CoSceneCurrentUserContext", () => ({
  useCurrentUser: (selector: (store: { user?: { userId: string } }) => unknown) =>
    selector({ user: mockUserId ? { userId: mockUserId } : undefined }),
}));
jest.mock("@foxglove/studio-base/context/CoreDataContext", () => ({
  useCoreData: (
    selector: (store: { record: { value?: { name: string; title: string } } }) => unknown,
  ) =>
    selector({
      record: {
        value: mockFile ? { name: mockFile.dataAssetName, title: mockFile.filename } : undefined,
      },
    }),
}));
jest.mock("@foxglove/studio-base/context/Workspace/useWorkspaceActions", () => ({
  useWorkspaceActions: () => ({ sidebarActions: { left: { selectItem } } }),
}));

let sequence = 0;
function fixture() {
  const containerRef = createRef<HTMLDivElement>();
  const source = {
    sourceId: `fixture-${++sequence}.mp4`,
    topic: "/camera",
    frames: [0n, 300_000_000n, 900_000_000n].map((timestampNs) => ({
      timestampNs,
      durationNs: 100_000_000n,
    })),
  };
  pipeline.playerState.urlState.parameters.url = source.sourceId;
  let image: SegmentationImage = {
    imageUrl: "data:image/png;base64,first",
    topic: "/camera",
    timestamp: fromNanoSec(0n),
    receiveTime: fromNanoSec(0n),
    decodedIdentity: {},
    providerId: "decoder-a",
    source,
  };
  const view = (topic = "/camera") => (
    <div ref={containerRef}>
      <canvas width={8} height={4} />
      <SegmentationImageEntry
        containerRef={containerRef}
        topic={topic}
        panelId="panel-1"
        onMaximize={maximize}
      />
    </div>
  );
  const result = render(view());
  const canvas = containerRef.current!.querySelector("canvas")!;
  const capture = jest.fn(() => image);
  segmentationImageSources.set(canvas, capture);
  return {
    ...result,
    view,
    canvas,
    capture,
    source,
    setImage: (time: bigint, changes?: Partial<SegmentationImage>) => {
      image = {
        ...image,
        imageUrl: `data:image/png;base64,${time}`,
        timestamp: fromNanoSec(time),
        receiveTime: fromNanoSec(time),
        decodedIdentity: {},
        ...changes,
      };
    },
    event: () => {
      act(() => {
        canvas.dispatchEvent(new Event("segmentation-frame", { bubbles: true }));
      });
    },
  };
}
async function open(mode: "inline" | "maximize" = "inline") {
  fireEvent.click(screen.getByTitle(mode === "maximize" ? "放大并编辑空间标注" : "编辑空间标注"));
  await waitFor(
    () => {
      expect(segmentationSession.getState().open).toBe(true);
    },
    { timeout: 3000 },
  );
  return segmentationSession.getState().runtime!;
}
beforeEach(() => {
  mockUserId = "fixture-user";
  mockFile = undefined;
  pipeline.playerState.playerId = "image-player";
  pipeline.playerState.activeData.endTime = fromNanoSec(1_000_000_000n);
  pipeline.playerState.activeData.currentTime = fromNanoSec(99_999_999n);
  pipeline.playerState.activeData.lastSeekTime = 0;
  segmentationSession.setState({
    runtime: undefined,
    open: false,
    panelId: undefined,
    imageUrl: undefined,
    sourceReady: true,
  });
  jest.clearAllMocks();
});

it("SEG-ENT-016/SEG-CACHE-008 isolates real source B after late annotation and upload completions from A", async () => {
  const f = fixture();
  const a = await open();
  a.service.setControls({ delayMs: 0 });
  const draft = a.store.getState().addClass("A isolated draft");
  const originalRead = a.service.loadFrameWindow.bind(a.service);
  const oldWindow = await originalRead(a.store.getState().document!.videos[0]!.id, 0, 1);
  const readGate = deferred<typeof oldWindow>();
  jest.spyOn(a.service, "loadFrameWindow").mockImplementation(async () => await readGate.promise);
  const oldRead = a.store.getState().loadFrameWindow(oldWindow.videoId, 0, 1);
  const inferenceA = jest.spyOn(a.service, "propagate");
  mockFile = {
    dataAssetName: "record-B",
    name: "record-B/files/b",
    filename: "b.mp4",
    sizeBytes: 8n,
  };
  pipeline.playerState.activeData.currentTime = fromNanoSec(350_000_000n);
  f.rerender(f.view("/rear"));
  f.setImage(300_000_000n, { topic: "/rear", providerId: "decoder-b" });
  f.event();
  const b = await open();
  expect(b).not.toBe(a);
  expect(b.store.getState().document!.classes).toEqual([]);
  const bVideo = b.store.getState().document!.videos[0]!.id;
  expect(bVideo).not.toBe(oldWindow.videoId);
  const bDocument = b.store.getState().document;
  const bFrame = b.store.getState().currentFrameId;
  const bImage = segmentationSession.getState().imageUrl;
  await act(async () => {
    readGate.resolve(oldWindow);
    await oldRead;
  });
  expect(segmentationSession.getState().runtime).toBe(b);
  expect(segmentationSession.getState().imageUrl).toBe(bImage);
  expect(b.store.getState().document).toEqual(bDocument);
  expect(b.store.getState().currentFrameId).toBe(bFrame);
  expect(a.store.getState().document!.classes.some((item) => item.id === draft)).toBe(true);
  expect(b.store.getState().document!.classes.some((item) => item.id === draft)).toBe(false);
  expect(inferenceA).not.toHaveBeenCalled();
  f.unmount();
  a.dispose();
  b.dispose();
});
