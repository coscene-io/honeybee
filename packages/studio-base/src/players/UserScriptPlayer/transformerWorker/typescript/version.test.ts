// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { readFileSync } from "fs";
import ts from "typescript-for-user-script/lib/typescript";

describe("user script TypeScript version", () => {
  it("matches the TypeScript language service embedded in Monaco", () => {
    const metadataPath =
      require.resolve("monaco-editor/esm/vs/language/typescript/lib/typescriptServicesMetadata.js");
    const metadata = readFileSync(metadataPath, "utf8");
    const monacoVersion = /const typescriptVersion = "([^"]+)"/.exec(metadata)?.[1];

    expect(monacoVersion).toBe(ts.version);
  });
});
