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

import { parseMessagePathWithDiagnostics } from "./parser";
import { MessagePath } from "./types";

export { isFullySpecified, parseMessagePathWithDiagnostics } from "./parser";
export type { MessagePathDiagnostic } from "./parser";

/** Wrap topic name in double quotes if it contains special characters */
export function quoteTopicNameIfNeeded(name: string): string {
  // Unquoted topic names are [a-zA-Z0-9_/-]+
  if (name.match(/^[a-zA-Z0-9_/-]+$/)) {
    return name;
  }
  return `"${name.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

/** Wrap field name in double quotes if it contains special characters */
export function quoteFieldNameIfNeeded(name: string): string {
  // Unquoted field names are [a-zA-Z0-9_-]+
  if (name.match(/^[a-zA-Z0-9_-]+$/)) {
    return name;
  }
  return `"${name.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

export function parseMessagePath(input: string): MessagePath | undefined {
  return parseMessagePathWithDiagnostics(input).path;
}
