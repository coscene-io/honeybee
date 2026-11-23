// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { makeStyles } from "tss-react/mui";

import type { VirtualRows } from "../useVirtualRows";
import { indentStyle } from "./treeLogic";
import type { FlatTreeRow } from "./treeTypes";

const useStyles = makeStyles()((theme) => ({
  pinned: {
    position: "sticky",
    top: 0,
    height: 0,
    zIndex: 3,
  },
  pinnedRow: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: theme.palette.background.paper,
    boxShadow: `0 1px 0 ${theme.palette.divider}`,
  },
}));

type VirtualTreeListProps = {
  rows: readonly FlatTreeRow[];
  virtual: VirtualRows;
  /** Positions of the class and instance rows pinned above the scrolled list. */
  pinnedRows: readonly number[];
};

/**
 * The windowed rows. The class and instance rows that own the first visible row are drawn again
 * in a zero-height sticky layer; their list slots stay empty so the geometry holds.
 */
export function VirtualTreeList({
  rows,
  virtual,
  pinnedRows,
}: VirtualTreeListProps): React.JSX.Element {
  const { classes, theme } = useStyles();
  const guide = theme.palette.divider;
  return (
    <>
      {pinnedRows.length > 0 && (
        <div className={classes.pinned}>
          {pinnedRows.map((position, layer) => (
            <div
              key={rows[position]!.key}
              className={classes.pinnedRow}
              style={{
                top:
                  layer === 0
                    ? 0
                    : virtual.offsets[pinnedRows[0]! + 1]! - virtual.offsets[pinnedRows[0]!]!,
                ...indentStyle(rows[position]!.level, guide),
              }}
            >
              {rows[position]!.render()}
            </div>
          ))}
        </div>
      )}
      <div style={{ height: virtual.offsets[virtual.start] }} />
      {rows.slice(virtual.start, virtual.end).map((item, offset) => {
        const position = virtual.start + offset;
        return pinnedRows.includes(position) ? (
          // Shown in the pinned layer; the slot keeps the list's geometry.
          <div
            key={item.key}
            style={{ height: virtual.offsets[position + 1]! - virtual.offsets[position]! }}
          />
        ) : (
          <div
            key={item.key}
            ref={virtual.measure(item.key)}
            style={indentStyle(item.level, guide)}
          >
            {item.render()}
          </div>
        );
      })}
      <div style={{ height: virtual.offsets[rows.length]! - virtual.offsets[virtual.end]! }} />
    </>
  );
}
