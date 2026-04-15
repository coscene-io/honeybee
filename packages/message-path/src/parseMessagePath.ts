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
import { MessagePath } from "./types";

const grammarObj = Grammar.fromCompiled(grammar);
const MAX_CACHE_ENTRIES = 1000;
const cacheMessagePath = new Map<string, MessagePath | undefined>();

function evictOldestCachedPath(): void {
  const firstEntry = cacheMessagePath.keys().next();
  if (firstEntry.done === false) {
    cacheMessagePath.delete(firstEntry.value);
  }
}

/** Wrap topic name in double quotes if it contains special characters */
export function quoteTopicNameIfNeeded(name: string): string {
  // Pattern should match `slashID` in grammar.ne
  if (/^[a-zA-Z0-9_/-]+$/.test(name)) {
    return name;
  }
  return `"${name.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

/** Wrap field name in double quotes if it contains special characters */
export function quoteFieldNameIfNeeded(name: string): string {
  // Pattern should match `id` in grammar.ne
  if (/^[a-zA-Z0-9_-]+$/.test(name)) {
    return name;
  }
  return `"${name.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

const parseMessagePath = (path: string): MessagePath | undefined => {
  if (cacheMessagePath.has(path)) {
    return cacheMessagePath.get(path);
  }

  const parser = new Parser(grammarObj);
  try {
    const results = parser.feed(path).results as MessagePath[];
    const result = results[0];
    if (cacheMessagePath.size >= MAX_CACHE_ENTRIES) {
      evictOldestCachedPath();
    }
    cacheMessagePath.set(path, result);
    return result;
  } catch {
    if (cacheMessagePath.size >= MAX_CACHE_ENTRIES) {
      evictOldestCachedPath();
    }
    cacheMessagePath.set(path, undefined);
    return undefined;
  }
};

export { parseMessagePath };
