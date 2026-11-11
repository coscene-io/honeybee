/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render } from "@testing-library/react";
import { Component, StrictMode, useLayoutEffect } from "react";
import type { PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";

import type { PanelExtensionContext, SettingsTree } from "@foxglove/studio";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import type { MockMessagePipelineProps } from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import MockPanelContextProvider from "@foxglove/studio-base/components/MockPanelContextProvider";
import { usePanelStateStore } from "@foxglove/studio-base/context/PanelStateContext";
import { PlayerCapabilities, PlayerPresence } from "@foxglove/studio-base/players/types";
import * as errorReporting from "@foxglove/studio-base/reportError";
import PanelSetup from "@foxglove/studio-base/test/PanelSetup";
import type { Fixture } from "@foxglove/studio-base/test/PanelSetup";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import PanelExtensionAdapter, { VERSION_CONFIG_KEY } from "./PanelExtensionAdapter";
import type { BuiltinPanelExtensionContext } from "./types";

jest.mock("@foxglove/studio-base/reportError", () => ({ reportError: jest.fn() }));

const config = {};
const saveConfig = jest.fn();

function Harness({
  children,
  fixture,
  pauseFrame,
  pipeline,
}: PropsWithChildren<{
  fixture?: Fixture;
  pauseFrame?: (name: string) => () => void;
  pipeline?: MockMessagePipelineProps;
}>) {
  return (
    <ThemeProvider isDark>
      <MockPanelContextProvider>
        <PanelSetup fixture={fixture} pauseFrame={pauseFrame}>
          {pipeline ? (
            <MockMessagePipelineProvider {...pipeline} pauseFrame={pauseFrame}>
              {children}
            </MockMessagePipelineProvider>
          ) : (
            children
          )}
        </PanelSetup>
      </MockPanelContextProvider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  saveConfig.mockClear();
  (errorReporting.reportError as jest.Mock).mockClear();
});

it("retires a busy panel when its configuration becomes too new and can initialize it again", async () => {
  const contexts: PanelExtensionContext[] = [];
  const releases: jest.Mock[] = [];
  const cleanup = jest.fn();
  const initPanel = (context: PanelExtensionContext) => {
    contexts.push(context);
    context.watch("colorScheme");
    context.onRender = () => {};
    return cleanup;
  };
  const pauseFrame = () => {
    const release = jest.fn();
    releases.push(release);
    return release;
  };
  const panel = (version: number) => (
    <Harness pauseFrame={pauseFrame}>
      <PanelExtensionAdapter
        config={{ [VERSION_CONFIG_KEY]: version }}
        highestSupportedConfigVersion={1}
        saveConfig={saveConfig}
        initPanel={initPanel}
      />
    </Harness>
  );
  const view = render(panel(1));
  await act(async () => undefined);
  expect(releases).toHaveLength(1);
  view.rerender(panel(2));
  await act(async () => undefined);
  expect(contexts).toHaveLength(1);
  expect(releases[0]).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(contexts[0]!.panelElement.parentNode).toBeNull();
  contexts[0]!.saveState({ retired: true });
  expect(saveConfig).not.toHaveBeenCalled();
  view.rerender(panel(1));
  await act(async () => undefined);
  expect(contexts).toHaveLength(2);
  view.unmount();
  await act(async () => undefined);
  expect(cleanup).toHaveBeenCalledTimes(2);
});

it.each(["player switch", "initializing"] as const)(
  "retires a busy session during %s even when capabilities and profile remain unchanged",
  async (transition) => {
    const contexts: PanelExtensionContext[] = [];
    const completions: (() => void)[] = [];
    const releases: jest.Mock[] = [];
    const cleanup = jest.fn();
    const capabilities = [PlayerCapabilities.advertise];
    const publish = jest.fn();
    const initPanel = (context: PanelExtensionContext) => {
      contexts.push(context);
      context.watch("colorScheme");
      context.onRender = (_state, done) => completions.push(done);
      return cleanup;
    };
    const pauseFrame = () => {
      const release = jest.fn();
      releases.push(release);
      return release;
    };
    const panel = (playerId: string, presence: PlayerPresence) => (
      <Harness
        pauseFrame={pauseFrame}
        pipeline={{ playerId, presence, capabilities, profile: "same-profile", publish }}
      >
        <PanelExtensionAdapter config={config} saveConfig={saveConfig} initPanel={initPanel} />
      </Harness>
    );
    const view = render(panel("first", PlayerPresence.PRESENT));
    await act(async () => undefined);
    const oldDone = completions[0]!;
    view.rerender(
      transition === "player switch"
        ? panel("second", PlayerPresence.PRESENT)
        : panel("first", PlayerPresence.INITIALIZING),
    );
    await act(async () => undefined);
    expect(releases[0]).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    contexts[0]!.publish?.("retired", {});
    contexts[0]!.saveState({ retired: true });
    expect(publish).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
    if (transition === "initializing") {
      expect(contexts).toHaveLength(1);
      view.rerender(panel("first", PlayerPresence.PRESENT));
      await act(async () => undefined);
    }
    expect(contexts).toHaveLength(2);
    oldDone();
    expect(releases.at(-1)).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => undefined);
    expect(releases.at(-1)).toHaveBeenCalledTimes(1);
  },
);

