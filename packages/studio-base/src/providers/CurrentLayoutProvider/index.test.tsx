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
import {
  ILayoutManager,
  LayoutManagerChangeEvent,
  LayoutManagerEventTypes,
} from "@foxglove/studio-base/services/CoSceneILayoutManager";
import { ISO8601Timestamp } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

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

type MockLayoutManager = Omit<
  ILayoutManager,
  | "on"
  | "off"
  | "getLayouts"
  | "getLayout"
  | "saveNewLayout"
  | "updateLayout"
  | "deleteLayout"
  | "overwriteLayout"
  | "revertLayout"
  | "makePersonalCopy"
  | "putHistory"
  | "getHistory"
  | "setError"
  | "setOnline"
> & {
  on: ILayoutManager["on"];
  off: ILayoutManager["off"];
  getLayouts: jest.Mock;
  getLayout: jest.Mock;
  saveNewLayout: jest.Mock;
  updateLayout: jest.Mock;
  deleteLayout: jest.Mock;
  overwriteLayout: jest.Mock;
  revertLayout: jest.Mock;
  makePersonalCopy: jest.Mock;
  putHistory: jest.Mock;
  getHistory: jest.Mock;
  setError: jest.Mock;
  setOnline: jest.Mock;
} & {
  emitChange: (event: LayoutManagerChangeEvent) => void;
};

