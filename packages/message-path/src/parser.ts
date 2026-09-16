// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import {
  FilterOperator,
  MessagePath,
  MessagePathFilter,
  MessagePathFunction,
  MessagePathPart,
} from "./types";

export type MessagePathDiagnostic = {
  code: string;
  message: string;
  start: number;
  end: number;
};

const FILTER_OPERATORS: readonly FilterOperator[] = ["==", "!=", "<=", ">=", "<", ">"];

class UnrecoverableParseError extends Error {
  override name = "UnrecoverableParseError";
  constructor(readonly diagnostic: MessagePathDiagnostic) {
    super(diagnostic.message);
  }
}

export function isFullySpecified(
  messagePath: MessagePathPart[],
  functionChain: MessagePathFunction[] | undefined,
): boolean {
  for (const part of messagePath) {
    if (part.type === "name" && part.name === "") {
      return false;
    }
    if (
      part.type === "filter" &&
      (part.operator == undefined || part.value == undefined || part.path.length === 0)
    ) {
      return false;
    }
  }
  for (const step of functionChain ?? []) {
    if (step.function === "" || step.fieldAccess === "") {
      return false;
    }
  }
  return true;
}

function isIdChar(char: string | undefined): boolean {
  if (char == undefined || char.length !== 1) {
    return false;
  }
  return (
    (char >= "A" && char <= "Z") ||
    (char >= "a" && char <= "z") ||
    (char >= "0" && char <= "9") ||
    char === "_" ||
    char === "-"
  );
}

function isDigit(char: string | undefined): boolean {
  return char != undefined && char >= "0" && char <= "9";
}

