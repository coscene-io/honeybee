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

import { Grammar, Parser } from "nearley";

import grammar from "./grammar.ne";
import { MessagePath, MessagePathFunction, MessagePathPart } from "./types";

const grammarObj = Grammar.fromCompiled(grammar);

/** Wrap topic name in double quotes if it contains special characters */
export function quoteTopicNameIfNeeded(name: string): string {
  // Pattern should match `slashID` in grammar.ne
  if (name.match(/^[a-zA-Z0-9_/-]+$/)) {
    return name;
  }
  return `"${name.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

/** Wrap field name in double quotes if it contains special characters */
export function quoteFieldNameIfNeeded(name: string): string {
  // Pattern should match `id` in grammar.ne
  if (name.match(/^[a-zA-Z0-9_-]+$/)) {
    return name;
  }
  return `"${name.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

export function isFullySpecified(
  messagePath: MessagePathPart[],
  functionChain: MessagePathFunction[] | undefined,
): boolean {
  for (const part of messagePath) {
    if (part.type === "name" && part.name === "") {
      return false;
    }
    if (part.type === "filter" && (part.operator == undefined || part.value == undefined)) {
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

// Temporary Nearley adapter: map modifier → functionChain until the handwritten parser lands.
type NearleyMessagePath = {
  topicName: string;
  topicNameRepr: string;
  messagePath: MessagePathPart[];
  modifier?: string;
};

function adaptNearleyResult(raw: NearleyMessagePath | undefined): MessagePath | undefined {
  if (raw == undefined) {
    return undefined;
  }

  const messagePath = raw.messagePath.map((part) => {
    if (part.type === "filter" && part.value != undefined) {
      return { ...part, operator: "==" as const };
    }
    return part;
  });

  const functionChain: MessagePathFunction[] | undefined =
    typeof raw.modifier === "string" ? [{ function: raw.modifier }] : undefined;

  return {
    topicName: raw.topicName,
    topicNameRepr: raw.topicNameRepr,
    messagePath,
    ...(functionChain != undefined ? { functionChain } : {}),
    // "/" is an unfinished topic (empty identifier after the slash).
    isFullySpecified: raw.topicName !== "/" && isFullySpecified(messagePath, functionChain),
  };
}

const parseMessagePath = (path: string): MessagePath | undefined => {
  // Need to create a new Parser object for every new string to parse (should be cheap).
  const parser = new Parser(grammarObj);
  try {
    return adaptNearleyResult(parser.feed(path).results[0]);
  } catch {
    return undefined;
  }
};

export { parseMessagePath };
