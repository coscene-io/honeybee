// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessagePathStructureItem, parseMessagePath } from "@foxglove/message-path";
import { enumValuesByDatatypeAndField } from "@foxglove/studio-base/util/enums";

import { traverseStructure } from "./messagePathsForDatatype";

const OPERATORS = ["==", "!=", "<", "<=", ">", ">="];

/** Complete an unfinished filter without making it a valid expression for evaluation. */
export function suggestFilterCompletions(
  path: string,
  topics: readonly { name: string; schemaName?: string }[],
  structures: Readonly<Record<string, MessagePathStructureItem>>,
  enumValues: ReturnType<typeof enumValuesByDatatypeAndField>,
  globalVariableNames: readonly string[],
):
  | {
      autocompleteItems: string[];
      autocompleteFilterText: string;
      autocompleteRange: { start: number; end: number };
    }
  | undefined {
  const open = path.lastIndexOf("{");
  if (open === -1) {
    return undefined;
  }
  const prefix = parseMessagePath(path.slice(0, open));
  const schemaName = topics.find((topic) => topic.name === prefix?.topicName)?.schemaName;
  if (prefix == undefined || schemaName == undefined || prefix.functionChain != undefined) {
    return undefined;
  }
  const traversal = traverseStructure(structures[schemaName], prefix.messagePath);
  if (!traversal.valid || traversal.structureItem?.structureType !== "message") {
    return undefined;
  }
  const close = path.indexOf("}", open + 1);
  const end = close === -1 ? path.length : close;
  const body = path.slice(open + 1, end);
  const match = /^([A-Za-z0-9_.-]*)([=!<>]*)(.*)$/.exec(body);
  if (match == undefined) {
    return undefined;
  }
  const [, fieldPath = "", operator = "", value = ""] = match;
  const names = fieldPath.split(".");
  const field = names.pop() ?? "";
  let owner: MessagePathStructureItem | undefined = traversal.structureItem;
  for (const name of names) {
    owner = owner.structureType === "message" ? owner.nextByName[name] : undefined;
    if (owner == undefined) {
      return undefined;
    }
  }
  if (owner.structureType !== "message") {
    return undefined;
  }

  const complete = (items: string[], filterText: string, start: number) => ({
    autocompleteItems: items.map((item) => (close === -1 ? `${item}}` : item)),
    autocompleteFilterText: filterText,
    autocompleteRange: { start, end },
  });
  const item = owner.nextByName[field];
  if (OPERATORS.includes(operator) && item?.structureType === "primitive") {
    const start = open + 1 + fieldPath.length + operator.length;
    if (
      value.startsWith("$") &&
      /^\$[A-Za-z0-9_-]*$/.test(value) &&
      (close === -1 || !globalVariableNames.includes(value.slice(1)))
    ) {
      return complete(
        globalVariableNames.map((name) => `$${name}`),
        value,
        start,
      );
    }
    if (/^(?:[A-Za-z_][A-Za-z0-9_-]*)?$/.test(value)) {
      const names = Object.values(enumValues[owner.datatype]?.[field] ?? {}).filter((name) =>
        /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name),
      );
      if (names.length > 0 && (close === -1 || !names.includes(value))) {
        return complete(names, value, start);
      }
    }
  }
  if (value !== "") {
    return undefined;
  }
  const items: string[] = [];
  for (const [name, structure] of Object.entries(owner.nextByName)) {
    if (structure.structureType !== "primitive" || !/^[A-Za-z0-9_-]+$/.test(name)) {
      continue;
    }
    const example =
      structure.primitiveType === "string"
        ? '""'
        : structure.primitiveType === "bool"
          ? "true"
          : "0";
    const fullName = [...names, name].join(".");
    for (const op of OPERATORS) {
      if (name.startsWith(field) && op.startsWith(operator)) {
        items.push(`${fullName}${op}${example}`);
      }
    }
  }
  return complete(items, body, open + 1);
}