export function parseMessagePathWithDiagnostics(input: string): {
  path: MessagePath | undefined;
  diagnostics: MessagePathDiagnostic[];
} {
  const diagnostics: MessagePathDiagnostic[] = [];
  let pos = 0;
  let recoverableIncomplete = false;

  const peek = (offset = 0): string | undefined => input[pos + offset];
  const atEnd = (): boolean => pos >= input.length;

  const fail = (code: string, message: string, start = pos, end = pos + 1): never => {
    throw new UnrecoverableParseError({
      code,
      message,
      start,
      end: Math.min(Math.max(end, start), input.length),
    });
  };

  const readId = (): string => {
    const start = pos;
    while (isIdChar(peek())) {
      pos++;
    }
    return input.slice(start, pos);
  };

  const parseQuotedString = (): { value: string; repr: string } => {
    const start = pos;
    if (peek() !== '"') {
      fail("expected_quote", "Expected quoted string", start, start + 1);
    }
    pos++;
    let value = "";
    while (!atEnd()) {
      const char = peek();
      if (char === '"') {
        pos++;
        return { value, repr: `"${value.replace(/[\\"]/g, (ch) => `\\${ch}`)}"` };
      }
      if (char === "\\") {
        const next = peek(1);
        if (next === "\\" || next === '"') {
          value += next;
          pos += 2;
          continue;
        }
        fail("invalid_escape", "Invalid escape in quoted string", pos, pos + 2);
      }
      value += char ?? "";
      pos++;
    }
    fail("unclosed_quote", "Unclosed quoted string", start, input.length);
  };

  const parseTopic = (): { value: string; repr: string } => {
    if (peek() === '"') {
      return parseQuotedString();
    }
    const start = pos;
    if (peek() === "/") {
      while (peek() === "/") {
        pos++;
        while (isIdChar(peek())) {
          pos++;
        }
      }
    } else if (isIdChar(peek())) {
      while (isIdChar(peek())) {
        pos++;
      }
      while (peek() === "/") {
        pos++;
        while (isIdChar(peek())) {
          pos++;
        }
      }
    } else {
      fail("expected_topic", "Expected topic name", 0, Math.max(1, input.length));
    }
    if (pos === start) {
      fail("expected_topic", "Expected topic name", 0, Math.max(1, input.length));
    }
    const value = input.slice(start, pos);
    return { value, repr: value };
  };

  const parseSliceNumber = (): number | undefined => {
    const start = pos;
    if (peek() === "-") {
      pos++;
    }
    if (!isDigit(peek())) {
      pos = start;
      return undefined;
    }
    while (isDigit(peek())) {
      pos++;
    }
    return Number(input.slice(start, pos));
  };

  const parseSliceBound = (): number | { variableName: string; startLoc: number } | undefined => {
    if (peek() === "$") {
      const startLoc = pos;
      pos++;
      return { variableName: readId(), startLoc };
    }
    return parseSliceNumber();
  };

  const parseSlice = (): MessagePathPart => {
    const start = pos;
    pos++; // [

    if (peek() === ":") {
      pos++;
      const end = parseSliceBound() ?? Infinity;
      if (peek() !== "]") {
        fail("invalid_slice", "Expected closing ]", start, pos + 1);
      }
      pos++;
      return { type: "slice", start: 0, end };
    }

    const startBound = parseSliceBound();
    if (startBound == undefined) {
      fail("invalid_slice", "Invalid slice", start, pos + 1);
    }
    if (peek() === "]") {
      pos++;
      return { type: "slice", start: startBound, end: startBound };
    }
    if (peek() === ":") {
      pos++;
      const end = parseSliceBound() ?? Infinity;
      if (peek() !== "]") {
        fail("invalid_slice", "Expected closing ]", start, pos + 1);
      }
      pos++;
      return { type: "slice", start: startBound, end };
    }
    fail("invalid_slice", "Invalid slice", start, pos + 1);
  };

  const tryKeyword = (keyword: string): boolean => {
    if (!input.startsWith(keyword, pos)) {
      return false;
    }
    if (isIdChar(input[pos + keyword.length])) {
      return false;
    }
    pos += keyword.length;
    return true;
  };

  const parseFilterString = (): { value: string; repr: string } | undefined => {
    const quote = peek();
    if (quote !== "'" && quote !== '"') {
      return undefined;
    }
    const start = pos;
    pos++;
    while (!atEnd() && peek() !== quote) {
      pos++;
    }
    if (peek() !== quote) {
      fail("unclosed_quote", "Unclosed quoted string", start, input.length);
    }
    const value = input.slice(start + 1, pos);
    pos++;
    return { value, repr: `${quote}${value}${quote}` };
  };

  const parseFilterNumber = (): number | bigint | undefined => {
    const start = pos;
    if (peek() === "+" || peek() === "-") {
      pos++;
    }
    if (!isDigit(peek())) {
      pos = start;
      return undefined;
    }
    while (isDigit(peek())) {
      pos++;
    }
    if (peek() === "." && isDigit(peek(1))) {
      pos++;
      while (isDigit(peek())) {
        pos++;
      }
      return Number(input.slice(start, pos));
    }
    return BigInt(input.slice(start, pos));
  };

  const parseFilterValue = ():
    | { value: NonNullable<MessagePathFilter["value"]>; valueIsIdentifier?: boolean }
    | undefined => {
    if (peek() === "$") {
      const startLoc = pos;
      pos++;
      const variableName = readId();
      return { value: { variableName, startLoc } };
    }

    const quoted = parseFilterString();
    if (quoted != undefined) {
      return { value: quoted.value };
    }

    if (tryKeyword("true")) {
      return { value: true };
    }
    if (tryKeyword("false")) {
      return { value: false };
    }

    const number = parseFilterNumber();
    if (number != undefined) {
      return { value: number };
    }

    if (isIdChar(peek())) {
      return { value: readId(), valueIsIdentifier: true };
    }

    return undefined;
  };

  const parseFilter = (): MessagePathFilter => {
    const open = pos;
    pos++; // {
    const nameLoc = pos;
    const path: string[] = [];
    if (isIdChar(peek())) {
      path.push(readId());
      while (peek() === "." && isIdChar(peek(1))) {
        pos++;
        path.push(readId());
      }
    }

    let operator: FilterOperator | undefined;
    let value: MessagePathFilter["value"];
    let valueIsIdentifier = false;
    let valueLoc = nameLoc;

    for (const op of FILTER_OPERATORS) {
      if (input.startsWith(op, pos)) {
        pos += op.length;
        operator = op;
        valueLoc = pos;
        const parsed = parseFilterValue();
        if (parsed == undefined) {
          fail(
            "missing_filter_value",
            "Expected filter value",
            valueLoc,
            Math.min(valueLoc + 1, input.length),
          );
        }
        value = parsed.value;
        valueIsIdentifier = parsed.valueIsIdentifier === true;
        break;
      }
    }

    let closed = false;
    if (peek() === "}") {
      pos++;
      closed = true;
    } else if (atEnd()) {
      recoverableIncomplete = true;
      diagnostics.push({
        code: "unclosed_filter",
        message: "Unclosed filter",
        start: open,
        end: pos,
      });
    } else {
      fail("unexpected_input", `Unexpected "${peek() ?? ""}" in filter`, pos, pos + 1);
    }

    const filter: MessagePathFilter = {
      type: "filter",
      path,
      value,
      nameLoc,
      valueLoc,
      repr: input.slice(nameLoc, closed ? pos - 1 : pos),
    };
    if (operator != undefined) {
      filter.operator = operator;
    }
    if (valueIsIdentifier) {
      filter.valueIsIdentifier = true;
    }
    return filter;
  };

  const parsePathParts = (): MessagePathPart[] => {
    const parts: MessagePathPart[] = [];
    for (;;) {
      if (peek() === "{") {
        parts.push(parseFilter());
        continue;
      }
      if (peek() === "." && peek(1) !== "@") {
        const dotPos = pos;
        pos++;
        if (peek() === '"') {
          const quoted = parseQuotedString();
          parts.push({ type: "name", name: quoted.value, repr: quoted.repr });
        } else if (isIdChar(peek())) {
          const name = readId();
          parts.push({ type: "name", name, repr: name });
        } else {
          diagnostics.push({
            code: "empty_name",
            message: "Expected field name",
            start: dotPos,
            end: pos,
          });
          parts.push({ type: "name", name: "", repr: "" });
          continue;
        }
        if (peek() === "[") {
          parts.push(parseSlice());
        }
        continue;
      }
      break;
    }
    return parts;
  };

  const parseFunctionChain = (): MessagePathFunction[] => {
    const chain: MessagePathFunction[] = [];
    while (peek() === "." && peek(1) === "@") {
      const stepStart = pos;
      pos += 2; // .@
      const nameStart = pos;
      while (isIdChar(peek())) {
        pos++;
      }
      if (peek() === "(") {
        let depth = 0;
        do {
          const char = peek();
          if (char == undefined) {
            fail("unclosed_paren", "Unclosed function operand", nameStart, input.length);
          }
          if (char === "(") {
            depth++;
          } else if (char === ")") {
            depth--;
          }
          pos++;
        } while (depth > 0);
      }
      const fn = input.slice(nameStart, pos);
      if (fn === "") {
        diagnostics.push({
          code: "empty_function",
          message: "Expected function name",
          start: stepStart,
          end: pos,
        });
      }

      let fieldAccess: string | undefined;
      if (peek() === "." && peek(1) !== "@") {
        const fieldDot = pos;
        pos++;
        if (isIdChar(peek())) {
          fieldAccess = readId();
        } else {
          fieldAccess = "";
          diagnostics.push({
            code: "empty_field_access",
            message: "Expected struct field name",
            start: fieldDot,
            end: pos,
          });
        }
      }

      chain.push(
        fieldAccess != undefined ? { function: fn, fieldAccess } : { function: fn },
      );
    }
    return chain;
  };

  try {
    const topic = parseTopic();
    const messagePath = parsePathParts();
    const functionChain = parseFunctionChain();
    if (!atEnd()) {
      fail("unexpected_input", `Unexpected "${input.slice(pos)}"`, pos, input.length);
    }
    const path: MessagePath = {
      topicName: topic.value,
      topicNameRepr: topic.repr,
      messagePath,
      ...(functionChain.length > 0 ? { functionChain } : {}),
      isFullySpecified:
        !recoverableIncomplete &&
        topic.value !== "/" &&
        isFullySpecified(messagePath, functionChain),
    };
    return { path, diagnostics };
  } catch (err) {
    if (err instanceof UnrecoverableParseError) {
      diagnostics.push(err.diagnostic);
      return { path: undefined, diagnostics };
    }
    throw err;
  }
}