function makeMockLayoutManager(): MockLayoutManager {
  const listeners = new Set<LayoutManagerEventTypes["change"]>();
  return {
    supportsSharing: false,
    isBusy: false,
    isOnline: false,
    error: undefined,
    projectName: undefined,
    userName: undefined,
    on: jest.fn((name: keyof LayoutManagerEventTypes, listener: (...args: unknown[]) => void) => {
      if (name === "change") {
        listeners.add(listener as LayoutManagerEventTypes["change"]);
      }
    }) as unknown as ILayoutManager["on"],
    off: jest.fn((name: keyof LayoutManagerEventTypes, listener: (...args: unknown[]) => void) => {
      if (name === "change") {
        listeners.delete(listener as LayoutManagerEventTypes["change"]);
      }
    }) as unknown as ILayoutManager["off"],
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
    emitChange: (event: LayoutManagerChangeEvent) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
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
      [{ id: "example", data: newState }],
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

  it("ignores stale autosave change events when memory has newer edits", async () => {
    const mockLayoutManager = makeMockLayoutManager();
    mockLayoutManager.getLayout.mockImplementation(async () => {
      return {
        id: "example",
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

    act(() => {
      result.current.actions.savePanelConfigs({
        configs: [{ id: "ExamplePanel!1", config: { foo: "old" } }],
      });
    });
    const oldData = result.current.layoutState.selectedLayout?.data;
    act(() => {
      result.current.actions.savePanelConfigs({
        configs: [{ id: "ExamplePanel!1", config: { foo: "new" } }],
      });
    });
    const newData = result.current.layoutState.selectedLayout?.data;

    act(() => {
      mockLayoutManager.emitChange({
        type: "change",
        source: "update",
        updatedLayout: {
          id: "example" as LayoutID,
          parent: "",
          folder: "",
          name: "Test layout",
          permission: "PERSONAL_WRITE",
          baseline: {
            data: TEST_LAYOUT,
            savedAt: undefined,
            modifier: undefined,
            modifierNickname: undefined,
          },
          working: {
            data: oldData ?? TEST_LAYOUT,
            savedAt: new Date(11).toISOString() as ISO8601Timestamp,
          },
          syncInfo: undefined,
        },
      });
    });

    expect(result.current.layoutState.selectedLayout).toMatchObject({
      id: "example",
      data: newData,
      edited: true,
    });
    (console.warn as jest.Mock).mockClear();
  });

  it("ignores stale explicit save change events when memory has newer edits", async () => {
    const mockLayoutManager = makeMockLayoutManager();
    mockLayoutManager.getLayout.mockImplementation(async () => {
      return {
        id: "example",
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

    act(() => {
      result.current.actions.savePanelConfigs({
        configs: [{ id: "ExamplePanel!1", config: { foo: "saved" } }],
      });
    });
    const savedData = result.current.layoutState.selectedLayout?.data;
    act(() => {
      result.current.actions.savePanelConfigs({
        configs: [{ id: "ExamplePanel!1", config: { foo: "newer" } }],
      });
    });
    const newerData = result.current.layoutState.selectedLayout?.data;

    act(() => {
      mockLayoutManager.emitChange({
        type: "change",
        source: "overwrite",
        updatedLayout: {
          id: "example" as LayoutID,
          parent: "",
          folder: "",
          name: "Test layout",
          permission: "PERSONAL_WRITE",
          baseline: {
            data: savedData ?? TEST_LAYOUT,
            savedAt: new Date(11).toISOString() as ISO8601Timestamp,
            modifier: undefined,
            modifierNickname: undefined,
          },
          working: undefined,
          syncInfo: undefined,
        },
      });
    });

    expect(result.current.layoutState.selectedLayout).toMatchObject({
      id: "example",
      data: newerData,
      edited: true,
    });
    (console.warn as jest.Mock).mockClear();
  });

  it("retries pending layout updates after layoutManager.updateLayout fails", async () => {
    jest.useFakeTimers();
    const firstAttempt = new Condvar();
    const secondAttempt = new Condvar();
    const firstAttemptWait = firstAttempt.wait();
    const secondAttemptWait = secondAttempt.wait();
    const mockLayoutManager = makeMockLayoutManager();
    mockLayoutManager.getLayout.mockImplementation(async () => {
      return {
        id: "example",
        name: "Test layout",
        baseline: { data: TEST_LAYOUT, updatedAt: new Date(10).toISOString() },
      };
    });

    let attempts = 0;
    mockLayoutManager.updateLayout.mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        firstAttempt.notifyAll();
        throw new Error("temporary failure");
      }
      secondAttempt.notifyAll();
    });

    const { result } = renderTest({ mockLayoutManager });

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

    act(() => {
      jest.advanceTimersByTime(1500);
    });
    await act(async () => {
      await firstAttemptWait;
    });
    await act(async () => {});

    act(() => {
      jest.advanceTimersByTime(1500);
    });
    await act(async () => {
      await secondAttemptWait;
    });

    (console.error as jest.Mock).mockClear();
    expect(mockLayoutManager.updateLayout).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
    (console.warn as jest.Mock).mockClear();
  });

  it("clears pending debounced updates after an explicit save uses current memory data", async () => {
    jest.useFakeTimers();
    const mockLayoutManager = makeMockLayoutManager();
    mockLayoutManager.getLayout.mockImplementation(async () => {
      return {
        id: "example",
        name: "Test layout",
        baseline: { data: TEST_LAYOUT, updatedAt: new Date(10).toISOString() },
      };
    });
    mockLayoutManager.updateLayout.mockResolvedValue(undefined);
    mockLayoutManager.overwriteLayout.mockImplementation(async ({ id, data }) => {
      const updatedLayout = {
        id,
        parent: "",
        folder: "",
        name: "Test layout",
        permission: "PERSONAL_WRITE" as const,
        baseline: {
          data: data ?? TEST_LAYOUT,
          savedAt: new Date(11).toISOString() as ISO8601Timestamp,
          modifier: undefined,
          modifierNickname: undefined,
        },
        working: undefined,
        syncInfo: undefined,
      };
      mockLayoutManager.emitChange({ type: "change", updatedLayout });
      return updatedLayout;
    });

    const { result } = renderTest({ mockLayoutManager });

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

    const currentData = result.current.layoutState.selectedLayout?.data;
    await act(async () => {
      await mockLayoutManager.overwriteLayout({
        id: "example" as LayoutID,
        data: currentData,
      });
    });
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    await act(async () => {});

    expect(mockLayoutManager.overwriteLayout.mock.calls[0]?.[0]).toEqual({
      id: "example",
      data: {
        ...TEST_LAYOUT,
        configById: { "ExamplePanel!1": { foo: "bar" } },
      },
    });
    expect(mockLayoutManager.updateLayout).not.toHaveBeenCalled();
    jest.useRealTimers();
    (console.warn as jest.Mock).mockClear();
  });

  it("does not requeue a stale autosave failure after an explicit save cleared pending edits", async () => {
    jest.useFakeTimers();
    const updateStarted = new Condvar();
    const updateStartedWait = updateStarted.wait();
    let rejectUpdate: ((error: Error) => void) | undefined;
    const mockLayoutManager = makeMockLayoutManager();
    mockLayoutManager.getLayout.mockImplementation(async () => {
      return {
        id: "example",
        name: "Test layout",
        baseline: { data: TEST_LAYOUT, updatedAt: new Date(10).toISOString() },
      };
    });
    mockLayoutManager.updateLayout.mockImplementation(
      async () =>
        await new Promise((_resolve, reject) => {
          rejectUpdate = reject;
          updateStarted.notifyAll();
        }),
    );

    const { result } = renderTest({ mockLayoutManager });
    await act(async () => {
      await result.current.childMounted;
    });
    act(() => {
      result.current.actions.setSelectedLayoutId("example" as LayoutID);
    });
    await act(async () => {});
    act(() => {
      result.current.actions.savePanelConfigs({
        configs: [{ id: "ExamplePanel!1", config: { foo: "old" } }],
      });
    });
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    await act(async () => {
      await updateStartedWait;
    });

    act(() => {
      result.current.actions.savePanelConfigs({
        configs: [{ id: "ExamplePanel!1", config: { foo: "saved" } }],
      });
    });
    const savedData = result.current.layoutState.selectedLayout?.data;
    act(() => {
      mockLayoutManager.emitChange({
        type: "change",
        source: "overwrite",
        updatedLayout: {
          id: "example" as LayoutID,
          parent: "",
          folder: "",
          name: "Test layout",
          permission: "PERSONAL_WRITE",
          baseline: {
            data: savedData ?? TEST_LAYOUT,
            savedAt: new Date(11).toISOString() as ISO8601Timestamp,
            modifier: undefined,
            modifierNickname: undefined,
          },
          working: undefined,
          syncInfo: undefined,
        },
      });
    });

    await act(async () => {
      rejectUpdate?.(new Error("stale autosave failed"));
    });
    (console.error as jest.Mock).mockClear();
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    await act(async () => {});

    expect(mockLayoutManager.updateLayout).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
    (console.warn as jest.Mock).mockClear();
  });

  it("does not save transient layout updates into LayoutStorage", async () => {
    jest.useFakeTimers();
    const mockLayoutManager = makeMockLayoutManager();
    mockLayoutManager.updateLayout.mockResolvedValue(undefined);

    const { result } = renderTest({ mockLayoutManager });

    await act(async () => {
      await result.current.childMounted;
    });
    act(() => {
      result.current.actions.setCurrentLayout({
        id: "share-layout" as LayoutID,
        data: TEST_LAYOUT,
        name: "Shared layout",
        transient: true,
      });
    });
    act(() => {
      result.current.actions.savePanelConfigs({
        configs: [{ id: "ExamplePanel!1", config: { foo: "bar" } }],
      });
    });
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    await act(async () => {});

    expect(mockLayoutManager.updateLayout).not.toHaveBeenCalled();
    expect(result.current.layoutState.selectedLayout).toMatchObject({
      id: "share-layout",
      name: "Shared layout",
      edited: true,
      transient: true,
      data: {
        configById: { "ExamplePanel!1": { foo: "bar" } },
      },
    });
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
