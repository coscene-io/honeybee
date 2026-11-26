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
import { PointClouds } from "./PointClouds";
import { DEFAULT_PUBLISH_SETTINGS } from "./PublishSettings";
import {
  computeSelectedObjectWorldPosition,
  formatSelectedObjectLabel,
  SelectedObjectLabel,
} from "./SelectedObjectLabel";
import { LAYER_SELECTED, RendererConfig } from "../IRenderer";
import { Renderable } from "../Renderable";
import { Renderer } from "../Renderer";
import { DEFAULT_SCENE_EXTENSION_CONFIG } from "../SceneExtensionConfig";
import { DEFAULT_CAMERA_STATE } from "../camera";
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

    // Moving the selected object updates the label position on next frame
    pointCloud.position.set(12, 1, 0);
    renderer.animationFrame();
    expect(label?.position.toArray()).toEqual([13.25, -1.5, 0.75]);

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

    renderer.setSelectedRenderable({ renderable: entityA });
    const firstLabel = extension.getLabel();
    expect(firstLabel).toBeDefined();
    expect(firstLabel?.visible).toBe(true);
    expect(acquireSpy).toHaveBeenCalledTimes(1);

    renderer.setSelectedRenderable({ renderable: entityB });
    expect(extension.getLabel()).toBe(firstLabel);
    expect(acquireSpy).toHaveBeenCalledTimes(1);

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

    // Select point index 2
    renderer.setSelectedRenderable({ renderable: cloudRenderable, instanceIndex: 2 });
    const label = extension.getLabel()!;
    const setTextSpy = jest.spyOn(label, "setText");
    expect(label.visible).toBe(true);
    expect(label.position.toArray()).toEqual([4, 5, 6]);

    // Streaming update changes point index 2's coordinates & intensity in-place
    await renderer.processMessageEvents({
      currentTime: fromNanoSec(2n),
      didSeek: false,
      allFrames: undefined,
      currentFrame: [
        makeCloudEvent(
          [
            [0, 0, 0, 1],
            [1, 2, 3, 10],
            [7.5, -1.25, 2.5, 99.5],
          ],
          2n,
        ),
      ],
    });
    renderer.animationFrame();

    expect(label.visible).toBe(true);
    expect(label.position.toArray()).toEqual([7.5, -1.25, 2.5]);
    expect(setTextSpy).toHaveBeenCalledWith("/lidar/points\n(7.50, -1.25, 2.50) I:99.5");

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
