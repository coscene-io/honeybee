// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, screen } from "@testing-library/react";

/** The canvas's View tools menu, opened from its button when closed. Tests only. */
export function openViewTools(): HTMLElement {
  const open = screen.queryByRole("group", { name: "View tools" });
  if (open) {
    return open;
  }
  fireEvent.click(screen.getByRole("button", { name: "View tools" }));
  return screen.getByRole("group", { name: "View tools" });
}
