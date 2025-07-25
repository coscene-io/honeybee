// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Typography } from "@mui/material";
import * as _ from "lodash-es";
import { FixedSizeList, ListChildComponentProps } from "react-window";

const Constants = Object.freeze({
  LISTBOX_PADDING: 8,
  ROW_HEIGHT: 26,
});

function renderRow(props: ListChildComponentProps) {
  const { data, index, style } = props;
  const dataSet = data[index];
  const inlineStyle = {
    ...style,
    top: (style.top as number) + Constants.LISTBOX_PADDING,
  };

  return (
    <Typography component="li" noWrap style={inlineStyle}>
      {dataSet}
    </Typography>
  );
}

const OuterElementContext = React.createContext({});

const OuterElementType = React.forwardRef<HTMLDivElement>((props, ref) => {
  const outerProps = React.useContext(OuterElementContext);
  return <div ref={ref} {...props} {...outerProps} />;
});
OuterElementType.displayName = "OuterElement";

/**
 * React-window adapter for a virtualized list, used in autocomplete.
 */
export const ReactWindowListboxAdapter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLElement>
>(function ListboxComponent(props, ref) {
  const { children, ...other } = props;
  const itemData: React.ReactNode[] = [];
  (children as React.ReactNode[]).forEach((item) => {
    if (item != undefined && typeof item === "object" && "children" in item) {
      itemData.push(item);
      itemData.push(...((item as { children?: React.ReactNode[] }).children ?? []));
    } else {
      itemData.push(item);
    }
  });

  const totalHeight =
    2 * Constants.LISTBOX_PADDING + Constants.ROW_HEIGHT * _.clamp(itemData.length, 16);

  return (
    <div ref={ref}>
      <OuterElementContext.Provider value={other}>
        <FixedSizeList
          height={totalHeight}
          itemCount={itemData.length}
          itemData={itemData}
          itemSize={Constants.ROW_HEIGHT}
          outerElementType={OuterElementType}
          width="100%"
        >
          {renderRow}
        </FixedSizeList>
      </OuterElementContext.Provider>
    </div>
  );
});
