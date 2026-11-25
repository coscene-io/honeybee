// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { buildFlatRows } from "./treeRows";
import type { RowContext } from "./treeRows";
import type { FlatTreeRow } from "./treeTypes";

/** The flat row list of the tree; empty until a record with classes is open. */
export function flatTreeRows(
  ctx: Omit<RowContext, "document" | "index"> & {
    document: RowContext["document"] | undefined;
    index: RowContext["index"] | undefined;
  },
): FlatTreeRow[] {
  const { document, index } = ctx;
  return document && index && document.classes.length > 0
    ? buildFlatRows({ ...ctx, document, index })
    : [];
}
