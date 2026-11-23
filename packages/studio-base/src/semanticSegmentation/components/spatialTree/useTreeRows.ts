// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useRef } from "react";
import type { RefObject } from "react";

import { useVirtualRows } from "../useVirtualRows";
import type { VirtualRows } from "../useVirtualRows";
import { pinnedRowsOf } from "./treeLogic";
import { buildFlatRows } from "./treeRows";
import type { RowContext } from "./treeRows";
import { ROW_ESTIMATE } from "./treeTypes";
import type { FlatTreeRow } from "./treeTypes";

export type TreeRows = {
  treeRef: RefObject<HTMLDivElement | ReactNull>;
  flatRows: FlatTreeRow[];
  virtual: VirtualRows;
  /** Positions of the class and instance rows pinned above the scrolled list. */
  pinnedRows: number[];
};

/** The flat row list, its windowing and the rows pinned above it. */
export function useTreeRows(
  ctx: Omit<RowContext, "document" | "index"> & {
    document: RowContext["document"] | undefined;
    index: RowContext["index"] | undefined;
  },
): TreeRows {
  const treeRef = useRef<HTMLDivElement>(ReactNull);
  const { document, index } = ctx;
  const flatRows: FlatTreeRow[] =
    document && index && document.classes.length > 0
      ? buildFlatRows({ ...ctx, document, index })
      : [];
  const virtual = useVirtualRows({
    container: treeRef,
    keys: flatRows.map((item) => item.key),
    estimate: (position) => ROW_ESTIMATE[flatRows[position]!.kind],
  });
  return { treeRef, flatRows, virtual, pinnedRows: pinnedRowsOf(flatRows, virtual) };
}
