/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { setupJestCanvasMock } from "jest-canvas-mock";
import * as THREE from "three";

import { Asset } from "@foxglove/studio-base/components/PanelExtensionAdapter";
import { RosValue } from "@foxglove/studio-base/players/types";
import { LabelMaterial } from "@foxglove/three-text";

import { FrameAxes } from "./FrameAxes";
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
  #point: Record<string, RosValue>;

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

  public override instanceDetails(_instanceId: number): Record<string, RosValue> {
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

    // Selecting a FrameAxisRenderable hides SelectedObjectLabel to avoid duplicate labels
    renderer.addCoordinateFrame("base_link");
    const frameRenderable = frameAxes.renderables.get("base_link")!;
    renderer.setSelectedRenderable({ renderable: frameRenderable });
    expect(firstLabel?.visible).toBe(false);

    // Disabling showSelectedObjectLabel hides the callout
    renderer.setSelectedRenderable({ renderable: entityA });
    expect(firstLabel?.visible).toBe(true);
    renderer.updateConfig((draft) => {
      draft.scene.showSelectedObjectLabel = false;
    });
    expect(firstLabel?.visible).toBe(false);

    renderer.dispose();
  });
});
