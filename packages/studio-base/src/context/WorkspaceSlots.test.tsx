/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { act, render, renderHook } from "@testing-library/react";

import {
  WorkspaceSlotsProvider,
  createWorkspaceSlotsStore,
  registerWorkspaceSlot,
  useWorkspaceSlot,
  useWorkspaceSlotEntries,
  useWorkspaceSlotValues,
} from "./WorkspaceSlots";

const column = { title: "Column", sections: [] };

describe("WorkspaceSlots", () => {
  it("reads every slot as empty, and registers nothing, outside a provider", () => {
    const { result } = renderHook(() => {
      useWorkspaceSlot("shortcutColumns", "a", column);
      return useWorkspaceSlotValues("shortcutColumns");
    });
    expect(result.current).toEqual([]);
  });

  it("keeps each provider's registrations apart", () => {
    const first = createWorkspaceSlotsStore();
    const second = createWorkspaceSlotsStore();
    registerWorkspaceSlot(first, "shortcutColumns", "a", column);
    const read = (store: typeof first) =>
      renderHook(() => useWorkspaceSlotEntries("shortcutColumns"), {
        wrapper: ({ children }) => (
          <WorkspaceSlotsProvider store={store}>{children}</WorkspaceSlotsProvider>
        ),
      }).result.current;
    expect(read(first)).toEqual([["a", column]]);
    expect(read(second)).toEqual([]);
  });

  it("registers while a component is mounted and removes the entry on unmount", () => {
    const store = createWorkspaceSlotsStore();
    function Feature(): React.JSX.Element {
      useWorkspaceSlot("shortcutColumns", "feature", column);
      return <div />;
    }
    const view = render(
      <WorkspaceSlotsProvider store={store}>
        <Feature />
      </WorkspaceSlotsProvider>,
    );
    expect(Object.keys(store.getState().shortcutColumns)).toEqual(["feature"]);
    act(() => {
      view.unmount();
    });
    expect(store.getState().shortcutColumns).toEqual({});
  });

  it("rejects integer-like ids, which would not read back in registration order", () => {
    const store = createWorkspaceSlotsStore();
    registerWorkspaceSlot(store, "shortcutColumns", "b", column);
    registerWorkspaceSlot(store, "shortcutColumns", "a", column);
    expect(Object.keys(store.getState().shortcutColumns)).toEqual(["b", "a"]);
    expect(() => registerWorkspaceSlot(store, "shortcutColumns", "10", column)).toThrow(
      /must not be an integer/,
    );
    expect(Object.keys(store.getState().shortcutColumns)).toEqual(["b", "a"]);
  });

  it("creates a store of its own when none is passed", () => {
    const { result } = renderHook(
      () => {
        useWorkspaceSlot("shortcutColumns", "a", column);
        return useWorkspaceSlotEntries("shortcutColumns");
      },
      { wrapper: ({ children }) => <WorkspaceSlotsProvider>{children}</WorkspaceSlotsProvider> },
    );
    expect(result.current).toEqual([["a", column]]);
  });
});
