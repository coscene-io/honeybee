// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ReactNode, useState } from "react";

/** Keep hover updates local to a value instead of re-rendering the entire message tree. */
export function HoverValue({
  className,
  children,
}: {
  className: string;
  children: (state: { isHovering: boolean }) => ReactNode;
}): React.JSX.Element {
  const [isHovering, setIsHovering] = useState(false);
  return (
    <div
      className={className}
      onMouseEnter={() => {
        setIsHovering(true);
      }}
      onMouseLeave={() => {
        setIsHovering(false);
      }}
    >
      {children({ isHovering })}
    </div>
  );
}
