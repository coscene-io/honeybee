/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";

import { fromNanoSec } from "@foxglove/rostime";
import type { Progress, SubscribeMessageRange } from "@foxglove/studio-base/players/types";

import { segmentationImageSources, type SegmentationImage } from "../imageSource";
import { segmentationSession } from "../runtime";
import { SegmentationImageEntry } from "./SegmentationImageEntry";

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
    progress: { messageCache: { blocks: [], startTime: { sec: 0, nsec: 0 } } } as Progress,
    activeData: {
      startTime: fromNanoSec(0n),
      endTime: fromNanoSec(1_000_000_000n),
      currentTime: fromNanoSec(99_999_999n),
      lastSeekTime: 0,
      isPlaying: false,
      messages: [],
    },
  },
  pausePlayback: jest.fn(),
  seekPlayback: jest.fn(),
  subscribeMessageRange: undefined as SubscribeMessageRange | undefined,
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
  pipeline.playerState.activeData.isPlaying = false;
  pipeline.playerState.progress = { messageCache: { blocks: [], startTime: { sec: 0, nsec: 0 } } };
  pipeline.subscribeMessageRange = undefined;
  segmentationSession.setState({
    runtime: undefined,
    open: false,
    panelId: undefined,
    imageUrl: undefined,
    sourceReady: true,
  });
  jest.clearAllMocks();
});

it("uses the sparse presentation index and actual decoded first/last frame, without a duration+1 phantom", async () => {
  const f = fixture();
  const runtime = await open("maximize");
  expect(selectItem).toHaveBeenCalledWith("space");
  expect(maximize).toHaveBeenCalledTimes(1);
  expect(runtime.store.getState().document?.frames.map((frame) => frame.timestampSec)).toEqual([
    0, 0.3, 0.9,
  ]);
  expect(runtime.store.getState().currentFrameId).toBe(
    runtime.store.getState().document?.frames[0]?.id,
  );
  expect(segmentationSession.getState().imageUrl).toContain("first");
  pipeline.playerState.activeData.currentTime = fromNanoSec(1_000_000_000n);
  f.setImage(900_000_000n);
  f.event();
  expect(runtime.store.getState().currentFrameId).toBe(
    runtime.store.getState().document?.frames[2]?.id,
  );
  expect(segmentationSession.getState().sourceReady).toBe(true);
});

it("gates delayed decoding and never relabels old pixels as the requested frame", async () => {
  const f = fixture();
  const runtime = await open();
  const first = runtime.store.getState().currentFrameId;
  pipeline.playerState.activeData.currentTime = fromNanoSec(950_000_000n);
  f.rerender(f.view());
  expect(segmentationSession.getState().sourceReady).toBe(false);
  expect(runtime.store.getState().currentFrameId).toBe(first);
  f.setImage(900_000_000n);
  f.event();
  expect(segmentationSession.getState().sourceReady).toBe(true);
  expect(runtime.store.getState().currentFrameId).not.toBe(first);
  f.setImage(300_000_000n); // A late decode from the previous seek must not overwrite the newer target.
  f.event();
  expect(segmentationSession.getState().sourceReady).toBe(false);
  expect(segmentationSession.getState().imageUrl).toContain("900000000");
});

it.each(["topic", "player"])(
  "closes the binding on a %s switch and keeps its draft isolated",
  async (kind) => {
    const f = fixture();
    const runtime = await open();
    const id = runtime.store.getState().addClass("retained draft");
    if (kind === "player") {
      pipeline.playerState.playerId = "new-player";
    }
    f.rerender(f.view(kind === "topic" ? "/rear" : "/camera"));
    expect(segmentationSession.getState().open).toBe(false);
    f.setImage(900_000_000n, { providerId: "decoder-b", topic: "/rear" });
    f.event();
    expect(segmentationSession.getState().imageUrl).toBeUndefined();
    expect(runtime.store.getState().document?.classes).toEqual([
      { id, name: "retained draft", color: expect.any(String) },
    ]);
  },
);