it("keeps one settings handler per session while dispatching to the latest panel callback", async () => {
  let settingsHandler: SettingsTree["actionHandler"] | undefined;
  function SettingsObserver() {
    const tree = usePanelStateStore((state) => state.settingsTrees.bar);
    useLayoutEffect(() => {
      settingsHandler = tree?.actionHandler;
    }, [tree]);
    return ReactNull;
  }
  let context: PanelExtensionContext | undefined;
  const initPanel = (value: PanelExtensionContext) => {
    context = value;
  };
  const view = render(
    <Harness>
      <PanelExtensionAdapter config={config} saveConfig={saveConfig} initPanel={initPanel} />
      <SettingsObserver />
    </Harness>,
  );
  try {
    const firstCallback = jest.fn();
    const latestCallback = jest.fn();
    act(() => {
      context!.updatePanelSettingsEditor({ nodes: {}, actionHandler: firstCallback });
    });
    const firstHandler = settingsHandler!;
    act(() => {
      context!.updatePanelSettingsEditor({ nodes: {}, actionHandler: latestCallback });
    });
    expect(firstHandler).toBe(settingsHandler);
    const action = {
      action: "update" as const,
      payload: { path: ["data", "label"], input: "string" as const, value: "updated" },
    };
    firstHandler(action);
    expect(firstCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledWith(action);
    view.unmount();
    firstHandler(action);
    expect(latestCallback).toHaveBeenCalledTimes(1);
    await act(async () => undefined);
  } finally {
    view.unmount();
  }
});

it("mounts a real asynchronous root and retires its context before deferred StrictMode cleanup", async () => {
  const contexts: PanelExtensionContext[] = [];
  const cleanups: jest.Mock[] = [];
  const completions: (() => void)[] = [];
  const releases: jest.Mock[] = [];
  const publish = jest.fn();
  const setSubscriptions = jest.fn();
  const fixture: Fixture = {
    capabilities: [PlayerCapabilities.advertise],
    publish,
    setSubscriptions,
  };
  const pauseFrame = () => {
    const release = jest.fn();
    releases.push(release);
    return release;
  };
  function Child({ context }: { context: PanelExtensionContext }) {
    useLayoutEffect(() => {
      context.watch("colorScheme");
      context.onRender = (_state, done) => completions.push(done);
      context.subscribe([{ topic: "active" }]);
      return () => {
        context.onRender = undefined;
        context.unsubscribeAll();
      };
    }, [context]);
    return <div>Independent panel root</div>;
  }
  const initPanel = (context: PanelExtensionContext) => {
    contexts.push(context);
    const root = createRoot(context.panelElement);
    root.render(
      <StrictMode>
        <Child context={context} />
      </StrictMode>,
    );
    const cleanup = jest.fn(() => {
      root.unmount();
    });
    cleanups.push(cleanup);
    return cleanup;
  };
  const view = render(
    <StrictMode>
      <Harness fixture={fixture} pauseFrame={pauseFrame}>
        <PanelExtensionAdapter config={config} saveConfig={saveConfig} initPanel={initPanel} />
      </Harness>
    </StrictMode>,
  );
  await act(async () => undefined);
  expect(view.getByText("Independent panel root")).toBeDefined();
  expect(completions.length).toBeGreaterThan(0);
  const lastContext = contexts.at(-1)!;
  const lastCleanup = cleanups.at(-1)!;
  view.unmount();
  expect(lastCleanup).not.toHaveBeenCalled();
  expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true);
  const subscriptionCalls = setSubscriptions.mock.calls.length;
  lastContext.subscribe([{ topic: "retired" }]);
  lastContext.publish?.("active", {});
  lastContext.saveState({ retired: true });
  completions.forEach((done) => {
    done();
  });
  expect(setSubscriptions).toHaveBeenCalledTimes(subscriptionCalls);
  expect(publish).not.toHaveBeenCalled();
  expect(saveConfig).not.toHaveBeenCalled();
  await act(async () => undefined);
  expect(cleanups.every((cleanup) => cleanup.mock.calls.length === 1)).toBe(true);
  expect(contexts.every((context) => context.panelElement.parentNode == undefined)).toBe(true);
});

