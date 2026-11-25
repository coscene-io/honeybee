/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { SegmentationTree } from "../components/SegmentationTree/SegmentationTree";
import { createSegmentationStore } from "../store";
import { CurrentFramePropagationForm } from "./fixtures/canvas";
import { render, installSegmentationTestHost } from "../testing/host";
import { createMockSegmentationService } from "../testing/mockService";
import { allowSlowRunner } from "../testing/slowRunner";

allowSlowRunner();

installSegmentationTestHost();

afterEach(cleanup);

describe("propagation capabilities", () => {
  it("uses the injected model choices and sends the supported model", async () => {
    const service = createMockSegmentationService({
      controls: { delayMs: 0, streamDelayMs: 0 },
      capabilities: { models: ["small"] },
    });
    const store = createSegmentationStore(service);
    await store.getState().initialize();
    store.getState().setFocus({ type: "instance", id: "instance-1" });
    const online = jest.spyOn(service, "propagate");
    render(<CurrentFramePropagationForm store={store} />);
    // A single supported model needs no choice: the dropdown is hidden and that model is sent.
    expect(screen.queryByRole("combobox", { name: "Propagation model" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "1 s" }));
    const expected = { model: "small" };
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start propagation" })).toHaveProperty(
        "disabled",
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Start propagation" }));
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
    const service = createMockSegmentationService({ controls: { delayMs: 0 } });
    const original = service.getPropagationCapabilities?.bind(service);
    let reject: ((error: Error) => void) | undefined;
    service.getPropagationCapabilities = async () =>
      await new Promise((_resolve, rejectQuery) => {
        reject = rejectQuery;
      });
    const store = createSegmentationStore(service);
    await store.getState().initialize();
    store.getState().addClass("Retained capability draft");
    const reload = jest.spyOn(service, "loadDocument");
    render(
      <>
        <SegmentationTree store={store} />
        <CurrentFramePropagationForm store={store} />
      </>,
    );
    expect(screen.getByRole("button", { name: "New" })).toHaveProperty("disabled", false);
    expect(screen.getByText("Loading the model's propagation capabilities…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start propagation" })).toHaveProperty(
      "disabled",
      true,
    );
    act(() => {
      reject?.(new Error("Declaration unavailable"));
    });
    await screen.findByText(/Could not load propagation capabilities: Declaration unavailable/);
    service.getPropagationCapabilities = original;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
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

  it("does not offer an instance merge the service cannot save", async () => {
    const service = createMockSegmentationService({ controls: { delayMs: 0 } });
    // The live AnnotationService declares this; merging there could drop frames on closed cameras.
    service.supportsInstanceMerge = false;
    const store = createSegmentationStore(service);
    await store.getState().initialize();
    expect(store.getState().supportsInstanceMerge).toBe(false);
    act(() => {
      store.getState().setSelection([{ type: "instance", id: "instance-1" }]);
    });
    render(<SegmentationTree store={store} />);
    expect(screen.getByRole("button", { name: "Merge" })).toHaveProperty("disabled", true);
    expect(() => {
      store.getState().mergeInstances(["instance-1"], "instance-2");
    }).toThrow(/does not support merging instances/);
    expect(store.getState().stagedOperations).toHaveLength(0);
    store.getState().dispose();
  });
});
