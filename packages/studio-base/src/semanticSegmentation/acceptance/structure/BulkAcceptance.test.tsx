/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, screen, within } from "@testing-library/react";

import { confirm, destination, geometry, polygons, row, setup } from "./fixture";

function checkbox(id: string): HTMLInputElement {
  return within(
    row(id).querySelector<HTMLElement>(":scope > * > [data-tree-row]")!,
  ).getByRole<HTMLInputElement>("checkbox");
}
function check(id: string) {
  fireEvent.click(checkbox(id));
}
function checked(id: string) {
  return checkbox(id).checked;
}

describe("structure bulk original GWT acceptance", () => {
  it("SEG-BULK-001/002/003/007/010 shows every checkbox, rejects empty actions, propagates partial checks and clears transient checks", async () => {
    const { store, submit } = await setup();
    const before = store.getState().document;
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(screen.getAllByRole("treeitem").length);
    for (const name of ["Delete", "Merge"]) {
      const action = screen.getByRole<HTMLButtonElement>("button", { name });
      expect(action.disabled).toBe(true);
      fireEvent.keyDown(action, { key: "Enter" });
      fireEvent.click(action);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.getState().stagedOperations).toEqual([]);
    check("C");
    for (const id of ["C", "I", "J", "I-P-0", "I-Q-0", "J-P-0"]) {
      expect(checked(id)).toBe(true);
    }
    check("I-P-0");
    expect(checked("I-P-0")).toBe(false);
    expect(checked("I-Q-0")).toBe(true);
    expect(checkbox("I").getAttribute("data-indeterminate")).toBe("true");
    expect(checkbox("C").getAttribute("data-indeterminate")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(store.getState().selection).toEqual([]);
    expect(store.getState().document).toEqual(before);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getAllByRole<HTMLInputElement>("checkbox").every((item) => !item.checked)).toBe(
      true,
    );
  });

  it("SEG-BULK-004 deduplicates selected class, instance and polygon into one retirement per instance", async () => {
    const { store } = await setup();
    const before = store.getState().document!;
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    check("C");
    expect(checked("I")).toBe(true);
    expect(checked("I-P-0")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "All frames" }));
    await confirm("Delete");
    const staged = store.getState().stagedOperations;
    const retired = staged.flatMap((operation) =>
      Object.entries(operation.patch.instances ?? {})
        .filter(([, value]) => value == undefined)
        .map(([id]) => id),
    );
    expect(retired.sort()).toEqual(["I", "J"]);
    expect(staged.flatMap((operation) => Object.keys(operation.patch.annotations ?? {}))).toEqual(
      [],
    );
    expect(
      store.getState().document!.instances.filter((item) => ["K", "U"].includes(item.id)),
    ).toEqual(before.instances.filter((item) => ["K", "U"].includes(item.id)));
    act(() => {
      store.getState().undo();
    });
    expect(store.getState().document).toEqual(before);
  });

  it("SEG-BULK-005 deletes P in the current frame and all J only in the displayed all-frame scope", async () => {
    const { store } = await setup();
    const before = store.getState().document!;
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    check("I-P-0");
    check("J");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByLabelText("Affected instance IDs").textContent).toBe("J, I");
    expect(screen.getByLabelText("Affected polygon IDs").textContent).toBe("I-P-0");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "All frames" }));
    expect(screen.getByText(/Selected polygons are deleted only in this frame/)).toBeDefined();
    await confirm("Delete");
    const after = store.getState().document!;
    expect(after.instances.some((item) => item.id === "J")).toBe(false);
    for (const frame of [0, 1, 2]) {
      expect(polygons(after, frame, "J")).toEqual([]);
      expect(polygons(after, frame, "I")).toEqual(
        polygons(before, frame, "I").filter((item) => item.id !== "I-P-0"),
      );
      for (const owner of ["K", "U"]) {
        expect(polygons(after, frame, owner)).toEqual(polygons(before, frame, owner));
      }
    }
  });

  it("SEG-BULK-006 describes two instance sources and one polygon without editing before confirmation", async () => {
    const { store } = await setup();
    const before = store.getState().document;
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    check("I");
    check("J");
    check("U-P-0");
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(screen.getByLabelText("Affected instance IDs").textContent).toBe("I, J, U");
    expect(screen.getByLabelText("Affected polygon IDs").textContent).toBe("U-P-0");
    expect(
      screen.getByText(
        /Instances merge across all frames.*Selected polygons move only in the current frame/,
      ),
    ).toBeDefined();
    expect(store.getState().document).toEqual(before);
    expect(store.getState().stagedOperations).toEqual([]);
  });

  it("SEG-BULK-007 excludes a selected instance as its own destination and requires a distinct target", async () => {
    const { store } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    check("I");
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(
      within(screen.getByRole("dialog")).getByRole<HTMLButtonElement>("button", { name: "Confirm" })
        .disabled,
    ).toBe(true);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Target instance" }));
    expect(screen.queryByRole("option", { name: "C / I (I)" })).toBeNull();
    expect(screen.getByRole("option", { name: "D / K (K)" })).toBeDefined();
    expect(store.getState().stagedOperations).toEqual([]);
  });

  it("SEG-BULK-008 unions a class, checked descendant and external polygon exactly once into K", async () => {
    const { store, submit } = await setup();
    const before = store.getState().document!;
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    check("C");
    check("U-P-0");
    expect(checked("I")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await destination();
    await confirm();
    const after = store.getState().document!;
    expect(geometry(after)).toEqual(geometry(before));
    expect(after.instances.find((item) => item.id === "K")).toEqual(
      before.instances.find((item) => item.id === "K"),
    );
    for (const frame of [0, 1, 2]) {
      const target = polygons(after, frame, "K");
      expect(target).toEqual([
        ...polygons(before, frame, "K"),
        ...polygons(before, frame, "I"),
        ...polygons(before, frame, "J"),
        ...(frame === 0 ? polygons(before, frame, "U") : []),
      ]);
      expect(new Set(target.map((item) => item.id)).size).toBe(target.length);
      expect(polygons(after, frame, "U")).toEqual(frame === 0 ? [] : polygons(before, frame, "U"));
    }
    const retired = store
      .getState()
      .stagedOperations.flatMap((operation) => Object.keys(operation.patch.instances ?? {}));
    expect(retired.sort()).toEqual(["I", "J"]);
    expect(submit).not.toHaveBeenCalled();
  });

  it("SEG-BULK-009 removes an acknowledged selected polygon and disables actions with no stale checkbox", async () => {
    const { store, container } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    check("I-P-0");
    act(() => {
      store.getState().deletePolygon("I-P-0");
      store.getState().submit();
    });
    await act(async () => {
      await store.getState().waitForSubmissions();
    });
    expect(container.querySelector('[data-node-id="I-P-0"]')).toBeNull();
    expect(store.getState().selection).toEqual([]);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Delete" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Merge" }).disabled).toBe(true);
  });
});
