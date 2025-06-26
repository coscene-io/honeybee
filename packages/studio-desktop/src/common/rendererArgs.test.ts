// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { decodeRendererArg, encodeRendererArg } from "./rendererArgs";

describe("encodeRendererArg & decodeRendererArg", () => {
  it("encodes and decodes", () => {
    const encoded = encodeRendererArg("deepLinks", ["coscene://example"]);
    expect(encoded).toEqual("--deepLinks=WyJsaWNodGJsaWNrOi8vZXhhbXBsZSJd");
    expect(decodeRendererArg("deepLinks", ["arg1", encoded, "arg2"])).toEqual([
      "coscene://example",
    ]);
  });
});
