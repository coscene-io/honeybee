// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ESLint } from "eslint";
import type { Linter } from "eslint";
import { createRequire } from "node:module";
import path from "node:path";

const rootDir = path.resolve(__dirname, "..");
const loadModule = createRequire(__filename);
const eslintConfig = loadModule("../eslint.config.cjs") as Linter.Config[];
const eslintCiConfig = loadModule("../eslint.config.ci.cjs") as Linter.Config[];

const eslint = new ESLint({
  cwd: rootDir,
  overrideConfig: eslintConfig,
  overrideConfigFile: true,
});

const eslintCi = new ESLint({
  cwd: rootDir,
  overrideConfig: eslintCiConfig,
  overrideConfigFile: true,
});

const eslintWithCycleFixtures = new ESLint({
  cwd: rootDir,
  overrideConfig: [
    ...eslintCiConfig,
    {
      files: ["**/__tests__/eslintCycleFixtures/**/*.ts"],
      rules: {
        "import/no-cycle": "error",
      },
    },
  ],
  overrideConfigFile: true,
});

async function configFor(relativePath: string) {
  const config = await eslint.calculateConfigForFile(path.join(rootDir, relativePath));
  if (config == undefined) {
    throw new Error(`No ESLint configuration matched ${relativePath}`);
  }
  return config;
}

describe("ESLint flat config", () => {
  it("composes JavaScript, TypeScript, and React configuration by file type", async () => {
    const [javascript, typescript, tsx] = await Promise.all([
      configFor("packages/eslint-plugin/index.js"),
      configFor("eslint-test.ts"),
      configFor("packages/studio-base/src/components/Panel.tsx"),
    ]);

    expect(javascript.rules["@coscene-io/no-regexp-lookbehind-assertions"]?.[0]).toBe(2);
    expect(typescript.rules["@typescript-eslint/no-floating-promises"]?.[0]).toBe(2);
    expect(tsx.rules["react/prop-types"]?.[0]).toBe(0);
    expect(tsx.rules["react-hooks/exhaustive-deps"]?.[0]).toBe(2);
  });

  it("uses only the local project plugin for project-specific rules", async () => {
    const config = await configFor("eslint-test.ts");

    expect(config.plugins).toHaveProperty("@coscene-io");
    expect(config.plugins).not.toHaveProperty("@foxglove");
    expect(config.rules["@coscene-io/no-boolean-parameters"]?.[0]).toBe(2);
    const rules = config.rules as Record<string, unknown>;
    expect(Object.keys(rules).some((ruleId) => ruleId.startsWith("@foxglove/"))).toBe(false);
  });

  it("enables the complete Jest recommendation and project overrides", async () => {
    const config = await configFor("packages/studio-base/src/components/Panel.test.tsx");

    expect(config.rules["jest/no-focused-tests"]?.[0]).toBe(2);
    expect(config.rules["jest/consistent-test-it"]?.[0]).toBe(2);
    expect(config.rules["jest/expect-expect"]?.[0]).toBe(2);
  });

  it("keeps the desktop import resolver exceptions", async () => {
    const config = await configFor("packages/studio-desktop/src/main/index.ts");

    expect(config.rules["import/no-unresolved"]?.[0]).toBe(0);
  });

  it("enforces the local license rule for user script utilities", async () => {
    const config = await configFor(
      "packages/studio-base/src/players/UserScriptPlayer/transformerWorker/typescript/userUtils/pointClouds.ts",
    );

    expect(config.rules["@coscene-io/license-header"]?.[0]).toBe(2);
  });

  it("detects dependency cycles using relative, aliased, and mixed imports", async () => {
    const importStyles = ["relative", "alias", "mixed"];
    const fixtureRoot = path.join(
      rootDir,
      "packages/studio-base/src/__tests__/eslintCycleFixtures",
    );
    const fixtureFiles = importStyles.flatMap((importStyle) => [
      path.join(fixtureRoot, `${importStyle}A.ts`),
      path.join(fixtureRoot, `${importStyle}B.ts`),
    ]);
    const results = await eslintWithCycleFixtures.lintFiles(fixtureFiles);

    for (const importStyle of importStyles) {
      const stylePrefix = path.join(fixtureRoot, importStyle);
      const messages = results
        .filter((result) => result.filePath.startsWith(stylePrefix))
        .flatMap((result) =>
          result.messages.filter((message) => message.ruleId === "import/no-cycle"),
        );

      expect(messages).toHaveLength(2);
      for (const message of messages) {
        expect(message.message).toMatch(/^Dependency cycle/);
      }
    }
  }, 30_000);

  it("restricts studio-base entry points without dropping React restrictions", async () => {
    const [typescriptConfig, reactConfig] = await Promise.all([
      eslintCi.calculateConfigForFile(
        path.join(rootDir, "packages/studio-base/src/util/appURLState.ts"),
      ),
      eslintCi.calculateConfigForFile(
        path.join(rootDir, "packages/studio-base/src/components/Panel.tsx"),
      ),
    ]);
    const restrictedImportNames = (config: unknown): Array<string | undefined> => {
      const typedConfig = config as Linter.Config | undefined;
      const restrictedImportsRule = typedConfig?.rules?.["no-restricted-imports"] as
        | unknown[]
        | undefined;
      const ruleOptions = restrictedImportsRule?.[1] as
        | { paths?: Array<{ name?: string }> }
        | undefined;

      return ruleOptions?.paths?.map((entry) => entry.name) ?? [];
    };

    const studioBaseEntryPoints = ["@foxglove/studio-base", "@foxglove/studio-base/index"];
    expect(restrictedImportNames(typescriptConfig)).toEqual(
      expect.arrayContaining(studioBaseEntryPoints),
    );
    expect(restrictedImportNames(reactConfig)).toEqual(
      expect.arrayContaining([
        ...studioBaseEntryPoints,
        "@mui/material",
        "@mui/styles",
        "@mui/material/styles/styled",
        "@emotion/styled",
      ]),
    );
  });
});
