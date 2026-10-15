// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/** Preserve the legacy wire format without accepting lookalike callback hosts. */
export function parseLegacyAuthLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "coscene:" ||
      url.hostname !== "signin-complete" ||
      url.username ||
      url.password ||
      url.port ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.searchParams.getAll("jwt").length !== 1
    ) {
      return undefined;
    }
    const encoded = url.searchParams.get("jwt");
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      return undefined;
    }
    const credential = atob(encoded);
    return /^(Bearer|Basic) \S+$/i.test(credential) ? credential : undefined;
  } catch {
    // Never log a parser error: its message can contain the credential-bearing URL.
    return undefined;
  }
}
