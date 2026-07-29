// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import ts from "typescript";

import { createTssReactNameTransformer } from "./createTssReactNameTransformer";

const sourceFileName = "/repo/packages/example/src/Foo.tsx";

function transform(sourceText: string): string {
  const compilerOptions: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true,
    target: ts.ScriptTarget.ES2022,
  };
  const sourceFile = ts.createSourceFile(
    sourceFileName,
    sourceText,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  const defaultHost = ts.createCompilerHost(compilerOptions);
  const compilerHost: ts.CompilerHost = {
    ...defaultHost,
    fileExists: (fileName) => fileName === sourceFileName || defaultHost.fileExists(fileName),
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
      fileName === sourceFileName
        ? sourceFile
        : defaultHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile),
    readFile: (fileName) =>
      fileName === sourceFileName ? sourceText : defaultHost.readFile(fileName),
  };
  const program = ts.createProgram([sourceFileName], compilerOptions, compilerHost);
  const result = ts.transform(sourceFile, [createTssReactNameTransformer(program)]);

  try {
    return ts.createPrinter().printFile(result.transformed[0]!);
  } finally {
    result.dispose();
  }
}

describe("createTssReactNameTransformer", () => {
  it("adds a filename-derived name to makeStyles imported from tss-react/mui", () => {
    const output = transform(`
      import { makeStyles } from "tss-react/mui";
      makeStyles();
    `);

    expect(output).toContain('makeStyles({ name: "src_Foo_tsx" });');
  });

  it("does not transform a same-named local function", () => {
    const output = transform(`
      function makeStyles() {}
      makeStyles();
    `);

    expect(output).toContain("makeStyles();");
    expect(output).not.toContain("src_Foo_tsx");
  });

  it("does not replace existing makeStyles arguments", () => {
    const output = transform(`
      import { makeStyles } from "tss-react/mui";
      makeStyles({ name: "ExplicitName" });
    `);

    expect(output).toContain('makeStyles({ name: "ExplicitName" });');
    expect(output).not.toContain("src_Foo_tsx");
  });
});
