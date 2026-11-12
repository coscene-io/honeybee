/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { useStore } from "zustand";

import { fromNanoSec } from "@foxglove/rostime";
import { Sidebar, type SidebarItem } from "@foxglove/studio-base/components/Sidebars/Sidebar";
import {
  useWorkspaceStore,
  type LeftSidebarItemKey,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import WorkspaceContextProvider, {
  makeWorkspaceContextInitialState,
} from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { SegmentationCanvas } from "../../components/SegmentationCanvas";
import { SegmentationImageEntry } from "../../components/SegmentationImageEntry";
import { SpatialSidebar } from "../../components/SpatialSidebar";
import { segmentationImageSources, type SegmentationImage } from "../../imageSource";
import { segmentationSession } from "../../runtime";

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
jest.mock("@foxglove/studio-base/context/CoreDataContext", () => {
  const actual = jest.requireActual("@foxglove/studio-base/context/CoreDataContext");
  return {
    ...actual,
    useCoreData: (
      selector: (store: { record: { value?: { name: string; title: string } } }) => unknown,
    ) =>
      selector({
        record: {
          value: mockFile ? { name: mockFile.dataAssetName, title: mockFile.filename } : undefined,
        },
      }),
  };
});

// The Workspace.tsx moment→space entries are composed with the actual Sidebar and workspace actions.
// Moment content is only a marker for the initial tab; actual Moment form/list/detail tests are separate.
function MomentPanel(): React.JSX.Element {
  return <div>Existing Moment panel</div>;
}
const sidebarItems = new Map<LeftSidebarItemKey, SidebarItem>([
  ["moment", { title: "一刻", component: MomentPanel }],
  ["space", { title: "空间", component: SpatialSidebar }],
]);
function SidebarBinding(): React.JSX.Element {
  const left = useWorkspaceStore((state) => state.sidebars.left);
  const { sidebarActions } = useWorkspaceActions();
  return (
    <Sidebar
      items={sidebarItems}
      anchor="left"
      activeTab={left.open ? left.item : undefined}
      setActiveTab={sidebarActions.left.selectItem}
      onClose={() => {
        sidebarActions.left.setOpen(false);
      }}
    />
  );
}
function BoundCanvas(): React.JSX.Element | ReactNull {
  const session = useStore(segmentationSession);
  return session.open && session.runtime ? (
    <SegmentationCanvas
      store={session.runtime.store}
      imageUrl={session.imageUrl}
      disabled={!session.sourceReady}
    />
  ) : (
    ReactNull
  );
}
const initialWorkspace = makeWorkspaceContextInitialState();
initialWorkspace.sidebars.left.item = "moment";

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
    <WorkspaceContextProvider disablePersistence initialState={initialWorkspace}>
      <ThemeProvider isDark>
        <SidebarBinding />
        <div ref={containerRef}>
          <canvas width={8} height={4} />
          <SegmentationImageEntry
            containerRef={containerRef}
            topic={topic}
            panelId="panel-1"
            onMaximize={maximize}
          />
          <BoundCanvas />
        </div>
      </ThemeProvider>
    </WorkspaceContextProvider>
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

it("SEG-ENT-002 actual Workspace sidebar actions select adjacent Space from Moment and bind sidebar edits to decoded video/frame", async () => {
  mockFile = {
    dataAssetName: "workspace-binding-record",
    name: "workspace-binding-record/files/camera",
    filename: "camera.mp4",
    sizeBytes: 8n,
  };
  pipeline.playerState.activeData.currentTime = fromNanoSec(350_000_000n);
  const f = fixture();
  f.setImage(300_000_000n);
  const moment = screen.getByRole("tab", { name: "一刻" });
  const space = screen.getByRole("tab", { name: "空间" });
  expect(moment.getAttribute("aria-selected")).toBe("true");
  expect(space.getAttribute("aria-selected")).toBe("false");
  expect(moment.nextElementSibling).toBe(space);
  expect(screen.getByText("Existing Moment panel")).toBeDefined();
  const runtime = await open();
  await waitFor(() => {
    expect(space.getAttribute("aria-selected")).toBe("true");
  });
  expect(moment.getAttribute("aria-selected")).toBe("false");
  expect(screen.queryByText("Existing Moment panel")).toBeNull();
  const frame = runtime.store
    .getState()
    .document!.frames.find((item) => item.id === runtime.store.getState().currentFrameId)!;
  expect(frame.timestampSec).toBe(0.3);
  expect(frame.videoId).toBe(runtime.store.getState().document!.videos[0]!.id);
  expect(segmentationSession.getState().sourceReady).toBe(true);
  const canvas = screen.getByRole("img", { name: "Frame polygons" });
  expect(canvas.querySelector("image")!.getAttribute("href")).toBe(
    segmentationSession.getState().imageUrl,
  );
  Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
    configurable: true,
    value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  });
  fireEvent.click(screen.getByRole("button", { name: "New" }));
  fireEvent.change(screen.getByLabelText("Class name"), { target: { value: "Bound camera" } });
  fireEvent.keyDown(screen.getByLabelText("Class name"), { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "Add instance to Bound camera" }));
  fireEvent.click(screen.getByRole("button", { name: /Add polygon to.*#1$/ }));
  const polygonId = runtime.store.getState().drawingPolygonId!;
  for (const [x, y] of [
    [96, 54],
    [288, 54],
    [288, 162],
  ]) {
    fireEvent(
      canvas,
      new MouseEvent("pointerdown", { clientX: x, clientY: y, button: 0, bubbles: true }),
    );
  }
  fireEvent.keyDown(screen.getByLabelText("Segmentation canvas"), { key: "Enter" });
  expect(runtime.store.getState().currentFrameId).toBe(frame.id);
  const annotation = Object.values(runtime.store.getState().document!.annotations).find((item) =>
    item.polygons.some((polygon) => polygon.id === polygonId),
  )!;
  expect(annotation.frameId).toBe(frame.id);
  expect(annotation.polygons[0]!.points).toEqual([
    { x: 0.1, y: 0.1 },
    { x: 0.3, y: 0.1 },
    { x: 0.3, y: 0.3 },
  ]);
  expect(f.container.querySelectorAll(`[data-node-id="${polygonId}"]`)).toHaveLength(1);
  expect(
    runtime.store.getState().document!.frames.find((item) => item.id === annotation.frameId)!
      .videoId,
  ).toBe(frame.videoId);
  f.unmount();
  runtime.dispose();
});
