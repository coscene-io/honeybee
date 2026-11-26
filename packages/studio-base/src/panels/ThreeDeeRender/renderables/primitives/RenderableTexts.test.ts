/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { setupJestCanvasMock } from "jest-canvas-mock";

import { SceneEntity, TextPrimitive } from "@foxglove/schemas";
import { LabelMaterial, LabelPool } from "@foxglove/three-text";

import { RenderableTexts } from "./RenderableTexts";
import type { IRenderer } from "../../IRenderer";
import { LayerSettingsEntity } from "../../settings";
import { makePose } from "../../transforms";
import { RenderableTopicAnnotations } from "../ImageMode/annotations/RenderableTopicAnnotations";

function makeTextPrimitive(text: string, overrides: Partial<TextPrimitive> = {}): TextPrimitive {
  return {
    pose: makePose(),
    billboard: true,
    font_size: 14,
    scale_invariant: true,
    color: { r: 1, g: 1, b: 1, a: 1 },
    text,
    ...overrides,
  };
}

function makeSceneEntity(texts: TextPrimitive[]): SceneEntity {
  return {
    timestamp: { sec: 1, nsec: 0 },
    frame_id: "map",
    id: "entity_1",
    lifetime: { sec: 0, nsec: 0 },
    frame_locked: false,
    metadata: [],
    arrows: [],
    cubes: [],
    spheres: [],
    cylinders: [],
    lines: [],
    triangles: [],
    texts,
    models: [],
  };
}

const DEFAULT_ENTITY_SETTINGS: LayerSettingsEntity = {
  visible: true,
  showOutlines: true,
  color: undefined,
  selectedIdVariable: undefined,
};

describe("RenderableTexts and RenderableTopicAnnotations pooling", () => {
  beforeEach(() => {
    setupJestCanvasMock();
  });

  it("reuses pooled labels across SceneEntity updates and guards against double-dispose", () => {
    const labelPool = new LabelPool();
    const renderer = { labelPool } as unknown as IRenderer;
    const acquireSpy = jest.spyOn(labelPool, "acquire");
    const releaseSpy = jest.spyOn(labelPool, "release");

    // Pre-pollute a pooled label with non-default anchor & depthTest before RenderableTexts acquires it
    const dirtyLabel = labelPool.acquire();
    dirtyLabel.setAnchorPoint(0, 0);
    dirtyLabel.material.depthTest = false;
    labelPool.release(dirtyLabel);
    acquireSpy.mockClear();
    releaseSpy.mockClear();

    const renderable = new RenderableTexts(renderer);
    renderable.update(
      "/scene",
      makeSceneEntity([makeTextPrimitive("one"), makeTextPrimitive("two")]),
      DEFAULT_ENTITY_SETTINGS,
      10n,
    );

    expect(acquireSpy).toHaveBeenCalledTimes(2);
    expect(renderable.children).toHaveLength(2);
    const firstLabel = renderable.children[0] as typeof dirtyLabel;
    expect(firstLabel).toBe(dirtyLabel);
    expect((firstLabel.material as LabelMaterial).uniforms.uAnchorPoint?.value).toEqual([0.5, 0.5]);
    expect(firstLabel.material.depthTest).toBe(true);
    expect((firstLabel.material as LabelMaterial).uniforms.uSizeAttenuation?.value).toBe(false);

    // Updating in-place with the same count does not acquire or release any labels
    renderable.update(
      "/scene",
      makeSceneEntity([makeTextPrimitive("one_updated"), makeTextPrimitive("two_updated")]),
      DEFAULT_ENTITY_SETTINGS,
      20n,
    );
    expect(acquireSpy).toHaveBeenCalledTimes(2);
    expect(releaseSpy).toHaveBeenCalledTimes(0);

    // Shrinking releases only excess labels back to LabelPool
    renderable.update(
      "/scene",
      makeSceneEntity([makeTextPrimitive("only_one")]),
      DEFAULT_ENTITY_SETTINGS,
      30n,
    );
    expect(releaseSpy).toHaveBeenCalledTimes(1);

    // Calling dispose twice releases remaining label exactly once
    renderable.dispose();
    renderable.dispose();
    expect(releaseSpy).toHaveBeenCalledTimes(2);

    labelPool.dispose();
  });

  it("releases RenderableTextAnnotation labels back to LabelPool when RenderableTopicAnnotations is disposed", () => {
    const labelPool = new LabelPool();
    const acquireSpy = jest.spyOn(labelPool, "acquire");
    const releaseSpy = jest.spyOn(labelPool, "release");

    const topicAnnotations = new RenderableTopicAnnotations("/annotations", labelPool);
    topicAnnotations.setAnnotations([
      {
        type: "text",
        stamp: { sec: 1, nsec: 0 },
        position: { x: 10, y: 20 },
        text: "car",
        textColor: { r: 1, g: 1, b: 1, a: 1 },
        backgroundColor: { r: 0, g: 0, b: 0, a: 1 },
        fontSize: 16,
        padding: 0,
        messagePath: ["texts", 0],
      },
    ]);
    topicAnnotations.update();

    expect(acquireSpy).toHaveBeenCalledTimes(1);
    expect(releaseSpy).toHaveBeenCalledTimes(0);

    topicAnnotations.dispose();
    topicAnnotations.dispose();

    expect(releaseSpy).toHaveBeenCalledTimes(1);
    labelPool.dispose();
  });
});
