/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import {
  confirm,
  destination,
  geometry,
  menu,
  polygons,
  row,
  setup,
  structureDocument,
} from "./fixture";
import {
  MomentReferencePicker,
  resolveSpatialReference,
} from "../../components/MomentReferencePicker";
import { SegmentationCanvas } from "../../components/SegmentationCanvas";
import { SpatialTree } from "../../components/SpatialTree";
import { SubmissionControls, WorkflowControls } from "../../components/WorkflowControls";
import { createMockSemanticSegmentationService, createSeedDocument } from "../../mockService";
import { frameInstanceKey } from "../../service";
import { createSemanticSegmentationStore } from "../../store";

function invariant(store: Awaited<ReturnType<typeof setup>>["store"]) {
  const state = store.getState();
  return {
    document: state.document,
    selection: state.selection,
    focus: state.focus,
    staging: state.stagedOperations,
  };
}

describe("structure tree original GWT acceptance", () => {
  it("SEG-ID-003 retains polygon IDs through backend row reordering and deletes only the selected ID", async () => {
    const document = structureDocument();
    const { store, service } = await setup(document);
    fireEvent.click(within(row("I-P-0")).getByRole("button", { name: /^Polygon 1 / }));
    const load = service.loadFrameWindow.bind(service);
    service.loadFrameWindow = async (...args) => {
      const response = await load(...args);
      response.annotations[frameInstanceKey("frame-0", "I")]!.polygons.reverse();
      return response;
    };
    await act(async () => {
      await store.getState().loadFrameWindow("video-1", 0, 0.6);
    });
    const before = store.getState().document!;
    expect(row("I-Q-0").textContent).toContain("Polygon 1");
    expect(row("I-P-0").textContent).toContain("Polygon 2");
    expect(store.getState().selection).toEqual([{ type: "polygon", id: "I-P-0" }]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await confirm("Delete");
    expect(polygons(store.getState().document!, 0, "I")).toEqual(
      polygons(before, 0, "I").filter((item) => item.id === "I-Q-0"),
    );
    expect(polygons(store.getState().document!, 1, "I")).toEqual(polygons(before, 1, "I"));
  });

  it("SEG-AUX-006 renders unloaded presence from the backend summary rather than the partial geometry window", async () => {
    const { store } = await setup(createSeedDocument());
    act(() => {
      store.getState().setCurrentFrame("frame-49");
    });
    expect(
      store.getState().document!.annotations[frameInstanceKey("frame-69", "instance-1")],
    ).toBeUndefined();
    expect(
      store.getState().document!.annotationSummaries[frameInstanceKey("frame-69", "instance-1")]!
        .pointCount,
    ).toBe(4);
    const instance = screen.getByRole("button", { name: "● Person 1" });
    expect(within(instance).getByText("120/120 frames · 1 polygons")).toBeDefined();
    const strip = screen.getByLabelText("Presence around current frame for Person 1");
    expect(strip.children).toHaveLength(41);
    expect(strip.children[40]!.getAttribute("title")).toBe("Frame +20: present");
  });
  it("SEG-ID-002/009 TREE-012 preserves references and every polygon across rename and backend display refresh", async () => {
    const document = structureDocument();
    document.momentReferences = [
      {
        id: "ref",
        momentId: "moment",
        recordId: document.record.id,
        videoId: "video-1",
        targetType: "instance",
        targetId: "I",
      },
    ];
    const { store, service } = await setup(document);
    const before = store.getState().document!;
    menu("C", "Rename class");
    fireEvent.change(screen.getByLabelText("Class name"), { target: { value: "Renamed C" } });
    await confirm();
    menu("I", "Rename instance");
    fireEvent.change(screen.getByLabelText("Instance name"), { target: { value: "Renamed I" } });
    await confirm();
    for (const frame of [0, 2]) {
      act(() => {
        store.getState().setCurrentFrame(`frame-${frame}`);
      });
      expect(screen.getByRole("button", { name: "● Renamed I" })).toBeDefined();
      expect(screen.getByRole("button", { name: /^Renamed C / })).toBeDefined();
      expect(polygons(store.getState().document!, frame, "I")).toEqual(
        polygons(before, frame, "I"),
      );
    }
    expect(store.getState().document!.instances.map((item) => item.id)).toEqual(
      before.instances.map((item) => item.id),
    );
    expect(geometry(store.getState().document!)).toEqual(geometry(before));
    expect(store.getState().document!.momentReferences).toEqual(before.momentReferences);
    act(() => {
      store.getState().submit();
    });
    await act(async () => {
      await store.getState().waitForSubmissions();
    });
    // Color/sort are backend fixture display changes, not invented UI tools.
    const refreshed = await service.loadDocument();
    refreshed.annotations = (await service.loadFrameWindow("video-1", 0, 0.6)).annotations;
    refreshed.classes.reverse();
    refreshed.instances.reverse();
    refreshed.classes.find((item) => item.id === "C")!.color = "#123456";
    const refreshedStore = createSemanticSegmentationStore(
      createMockSemanticSegmentationService({ document: refreshed, controls: { delayMs: 0 } }),
    );
    await refreshedStore.getState().initialize();
    expect(
      refreshedStore
        .getState()
        .document!.classes.map((item) => item.id)
        .sort(),
    ).toEqual(before.classes.map((item) => item.id).sort());
    expect(
      refreshedStore
        .getState()
        .document!.instances.map((item) => item.id)
        .sort(),
    ).toEqual(before.instances.map((item) => item.id).sort());
    expect(geometry(refreshedStore.getState().document!)).toEqual(geometry(before));
    expect(refreshedStore.getState().document!.momentReferences).toEqual(before.momentReferences);
    refreshedStore.getState().dispose();
  });

  it("SEG-ID-006/007/008 persists empty objects and renders selectable drafts without painted area", async () => {
    const storageKey = "structure-empty-persistence";
    window.localStorage.removeItem(storageKey);
    const { store, unmount } = await setup(structureDocument(), window.localStorage, storageKey);
    fireEvent.click(screen.getByRole("button", { name: "○ Empty instance" }));
    expect(store.getState().selection).toEqual([{ type: "instance", id: "empty-instance" }]);
    expect(polygons(store.getState().document!, 0, "empty-instance")).toEqual([]);
    let draft = "";
    let emptyClass = "";
    let emptyInstance = "";
    act(() => {
      emptyClass = store.getState().addClass("Persisted empty");
      emptyInstance = store.getState().addInstance("E", "Persisted empty instance");
      draft = store.getState().addPolygon("empty-instance");
      store.getState().submit();
    });
    await act(async () => {
      await store.getState().waitForSubmissions();
    });
    unmount();
    store.getState().dispose();
    const reloaded = createSemanticSegmentationStore(
      createMockSemanticSegmentationService({
        document: structureDocument(),
        storage: window.localStorage,
        storageKey,
        controls: { delayMs: 0 },
      }),
    );
    await reloaded.getState().initialize();
    render(
      <>
        <SpatialTree store={reloaded} />
        <SegmentationCanvas store={reloaded} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse Empty class" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand Empty class" }));
    expect(row("empty-class")).toBeDefined();
    expect(row(emptyClass)).toBeDefined();
    expect(row(emptyInstance)).toBeDefined();
    expect(polygons(reloaded.getState().document!, 0, emptyInstance)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "○ Empty instance" }));
    expect(reloaded.getState().selection).toEqual([{ type: "instance", id: "empty-instance" }]);
    expect(within(row("E")).getByText("1 present / 3 total")).toBeDefined();
    expect(within(row(draft)).getByText("Empty polygon · add vertices")).toBeDefined();
    fireEvent.click(within(row(draft)).getByRole("button", { name: /^Polygon \d+ Empty/ }));
    expect(reloaded.getState().selection).toEqual([{ type: "polygon", id: draft }]);
    expect(polygons(reloaded.getState().document!, 0, "empty-instance")).toEqual([
      { id: draft, points: [], topic: "/camera/front" },
    ]);
    const emptyPaths = screen
      .getByRole("img", { name: "Frame polygons" })
      .querySelectorAll('[data-instance-id="empty-instance"] path');
    for (const path of emptyPaths) {
      expect(path.getAttribute("d")).toBe("");
    }
    fireEvent.click(screen.getByRole("button", { name: "Add instance to Empty class" }));
    expect(
      reloaded.getState().document!.instances.some((item) => item.classId === "empty-class"),
    ).toBe(true);
    reloaded.getState().dispose();
  });

  it("SEG-TREE-001/002/003 nests pieces under their owner and reuses visible class colors across frames", async () => {
    const { store, container } = await setup();
    for (const frame of [0, 2]) {
      act(() => {
        store.getState().setCurrentFrame(`frame-${frame}`);
      });
      fireEvent.click(within(row("C")).getByRole("button", { name: "Collapse C" }));
      expect(container.querySelector('[data-node-id="I"]')).toBeNull();
      fireEvent.click(within(row("C")).getByRole("button", { name: "Expand C" }));
      const classGroup = row("C");
      expect(classGroup.querySelector('[data-node-id="I"]')).toBe(row("I"));
      expect(classGroup.querySelector('[data-node-id="K"]')).toBeNull();
      const instanceGroup = row("I");
      expect(instanceGroup.querySelector(`[data-node-id="I-P-${frame}"]`)).toBe(
        row(`I-P-${frame}`),
      );
      expect(instanceGroup.querySelector(`[data-node-id="I-Q-${frame}"]`)).toBe(
        row(`I-Q-${frame}`),
      );
      expect(instanceGroup.querySelector(`[data-node-id="J-P-${frame}"]`)).toBeNull();
      for (const id of ["C", "I", "J", `I-P-${frame}`, `I-Q-${frame}`, `J-P-${frame}`]) {
        expect(
          row(id).querySelector<HTMLElement>('[style*="background-color"]')!.style.backgroundColor,
        ).toBe("rgb(85, 184, 222)");
      }
    }
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.change(screen.getByLabelText("Class name"), { target: { value: "New color" } });
    fireEvent.keyDown(screen.getByLabelText("Class name"), { key: "Enter" });
    const category = store.getState().document!.classes.find((item) => item.name === "New color")!;
    expect(category.color).toMatch(/^#[0-9a-f]{6}$/i);
    fireEvent.click(within(row(category.id)).getByRole("button", { name: /^Add instance/ }));
    const instance = store
      .getState()
      .document!.instances.find((item) => item.classId === category.id)!;
    const color = row(category.id).querySelector<HTMLElement>('[style*="background-color"]')!.style
      .backgroundColor;
    expect(color).not.toBe("");
    expect(
      row(instance.id).querySelector<HTMLElement>('[style*="background-color"]')!.style
        .backgroundColor,
    ).toBe(color);
    fireEvent.click(within(row(instance.id)).getByRole("button", { name: /^Add polygon/ }));
    const draftId = store.getState().drawingPolygonId!;
    expect(
      row(draftId).querySelector<HTMLElement>('[style*="background-color"]')!.style.backgroundColor,
    ).toBe(color);
  });

  it("SEG-TREE-005 adds a draft and starts drawing while preserving both existing pieces", async () => {
    const { store } = await setup();
    const before = polygons(store.getState().document!, 0, "I");
    fireEvent.click(within(row("I")).getByRole("button", { name: /^Add polygon/ }));
    const id = store.getState().drawingPolygonId!;
    expect(id).toBeDefined();
    expect(store.getState().editing).toBe(true);
    expect(polygons(store.getState().document!, 0, "I")).toEqual([
      ...before,
      { id, points: [], topic: "/camera/front" },
    ]);
    expect(row(id).textContent).toContain("Empty polygon");
  });

  it.each(["cross", "menu"])(
    "SEG-TREE-006/023/024 deletes only P through %s and retains empty I",
    async (method) => {
      const { store } = await setup();
      const before = store.getState().document!;
      if (method === "cross") {
        fireEvent.click(within(row("I-P-0")).getByRole("button", { name: "Delete Polygon 1" }));
      } else {
        fireEvent.contextMenu(row("I-P-0"));
        expect(screen.getByRole("menuitem", { name: "Merge into instance…" })).toBeDefined();
        fireEvent.click(screen.getByRole("menuitem", { name: "Delete polygon…" }));
      }
      await confirm("Delete");
      expect(polygons(store.getState().document!, 0, "I")).toEqual(
        polygons(before, 0, "I").filter((item) => item.id === "I-Q-0"),
      );
      expect(polygons(store.getState().document!, 1, "I")).toEqual(polygons(before, 1, "I"));
      fireEvent.click(within(row("I-Q-0")).getByRole("button", { name: "Delete Polygon 1" }));
      await confirm("Delete");
      expect(polygons(store.getState().document!, 0, "I")).toEqual([]);
      expect(store.getState().document!.instances.find((item) => item.id === "I")).toEqual(
        before.instances.find((item) => item.id === "I"),
      );
    },
  );

  it.each([
    ["C", ["Rename class", "Delete all instances…", "Focus this class", "Merge into instance…"]],
    [
      "I",
      [
        "Delete instance in current frame…",
        "Delete instance in all frames…",
        "Focus this instance",
        "Merge into instance…",
        "Move to class…",
      ],
    ],
  ] as const)("SEG-TREE-011/016 exposes explicit %s menu actions", async (id, labels) => {
    const { store } = await setup();
    const before = invariant(store);
    fireEvent.contextMenu(row(id));
    for (const label of labels) {
      expect(screen.getByRole("menuitem", { name: label })).toBeDefined();
    }
    expect(invariant(store)).toEqual(before);
  });

  it.each(["C", "I"])(
    "SEG-TREE-013/018 confirms all-frame deletion of %s and preserves unrelated IDs and geometry",
    async (id) => {
      const { store } = await setup();
      const before = store.getState().document!;
      menu(id, id === "C" ? "Delete all instances…" : "Delete instance in all frames…");
      expect(screen.getByLabelText("Affected instance IDs").textContent).toContain("I");
      expect(
        within(screen.getByRole("dialog"))
          .getByRole("button", { name: "All frames" })
          .getAttribute("aria-pressed"),
      ).toBe("true");
      expect(store.getState().document).toEqual(before);
      await confirm("Delete");
      const after = store.getState().document!;
      const removed = id === "C" ? ["I", "J"] : ["I"];
      for (const owner of removed) {
        expect(after.instances.some((item) => item.id === owner)).toBe(false);
        for (const frame of [0, 1, 2]) {
          expect(polygons(after, frame, owner)).toEqual([]);
        }
      }
      expect(after.classes).toEqual(before.classes);
      expect(after.instances.filter((item) => !removed.includes(item.id))).toEqual(
        before.instances.filter((item) => !removed.includes(item.id)),
      );
      for (const owner of ["K", "U"]) {
        for (const frame of [0, 1, 2]) {
          expect(polygons(after, frame, owner)).toEqual(polygons(before, frame, owner));
        }
      }
    },
  );

  it.each(["C", "I"])(
    "SEG-TREE-014/019 focuses %s and excludes other instances from editing",
    async (id) => {
      const { store } = await setup();
      menu(id, `Focus this ${id === "C" ? "class" : "instance"}`);
      expect(store.getState().focus).toEqual({ type: id === "C" ? "class" : "instance", id });
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      const handles = screen.getAllByRole("button", { name: /^Vertex / });
      expect(handles.length).toBe(id === "C" ? 9 : 6);
      expect(
        handles.every((handle) => /polygon (I|J)-/.test(handle.getAttribute("aria-label")!)),
      ).toBe(true);
      expect(handles.some((handle) => handle.getAttribute("aria-label")!.includes("J-"))).toBe(
        id === "C",
      );
    },
  );

  it.each(["C", "I", "I-P-0"])(
    "SEG-TREE-015/020/021/025 merges %s via chooser with exact frame and owner scope",
    async (id) => {
      const { store } = await setup();
      const before = store.getState().document!;
      menu(id, "Merge into instance…");
      const targetId = id === "I" ? "J" : "K";
      expect(store.getState().document).toEqual(before);
      fireEvent.mouseDown(screen.getByRole("combobox", { name: "Target instance" }));
      expect(screen.getByRole("option", { name: "D / K (K)" })).toBeDefined();
      expect(screen.getByRole("option", { name: "E / U (U)" })).toBeDefined();
      fireEvent.click(
        screen.getByRole("option", { name: targetId === "J" ? "C / J (J)" : "D / K (K)" }),
      );
      await confirm();
      const after = store.getState().document!;
      expect(after.instances.find((item) => item.id === targetId)).toEqual(
        before.instances.find((item) => item.id === targetId),
      );
      expect(geometry(after)).toEqual(geometry(before));
      for (const frame of [0, 1, 2]) {
        const moved =
          id === "I-P-0"
            ? frame === 0
              ? polygons(before, 0, "I").filter((item) => item.id === id)
              : []
            : [
                ...polygons(before, frame, "I"),
                ...(id === "C" ? polygons(before, frame, "J") : []),
              ];
        expect(polygons(after, frame, targetId)).toEqual([
          ...polygons(before, frame, targetId),
          ...moved,
        ]);
        if (id === "I-P-0") {
          expect(polygons(after, frame, "I")).toEqual(
            polygons(before, frame, "I").filter((item) => item.id !== id),
          );
        }
        expect(polygons(after, frame, "U")).toEqual(polygons(before, frame, "U"));
      }
      if (id === "C") {
        expect(after.instances.filter((item) => item.classId === "C")).toEqual([]);
      }
      if (id === "I") {
        expect(after.instances.some((item) => item.id === "I")).toBe(false);
        for (const frame of [0, 1, 2]) {
          expect(polygons(after, frame, "I")).toEqual([]);
        }
      }
    },
  );

  it("SEG-TREE-022 moves I to D across three frames without merging or changing any geometry", async () => {
    const { store } = await setup();
    const before = store.getState().document!;
    menu("I", "Move to class…");
    await destination("D", "class");
    expect(screen.getByText(/This category move applies across all frames/)).toBeDefined();
    await confirm();
    expect(store.getState().document!.instances).toEqual(
      before.instances.map((item) => (item.id === "I" ? { ...item, classId: "D" } : item)),
    );
    expect(store.getState().document!.annotations).toEqual(before.annotations);
  });

  it.each(["Cancel", "Escape"])(
    "SEG-TREE-026/030 cancels all-frame merge with %s and preserves all local state",
    async (cancel) => {
      const { store, submit } = await setup();
      act(() => {
        store.getState().setSelection([{ type: "instance", id: "I" }]);
      });
      const before = invariant(store);
      menu("I", "Merge into instance…");
      expect(screen.getByLabelText("Affected instance IDs").textContent).toBe("I");
      expect(screen.getByText(/Instances merge across all frames/)).toBeDefined();
      await destination();
      if (cancel === "Cancel") {
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
      } else {
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      }
      expect(invariant(store)).toEqual(before);
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it("SEG-TREE-027 excludes self and deleted destinations with an explicit empty explanation", async () => {
    const document = structureDocument();
    document.instances = document.instances.filter((item) => item.id === "I");
    document.annotations = Object.fromEntries(
      Object.entries(document.annotations).filter(([, item]) => item.instanceId === "I"),
    );
    const { store } = await setup(document);
    menu("I", "Merge into instance…");
    expect(screen.getByText("Add another instance before merging.")).toBeDefined();
    expect(
      within(screen.getByRole("dialog")).getByRole<HTMLButtonElement>("button", { name: "Confirm" })
        .disabled,
    ).toBe(true);
    expect(store.getState().stagedOperations).toEqual([]);
  });

  it("SEG-TREE-028 rejects a destination deleted after opening the chooser without partial merge", async () => {
    const { store, service, submit } = await setup();
    menu("I", "Merge into instance…");
    await destination();
    // Real backend deletion, then a real document refresh, invalidates the open action snapshot.
    const external = createSemanticSegmentationStore(service);
    await act(async () => {
      await external.getState().initialize();
      external.getState().deleteInstance("K");
      external.getState().submit();
      await external.getState().waitForSubmissions();
    });
    await act(async () => {
      await store.getState().initialize();
    });
    const beforeConfirm = invariant(store);
    submit.mockClear();
    await confirm("Confirm", "keep-open");
    expect(screen.getByText(/Reopen this action/)).toBeDefined();
    expect(invariant(store)).toEqual(beforeConfirm);
    expect(submit).not.toHaveBeenCalled();
    // MUI diagnoses a now-deleted selected option; accept only that exact boundary warning.
    const warnings = jest.mocked(console.warn);
    for (const call of warnings.mock.calls) {
      expect(String(call[0])).toContain("out-of-range value `K`");
    }
    warnings.mockClear();
    external.getState().dispose();
  });

  // DEC006 policy evidence supplements TREE029; it does not rewrite the original adapter-error GWT.
  it("DEC006 rolls a failed real domain transaction back to prior local geometry and staging", async () => {
    const { store, submit } = await setup();
    act(() => {
      store.getState().setPolygonPoints("I-P-0", [
        { x: 0.2, y: 0.2 },
        { x: 0.5, y: 0.2 },
        { x: 0.3, y: 0.6 },
      ]);
    });
    const before = invariant(store);
    act(() => {
      expect(() => {
        store.getState().runTransaction("Scoped action failure", () => {
          store.getState().moveInstance("I", "D");
          store.getState().deletePolygon("U-P-0");
          store.getState().moveInstance("J", "missing-class");
        });
      }).toThrow("Unknown instance or class");
    });
    expect(invariant(store)).toEqual(before);
    expect(submit).not.toHaveBeenCalled();
  });

  it("DEC006 reports actual adapter failure only after submit and retains retryable local geometry", async () => {
    const { store, service, submit } = await setup();
    const backendBefore = await service.loadFrameWindow("video-1", 0, 0.6);
    menu("I", "Delete instance in current frame…");
    await confirm("Delete");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    const localBeforeSubmit = store.getState().document;
    expect(submit).not.toHaveBeenCalled();
    render(
      <>
        <SubmissionControls store={store} />
        <WorkflowControls store={store} />
      </>,
    );
    service.setControls({ failNext: true });
    fireEvent.click(screen.getByRole("button", { name: /^提交 / }));
    await act(async () => {
      await store.getState().waitForSubmissions();
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(store.getState().submissionQueue[0]!.status).toBe("failed");
    expect(store.getState().submissionQueue[0]!.error).toBe("Simulated service failure");
    expect(screen.getByRole("alert").textContent).toBe("Simulated service failure");
    expect(screen.getByRole("button", { name: "重试提交" })).toBeDefined();
    expect(store.getState().document).toEqual(localBeforeSubmit);
    expect(await service.loadFrameWindow("video-1", 0, 0.6)).toEqual(backendBefore);
  });

  it("SEG-ID-005 fences duplicate instance 7 references and selection when switching real stores", async () => {
    const first = structureDocument();
    first.instances.push({ id: "7", name: "First seven", classId: "C" });
    const second = structureDocument();
    second.record.id = "second-record";
    second.videos[0]!.recordId = second.record.id;
    second.instances.push({ id: "7", name: "Second seven", classId: "D" });
    const a = createSemanticSegmentationStore(
      createMockSemanticSegmentationService({ document: first, controls: { delayMs: 0 } }),
    );
    const b = createSemanticSegmentationStore(
      createMockSemanticSegmentationService({ document: second, controls: { delayMs: 0 } }),
    );
    await a.getState().initialize();
    await b.getState().initialize();
    a.getState().setSelection([{ type: "instance", id: "7" }]);
    const onChange = jest.fn();
    const view = render(<MomentReferencePicker store={a} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "引用空间类别或实例" }));
    fireEvent.change(screen.getByLabelText("选择类别或实例"), { target: { value: "instance/7" } });
    view.rerender(<MomentReferencePicker store={b} value="" onChange={onChange} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(b.getState().selection).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "引用空间类别或实例" }));
    fireEvent.change(screen.getByLabelText("选择类别或实例"), { target: { value: "instance/7" } });
    fireEvent.click(screen.getByRole("button", { name: "插入引用" }));
    expect(onChange).toHaveBeenCalledWith("spatial://second-record/video-1/instance/7");
    expect(
      resolveSpatialReference("spatial://record-1/video-1/instance/7", b.getState().document),
    ).toContain("记录未打开");
    expect(a.getState().selection).toEqual([{ type: "instance", id: "7" }]);
    a.getState().dispose();
    b.getState().dispose();
  });
});