it("ignores initialization completing after a source switch", async () => {
  const f = fixture();
  fireEvent.click(screen.getByTitle("编辑空间标注"));
  f.rerender(f.view("/rear"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
  });
  expect(segmentationSession.getState().open).toBe(false);
});

it("detaches the frame listener and clears captured image resources on panel removal", async () => {
  const f = fixture();
  await open();
  f.unmount();
  const calls = f.capture.mock.calls.length;
  f.event();
  expect(f.capture).toHaveBeenCalledTimes(calls);
  expect(segmentationSession.getState()).toMatchObject({
    open: false,
    imageUrl: undefined,
    panelId: undefined,
    sourceReady: false,
  });
});

it("uses real raw/compressed message stamps instead of inventing frame zero under displayed pixels", async () => {
  const f = fixture();
  pipeline.playerState.activeData.currentTime = fromNanoSec(700_000_000n);
  f.setImage(650_000_000n, {
    source: undefined,
    providerId: undefined,
    timestamp: fromNanoSec(123_000_000n),
  });
  const runtime = await open();
  expect(runtime.store.getState().document?.frames).toHaveLength(1);
  expect(runtime.store.getState().document?.frames[0]).toMatchObject({ timestampSec: 0.65 });
  expect(runtime.store.getState().currentFrameId).toContain("123000000:650000000");
});

it("registers every cached frame of the canvas, not just the decoded one", async () => {
  const f = fixture();
  pipeline.playerState.progress = {
    messageCache: {
      startTime: { sec: 0, nsec: 0 },
      blocks: [
        {
          sizeInBytes: 3,
          messagesByTopic: {
            "/camera": [0.1, 0.4, 0.7].map((seconds) => ({
              topic: "/camera",
              schemaName: "sensor_msgs/CompressedImage",
              receiveTime: fromNanoSec(BigInt(seconds * 1e9)),
              message: { timestamp: fromNanoSec(BigInt(seconds * 1e9)) },
              sizeInBytes: 1,
            })),
            "/other": [
              {
                topic: "/other",
                schemaName: "sensor_msgs/CompressedImage",
                receiveTime: fromNanoSec(200_000_000n),
                message: { timestamp: fromNanoSec(200_000_000n) },
                sizeInBytes: 1,
              },
            ],
          },
        },
      ],
    },
  };
  pipeline.playerState.activeData.currentTime = fromNanoSec(700_000_000n);
  f.setImage(650_000_000n, { source: undefined, providerId: undefined });
  const runtime = await open();
  expect(runtime.store.getState().document?.frames.map((frame) => frame.timestampSec)).toEqual([
    0.1, 0.4, 0.65, 0.7,
  ]);
  pipeline.playerState.progress.messageCache!.blocks = [
    ...pipeline.playerState.progress.messageCache!.blocks,
    {
      sizeInBytes: 1,
      messagesByTopic: {
        "/camera": [
          {
            topic: "/camera",
            schemaName: "sensor_msgs/CompressedImage",
            receiveTime: fromNanoSec(950_000_000n),
            message: { timestamp: fromNanoSec(950_000_000n) },
            sizeInBytes: 1,
          },
        ],
      },
    },
  ];
  f.event();
  expect(runtime.store.getState().document?.frames.map((frame) => frame.timestampSec)).toEqual([
    0.1, 0.4, 0.65, 0.7, 0.95,
  ]);
  expect(runtime.store.getState().currentFrameId).toContain("650000000:650000000");
});

