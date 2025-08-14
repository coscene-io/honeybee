// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { escapeRegExp } from "lodash-es";

/**
 * Renders the given text with the span matching highlight wrapped in a
 * <mark> component.
 */
export function HighlightedText({
  text,
  highlight,
}: {
  text: string;
  highlight?: string;
}): React.JSX.Element {
  if (!highlight?.trim()) {
    return <span style={{ wordBreak: "break-word" }}>{text}</span>;
  }
  const regex = new RegExp(`(${escapeRegExp(highlight)})`, "gi");
  const parts = text.split(regex);
  return (
    <span style={{ wordBreak: "break-word" }}>
      {parts
        .filter((part) => part)
        .map((part, i) =>
          regex.test(part) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
        )}
    </span>
  );
}