it("does not let old context or late completion modify a replacement session", async () => {
  const contexts: BuiltinPanelExtensionContext[] = [];
  const pending: (() => void)[] = [];
  const releases: jest.Mock[] = [];
  const releaseRange = jest.fn();
  const publish = jest.fn();
  const setSubscriptions = jest.fn();
  const fixture: Fixture = {
    capabilities: [PlayerCapabilities.advertise, PlayerCapabilities.callServices],
    publish,
    setSubscriptions,
    subscribeMessageRange: () => releaseRange,
  };
  const initialize = (context: BuiltinPanelExtensionContext) => {
    contexts.push(context);
    context.watch("colorScheme");
    context.onRender = (_state, done) => pending.push(done);
    context.subscribe([{ topic: "active" }]);
    const release = context.unstable_subscribeMessageRange?.({
      topic: "active",
      onNewRangeIterator: () => {},
    });
    return () => {
      context.unsubscribeAll();
      release?.();
    };
  };
  const pauseFrame = () => {
    const release = jest.fn();
    releases.push(release);
    return release;
  };
  function View({ initPanel }: { initPanel: typeof initialize }) {
    return (
      <Harness fixture={fixture} pauseFrame={pauseFrame}>
        <PanelExtensionAdapter config={config} saveConfig={saveConfig} initPanel={initPanel} />
      </Harness>
    );
  }
  const view = render(<View initPanel={initialize} />);
  await act(async () => undefined);
  const oldDone = pending.at(-1)!;
  view.rerender(<View initPanel={(context) => initialize(context)} />);
  await act(async () => undefined);
  const old = contexts[0]!;
  const latestRelease = releases.at(-1)!;
  expect(releaseRange).toHaveBeenCalledTimes(1);
  const count = setSubscriptions.mock.calls.length;
  old.unsubscribeAll();
  old.subscribe([{ topic: "old" }]);
  old.publish?.("old", {});
  old.saveState({ old: true });
  oldDone();
  expect(latestRelease).not.toHaveBeenCalled();
  expect(setSubscriptions).toHaveBeenCalledTimes(count);
  expect(publish).not.toHaveBeenCalled();
  expect(saveConfig).not.toHaveBeenCalled();
  await expect(old.callService?.("old", {})).rejects.toThrow("unmounted");
  await expect(old.unstable_fetchAsset("old")).rejects.toThrow("unmounted");
  view.unmount();
  await act(async () => undefined);
  expect(latestRelease).toHaveBeenCalledTimes(1);
  expect(releaseRange).toHaveBeenCalledTimes(2);
});

it("reports a cleanup error and still removes the retired container", async () => {
  const error = new Error("cleanup failed");
  const reportError = errorReporting.reportError as jest.Mock;
  let element: HTMLElement | undefined;
  const cleanup = jest.fn(() => {
    throw error;
  });
  const initPanel = (context: PanelExtensionContext) => {
    element = context.panelElement;
    return cleanup;
  };
  const view = render(
    <Harness>
      <PanelExtensionAdapter config={config} saveConfig={saveConfig} initPanel={initPanel} />
    </Harness>,
  );
  view.unmount();
  await act(async () => undefined);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(reportError).toHaveBeenCalledWith(error);
  expect(element!.parentNode).toBeNull();
});

