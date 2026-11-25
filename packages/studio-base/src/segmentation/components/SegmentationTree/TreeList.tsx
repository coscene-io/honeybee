// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useMemo } from "react";
import { makeStyles } from "tss-react/mui";

import {
  WindowedList,
  type WindowedView,
} from "@foxglove/studio-base/components/Events/WindowedList";

import { indentStyle, pinnedRowsOf } from "./treeLogic";
import { ROW_ESTIMATE, type FlatTreeRow } from "./treeTypes";

const useStyles = makeStyles()((theme) => ({
  pinnedRow: {
    backgroundColor: theme.palette.background.paper,
    boxShadow: `0 1px 0 ${theme.palette.divider}`,
  },
}));

/** One row's content, built only while the list shows it. */
function TreeSlot({ row, guide }: { row: FlatTreeRow; guide: string }): React.JSX.Element {
  return <div style={indentStyle(row.level, guide)}>{row.render()}</div>;
}

/** The windowed rows, with the class and instance of the first visible row pinned above them. */
export function TreeList({ rows }: { rows: readonly FlatTreeRow[] }): React.JSX.Element {
  const { classes, theme } = useStyles();
  const guide = theme.palette.divider;
  const items = useMemo(
    () =>
      rows.map((row) => ({
        key: row.key,
        estimatedSize: ROW_ESTIMATE[row.kind],
        content: <TreeSlot row={row} guide={guide} />,
      })),
    [rows, guide],
  );
  const select = useCallback((view: WindowedView) => pinnedRowsOf(rows, view), [rows]);
  const stickyRows = useMemo(
    () => ({ select, className: classes.pinnedRow }),
    [select, classes.pinnedRow],
  );
  return <WindowedList items={items} stickyRows={stickyRows} />;
}
