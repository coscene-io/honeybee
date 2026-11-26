/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { setupJestCanvasMock } from "jest-canvas-mock";
import * as THREE from "three";

import { fromNanoSec } from "@foxglove/rostime";
import { NumericType, PointCloud } from "@foxglove/schemas";
import { MessageEvent } from "@foxglove/studio";
import { Asset } from "@foxglove/studio-base/components/PanelExtensionAdapter";
import { RosValue } from "@foxglove/studio-base/players/types";
import { LabelMaterial } from "@foxglove/three-text";

import { FrameAxes } from "./FrameAxes";
import { LaserScans } from "./LaserScans";
import { Markers } from "./Markers";
import { PointClouds } from "./PointClouds";
import { PoseArrays } from "./PoseArrays";
import { DEFAULT_PUBLISH_SETTINGS } from "./PublishSettings";
import { FoxgloveSceneEntities } from "./SceneEntities";
import {
  computeSelectedObjectWorldPosition,
  formatSelectedObjectLabel,
  SelectedObjectLabel,
} from "./SelectedObjectLabel";
import { LAYER_SELECTED, RendererConfig } from "../IRenderer";
import { findPickedRenderable } from "../Picker";
import { Renderable } from "../Renderable";
import { Renderer } from "../Renderer";
import { DEFAULT_SCENE_EXTENSION_CONFIG } from "../SceneExtensionConfig";
import { DEFAULT_CAMERA_STATE } from "../camera";
import { MarkerType } from "../ros";
import { makePose } from "../transforms";

jest.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => "");

jest.mock("three", () => {
  const THREE_ACTUAL = jest.requireActual("three");
  return {
    ...THREE_ACTUAL,
    WebGLRenderer: function WebGLRenderer() {
      return {
        capabilities: {
          isWebGL2: true,
        },
        getPixelRatio: jest.fn(() => 1),
        setPixelRatio: jest.fn(),
        setSize: jest.fn(),
        render: jest.fn(),
        clear: jest.fn(),
        setClearColor: jest.fn(),
        readRenderTargetPixels: jest.fn(),
        info: {
          reset: jest.fn(),
        },
        shadowMap: {},
        dispose: jest.fn(),
        clearDepth: jest.fn(),
        getDrawingBufferSize: () => ({ width: 800, height: 600 }),
      };
    },
  };
});

class MockPointCloudRenderable extends Renderable {
  #point: Record<string, RosValue> | undefined;
  #shouldThrow = false;

  public constructor(name: string, renderer: Renderer, point: Record<string, RosValue>) {
    super(name, renderer, {
      receiveTime: 0n,
      messageTime: 0n,
      frameId: "lidar",
      pose: makePose(),
      settingsPath: ["topics", name],
      settings: { visible: true },
      topic: name,
    });
    this.#point = point;
  }

  public enableThrowOnRead(): void {
    this.#shouldThrow = true;
  }

  public override instanceDetails(_instanceId: number): Record<string, RosValue> | undefined {
    if (this.#shouldThrow) {
      throw new RangeError("Offset is outside the bounds of the DataView");
    }
    return this.#point;
  }
}

class MockEntityRenderable extends Renderable {
  #entityId: string;

  public constructor(name: string, topic: string, entityId: string, renderer: Renderer) {
    super(name, renderer, {
      receiveTime: 0n,
      messageTime: 0n,
      frameId: "map",
      pose: makePose(),
      settingsPath: ["topics", topic],
      settings: { visible: true },
      topic,
    });
    this.#entityId = entityId;
  }

  public override idFromMessage(): string {
    return this.#entityId;
  }
}

const fetchAsset = async (uri: string): Promise<Asset> => ({
  uri,
  data: new Uint8Array(),
});

function createConfig(overrides?: Partial<RendererConfig["scene"]>): RendererConfig {
  return {
    cameraState: DEFAULT_CAMERA_STATE,
    followMode: "follow-pose",
    followTf: undefined,
    scene: {
      transforms: { enablePreloading: false },
      ...overrides,
    },
    transforms: {},
    topics: {},
    layers: {},
    publish: DEFAULT_PUBLISH_SETTINGS,
    imageMode: {},
  };
}