it("attempts all cleanup when a host resource or subscription release throws", async () => {
  const resourceError = new Error("resource release failed");
  const subscriptionError = new Error("subscription release failed");
  const releaseRange = jest.fn(() => {
    throw resourceError;
  });
  const setSubscriptions = jest.fn();
  const setPublishers = jest.fn();
  const cleanup = jest.fn();
  let element: HTMLElement | undefined;
  const initPanel = (context: BuiltinPanelExtensionContext) => {
    element = context.panelElement;
    context.unstable_subscribeMessageRange?.({ topic: "test", onNewRangeIterator: () => {} });
    return cleanup;
  };
  const view = render(
    <Harness
      fixture={{ subscribeMessageRange: () => releaseRange, setSubscriptions, setPublishers }}
    >
      <PanelExtensionAdapter config={config} saveConfig={saveConfig} initPanel={initPanel} />
    </Harness>,
  );
  setSubscriptions.mockImplementation(() => {
    throw subscriptionError;
  });
  view.unmount();
  await act(async () => undefined);
  expect(releaseRange).toHaveBeenCalledTimes(1);
  expect(setPublishers).toHaveBeenLastCalledWith(expect.any(String), []);
  expect(errorReporting.reportError).toHaveBeenCalledWith(resourceError);
  expect(errorReporting.reportError).toHaveBeenCalledWith(subscriptionError);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(element!.parentNode).toBeNull();
});

it("releases a resource acquired while a synchronous callback retires the session", async () => {
  const releaseRange = jest.fn();
  const fixture: Fixture = {
    subscribeMessageRange: (args) => {
      void args.onNewRangeIterator((async function* () {})());
      return releaseRange;
    },
  };
  let context: BuiltinPanelExtensionContext | undefined;
  const initPanel = (value: BuiltinPanelExtensionContext) => {
    context = value;
  };
  const view = render(
    <Harness fixture={fixture}>
      <PanelExtensionAdapter config={config} saveConfig={saveConfig} initPanel={initPanel} />
    </Harness>,
  );
  let release: (() => void) | undefined;
  act(() => {
    release = context!.unstable_subscribeMessageRange?.({
      topic: "test",
      onNewRangeIterator: () => {
        view.unmount();
      },
    });
  });
  expect(releaseRange).toHaveBeenCalledTimes(1);
  release?.();
  await act(async () => undefined);
  expect(releaseRange).toHaveBeenCalledTimes(1);
});

class Boundary extends Component<PropsWithChildren, { failed: boolean }> {
  public override state = { failed: false };
  public static getDerivedStateFromError() {
    return { failed: true };
  }
  public override render() {
    return this.state.failed ? <div>Failed panel</div> : this.props.children;
  }
}

it("releases resources acquired before initPanel throws", async () => {
  const releaseRange = jest.fn();
  const setPublishers = jest.fn();
  const fixture: Fixture = {
    capabilities: [PlayerCapabilities.advertise],
    setPublishers,
    subscribeMessageRange: () => releaseRange,
  };
  let context: BuiltinPanelExtensionContext | undefined;
  const initPanel = (value: BuiltinPanelExtensionContext) => {
    context = value;
    value.advertise?.("test", "schema");
    value.unstable_subscribeMessageRange?.({ topic: "test", onNewRangeIterator: () => {} });
    throw new Error("init failed");
  };
  render(
    <Harness fixture={fixture}>
      <Boundary>
        <PanelExtensionAdapter config={config} saveConfig={saveConfig} initPanel={initPanel} />
      </Boundary>
    </Harness>,
  );
  await act(async () => undefined);
  expect(releaseRange).toHaveBeenCalledTimes(1);
  expect(setPublishers).toHaveBeenLastCalledWith(expect.any(String), []);
  expect(context!.panelElement.parentNode).toBeNull();
  expect(console.error).toHaveBeenCalled();
  (console.error as jest.Mock).mockClear();
});
