// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createMockSemanticSegmentationService } from "./mockService";
import { createSemanticSegmentationStore } from "./store";
import type { PropagationCapabilities, PropagationRequest } from "./types";

const request: PropagationRequest = {
  instanceId: "instance-1",
  fromFrameId: "frame-0",
  direction: "forward",
  frameCount: 1,
  model: "small",
  resolution: 720,
};

async function prepared(capabilities?: Partial<PropagationCapabilities>) {
  const service = createMockSemanticSegmentationService({
    capabilities,
    controls: { delayMs: 0, streamDelayMs: 0 },
  });
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  return { service, store };
}

it("blocks unsupported direction, model and resolution before inference", async () => {
  const { service, store } = await prepared({
    directions: ["forward"],
    models: ["small"],
    resolutions: [720],
    directionReasons: { backward: "This mock supports increasing frame indices only" },
  });
  const online = jest.spyOn(service, "propagate");
  expect(store.getState().propagationCapabilities).toMatchObject({
    directions: ["forward"],
    models: ["small"],
    resolutions: [720],
  });
  await expect(
    store.getState().startPropagation({ ...request, direction: "backward" }),
  ).rejects.toThrow("increasing");
  await expect(store.getState().startPropagation({ ...request, model: "large" })).rejects.toThrow(
    "model",
  );
  await expect(store.getState().startPropagation({ ...request, resolution: 1080 })).rejects.toThrow(
    "resolution",
  );
  expect(online).not.toHaveBeenCalled();
  await store.getState().startPropagation(request);
  expect(online.mock.calls[0]![0]).toMatchObject({
    direction: "forward",
    model: "small",
    resolution: 720,
  });
  const queried = await service.getPropagationCapabilities!();
  queried.directions.push("backward");
  expect((await service.getPropagationCapabilities!()).directions).toEqual(["forward"]);
  store.getState().dispose();
});

it("leaves manual editing available when the capability query fails and preserves legacy adapters without that seam", async () => {
  const service = createMockSemanticSegmentationService({ controls: { delayMs: 0 } });
  service.getPropagationCapabilities = async () => {
    throw new Error("Capabilities unavailable");
  };
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  expect(store.getState().document).toBeDefined();
  expect(store.getState().propagationCapabilitiesError).toBe("Capabilities unavailable");
  expect(() => store.getState().addClass("Manual editing remains available")).not.toThrow();
  await expect(store.getState().startPropagation(request)).rejects.toThrow(
    "capabilities unavailable",
  );
  store.getState().dispose();
  const legacy = createMockSemanticSegmentationService({ controls: { delayMs: 0 } });
  legacy.getPropagationCapabilities = undefined;
  const legacyStore = createSemanticSegmentationStore(legacy);
  await legacyStore.getState().initialize();
  expect(legacyStore.getState().propagationCapabilities).toBeUndefined();
  expect(legacyStore.getState().propagationCapabilitiesError).toBeUndefined();
  expect(() => legacyStore.getState().addClass("Legacy manual editing")).not.toThrow();
  legacyStore.getState().dispose();
});

it("keeps document editing independent from a pending query and retries capabilities without losing drafts or accepting a stale query", async () => {
  const service = createMockSemanticSegmentationService({ controls: { delayMs: 0 } });
  const original = service.getPropagationCapabilities!.bind(service);
  let release!: (value: PropagationCapabilities) => void;
  service.getPropagationCapabilities = async () =>
    await new Promise<PropagationCapabilities>((resolve) => {
      release = resolve;
    });
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  expect(store.getState().document).toBeDefined();
  expect(store.getState().propagationCapabilitiesLoading).toBe(true);
  store.getState().addClass("Draft while declaration is pending");
  await expect(store.getState().startPropagation(request)).rejects.toThrow(
    "Wait for propagation capabilities",
  );
  const before = store.getState().document;
  service.getPropagationCapabilities = async () => {
    throw new Error("Retry query failed");
  };
  await store.getState().refreshPropagationCapabilities();
  release({ directions: ["forward"], models: ["small"], resolutions: [720] });
  await Promise.resolve();
  await Promise.resolve();
  expect(store.getState().propagationCapabilitiesError).toBe("Retry query failed");
  expect(store.getState().propagationCapabilities).toBeUndefined();
  service.getPropagationCapabilities = original;
  await store.getState().refreshPropagationCapabilities();
  expect(store.getState().propagationCapabilitiesError).toBeUndefined();
  expect(store.getState().propagationCapabilitiesLoading).toBe(false);
  expect(store.getState().document).toBe(before);
  expect(store.getState().stagedOperations).toHaveLength(1);
  store.getState().dispose();
});
