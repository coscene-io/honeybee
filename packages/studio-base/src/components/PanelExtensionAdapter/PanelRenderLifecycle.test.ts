// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Immutable, MessageEvent, PanelExtensionContext, RenderState } from "@foxglove/studio";

import { PanelRenderLifecycle } from "./PanelRenderLifecycle";
import type { BuilderRenderStateInput } from "./renderState";

const message = (value: number): MessageEvent => ({
  topic: "test",
  schemaName: "schema",
  receiveTime: { sec: value, nsec: 0 },
  sizeInBytes: 1,
  message: value,
});

function setup() {
  let input: BuilderRenderStateInput = {
    watchedFields: new Set(["colorScheme", "currentFrame"]),
    playerState: undefined,
    appSettings: undefined,
    currentFrame: [message(0)],
    colorScheme: "light",
    globalVariables: {},
    hoverValue: undefined,
    sharedPanelState: undefined,
    sortedTopics: [{ name: "test", schemaName: "schema" }],
    subscriptions: [{ topic: "test" }],
  };
  const releases: jest.Mock[] = [];
  const onError = jest.fn();
  const onSlowRender = jest.fn();
  const lifecycle = new PanelRenderLifecycle({
    getInput: () => input,
    pauseFrame: () => {
      const release = jest.fn();
      releases.push(release);
      return release;
    },
    onError,
    onSlowRender,
  });
  const renders: { state: Immutable<RenderState>; done: () => void }[] = [];
  const render: NonNullable<PanelExtensionContext["onRender"]> = (state, done) => {
    renders.push({ state, done });
  };
  return {
    lifecycle,
    releases,
    renders,
    render,
    onError,
    onSlowRender,
    update(next: Partial<BuilderRenderStateInput>) {
      input = { ...input, ...next };
      lifecycle.requestRender();
    },
  };
}

it("waits for initialization and delivers the latest state to an asynchronously registered handler", async () => {
  const view = setup();
  view.lifecycle.start();
  view.update({ colorScheme: "dark" });
  await Promise.resolve();
  expect(view.releases).toHaveLength(0);
  view.lifecycle.setRenderFunction(view.render);
  await Promise.resolve();
  expect(view.renders).toHaveLength(1);
  expect(view.renders[0]!.state.colorScheme).toBe("dark");
  view.lifecycle.dispose();
  expect(view.releases[0]).toHaveBeenCalledTimes(1);
});

it("retains a busy frame unchanged and delivers the latest pending frame after done", async () => {
  const view = setup();
  view.lifecycle.setRenderFunction(view.render);
  await Promise.resolve();
  expect(view.renders).toHaveLength(0);
  view.lifecycle.start();
  await Promise.resolve();
  const first = view.renders[0]!;
  view.update({ currentFrame: [message(1)] });
  view.update({ currentFrame: [message(2)], colorScheme: "dark" });
  await Promise.resolve();
  expect(first.state.currentFrame).toEqual([message(0)]);
  expect(first.state.colorScheme).toBe("light");
  expect(view.renders).toHaveLength(1);
  first.done();
  first.done();
  await Promise.resolve();
  expect(view.renders).toHaveLength(2);
  expect(view.renders[1]!.state).toMatchObject({ currentFrame: [message(2)], colorScheme: "dark" });
  expect(first.state.currentFrame).toEqual([message(0)]);
  expect(view.releases[0]).toHaveBeenCalledTimes(1);
  view.lifecycle.dispose();
  expect(view.releases[1]).toHaveBeenCalledTimes(1);
});

it("releases a replaced handler without allowing its late done to release the new frame", async () => {
  const view = setup();
  view.lifecycle.setRenderFunction(view.render);
  view.lifecycle.start();
  await Promise.resolve();
  const oldDone = view.renders[0]!.done;
  view.lifecycle.setRenderFunction(undefined);
  view.lifecycle.setRenderFunction(view.render);
  await Promise.resolve();
  expect(view.renders).toHaveLength(2);
  oldDone();
  expect(view.releases[0]).toHaveBeenCalledTimes(1);
  expect(view.releases[1]).not.toHaveBeenCalled();
  view.renders[1]!.done();
  expect(view.releases[1]).toHaveBeenCalledTimes(1);
});

it("clears the busy indicator even when pending inputs have not changed", async () => {
  const view = setup();
  view.lifecycle.setRenderFunction(view.render);
  view.lifecycle.start();
  await Promise.resolve();
  view.lifecycle.requestRender();
  expect(view.onSlowRender).toHaveBeenLastCalledWith("busy");
  view.renders[0]!.done();
  await Promise.resolve();
  expect(view.onSlowRender).toHaveBeenLastCalledWith("idle");
  expect(view.renders).toHaveLength(1);
});

it.each([false, true])(
  "releases once and stops rendering when a handler throws (done first: %s)",
  async (doneFirst) => {
    const view = setup();
    const error = new Error("render failed");
    view.lifecycle.setRenderFunction((_state, done) => {
      if (doneFirst) {
        done();
      }
      throw error;
    });
    view.lifecycle.start();
    await Promise.resolve();
    expect(view.onError).toHaveBeenCalledWith(error);
    expect(view.releases[0]).toHaveBeenCalledTimes(1);
    view.update({ colorScheme: "dark" });
    view.lifecycle.dispose();
    await Promise.resolve();
    expect(view.releases).toHaveLength(1);
    expect(view.releases[0]).toHaveBeenCalledTimes(1);
  },
);

it("does not acquire a barrier when building the frame fails", async () => {
  const view = setup();
  const error = new Error("conversion failed");
  view.update({
    subscriptions: [{ topic: "test", convertTo: "converted" }],
    messageConverters: [
      {
        fromSchemaName: "schema",
        toSchemaName: "converted",
        converter: () => {
          throw error;
        },
      },
    ],
  });
  view.lifecycle.setRenderFunction(view.render);
  view.lifecycle.start();
  await Promise.resolve();
  expect(view.onError).toHaveBeenCalled();
  expect(view.releases).toHaveLength(0);
});

it("cancels pending work and makes disposal and late completion harmless", async () => {
  const view = setup();
  view.lifecycle.setRenderFunction(view.render);
  view.lifecycle.start();
  await Promise.resolve();
  view.update({ colorScheme: "dark" });
  view.lifecycle.dispose();
  view.lifecycle.dispose();
  view.renders[0]!.done();
  view.lifecycle.setRenderFunction(view.render);
  await Promise.resolve();
  expect(view.renders).toHaveLength(1);
  expect(view.releases[0]).toHaveBeenCalledTimes(1);
});

it("registers its pause before the pipeline's zero-delay frame barrier samples promises", async () => {
  const view = setup();
  view.lifecycle.setRenderFunction(view.render);
  view.lifecycle.start();
  // MessagePipeline's renderDone samples pause requests in setTimeout(frameTime), where
  // frameTime may be zero. The asynchronous child-root registration must still beat that sample.
  const sampledReleases = await new Promise<jest.Mock[]>((resolve) => {
    setTimeout(() => resolve([...view.releases]), 0);
  });
  expect(sampledReleases).toHaveLength(1);
  expect(sampledReleases[0]).not.toHaveBeenCalled();
  view.renders[0]!.done();
  expect(sampledReleases[0]).toHaveBeenCalledTimes(1);
});
