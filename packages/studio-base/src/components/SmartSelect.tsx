// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Select } from "@mui/material";
import type { SelectProps } from "@mui/material";
import { useForkRef } from "@mui/material/utils";
import {
  forwardRef,
  type ForwardedRef,
  type MutableRefObject,
  type ReactElement,
  type Ref,
  type SyntheticEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

type AnchorRef = MutableRefObject<HTMLDivElement | ReactNull>;

function useSmartSelectMenuPlacement(anchorRef: AnchorRef) {
  const [menuVerticalPlacement, setMenuVerticalPlacement] = useState<"bottom" | "top">("bottom");

  const updateMenuPlacement = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const ownerDocument = anchor.ownerDocument;
    const viewportHeight =
      ownerDocument.defaultView?.innerHeight ?? ownerDocument.documentElement.clientHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const nextPlacement = spaceBelow >= spaceAbove ? "bottom" : "top";

    setMenuVerticalPlacement((prev) => (prev === nextPlacement ? prev : nextPlacement));
  }, [anchorRef]);

  const menuProps = useMemo(
    () =>
      menuVerticalPlacement === "bottom"
        ? {
            anchorOrigin: { vertical: "bottom", horizontal: "left" } as const,
            transformOrigin: { vertical: "top", horizontal: "left" } as const,
          }
        : {
            anchorOrigin: { vertical: "top", horizontal: "left" } as const,
            transformOrigin: { vertical: "bottom", horizontal: "left" } as const,
          },
    [menuVerticalPlacement],
  );

  return { menuProps, updateMenuPlacement };
}

function SmartSelectInner<T>(
  props: SelectProps<T>,
  ref: ForwardedRef<HTMLDivElement>,
): ReactElement {
  const { MenuProps: incomingMenuProps, onOpen: incomingOnOpen, ...other } = props;
  const anchorRef = useRef<HTMLDivElement>(ReactNull);
  const combinedRef = useForkRef(anchorRef, ref);
  const { menuProps, updateMenuPlacement } = useSmartSelectMenuPlacement(anchorRef);

  const handleOpen = useCallback(
    (event: SyntheticEvent) => {
      updateMenuPlacement();
      incomingOnOpen?.(event);
    },
    [incomingOnOpen, updateMenuPlacement],
  );

  const mergedMenuProps = useMemo(() => {
    if (!incomingMenuProps) {
      return menuProps;
    }
    return {
      ...menuProps,
      ...incomingMenuProps,
      anchorOrigin: incomingMenuProps.anchorOrigin ?? menuProps.anchorOrigin,
      transformOrigin: incomingMenuProps.transformOrigin ?? menuProps.transformOrigin,
    };
  }, [incomingMenuProps, menuProps]);

  return <Select {...other} ref={combinedRef} MenuProps={mergedMenuProps} onOpen={handleOpen} />;
}

type SmartSelectComponent = <T>(
  props: SelectProps<T> & { ref?: Ref<HTMLDivElement> },
) => ReactElement;

const SmartSelect = forwardRef(SmartSelectInner) as SmartSelectComponent & { displayName?: string };
SmartSelect.displayName = "SmartSelect";

export default SmartSelect;
