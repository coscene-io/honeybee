// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";

import { SegmentationCanvas } from "../../components/SegmentationCanvas";
import { SpatialTree } from "../../components/SpatialTree";
import { createMockSemanticSegmentationService, createSeedDocument } from "../../mockService";
import { frameInstanceKey } from "../../service";
import { createSemanticSegmentationStore } from "../../store";
import type { SegmentationDocument, SegmentationPolygon } from "../../types";

type StructureSetup = RenderResult & {
  store: ReturnType<typeof createSemanticSegmentationStore>;
  service: ReturnType<typeof createMockSemanticSegmentationService>;
  submit: jest.SpiedFunction<ReturnType<typeof createMockSemanticSegmentationService>["submit"]>;
};

const stores = new Set<ReturnType<typeof createSemanticSegmentationStore>>();

afterEach(() => {
  for (const store of stores) {
    store.getState().dispose();
  }
  stores.clear();
});

// I has two distinct pieces across three frames; J occurs on overlapping and disjoint frames.
// K is a destination in D and U is unrelated geometry in a third class.
export function structureDocument(): SegmentationDocument {
  const document = createSeedDocument();
  document.frames = document.frames.slice(0, 3);
  document.videos[0]!.durationSec = 0.6;
  document.classes = [
    { id: "C", name: "C", color: "#55b8de" },
    { id: "D", name: "D", color: "#edaa59" },
    { id: "E", name: "E", color: "#7ccf92" },
    { id: "empty-class", name: "Empty class", color: "#b28ee8" },
  ];
  document.instances = [
    { id: "I", name: "I", classId: "C" },
    { id: "J", name: "J", classId: "C" },
    { id: "K", name: "K", classId: "D" },
    { id: "U", name: "U", classId: "E" },
    { id: "empty-instance", name: "Empty instance", classId: "E" },
  ];
  document.annotations = {};
  document.annotationSummaries = {};
  document.versions = {};
  for (const frame of document.frames) {
    for (const [owner, count] of [
      ["I", 2],
      ["J", 1],
      ["K", 1],
      ["U", 1],
    ] as const) {
      if (owner === "J" && frame.index === 1) {
        continue;
      }
      const key = frameInstanceKey(frame.id, owner);
      const polygons = Array.from({ length: count }, (_, index) => ({
        id: `${owner}-${index === 0 ? "P" : "Q"}-${frame.index}`,
        points: [
          { x: 0.1 + index * 0.2, y: 0.1 },
          { x: 0.4 + index * 0.2, y: 0.1 },
          { x: 0.25 + index * 0.2, y: 0.5 },
        ],
      }));
      document.annotations[key] = { frameId: frame.id, instanceId: owner, version: 1, polygons };
      document.annotationSummaries[key] = { polygonCount: count, pointCount: count * 3 };
      document.versions[key] = 1;
    }
  }
  return document;
}

export async function setup(
  document = structureDocument(),
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  storageKey?: string,
): Promise<StructureSetup> {
  const service = createMockSemanticSegmentationService({
    document,
    storage,
    storageKey,
    controls: { delayMs: 0 },
  });
  const store = createSemanticSegmentationStore(service);
  stores.add(store);
  await store.getState().initialize();
  const submit = jest.spyOn(service, "submit");
  const view = render(
    <>
      <SpatialTree store={store} />
      <SegmentationCanvas store={store} />
    </>,
  );
  return { store, service, submit, ...view };
}

export function row(id: string): HTMLElement {
  const element = screen.getByRole("tree").querySelector<HTMLElement>(`[data-node-id="${id}"]`);
  expect(element).not.toBeNull();
  return element!;
}

export function menu(id: string, action: string): void {
  fireEvent.contextMenu(row(id), { clientX: 10, clientY: 10 });
  fireEvent.click(screen.getByRole("menuitem", { name: action }));
}

export async function confirm(
  name = "Confirm",
  completion: "close" | "keep-open" = "close",
): Promise<void> {
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name }));
  if (completion === "close") {
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    });
  }
}

export async function destination(id = "K", type = "instance"): Promise<void> {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: `Target ${type}` }));
  fireEvent.click(screen.getByRole("option", { name: new RegExp(`\\(${id}\\)$`) }));
  await waitFor(() => {
    expect(screen.queryByRole("listbox", { hidden: true })).toBeNull();
  });
}

export function polygons(
  document: SegmentationDocument,
  frame: number,
  owner: string,
): SegmentationPolygon[] {
  return document.annotations[frameInstanceKey(`frame-${frame}`, owner)]?.polygons ?? [];
}

export function geometry(document: SegmentationDocument): SegmentationPolygon[] {
  return Object.values(document.annotations)
    .flatMap((annotation) => annotation.polygons)
    .sort((a, b) => a.id.localeCompare(b.id));
}