describe("SelectedObjectLabel", () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    jest.clearAllMocks();
    setupJestCanvasMock();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: ReactNull,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });

    const parent = document.createElement("div");
    canvas = document.createElement("canvas");
    parent.appendChild(canvas);
  });

  afterEach(() => {
    (console.warn as jest.Mock).mockClear();
  });

  it("formats and positions a screen-space label for a selected PointCloud point", () => {
    const renderer = new Renderer({
      canvas,
      config: createConfig(),
      interfaceMode: "3d",
      fetchAsset,
      sceneExtensionConfig: DEFAULT_SCENE_EXTENSION_CONFIG,
      testOptions: {},
    });
    const extension = renderer.sceneExtensions.get(
      SelectedObjectLabel.extensionId,
    ) as SelectedObjectLabel;

    const pointCloud = new MockPointCloudRenderable("/lidar/points", renderer, {
      x: 1.25,
      y: -2.5,
      z: 0.75,
      intensity: 42.4,
    });
    const topicGroup = new THREE.Group();
    extension.add(topicGroup);
    topicGroup.add(pointCloud);
    pointCloud.position.set(10, 0, 0);

    expect(formatSelectedObjectLabel({ renderable: pointCloud, instanceIndex: 7 })).toBe(
      "/lidar/points\n(1.25, -2.50, 0.75) I:42.4",
    );

    const worldPos = new THREE.Vector3();
    expect(
      computeSelectedObjectWorldPosition({ renderable: pointCloud, instanceIndex: 7 }, worldPos),
    ).toBe(true);
    expect(worldPos.toArray()).toEqual([11.25, -2.5, 0.75]);

    renderer.setSelectedRenderable({ renderable: pointCloud, instanceIndex: 7 });
    const label = extension.getLabel();
    expect(label).toBeDefined();
    expect(label?.visible).toBe(true);
    expect(label?.position.toArray()).toEqual([11.25, -2.5, 0.75]);
    expect(label?.layers.mask).toBe(1 << LAYER_SELECTED);
    expect(label?.mesh.layers.mask).toBe(1 << LAYER_SELECTED);
    expect(label?.userData.picking).toBe(false);
    expect((label?.material as LabelMaterial).uniforms.uSizeAttenuation?.value).toBe(false);

    // A scene extension registered after the callout moves the object during this frame.
    const clouds = renderer.sceneExtensions.get(PointClouds.extensionId)!;
    jest.spyOn(clouds, "startFrame").mockImplementationOnce(() => {
      pointCloud.position.set(12, 1, 0);
    });
    renderer.animationFrame();
    expect(label?.position.toArray()).toEqual([13.25, -1.5, 0.75]);

    topicGroup.visible = false;
    renderer.animationFrame();
    expect(label?.visible).toBe(false);
    topicGroup.visible = true;
    renderer.animationFrame();
    expect(label?.visible).toBe(true);
    topicGroup.removeFromParent();
    renderer.animationFrame();
    expect(label?.visible).toBe(false);

    renderer.dispose();
  });

  it("reuses a single pooled Label across selections and skips FrameAxisRenderable", () => {
    const renderer = new Renderer({
      canvas,
      config: createConfig(),
      interfaceMode: "3d",
      fetchAsset,
      sceneExtensionConfig: DEFAULT_SCENE_EXTENSION_CONFIG,
      testOptions: {},
    });
    const extension = renderer.sceneExtensions.get(
      SelectedObjectLabel.extensionId,
    ) as SelectedObjectLabel;
    const frameAxes = renderer.sceneExtensions.get(FrameAxes.extensionId) as FrameAxes;
    const acquireSpy = jest.spyOn(renderer.labelPool, "acquire");

    const entityA = new MockEntityRenderable("entityA", "/scene", "box_1", renderer);
    const entityB = new MockEntityRenderable("entityB", "/scene", "box_2", renderer);

    extension.add(entityA, entityB);
    renderer.setSelectedRenderable({ renderable: entityA });
    const firstLabel = extension.getLabel();
    expect(firstLabel).toBeDefined();
    expect(firstLabel?.visible).toBe(true);
    expect(acquireSpy).toHaveBeenCalledTimes(1);

    renderer.setSelectedRenderable({ renderable: entityB });
    expect(extension.getLabel()).toBe(firstLabel);
    expect(acquireSpy).toHaveBeenCalledTimes(1);

    // A URDF selection retains its owning object while the picked link supplies the anchor.
    const link = new MockEntityRenderable("link", "/robot", "link", renderer);
    entityB.add(link);
    link.position.set(10, 20, 30);
    renderer.setSelectedRenderable({ renderable: entityB, pickedChild: link });
    expect(firstLabel?.position.toArray()).toEqual([10, 20, 30]);
    renderer.setCurrentTime(2n);
    renderer.handleSeek(1n);
    renderer.animationFrame();
    expect(firstLabel?.visible).toBe(true);
    expect(firstLabel?.position.toArray()).toEqual([10, 20, 30]);
    link.removeFromParent();
    renderer.animationFrame();
    expect(firstLabel?.visible).toBe(false);

    // Selecting a FrameAxisRenderable hides SelectedObjectLabel and keeps it hidden across frames
    renderer.addCoordinateFrame("base_link");
    const frameRenderable = frameAxes.renderables.get("base_link")!;
    renderer.setSelectedRenderable({ renderable: frameRenderable });
    expect(firstLabel?.visible).toBe(false);
    renderer.animationFrame();
    expect(firstLabel?.visible).toBe(false);

    // Disabling showSelectedObjectLabel hides the callout
    renderer.setSelectedRenderable({ renderable: entityA });
    expect(firstLabel?.visible).toBe(true);
    renderer.updateConfig((draft) => {
      draft.scene.showSelectedObjectLabel = false;
    });
    expect(firstLabel?.visible).toBe(false);
    renderer.animationFrame();
    expect(firstLabel?.visible).toBe(false);

    renderer.dispose();
  });

  function createTopicRenderer(topic: string): Renderer {
    const renderer = new Renderer({
      canvas,
      config: { ...createConfig(), followTf: "map", topics: { [topic]: { visible: true } } },
      interfaceMode: "3d",
      fetchAsset,
      sceneExtensionConfig: DEFAULT_SCENE_EXTENSION_CONFIG,
      testOptions: {},
    });
    renderer.addCoordinateFrame("map");
    return renderer;
  }

  async function renderMessage(
    renderer: Renderer,
    topic: string,
    schemaName: string,
    message: unknown,
  ) {
    const time = fromNanoSec(1n);
    await renderer.processMessageEvents({
      currentTime: time,
      didSeek: false,
      allFrames: undefined,
      currentFrame: [{ topic, schemaName, receiveTime: time, sizeInBytes: 0, message }],
    });
    renderer.animationFrame();
  }

  it("anchors the label to a laser return and hides it when the scan shrinks", async () => {
    const renderer = createTopicRenderer("/scan");
    const extension = renderer.sceneExtensions.get(
      SelectedObjectLabel.extensionId,
    ) as SelectedObjectLabel;
    const scans = renderer.sceneExtensions.get(LaserScans.extensionId) as LaserScans;
    const scan = { frame_id: "map", start_angle: 0, end_angle: Math.PI / 2, ranges: [1, 3] };
    await renderMessage(renderer, "/scan", "foxglove.LaserScan", scan);

    const renderable = scans.renderables.get("/scan")!.children[0] as Renderable;
    renderer.setSelectedRenderable({ renderable, instanceIndex: 1 });
    const label = extension.getLabel()!;
    expect(label.position.x).toBeCloseTo(0);
    expect(label.position.y).toBeCloseTo(3);
    expect(label.visible).toBe(true);
    await renderMessage(renderer, "/scan", "foxglove.LaserScan", { ...scan, ranges: [1] });
    expect(label.visible).toBe(false);
    renderer.setSelectedRenderable({ renderable, instanceIndex: 0 });
    expect(label.visible).toBe(true);
    expect(label.position.toArray()).toEqual([1, 0, 0]);
    renderer.dispose();
  });

  it("anchors a ROS line marker at its first point in the transformed marker frame", async () => {
    const renderer = createTopicRenderer("/markers");
    const extension = renderer.sceneExtensions.get(
      SelectedObjectLabel.extensionId,
    ) as SelectedObjectLabel;
    const markers = renderer.sceneExtensions.get(Markers.extensionId) as Markers;
    await renderMessage(renderer, "/markers", "visualization_msgs/Marker", {
      header: { frame_id: "map" },
      ns: "path",
      id: 1,
      type: MarkerType.LINE_STRIP,
      pose: { position: { x: 10, y: 3, z: 0 }, orientation: { x: 0, y: 0, z: 1, w: 0 } },
      points: [
        { x: 100, y: 0, z: 0 },
        { x: 110, y: 0, z: 0 },
      ],
    });
    const marker = markers.renderables.get("/markers")!.children[0] as Renderable;
    expect(formatSelectedObjectLabel({ renderable: marker })).toBe("/markers:path:1");
    renderer.setSelectedRenderable({ renderable: marker });
    const label = extension.getLabel()!;
    expect(label.visible).toBe(true);
    expect(label.position.toArray()).toEqual([-90, 3, 0]);
    renderer.setCurrentTime(2n);
    renderer.handleSeek(1n);
    renderer.animationFrame();
    expect(label.visible).toBe(false);
    renderer.dispose();
  });

  it("hides a cleared text marker and restores the callout when text returns", async () => {
    const renderer = createTopicRenderer("/sign");
    const extension = renderer.sceneExtensions.get(
      SelectedObjectLabel.extensionId,
    ) as SelectedObjectLabel;
    const markers = renderer.sceneExtensions.get(Markers.extensionId) as Markers;
    const update = async (text: string) => {
      await renderMessage(renderer, "/sign", "visualization_msgs/Marker", {
        header: { frame_id: "map" },
        id: 5,
        type: MarkerType.TEXT_VIEW_FACING,
        text,
      });
    };
    await update("Ready");
    const marker = markers.renderables.get("/sign")!.children[0] as Renderable;
    renderer.setSelectedRenderable({ renderable: marker });
    const label = extension.getLabel()!;
    expect(label.visible).toBe(true);
    await update("");
    expect(label.visible).toBe(false);
    await update("Go");
    expect(label.visible).toBe(true);
    renderer.dispose();
  });

  it("hides a selected path without a line segment and restores it on the next drawable update", async () => {
    const renderer = createTopicRenderer("/path");
    const topic = {
      name: "/path",
      schemaName: "nav_msgs/Path",
      messageCount: 4,
      messageFrequency: 1,
    };
    renderer.setTopics([topic]);
    const extension = renderer.sceneExtensions.get(
      SelectedObjectLabel.extensionId,
    ) as SelectedObjectLabel;
    const paths = renderer.sceneExtensions.get(PoseArrays.extensionId) as PoseArrays;
    const update = async (xs: number[]) => {
      const header = { frame_id: "map" };
      await renderMessage(renderer, topic.name, topic.schemaName, {
        header,
        poses: xs.map((x) => ({ header, pose: { ...makePose(), position: { x, y: 0, z: 0 } } })),
      });
    };
    await update([10, 12]);
    const lineStrip = paths.renderables.get("/path")!.userData.lineStrip!;
    renderer.setSelectedRenderable(findPickedRenderable(lineStrip));
    const label = extension.getLabel()!;
    expect(label.visible).toBe(true);
    expect(label.position.x).toBe(10);
    await update([]);
    expect(label.visible).toBe(false);
    await update([30]);
    expect(label.visible).toBe(false);
    await update([30, 40]);
    expect(label.visible).toBe(true);
    expect(label.position.x).toBe(30);
    renderer.dispose();
  });

  it("anchors a PoseArray selection to the picked axis and hides it when that pose disappears", async () => {
    const renderer = createTopicRenderer("/poses");
    const extension = renderer.sceneExtensions.get(
      SelectedObjectLabel.extensionId,
    ) as SelectedObjectLabel;
    const poses = renderer.sceneExtensions.get(PoseArrays.extensionId) as PoseArrays;
    const pose = { ...makePose(), position: { x: 100, y: 2, z: 3 } };
    const message = { header: { frame_id: "map" }, poses: [makePose(), pose] };
    await renderMessage(renderer, "/poses", "geometry_msgs/PoseArray", message);
    const owner = poses.renderables.get("/poses")!;
    const selectedAxis = owner.userData.axes[1]!;
    const selection = findPickedRenderable(selectedAxis.children[0]);
    expect(selection?.renderable).toBe(owner);
    expect(selection?.pickedChild).toBe(selectedAxis);
    renderer.setSelectedRenderable(selection);
    const label = extension.getLabel()!;
    expect(label.position.toArray()).toEqual([100, 2, 3]);
    await renderMessage(renderer, "/poses", "geometry_msgs/PoseArray", {
      ...message,
      poses: [makePose()],
    });
    expect(label.visible).toBe(false);
    renderer.dispose();
  });

  it("tracks an offset SceneEntity and drops the callout when its primitive is recycled", async () => {
    const renderer = createTopicRenderer("/scene");
    const extension = renderer.sceneExtensions.get(
      SelectedObjectLabel.extensionId,
    ) as SelectedObjectLabel;
    const entities = renderer.sceneExtensions.get(
      FoxgloveSceneEntities.extensionId,
    ) as FoxgloveSceneEntities;
    const entity = (id: string, x: number) => ({
      id,
      frame_id: "map",
      cubes: [{ pose: { ...makePose(), position: { x, y: 2, z: 3 } } }],
    });
    await renderMessage(renderer, "/scene", "foxglove.SceneUpdate", {
      entities: [entity("A", 100)],
    });
    const group = entities.renderables.get("/scene")!;
    const cube = group.children[0] as Renderable;
    renderer.setSelectedRenderable({ renderable: cube });
    const label = extension.getLabel()!;
    expect(label.position.toArray()).toEqual([100, 2, 3]);
    await renderMessage(renderer, "/scene", "foxglove.SceneUpdate", {
      entities: [entity("A", 120)],
    });
    expect(label.position.toArray()).toEqual([120, 2, 3]);
    await renderMessage(renderer, "/scene", "foxglove.SceneUpdate", {
      deletions: [{ id: "A" }],
      entities: [entity("B", 10)],
    });
    expect(group.children[0]).toBe(cube);
    expect(label.visible).toBe(false);
    renderer.dispose();
  });

  it("synchronizes label text and position when streaming point cloud data updates and hides safely on out-of-bounds index", async () => {
    const renderer = new Renderer({
      canvas,
      config: {
        ...createConfig(),
        followTf: "lidar",
        topics: {
          "/lidar/points": { visible: true },
        },
      },
      interfaceMode: "3d",
      fetchAsset,
      sceneExtensionConfig: DEFAULT_SCENE_EXTENSION_CONFIG,
      testOptions: {},
    });
    const extension = renderer.sceneExtensions.get(
      SelectedObjectLabel.extensionId,
    ) as SelectedObjectLabel;
    const pointClouds = renderer.sceneExtensions.get(PointClouds.extensionId) as PointClouds;

    const makeCloudEvent = (
      points: [number, number, number, number][],
      timeNs: bigint,
    ): MessageEvent<PointCloud> => {
      const stride = 16;
      const buffer = new ArrayBuffer(points.length * stride);
      const view = new DataView(buffer);
      points.forEach(([x, y, z, intensity], idx) => {
        const offset = idx * stride;
        view.setFloat32(offset + 0, x, true);
        view.setFloat32(offset + 4, y, true);
        view.setFloat32(offset + 8, z, true);
        view.setFloat32(offset + 12, intensity, true);
      });
      return {
        topic: "/lidar/points",
        receiveTime: fromNanoSec(timeNs),
        schemaName: "foxglove.PointCloud",
        sizeInBytes: buffer.byteLength,
        message: {
          timestamp: fromNanoSec(timeNs),
          frame_id: "lidar",
          pose: makePose(),
          point_stride: stride,
          fields: [
            { name: "x", offset: 0, type: NumericType.FLOAT32 },
            { name: "y", offset: 4, type: NumericType.FLOAT32 },
            { name: "z", offset: 8, type: NumericType.FLOAT32 },
            { name: "intensity", offset: 12, type: NumericType.FLOAT32 },
          ],
          data: new Uint8Array(buffer),
        },
      };
    };

    renderer.addCoordinateFrame("lidar");
    await renderer.processMessageEvents({
      currentTime: fromNanoSec(1n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [
        makeCloudEvent(
          [
            [0, 0, 0, 1],
            [1, 2, 3, 10],
            [4, 5, 6, 20],
          ],
          1n,
        ),
      ],
    });
    renderer.animationFrame();

    const historyRenderable = pointClouds.renderables.get("/lidar/points")!;
    const cloudRenderable = historyRenderable.children[0] as Renderable;

    const setStixels = (state: "enabled" | "disabled") => {
      pointClouds.handleSettingsAction({
        action: "update",
        payload: {
          path: ["topics", "/lidar/points", "stixelsEnabled"],
          input: "boolean",
          value: state === "enabled",
        },
      });
      renderer.animationFrame();
    };
    setStixels("enabled");
    const stixels = historyRenderable.children[1] as Renderable;
    renderer.setSelectedRenderable({ renderable: stixels });
    const stixelLabel = extension.getLabel()!;
    expect(stixelLabel.position.toArray()).toEqual([1, 2, 3]);
    setStixels("disabled");
    expect(stixelLabel.visible).toBe(false);
    setStixels("enabled");
    expect(stixelLabel.visible).toBe(true);

    // Select point index 2
    renderer.setSelectedRenderable({ renderable: cloudRenderable, instanceIndex: 2 });
    const label = extension.getLabel()!;
    const setTextSpy = jest.spyOn(label, "setText");
    expect(label.visible).toBe(true);
    expect(label.position.toArray()).toEqual([4, 5, 6]);

    // Streaming update changes point index 2's coordinates & intensity in-place
    const planarCloud = makeCloudEvent(
      [
        [0, 0, 0, 1],
        [1, 2, 3, 10],
        [7.5, -1.25, 2.5, 99.5],
      ],
      2n,
    );
    planarCloud.message.fields = planarCloud.message.fields.filter((field) => field.name !== "z");
    await renderer.processMessageEvents({
      currentTime: fromNanoSec(2n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [planarCloud],
    });
    renderer.animationFrame();

    expect(label.visible).toBe(true);
    expect(label.position.toArray()).toEqual([7.5, -1.25, 0]);
    expect(setTextSpy).toHaveBeenCalledWith("/lidar/points\n(7.50, -1.25, 0.00) I:99.5");

    // Subsequent frame shrinks the point cloud so index 2 is now out of bounds
    await renderer.processMessageEvents({
      currentTime: fromNanoSec(3n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [makeCloudEvent([[0, 0, 0, 1]], 3n)],
    });
    expect(() => {
      renderer.animationFrame();
    }).not.toThrow();
    expect(cloudRenderable.instanceDetails(2)).toBeUndefined();
    expect(label.visible).toBe(false);

    // Defense-in-depth: even if a custom renderable throws from instanceDetails(), rendering stays safe
    const throwingCloud = new MockPointCloudRenderable("/custom/points", renderer, {
      x: 1,
      y: 2,
      z: 3,
    });
    extension.add(throwingCloud);
    renderer.setSelectedRenderable({ renderable: throwingCloud, instanceIndex: 5 });
    expect(label.visible).toBe(true);
    throwingCloud.enableThrowOnRead();
    expect(() => {
      renderer.animationFrame();
    }).not.toThrow();
    expect(label.visible).toBe(false);

    renderer.dispose();
  });
});
