// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { parseLegacyAuthLink } from "./authLink";

it.each(["Bearer legacy.jwt.signature", "Basic legacy-api-key"])(
  "accepts legacy %s handoff",
  (credential) => {
    const link = `coscene://signin-complete?jwt=${encodeURIComponent(btoa(credential))}`;
    expect(parseLegacyAuthLink(link)).toBe(credential);
  },
);

it.each([
  "https://signin-complete",
  "coscene://signin-complete.evil",
  "coscene://signin-complete/path",
  "coscene://user@signin-complete",
  "coscene://signin-complete:123",
])("rejects lookalike callback %s", (prefix) => {
  expect(parseLegacyAuthLink(`${prefix}?jwt=${btoa("Bearer private-token")}`)).toBeUndefined();
});

it.each(["", "?jwt=not-base64!", "?jwt=YQ==", "?jwt=YQ==&jwt=Yg=="])(
  "rejects invalid callback %s without logging input",
  (query) => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(parseLegacyAuthLink(`coscene://signin-complete${query}`)).toBeUndefined();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  },
);
