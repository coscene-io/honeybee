/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { setupJestCanvasMock } from "jest-canvas-mock";

import { SettingsTreeAction } from "@foxglove/studio";
import { Asset } from "@foxglove/studio-base/components/PanelExtensionAdapter";
import { LabelMaterial } from "@foxglove/three-text";

import { DEFAULT_TF_LABEL_SIZE, DEFAULT_TF_LABEL_SIZE_PX, FrameAxes } from "./FrameAxes";
import { DEFAULT_PUBLISH_SETTINGS } from "./PublishSettings";
import { DEFAULT_LABEL_SCALE_FACTOR, SceneSettings } from "./SceneSettings";
import type { RendererConfig } from "../IRenderer";
import { Renderer } from "../Renderer";
import { DEFAULT_SCENE_EXTENSION_CONFIG } from "../SceneExtensionConfig";
import { DEFAULT_CAMERA_STATE } from "../camera";
import { HIGHLIGHT_LABEL_RENDER_ORDER } from "../labels/labelUtils";

jest.mock("three/examples/jsm/libs/draco/draco_decoder.wasm", () => "");

jest.mock("three", () => {
  const THREE = jest.requireActual("three");
  return {
    ...THREE,
    WebGLRenderer: function WebGLRenderer() {
      return {
        capabilities: {
          isWebGL2: true,
        },
        getPixelRatio: jest.fn(() => 2),
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

function createDefaultConfig(overrides?: Partial<RendererConfig["scene"]>): RendererConfig {
  return {
    cameraState: { ...DEFAULT_CAMERA_STATE, distance: 10 },
    followMode: "follow-pose",
    followTf: "world",
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

const fetchAsset = async (uri: string): Promise<Asset> => ({
  uri,
  data: new Uint8Array(),
});

describe("FrameAxes unified @foxglove/three-text labels", () => {
  let canvas: HTMLCanvasElement;
  let parent: HTMLDivElement;

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

    parent = document.createElement("div");
    Object.defineProperty(parent, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(parent, "clientHeight", { value: 600, configurable: true });
    canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    parent.appendChild(canvas);
  });

  afterEach(() => {
    (console.warn as jest.Mock).mockClear();
  });

  function createRenderer(sceneOverrides?: Partial<RendererConfig["scene"]>): Renderer {
    return new Renderer({
      canvas,
      config: createDefaultConfig(sceneOverrides),
      interfaceMode: "3d",
      fetchAsset,
      sceneExtensionConfig: DEFAULT_SCENE_EXTENSION_CONFIG,
      testOptions: {},
    });
  }

  it("supports switching between world-space and screen-space scale-invariant labels", () => {
    const renderer = createRenderer();
    const frameAxes = renderer.sceneExtensions.get(FrameAxes.extensionId) as FrameAxes;

    renderer.addCoordinateFrame("world");
    const renderable = frameAxes.renderables.get("world")!;
    const label = renderable.userData.label;
    const mat = label.material as LabelMaterial;
    const setLineHeightSpy = jest.spyOn(label, "setLineHeight");

    expect(mat.uniforms.uSizeAttenuation?.value).toBe(true);
    expect(mat.uniforms.uAnchorPoint?.value).toEqual([0.5, 0.5]);

    const enableScreenSpace: SettingsTreeAction = {
      action: "update",
      payload: {
        path: ["transforms", "settings", "scaleInvariantLabels"],
        input: "boolean",
        value: true,
      },
    };
    frameAxes.handleSettingsAction(enableScreenSpace);

    expect(mat.uniforms.uSizeAttenuation?.value).toBe(false);
    expect(mat.uniforms.uAnchorPoint?.value).toEqual([0.5, 0]);
    expect(setLineHeightSpy).toHaveBeenCalledWith(DEFAULT_TF_LABEL_SIZE_PX);

    // Switching back restores world-space defaults
    const disableScreenSpace: SettingsTreeAction = {
      action: "update",
      payload: {
        path: ["transforms", "settings", "scaleInvariantLabels"],
        input: "boolean",
        value: false,
      },
    };
    frameAxes.handleSettingsAction(disableScreenSpace);

    expect(mat.uniforms.uSizeAttenuation?.value).toBe(true);
    expect(mat.uniforms.uAnchorPoint?.value).toEqual([0.5, 0.5]);
    expect(setLineHeightSpy).toHaveBeenCalledWith(DEFAULT_TF_LABEL_SIZE);

    renderer.dispose();
  });

  it("preserves LabelMaterial resolution uniform ownership across canvas resizes", () => {
    const renderer = createRenderer({
      transforms: { enablePreloading: false, scaleInvariantLabels: true },
    });
    const frameAxes = renderer.sceneExtensions.get(FrameAxes.extensionId) as FrameAxes;

    renderer.addCoordinateFrame("world");
    const label = frameAxes.renderables.get("world")!.userData.label;
    const mat = label.material as LabelMaterial;

    // Simulate physical-pixel viewport populated by LabelMaterial.onBeforeRender (2x DPR)
    mat.uniforms.resolution!.value.set(1600, 1200);
    renderer.input.canvasSize.set(1024, 768);
    renderer.animationFrame();

    // Renderer.#updateResolution() must NOT overwrite LabelMaterial's physical viewport uniform
    expect(mat.uniforms.resolution!.value.x).toBe(1600);
    expect(mat.uniforms.resolution!.value.y).toBe(1200);

    renderer.dispose();
  });

  it("culls distant and dense overlapping labels while keeping search-highlighted and selected frames visible", () => {
    const renderer = createRenderer({
      transforms: {
        enablePreloading: false,
        labelMaxDistance: 20,
        labelMinSpacing: 60,
        labelFilter: "target",
      },
    });
    const frameAxes = renderer.sceneExtensions.get(FrameAxes.extensionId) as FrameAxes;
    renderer.input.canvasSize.set(800, 600);

    renderer.addCoordinateFrame("world");
    renderer.addTransform("world", "near_a", 0n, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    renderer.addTransform(
      "world",
      "near_b",
      0n,
      { x: 0.01, y: 0.01, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
    );
    renderer.addTransform(
      "world",
      "far_hidden",
      0n,
      { x: 100, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
    );
    renderer.addTransform(
      "world",
      "far_target_link",
      0n,
      { x: 100, y: 5, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
    );
    renderer.setFollowFrameId("world");
    renderer.animationFrame();

    const nearA = frameAxes.renderables.get("near_a")!;
    const nearB = frameAxes.renderables.get("near_b")!;
    const farHidden = frameAxes.renderables.get("far_hidden")!;
    const farTarget = frameAxes.renderables.get("far_target_link")!;

    // Far unhighlighted frame is culled by maxDistance
    expect(farHidden.userData.label.visible).toBe(false);
    // Search-matched far frame bypasses culling and gets highlight styling
    expect(farTarget.userData.label.visible).toBe(true);
    expect(farTarget.userData.label.renderOrder).toBe(HIGHLIGHT_LABEL_RENDER_ORDER);
    expect(farTarget.userData.label.material.depthTest).toBe(false);

    // Selecting the previously hidden far frame highlights and pins it visible
    renderer.setSelectedRenderable({ renderable: farHidden });
    renderer.animationFrame();
    expect(farHidden.userData.label.visible).toBe(true);
    expect(farHidden.userData.label.renderOrder).toBe(HIGHLIGHT_LABEL_RENDER_ORDER);

    // Dense near_a/near_b overlapping the origin are thinned by minSpacingPx
    const visibleNearCount = [
      frameAxes.renderables.get("world")!.userData.label.visible,
      nearA.userData.label.visible,
      nearB.userData.label.visible,
    ].filter(Boolean).length;
    expect(visibleNearCount).toBe(1);

    // Deselecting restores normal depth testing & renderOrder
    renderer.setSelectedRenderable(undefined);
    expect(farHidden.userData.label.renderOrder).toBe(0);
    expect(farHidden.userData.label.material.depthTest).toBe(true);

    renderer.dispose();
  });

  it("measures max distance from the view center after switching to orthographic projection", () => {
    const renderer = createRenderer({ transforms: { labelMaxDistance: 20 } });
    renderer.addCoordinateFrame("world");
    renderer.addTransform(
      "world",
      "panned",
      0n,
      { x: 100, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
    );
    const axes = renderer.sceneExtensions.get(FrameAxes.extensionId) as FrameAxes;
    const world = axes.renderables.get("world")!.userData.label;
    const panned = axes.renderables.get("panned")!.userData.label;
    renderer.updateConfig((draft) => {
      draft.cameraState.perspective = false;
      draft.cameraState.targetOffset = [100, 0, 0];
    });
    for (const far of [5000, 10000]) {
      renderer.setCameraState({ ...renderer.config.cameraState, far });
      renderer.animationFrame();
      expect(world.visible).toBe(false);
      expect(panned.visible).toBe(true);
    }
    renderer.dispose();
  });

  it("resets LabelPool scaleFactor when SceneSettings resets the scene", () => {
    const renderer = createRenderer({ labelScaleFactor: 2.5 });
    const sceneSettings = renderer.sceneExtensions.get(SceneSettings.extensionId) as SceneSettings;

    expect(renderer.labelPool.scaleFactor).toBe(2.5);

    sceneSettings.handleSettingsAction({
      action: "perform-node-action",
      payload: { path: ["scene"], id: "reset-scene" },
    });

    expect(renderer.labelPool.scaleFactor).toBe(DEFAULT_LABEL_SCALE_FACTOR);
    renderer.dispose();
  });
});