it("registers frames the player can read after the current one", async () => {
  const f = fixture();
  pipeline.playerState.activeData.currentTime = fromNanoSec(700_000_000n);
  f.setImage(650_000_000n, { source: undefined, providerId: undefined });
  pipeline.subscribeMessageRange = ({ onNewRangeIterator }) => {
    void onNewRangeIterator(
      (async function* () {
        yield [0.8, 0.85, 0.9].map((seconds) => ({
          topic: seconds === 0.85 ? "/other" : "/camera",
          schemaName: "sensor_msgs/CompressedImage",
          receiveTime: fromNanoSec(BigInt(seconds * 1e9)),
          message: { timestamp: fromNanoSec(BigInt(seconds * 1e9)) },
          sizeInBytes: 1,
        }));
      })(),
    );
    return () => undefined;
  };
  const runtime = await open();
  await waitFor(() => {
    expect(runtime.store.getState().document?.frames.map((frame) => frame.timestampSec)).toEqual([
      0.65, 0.8, 0.9,
    ]);
  });
});

it("appends newly decoded feed frames and keeps frame identity across subsequent staged edits", async () => {
  const f = fixture();
  pipeline.playerState.progress = { messageCache: { blocks: [], startTime: { sec: 0, nsec: 0 } } };
  pipeline.playerState.activeData.currentTime = fromNanoSec(700_000_000n);
  f.setImage(650_000_000n, { source: undefined, providerId: undefined });
  const runtime = await open();
  const id = runtime.store.getState().addClass("feed draft");
  pipeline.playerState.activeData.currentTime = fromNanoSec(950_000_000n);
  f.setImage(900_000_000n);
  runtime.service.setControls({ failNext: true });
  f.event();
  expect(runtime.store.getState().document?.frames.map((frame) => frame.timestampSec)).toEqual([
    0.65, 0.9,
  ]);
  expect(runtime.store.getState().currentFrameId).toContain("900000000:900000000");
  expect(runtime.store.getState().document?.classes.some((item) => item.id === id)).toBe(true);
  expect(runtime.store.getState().stagedOperations).toHaveLength(1);
  expect(segmentationSession.getState().sourceReady).toBe(false);
  await waitFor(() => {
    expect(runtime.store.getState().frameWindowError).toBeDefined();
  });
  expect(segmentationSession.getState().sourceReady).toBe(false);
  await act(async () => {
    await runtime.store.getState().retryCurrentFrameWindow();
  });
  await waitFor(() => {
    expect(segmentationSession.getState().sourceReady).toBe(true);
  });
  runtime.store.setState({ error: "Unrelated GPU status failure" });
  f.event();
  expect(segmentationSession.getState().sourceReady).toBe(true);
  pipeline.playerState.activeData.endTime = fromNanoSec(2_000_000_000n);
  pipeline.playerState.activeData.currentTime = fromNanoSec(1_950_000_000n);
  f.setImage(1_900_000_000n);
  f.event();
  expect(runtime.store.getState().document?.frames.map((frame) => frame.timestampSec)).toEqual([
    0.65, 0.9, 1.9,
  ]);
  expect(runtime.store.getState().document?.videos[0]?.durationSec).toBe(2);
});

it("fences a different video file inside the same record and topic", async () => {
  mockFile = {
    dataAssetName: "record-with-two-files",
    name: "record/files/a",
    filename: "a.mp4",
    sizeBytes: 100n,
  };
  const f = fixture();
  const runtime = await open();
  const first = runtime.store.getState().currentFrameId;
  pipeline.playerState.urlState.parameters.url = "https://example.com/b.mp4";
  f.rerender(f.view());
  f.setImage(900_000_000n);
  f.event();
  expect(segmentationSession.getState().open).toBe(false);
  expect(runtime.store.getState().currentFrameId).toBe(first);
});

it("closes and reconnects isolated cached user sessions without discarding drafts", async () => {
  const f = fixture();
  const first = await open();
  const classId = first.store.getState().addClass("first user draft");
  mockUserId = "second-fixture-user";
  f.rerender(f.view());
  f.setImage(0n);
  const second = await open();
  expect(second).not.toBe(first);
  expect(second.store.getState().document?.classes).toEqual([]);
  mockUserId = "fixture-user";
  f.rerender(f.view());
  f.setImage(0n);
  expect(await open()).toBe(first);
  expect(first.store.getState().document?.classes.some((item) => item.id === classId)).toBe(true);
  f.unmount();
});

