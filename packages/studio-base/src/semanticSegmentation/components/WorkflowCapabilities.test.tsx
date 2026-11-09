/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createMockSemanticSegmentationService } from "../mockService";
import { createSemanticSegmentationStore } from "../store";
import { SpatialTree } from "./SpatialTree";
import { WorkflowControls } from "./WorkflowControls";

afterEach(cleanup);

it("uses injected increasing-only choices and sends the supported model and resolution", async () => {
  const service = createMockSemanticSegmentationService({
    controls: { delayMs: 0, streamDelayMs: 0 },
    capabilities: {
      directions: ["forward"],
      models: ["small"],
      resolutions: [720],
      directionReasons: { backward: "Only increasing timestamps supported" },
    },
  });
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  store.getState().setFocus({ type: "instance", id: "instance-1" });
  const online = jest.spyOn(service, "propagate");
  render(<WorkflowControls store={store} />);
  expect(screen.getByRole("option", { name: /时间减少/ })).toHaveProperty("disabled", true);
  expect(screen.getByText(/Only increasing timestamps supported/)).toBeTruthy();
  expect(screen.getByRole("spinbutton", { name: "前帧数" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("spinbutton", { name: "前帧数" })).toHaveProperty("value", "0");
  expect(screen.getByRole("combobox", { name: "传播模型" })).toHaveProperty("value", "small");
  expect(screen.getByRole("combobox", { name: "传播分辨率" })).toHaveProperty("value", "720");
  fireEvent.change(screen.getByRole("spinbutton", { name: "后帧数" }), { target: { value: "1" } });
  const expected = {
    direction: "forward",
    model: "small",
    resolution: 720,
  };
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "在线传播" })).toHaveProperty("disabled", false);
  });
  fireEvent.click(screen.getByRole("button", { name: "在线传播" }));
  await waitFor(() => {
    expect(online).toHaveBeenCalledTimes(1);
  });
  expect(online.mock.calls[0]![0]).toMatchObject(expected);
  await waitFor(() => {
    expect(store.getState().propagation.status).toBe("completed");
  });
  store.getState().dispose();
});

it("keeps manual annotation available during capability loading/failure and retries only the declaration", async () => {
  const service = createMockSemanticSegmentationService({ controls: { delayMs: 0 } });
  const original = service.getPropagationCapabilities?.bind(service);
  let reject: ((error: Error) => void) | undefined;
  service.getPropagationCapabilities = async () =>
    await new Promise((_resolve, rejectQuery) => {
      reject = rejectQuery;
    });
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  store.getState().addClass("Retained capability draft");
  const reload = jest.spyOn(service, "loadDocument");
  render(
    <>
      <SpatialTree store={store} />
      <WorkflowControls store={store} />
    </>,
  );
  expect(screen.getByRole("button", { name: "New" })).toHaveProperty("disabled", false);
  expect(screen.getByText("正在读取模型传播能力…")).toBeTruthy();
  expect(screen.getByRole("button", { name: "在线传播" })).toHaveProperty("disabled", true);
  act(() => {
    reject?.(new Error("Declaration unavailable"));
  });
  await screen.findByText(/传播能力读取失败：Declaration unavailable/);
  service.getPropagationCapabilities = original;
  fireEvent.click(screen.getByRole("button", { name: "重试模型能力" }));
  await waitFor(() => {
    expect(store.getState().propagationCapabilitiesLoading).toBe(false);
  });
  expect(store.getState().propagationCapabilitiesError).toBeUndefined();
  expect(store.getState().stagedOperations).toHaveLength(1);
  expect(
    store.getState().document?.classes.some((item) => item.name === "Retained capability draft"),
  ).toBe(true);
  expect(reload).not.toHaveBeenCalled();
  store.getState().dispose();
});
