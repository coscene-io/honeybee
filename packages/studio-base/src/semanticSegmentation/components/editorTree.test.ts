// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { SegmentationDocument } from "../types";
import { canDropNode, compactSelection } from "./editorTree";

const document: SegmentationDocument = {
  annotationSummaries: {},
  record: { id: "r", name: "record" },
  videos: [],
  frames: [],
  versions: {},
  momentReferences: [],
  classes: [
    { id: "a", name: "A", color: "red" },
    { id: "b", name: "B", color: "blue" },
  ],
  instances: [
    { id: "i", classId: "a", name: "I" },
    { id: "j", classId: "b", name: "J" },
  ],
  annotations: {
    f: { frameId: "f", instanceId: "i", polygons: [{ id: "p", points: [] }], version: 0 },
  },
};

describe("editor tree operations", () => {
  it("rejects identity, missing targets, own class and descendant drops", () => {
    expect(canDropNode(document, { type: "class", id: "a" }, { type: "polygon", id: "p" })).toBe(
      false,
    );
    expect(canDropNode(document, { type: "instance", id: "i" }, { type: "polygon", id: "p" })).toBe(
      false,
    );
    expect(canDropNode(document, { type: "polygon", id: "p" }, { type: "class", id: "a" })).toBe(
      false,
    );
    expect(canDropNode(document, { type: "class", id: "a" }, { type: "class", id: "a" })).toBe(
      false,
    );
    expect(
      canDropNode(document, { type: "instance", id: "missing" }, { type: "class", id: "b" }),
    ).toBe(false);
  });
  it("accepts class merges, instance reparenting and polygon moves across classes", () => {
    expect(canDropNode(document, { type: "class", id: "a" }, { type: "class", id: "b" })).toBe(
      true,
    );
    expect(canDropNode(document, { type: "instance", id: "i" }, { type: "class", id: "b" })).toBe(
      true,
    );
    expect(canDropNode(document, { type: "polygon", id: "p" }, { type: "instance", id: "j" })).toBe(
      true,
    );
  });
  it("deduplicates selected parents and children before destructive bulk actions", () => {
    expect(
      compactSelection(document, [
        { type: "class", id: "a" },
        { type: "instance", id: "i" },
        { type: "polygon", id: "p" },
        { type: "instance", id: "j" },
        { type: "instance", id: "j" },
      ]),
    ).toEqual({ classes: ["a"], instances: ["j"], polygons: [] });
    expect(
      compactSelection(document, [
        { type: "instance", id: "i" },
        { type: "polygon", id: "p" },
      ]),
    ).toEqual({ classes: [], instances: ["i"], polygons: [] });
  });
});