it("keeps immutable historical geometry aligned with later decoded native seeks", async () => {
  const f = fixture();
  const runtime = await open();
  await act(async () => {
    await runtime.store.getState().viewRevision("revision-0");
  });
  expect(runtime.store.getState().readonly).toBe(true);
  const liveRead = jest.spyOn(runtime.service, "loadFrameWindow");
  pipeline.playerState.activeData.currentTime = fromNanoSec(950_000_000n);
  f.setImage(900_000_000n);
  f.event();
  expect(runtime.store.getState().currentFrameId).toContain("900000000:900000000");
  expect(segmentationSession.getState().imageUrl).toContain("900000000");
  expect(segmentationSession.getState().sourceReady).toBe(true);
  expect(liveRead).not.toHaveBeenCalled();
  expect(runtime.store.getState().readonly).toBe(true);
});

it("withholds decoded-frame navigation and cached reentry until terminal stop acknowledgement", async () => {
  const f = fixture();
  const runtime = await open();
  const first = runtime.store.getState().currentFrameId;
  act(() => {
    runtime.store.setState({
      propagation: { status: "stopping", processedFrames: 0, cancellationPending: true },
    });
  });
  pipeline.playerState.activeData.currentTime = fromNanoSec(350_000_000n);
  f.setImage(300_000_000n);
  f.event();
  expect(runtime.store.getState().currentFrameId).toBe(first);
  expect(segmentationSession.getState().sourceReady).toBe(false);
  f.rerender(f.view("/other-camera"));
  f.rerender(f.view());
  pipeline.playerState.activeData.currentTime = fromNanoSec(99_999_999n);
  f.setImage(0n);
  fireEvent.click(screen.getByTitle("编辑空间标注"));
  await screen.findByText("请等待传播停止确认后再进入标注。");
  expect(segmentationSession.getState().open).toBe(false);
  act(() => {
    runtime.store.setState({
      propagation: { status: "cancelled", processedFrames: 0, cancellationPending: false },
    });
  });
  expect(await open()).toBe(runtime);
  expect(runtime.store.getState().currentFrameId).toBe(first);
  expect(segmentationSession.getState().sourceReady).toBe(true);
});

it("entry leaves the native clock and playback alone and binds the displayed log time", async () => {
  fixture();
  const runtime = await open();
  expect(pipeline.pausePlayback).not.toHaveBeenCalled();
  expect(pipeline.seekPlayback).not.toHaveBeenCalled();
  expect(pipeline.playerState.activeData.currentTime).toEqual(fromNanoSec(99_999_999n));
  const state = runtime.store.getState();
  expect(state.document?.frames.find((frame) => frame.id === state.currentFrameId)?.logTimeNs).toBe(
    "0",
  );
});

it("does not annotate a future native image before its timestamp or seek to make it valid", async () => {
  const f = fixture();
  f.setImage(300_000_000n);
  await open();
  expect(segmentationSession.getState().sourceReady).toBe(false);
  expect(pipeline.seekPlayback).not.toHaveBeenCalled();
  pipeline.playerState.activeData.currentTime = fromNanoSec(300_000_000n);
  f.event();
  expect(segmentationSession.getState().sourceReady).toBe(true);
  expect(segmentationSession.getState().decodedFrame?.frameId).toContain("300000000");
});

it("keeps native playback running while editing is gated", async () => {
  const f = fixture();
  pipeline.playerState.activeData.isPlaying = true;
  await open();
  expect(pipeline.pausePlayback).not.toHaveBeenCalled();
  expect(segmentationSession.getState().sourceReady).toBe(false);
  pipeline.playerState.activeData.isPlaying = false;
  f.event();
  expect(segmentationSession.getState().sourceReady).toBe(true);
});
