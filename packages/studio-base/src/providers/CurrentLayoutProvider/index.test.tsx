/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { renderHook } from "@testing-library/react";
import { SnackbarProvider } from "notistack";
import { act, useEffect } from "react";

import { Condvar } from "@foxglove/den/async";
import { CurrentLayoutSyncAdapter } from "@foxglove/studio-base/components/CoSceneCurrentLayoutSyncAdapter";
import CoSceneLayoutManagerContext from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import {
  CurrentLayoutActions,
  LayoutID,
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import CurrentLayoutProvider, {
  MAX_SUPPORTED_LAYOUT_VERSION,
} from "@foxglove/studio-base/providers/CurrentLayoutProvider";
import { ILayoutManager } from "@foxglove/studio-base/services/CoSceneILayoutManager";

const TEST_LAYOUT: LayoutData = {
  layout: "ExamplePanel!1",
  configById: {},
  globalVariables: {},
  userNodes: {},
};

function mockThrow(name: string) {
  return () => {
    throw new Error(`Unexpected mock function call ${name}`);
  };
}

function makeMockLayoutManager() {
  return {
    supportsSharing: false,
    isBusy: false,
    isOnline: false,
    error: undefined,
    projectName: undefined,
    userName: undefined,
    on: jest.fn(/*noop*/),
    off: jest.fn(/*noop*/),
    setError: jest.fn(/*noop*/),
    setOnline: jest.fn(/*noop*/),
    getLayouts: jest.fn().mockImplementation(mockThrow("getLayouts")),
    getLayout: jest.fn().mockImplementation(mockThrow("getLayout")),
    saveNewLayout: jest.fn().mockImplementation(mockThrow("saveNewLayout")),
    updateLayout: jest.fn().mockImplementation(mockThrow("updateLayout")),
    deleteLayout: jest.fn().mockImplementation(mockThrow("deleteLayout")),
    overwriteLayout: jest.fn().mockImplementation(mockThrow("overwriteLayout")),
    revertLayout: jest.fn().mockImplementation(mockThrow("revertLayout")),
    makePersonalCopy: jest.fn().mockImplementation(mockThrow("makePersonalCopy")),
    putHistory: jest.fn().mockResolvedValue(undefined),
    getHistory: jest.fn().mockImplementation(mockThrow("getHistory")),
  };
}

const selectLayoutState = (state: LayoutState) => state;

function renderTest({ mockLayoutManager }: { mockLayoutManager: ILayoutManager }) {
  const childMounted = new Condvar();
  const childMountedWait = childMounted.wait();
  const all: Array<{
    actions: CurrentLayoutActions;
    layoutState: LayoutState;
    childMounted: Promise<void>;
  }> = [];
  const { result } = renderHook(
    () => {
      const value = {
        actions: useCurrentLayoutActions(),
        layoutState: useCurrentLayoutSelector(selectLayoutState),
        childMounted: childMountedWait,
      };
      all.push(value);
      return value;
    },
    {
      wrapper: function Wrapper({ children }) {
        useEffect(() => {
          childMounted.notifyAll();
        }, []);
        return (
          <SnackbarProvider>
            <CoSceneLayoutManagerContext.Provider value={mockLayoutManager}>
              <CurrentLayoutProvider>
                {children}
                <CurrentLayoutSyncAdapter />
              </CurrentLayoutProvider>
            </CoSceneLayoutManagerContext.Provider>
          </SnackbarProvider>
        );
      },
    },
  );
  return { result, all };
}

describe("CurrentLayoutProvider", () => {
  it("loads layout via setSelectedLayoutId", async () => {
    const expectedState: LayoutData = {
      layout: "Foo!bar",
      configById: { "Foo!bar": { setting: 1 } },
      globalVariables: { var: "hello" },
      userNodes: { node1: { name: "node", sourceCode: "node()" } },
    };
    const condvar = new Condvar();
    const layoutStorageGetCalledWait = condvar.wait();
    const mockLayoutManager = makeMockLayoutManager();
    mockLayoutManager.getLayout.mockImplementation(async () => {
      condvar.notifyAll();
      return {
        id: "example",
        name: "Example layout",
        baseline: { updatedAt: new Date(10).toISOString(), data: expectedState },
      };
    });

    const { result, all } = renderTest({ mockLayoutManager });
    await act(async () => {
      await result.current.childMounted;
    });
    // Synchronous act to capture the "loading" intermediate state
    act(() => {
      result.current.actions.setSelectedLayoutId("example" as LayoutID);
    });
    // Then await for getLayout to resolve
    await act(async () => {
      await layoutStorageGetCalledWait;
    });

    expect(mockLayoutManager.getLayout.mock.calls).toEqual([[{ id: "example" }]]);
    expect(all.map((item) => (item instanceof Error ? undefined : item.layoutState))).toEqual([
      { selectedLayout: undefined },
      { selectedLayout: { loading: true, id: "example", data: undefined } },
      {
        selectedLayout: {
          loading: false,
          id: "example",
          data: expectedState,
          name: "Example layout",
        },
      },
    ]);
    (console.warn as jest.Mock).mockClear();
  });

  it("refuses to load an incompatible layout", async () => {
    const expectedState: LayoutData = {
      configById: { "Foo!bar": { setting: 1 } },
      globalVariables: { var: "hello" },
      layout: "Foo!bar",
      userNodes: { node1: { name: "node", sourceCode: "node()" } },
      version: MAX_SUPPORTED_LAYOUT_VERSION + 1,
    };

    const condvar = new Condvar();
    const layoutStorageGetCalledWait = condvar.wait();
    const mockLayoutManager = makeMockLayoutManager();
    mockLayoutManager.getLayout.mockImplementation(async () => {
      condvar.notifyAll();
      return {
        id: "example",
        name: "Example layout",
        baseline: { updatedAt: new Date(10).toISOString(), data: expectedState },
      };
    });

    const { result, all } = renderTest({ mockLayoutManager });
    await act(async () => {
      await result.current.childMounted;
    });
    act(() => {
      result.current.actions.setSelectedLayoutId("example" as LayoutID);
    });
    await act(async () => {
      await layoutStorageGetCalledWait;
    });

    expect(mockLayoutManager.getLayout.mock.calls).toEqual([[{ id: "example" }]]);
    expect(all.map((item) => (item instanceof Error ? undefined : item.layoutState))).toEqual([
      { selectedLayout: undefined },
      { selectedLayout: { loading: true, id: "example", data: undefined } },
      { selectedLayout: undefined },
    ]);
    (console.warn as jest.Mock).mockClear();
  });

  it("switches layout via setSelectedLayoutId", async () => {
    const mockLayoutManager = makeMockLayoutManager();
    const newLayout: Partial<LayoutData> = {
      ...TEST_LAYOUT,
      layout: "ExamplePanel!2",
    };
    mockLayoutManager.getLayout.mockImplementation(async ({ id }: { id: string }) => {
      return id === "example"
        ? {
            id: "example",
            name: "Example layout",
            baseline: { data: TEST_LAYOUT, updatedAt: new Date(10).toISOString() },
          }
        : {
            id: "example2",
            name: "Example layout 2",
            baseline: { data: newLayout, updatedAt: new Date(12).toISOString() },
          };
    });

    const { result, all } = renderTest({ mockLayoutManager });

    await act(async () => {
      await result.current.childMounted;
    });
    // Load first layout
    act(() => {
      result.current.actions.setSelectedLayoutId("example" as LayoutID);
    });
    await act(async () => {});
    // Switch to second layout
    act(() => {
      result.current.actions.setSelectedLayoutId("example2" as LayoutID);
    });
    await act(async () => {});

    expect(all.map((item) => (item instanceof Error ? undefined : item.layoutState))).toEqual([
      { selectedLayout: undefined },
      { selectedLayout: { loading: true, id: "example", data: undefined } },
      {
        selectedLayout: {
          loading: false,
          id: "example",
          data: TEST_LAYOUT,
          name: "Example layout",
        },
      },
      { selectedLayout: { loading: true, id: "example2", data: undefined } },
      {
        selectedLayout: {
          loading: false,
          id: "example2",
          data: newLayout,
          name: "Example layout 2",
        },
      },
    ]);
    (console.warn as jest.Mock).mockClear();
  });

  it("saves layout updates into LayoutStorage", async () => {
    jest.useFakeTimers();
    const condvar = new Condvar();
    const layoutStoragePutCalled = condvar.wait();
    const mockLayoutManager = makeMockLayoutManager();
    mockLayoutManager.getLayout.mockImplementation(async () => {
      return {
        id: "example",
        name: "Test layout",
        baseline: { data: TEST_LAYOUT, updatedAt: new Date(10).toISOString() },
      };
    });

    mockLayoutManager.updateLayout.mockImplementation(async () => {
      condvar.notifyAll();
    });

    const { result, all } = renderTest({ mockLayoutManager });

    await act(async () => {
      await result.current.childMounted;
    });
    act(() => {
      result.current.actions.setSelectedLayoutId("example" as LayoutID);
    });
    await act(async () => {});
    act(() => {
      result.current.actions.savePanelConfigs({
        configs: [{ id: "ExamplePanel!1", config: { foo: "bar" } }],
      });
    });
    // Advance past the debounce interval to trigger the save
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    await act(async () => {
      await layoutStoragePutCalled;
    });

    const newState = {
      ...TEST_LAYOUT,
      configById: { "ExamplePanel!1": { foo: "bar" } },
    };

    expect(mockLayoutManager.updateLayout.mock.calls).toEqual([
      [{ id: "example", data: newState, name: "Test layout", edited: true, loading: false }],
    ]);
    expect(all.map((item) => (item instanceof Error ? undefined : item.layoutState))).toEqual([
      { selectedLayout: undefined },
      { selectedLayout: { loading: true, id: "example", data: undefined } },
      { selectedLayout: { loading: false, id: "example", data: TEST_LAYOUT, name: "Test layout" } },
      {
        selectedLayout: {
          loading: false,
          id: "example",
          data: newState,
          name: "Test layout",
          edited: true,
        },
      },
    ]);
    jest.useRealTimers();
    (console.warn as jest.Mock).mockClear();
  });

  it("keeps identity of action functions when modifying layout", async () => {
    jest.useFakeTimers();
    const condvar = new Condvar();
    const layoutStoragePutCalled = condvar.wait();
    const mockLayoutManager = makeMockLayoutManager();
    mockLayoutManager.getLayout.mockImplementation(async () => {
      return {
        id: "TEST_ID",
        name: "Test layout",
        baseline: { data: TEST_LAYOUT, updatedAt: new Date(10).toISOString() },
      };
    });
    mockLayoutManager.updateLayout.mockImplementation(async () => {
      condvar.notifyAll();
      return {
        id: "TEST_ID",
        name: "Test layout",
        baseline: { data: TEST_LAYOUT, updatedAt: new Date(10).toISOString() },
      };
    });

    const { result } = renderTest({ mockLayoutManager });
    await act(async () => {
      await result.current.childMounted;
    });
    act(() => {
      result.current.actions.setSelectedLayoutId("example" as LayoutID);
    });
    await act(async () => {});
    const actions = result.current.actions;
    expect(result.current.actions).toBe(actions);
    act(() => {
      result.current.actions.savePanelConfigs({
        configs: [{ id: "ExamplePanel!1", config: { foo: "bar" } }],
      });
    });
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    await act(async () => {
      await layoutStoragePutCalled;
    });
    expect(result.current.actions.savePanelConfigs).toBe(actions.savePanelConfigs);
    jest.useRealTimers();
    (console.warn as jest.Mock).mockClear();
  });
});
