// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { parseMessagePath } from "@foxglove/message-path";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";
import { enumValuesByDatatypeAndField } from "@foxglove/studio-base/util/enums";

import { messagePathStructures } from "./messagePathsForDatatype";
import { suggestFilterCompletions } from "./suggestFilterCompletions";

const datatypes: RosDatatypes = new Map([
  [
    "DiagnosticArray",
    { definitions: [{ name: "status", type: "DiagnosticStatus", isArray: true }] },
  ],
  [
    "DiagnosticStatus",
    {
      definitions: [
        { name: "OK", type: "uint8", isConstant: true, value: 0 },
        { name: "WARN", type: "uint8", isConstant: true, value: 1 },
        { name: "ERROR", type: "uint8", isConstant: true, value: 2 },
        { name: "level", type: "uint8" },
        { name: "message", type: "string" },
        { name: "nested", type: "Nested" },
      ],
    },
  ],
  [
    "Nested",
    {
      definitions: [
        { name: "IDLE", type: "uint8", isConstant: true, value: 0 },
        { name: "MOVING", type: "uint8", isConstant: true, value: 1 },
        { name: "state", type: "uint8" },
      ],
    },
  ],
]);
const topics = [{ name: "/diagnostics", schemaName: "DiagnosticArray" }];
const structures = messagePathStructures(datatypes);
const enums = enumValuesByDatatypeAndField(datatypes);
const suggest = (path: string) =>
  suggestFilterCompletions(path, topics, structures, enums, ["limit"]);
const select = (path: string, item: string) => {
  const result = suggest(path)!;
  return (
    path.slice(0, result.autocompleteRange.start) + item + path.slice(result.autocompleteRange.end)
  );
};

describe("suggestFilterCompletions", () => {
  it("offers all six comparison operators for a field without accepting an unclosed filter", () => {
    const path = "/diagnostics.status[:]{lev";
    expect(parseMessagePath(path)).toBeUndefined();
    const result = suggest(path)!;
    expect(result.autocompleteItems).toEqual([
      "level==0}",
      "level!=0}",
      "level<0}",
      "level<=0}",
      "level>0}",
      "level>=0}",
    ]);
    for (const item of result.autocompleteItems) {
      expect(parseMessagePath(select(path, item))?.isFullySpecified).toBe(true);
    }
  });

  it.each(["==", "!=", "<", "<=", ">", ">="])("completes enum names after %s", (op) => {
    const path = `/diagnostics.status[:]{level${op}`;
    expect(suggest(path)?.autocompleteItems).toEqual(["OK}", "WARN}", "ERROR}"]);
    expect(select(path, "OK}")).toBe(`/diagnostics.status[:]{level${op}OK}`);
  });

  it("preserves an existing closing brace and trailing field/function chain", () => {
    const path = "/diagnostics.status[:]{level==W}.level.@add(1)";
    expect(suggest(path)?.autocompleteFilterText).toBe("W");
    expect(select(path, "WARN")).toBe("/diagnostics.status[:]{level==WARN}.level.@add(1)");
  });

  it("completes a partial operator", () => {
    const path = "/diagnostics.status[:]{level!}";
    expect(suggest(path)?.autocompleteItems).toEqual(["level!=0"]);
    expect(select(path, "level!=0")).toBe("/diagnostics.status[:]{level!=0}");
  });

  it("uses the nested field's datatype for enum names", () => {
    expect(suggest("/diagnostics.status[:]{nested.state==")?.autocompleteItems).toEqual([
      "IDLE}",
      "MOVING}",
    ]);
    expect(suggest("/diagnostics.status[:]{nested.st}")?.autocompleteItems).toContain(
      "nested.state==0",
    );
  });

  it("completes globals without replacing the field or operator", () => {
    const path = "/diagnostics.status[:]{level==$li}";
    expect(suggest(path)?.autocompleteItems).toEqual(["$limit"]);
    expect(select(path, "$limit")).toBe("/diagnostics.status[:]{level==$limit}");
  });

  it.each([
    "/diagnostics.status[:]{level==OK}.level.@",
    "/diagnostics.status[:]{level==0}.message",
    "/diagnostics.status[:]{level==$limit}.level.@",
    '/diagnostics.status[:]{message=="{level=="}',
    "/diagnostics.unknown{level==",
    "/diagnostics.status{level==",
  ])("does not intercept complete values, quoted braces, or invalid prefixes: %s", (path) => {
    expect(suggest(path)).toBeUndefined();
  });
});
