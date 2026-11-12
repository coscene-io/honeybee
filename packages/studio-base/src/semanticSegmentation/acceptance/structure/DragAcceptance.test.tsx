/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ThemeProvider } from "@mui/material/styles";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createMuiTheme } from "@foxglove/theme";

import { confirm, geometry, polygons, row, setup, structureDocument } from "./fixture";
import { SemanticSegmentationWorkbench } from "../../SemanticSegmentationWorkbench";
import { SegmentationCanvas } from "../../components/SegmentationCanvas";
import { SpatialTree } from "../../components/SpatialTree";
import { createSegmentationRuntime } from "../../runtime";

function visibleRow(id: string): HTMLElement {
  return row(id).querySelector<HTMLElement>(":scope > * > [data-tree-row]")!;
}

// Real React drag handlers and domain commands. This does not claim native compositor QA.
describe("structure drag acceptance", () => {
  // These are DOM/theme state transitions, not trusted native drag or compositor pixels.
  it.each(["leave", "cancel", "finish"] as const)(
    "SEG-DRAG-002/003 themed eligible emphasis and cleanup after %s",
    async (ending) => {
      const { store, rerender, submit } = await setup();
      const theme = createMuiTheme("dark", "en");
      rerender(
        <ThemeProvider theme={theme}>
          <SpatialTree store={store} />
          <SegmentationCanvas store={store} />
        </ThemeProvider>,
      );
      const before = store.getState().document!;
      const source = row("I-P-0");
      const target = row("K");
      const sourceVisual = visibleRow("I-P-0");
      const targetVisual = visibleRow("K");
      const baseline = {
        background: getComputedStyle(targetVisual).backgroundColor,
        width: targetVisual.style.borderWidth,
        outline: targetVisual.style.outline,
        border: targetVisual.style.borderColor,
      };
      const targetColor = before.classes.find((item) => item.id === "D")!.color;
      const transfer = { setData: jest.fn(), effectAllowed: "", dropEffect: "" };
      expect(sourceVisual.style.opacity).toBe("1");
      fireEvent.dragStart(source, { dataTransfer: transfer });
      expect(sourceVisual.style.opacity).toBe("0.55");
      fireEvent.dragOver(target, { dataTransfer: transfer });
      expect(targetVisual.style.outline).toBe(`2px solid ${targetColor}`);
      expect(targetVisual.style.borderColor).toBe("rgb(237, 170, 89)");
      expect(Number.parseFloat(targetVisual.style.borderWidth)).toBeLessThan(
        Number.parseFloat(baseline.width),
      );
      expect(getComputedStyle(targetVisual).backgroundColor).toBe(theme.palette.action.hover);
      expect(getComputedStyle(targetVisual).backgroundColor).not.toBe(baseline.background);
      expect(sourceVisual.style.opacity).toBe("0.25");
      expect(store.getState().document).toEqual(before);
      expect(store.getState().stagedOperations).toEqual([]);
      if (ending === "leave") {
        fireEvent.dragLeave(target, { dataTransfer: transfer });
        expect(sourceVisual.style.opacity).toBe("0.55"); // Still dragging, no longer over an eligible row.
        expect(targetVisual.style.outline).toBe(baseline.outline);
        expect(targetVisual.style.borderWidth).toBe(baseline.width);
        expect(targetVisual.style.borderColor).toBe(baseline.border);
        expect(getComputedStyle(targetVisual).backgroundColor).toBe(baseline.background);
        fireEvent.dragEnd(source, { dataTransfer: transfer });
      } else if (ending === "cancel") {
        fireEvent.dragEnd(source, { dataTransfer: transfer });
      } else {
        fireEvent.drop(target, { dataTransfer: transfer });
        // A legitimate selection/focus color remains; temporary hover/outline/thin border does not.
        expect(getComputedStyle(targetVisual).backgroundColor).toBe(theme.palette.action.selected);
        expect(targetVisual.style.borderColor).toBe("rgb(237, 170, 89)");
        expect(polygons(store.getState().document!, 0, "K")).toEqual([
          ...polygons(before, 0, "K"),
          polygons(before, 0, "I")[0]!,
        ]);
        expect(polygons(store.getState().document!, 0, "I")).toEqual([
          polygons(before, 0, "I")[1]!,
        ]);
      }
      expect(targetVisual.style.outline).toBe(baseline.outline);
      expect(targetVisual.style.borderWidth).toBe(baseline.width);
      expect(visibleRow("I-P-0").style.opacity).toBe("1");
      if (ending !== "finish") {
        expect(getComputedStyle(targetVisual).backgroundColor).toBe(baseline.background);
        expect(targetVisual.style.borderColor).toBe(baseline.border);
        expect(store.getState().document).toEqual(before);
        expect(store.getState().stagedOperations).toEqual([]);
      }
      expect(submit).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["class", "class"],
    ["class", "instance"],
    ["class", "polygon"],
    ["instance", "class"],
    ["instance", "instance"],
    ["instance", "polygon"],
    ["polygon", "class"],
    ["polygon", "instance"],
    ["polygon", "polygon"],
  ] as const)(
    "all9 %s to %s preserves scope, identity, geometry and local undo",
    async (sourceType, targetType) => {
      const { store, service, submit } = await setup();
      const before = store.getState().document!;
      const backendBefore = await service.loadDocument();
      const backendWindow = await service.loadFrameWindow("video-1", 0, 0.6);
      const sourceId = sourceType === "class" ? "C" : sourceType === "instance" ? "I" : "I-P-0";
      const targetId = targetType === "class" ? "D" : targetType === "instance" ? "K" : "K-P-0";
      const transfer = { setData: jest.fn(), effectAllowed: "", dropEffect: "" };
      fireEvent.dragStart(row(sourceId), { dataTransfer: transfer });
      expect(transfer.setData).toHaveBeenCalledWith(
        "application/x-segmentation-node",
        JSON.stringify({ type: sourceType, id: sourceId }),
      );
      expect(transfer.effectAllowed).toBe("move");
      expect(store.getState().document).toEqual(before);
      fireEvent.dragOver(row(targetId), { dataTransfer: transfer });
      expect(screen.getByRole("status").textContent).toContain("Drop onto");
      fireEvent.drop(row(targetId), { dataTransfer: transfer });
      if (sourceType !== "polygon") {
        expect(store.getState().document).toEqual(before);
        expect(screen.getByLabelText("Affected instance IDs").textContent).toContain("I");
        await confirm();
      }
      const after = store.getState().document!;
      expect(geometry(after)).toEqual(geometry(before));
      expect(after.classes).toEqual(before.classes);
      expect(after.instances.find((item) => item.id === "K")).toEqual(
        before.instances.find((item) => item.id === "K"),
      );
      expect(after.instances.find((item) => item.id === "U")).toEqual(
        before.instances.find((item) => item.id === "U"),
      );
      if (sourceType === "polygon") {
        expect(
          after.instances.filter((item) => before.instances.some((old) => old.id === item.id)),
        ).toEqual(before.instances);
        expect(
          after.instances.filter((item) => !before.instances.some((old) => old.id === item.id)),
        ).toHaveLength(targetType === "class" ? 1 : 0);
      } else if (targetType === "class") {
        expect(after.instances).toEqual(
          before.instances.map((item) =>
            item.id === "I" || (sourceType === "class" && item.id === "J")
              ? { ...item, classId: "D" }
              : item,
          ),
        );
      } else {
        expect(after.instances).toEqual(
          before.instances.filter(
            (item) => item.id !== "I" && (sourceType !== "class" || item.id !== "J"),
          ),
        );
      }
      for (const frame of [0, 1, 2]) {
        expect(polygons(after, frame, "U")).toEqual(polygons(before, frame, "U"));
        if (sourceType === "polygon") {
          const targetOwner =
            targetType === "class"
              ? after.instances.find((item) => !before.instances.some((old) => old.id === item.id))!
                  .id
              : "K";
          expect(after.instances.find((item) => item.id === targetOwner)?.classId).toBe("D");
          expect(after.instances.filter((item) => item.id === "I")).toEqual(
            before.instances.filter((item) => item.id === "I"),
          );
          expect(polygons(after, frame, "I")).toEqual(
            frame === 0
              ? polygons(before, frame, "I").filter((item) => item.id !== "I-P-0")
              : polygons(before, frame, "I"),
          );
          expect(polygons(after, frame, "J")).toEqual(polygons(before, frame, "J"));
          expect(polygons(after, frame, targetOwner)).toEqual([
            ...(targetOwner === "K" ? polygons(before, frame, "K") : []),
            ...(frame === 0 ? polygons(before, 0, "I").filter((item) => item.id === "I-P-0") : []),
          ]);
        } else if (targetType === "class") {
          expect(after.instances.find((item) => item.id === "I")).toEqual({
            ...before.instances.find((item) => item.id === "I"),
            classId: "D",
          });
          expect(after.instances.find((item) => item.id === "J")?.classId).toBe(
            sourceType === "class" ? "D" : "C",
          );
          expect(after.annotations).toEqual(before.annotations);
        } else {
          const retired = sourceType === "class" ? ["I", "J"] : ["I"];
          expect(after.instances.filter((item) => retired.includes(item.id))).toEqual([]);
          expect(polygons(after, frame, "K")).toEqual([
            ...polygons(before, frame, "K"),
            ...polygons(before, frame, "I"),
            ...(sourceType === "class" ? polygons(before, frame, "J") : []),
          ]);
          for (const id of retired) {
            expect(polygons(after, frame, id)).toEqual([]);
          }
          if (sourceType === "instance") {
            expect(polygons(after, frame, "J")).toEqual(polygons(before, frame, "J"));
          }
        }
      }
      expect(store.getState().stagedOperations.length).toBeGreaterThan(0);
      expect(store.getState().submissionQueue).toEqual([]);
      expect(submit).not.toHaveBeenCalled();
      expect(await service.loadDocument()).toEqual(backendBefore);
      expect(await service.loadFrameWindow("video-1", 0, 0.6)).toEqual(backendWindow);
      act(() => {
        store.getState().undo();
      });
      expect(store.getState().document).toEqual(before);
      expect(store.getState().stagedOperations).toEqual([]);
      store.getState().dispose();
    },
  );

  it.each([
    ["C", "C"],
    ["I", "I"],
    ["I-P-0", "I"],
    ["C", "I"],
    ["C", "I-P-0"],
    ["I", "I-P-0"],
  ])(
    "rejects identity/descendant drop %s on %s with a reason and zero staging",
    async (source, target) => {
      const { store, submit } = await setup();
      const before = store.getState().document;
      const transfer = { setData: jest.fn(), effectAllowed: "" };
      fireEvent.dragStart(row(source), { dataTransfer: transfer });
      fireEvent.drop(row(target), { dataTransfer: transfer });
      expect(screen.getByRole("alert").textContent).toContain("No change");
      expect(store.getState().document).toEqual(before);
      expect(store.getState().stagedOperations).toEqual([]);
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it.each(["frame", "view", "revision"])(
    "rejects a stale %s drag without changing either scope",
    async (change) => {
      const { store, submit } = await setup();
      const transfer = { setData: jest.fn(), effectAllowed: "" };
      fireEvent.dragStart(row("I"), { dataTransfer: transfer });
      await act(async () => {
        if (change === "frame") {
          store.getState().setCurrentFrame("frame-1");
        } else if (change === "view") {
          store.getState().setViewMode("original");
        } else {
          await store.getState().viewRevision("revision-0");
        }
      });
      const beforeDrop = store.getState().document;
      fireEvent.drop(row("D"), { dataTransfer: transfer });
      expect(screen.getByText(/The frame or view changed during the drag/)).toBeDefined();
      expect(store.getState().document).toEqual(beforeDrop);
      expect(store.getState().stagedOperations).toEqual([]);
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it.each(["history", "propagation"])(
    "SEG-DRAG-015 blocks %s drag writes and displays the lock reason",
    async (mode) => {
      const runtime = createSegmentationRuntime(structureDocument());
      const { store, service } = runtime;
      service.setControls({ delayMs: 0 });
      await runtime.initialize();
      const submit = jest.spyOn(service, "submit");
      render(<SemanticSegmentationWorkbench runtime={runtime} embedded />);
      let running: Promise<void> | undefined;
      if (mode === "history") {
        await act(async () => {
          await store.getState().viewRevision("revision-0");
        });
        expect(screen.getByText(/历史版本 revision-0/)).toBeDefined();
      } else {
        await act(async () => {
          store.getState().setFocus({ type: "instance", id: "I" });
        });
        service.setControls({ streamDelayMs: 1000 });
        act(() => {
          running = store.getState().startPropagation({
            instanceId: "I",
            fromFrameId: "frame-0",
            endTimeNs: "1700000000400000000",
          });
        });
        await waitFor(() => {
          expect(store.getState().propagation.status).toBe("running");
        });
        // The embedded canvas is inert; the global lock banner owns the reason and STOP.
        expect(screen.queryByRole("button", { name: "STOP · 停止传播" })).toBeNull();
      }
      const before = store.getState().document;
      const transfer = { setData: jest.fn(), effectAllowed: "" };
      expect(row("I").draggable).toBe(false);
      fireEvent.dragStart(row("I"), { dataTransfer: transfer });
      fireEvent.drop(row("D"), { dataTransfer: transfer });
      expect(transfer.setData).not.toHaveBeenCalled();
      expect(store.getState().document).toEqual(before);
      expect(store.getState().stagedOperations).toEqual([]);
      expect(submit).not.toHaveBeenCalled();
      if (running) {
        await act(async () => {
          store.getState().stopPropagation();
          await running;
        });
      }
      runtime.dispose();
    },
  );

  it.each([false, true])(
    "merges I into a staged destination with geometry=%s and undoes without submission",
    async (withGeometry) => {
      const { store, submit } = await setup();
      let target = "";
      act(() => {
        target = store.getState().addInstance("D", "Staged destination");
        if (withGeometry) {
          store
            .getState()
            .addPolygon(target, polygons(store.getState().document!, 0, "K")[0]!.points);
        }
        store.getState().setFocus(undefined);
      });
      const before = store.getState().document!;
      const transfer = { setData: jest.fn(), effectAllowed: "" };
      fireEvent.dragStart(row("I"), { dataTransfer: transfer });
      fireEvent.drop(row(target), { dataTransfer: transfer });
      await confirm();
      const after = store.getState().document!;
      expect(after.instances.find((item) => item.id === target)).toEqual(
        before.instances.find((item) => item.id === target),
      );
      expect(after.instances.some((item) => item.id === "I")).toBe(false);
      for (const frame of [0, 1, 2]) {
        expect(polygons(after, frame, target)).toEqual([
          ...polygons(before, frame, target),
          ...polygons(before, frame, "I"),
        ]);
      }
      expect(submit).not.toHaveBeenCalled();
      expect(store.getState().submissionQueue).toEqual([]);
      act(() => {
        store.getState().undo();
      });
      expect(store.getState().document).toEqual(before);
    },
  );
});
