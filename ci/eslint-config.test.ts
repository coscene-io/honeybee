// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ESLint } from "eslint";
import type { Linter } from "eslint";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

type OxlintRule = string | [string, ...unknown[]];
type OxlintOverride = {
  files: string[];
  excludeFiles?: string[];
  rules: Record<string, OxlintRule>;
};
type OxlintConfig = {
  rules: Record<string, OxlintRule>;
  overrides: OxlintOverride[];
};

const rootDir = path.resolve(__dirname, "..");
const loadModule = createRequire(__filename);
const oxlintConfig = loadModule("../.oxlintrc.json") as OxlintConfig;
const residualConfig = loadModule("../eslint.config.residual.cjs") as Linter.Config[];

const residualEslint = new ESLint({
  cwd: rootDir,
  overrideConfig: residualConfig,
  overrideConfigFile: true,
});

function oxlintOverride(files: string): OxlintOverride {
  const override = oxlintConfig.overrides.find((entry) => entry.files.includes(files));
  if (override == undefined) {
    throw new Error(`No Oxlint override matched ${files}`);
  }
  return override;
}

async function residualConfigFor(relativePath: string) {
  const config = await residualEslint.calculateConfigForFile(path.join(rootDir, relativePath));
  if (config == undefined) {
    throw new Error(`No residual ESLint configuration matched ${relativePath}`);
  }
  return config;
}

describe("hybrid Oxlint and ESLint configuration", () => {
  it("moves supported JavaScript, TypeScript, and React rules to Oxlint", () => {
    const typescript = oxlintOverride("**/*.{ts,tsx}");
    const react = oxlintOverride("**/*.{jsx,tsx}");

    expect(oxlintConfig.rules["no-eval"]).toBe("error");
    expect(typescript.rules["typescript/no-floating-promises"]).toBe("error");
    expect(react.rules["react/react-in-jsx-scope"]).toBe("off");
    expect(react.rules["react/exhaustive-deps"]).toBe("off");
  });

  it("keeps project-specific and unsupported rules in residual ESLint", async () => {
    const [config, reactConfig, jestConfig] = await Promise.all([
      residualConfigFor("eslint-test.ts"),
      residualConfigFor("packages/studio-base/src/components/Panel.tsx"),
      residualConfigFor("packages/studio-base/src/components/Panel.test.tsx"),
    ]);

    expect(config.plugins).toHaveProperty("@coscene-io");
    expect(config.plugins).not.toHaveProperty("@foxglove");
    expect(config.rules["@coscene-io/no-boolean-parameters"]?.[0]).toBe(2);
    expect(config.rules["@typescript-eslint/no-floating-promises"]?.[0]).toBe(0);
    expect(config.rules["@typescript-eslint/no-deprecated"]?.[0]).toBe(2);
    expect(config.rules["no-unsafe-optional-chaining"]?.[0]).toBe(2);
    expect(config.rules["import/order"]?.[0]).toBe(2);
    expect(reactConfig.rules["react/jsx-curly-brace-presence"]?.[0]).toBe(2);
    expect(reactConfig.rules["react-hooks/exhaustive-deps"]?.[0]).toBe(2);
    expect(jestConfig.rules["jest/no-standalone-expect"]?.[0]).toBe(2);
    expect(reactConfig.rules["import/no-cycle"]?.[0]).toBe(0);
    expect(reactConfig.rules["prettier/prettier"]?.[0]).toBe(0);
    const rules = config.rules as Record<string, unknown>;
    expect(Object.keys(rules).some((ruleId) => ruleId.startsWith("@foxglove/"))).toBe(false);
  });

  it("moves the complete supported Jest recommendation and project overrides to Oxlint", () => {
    const config = oxlintOverride("**/*.test.{js,jsx,ts,tsx}");

    expect(config.rules["jest/no-focused-tests"]).toBe("error");
    expect(config.rules["jest/consistent-test-it"]?.[0]).toBe("error");
    expect(config.rules["jest/expect-expect"]?.[0]).toBe("error");
  });

  it("keeps the desktop import resolver exceptions", async () => {
    const config = await residualConfigFor("packages/studio-desktop/src/main/index.ts");

    expect(config.rules["import/no-unresolved"]?.[0]).toBe(0);
  });

  it("enforces the local license rule for user script utilities", async () => {
    const config = await residualConfigFor(
      "packages/studio-base/src/players/UserScriptPlayer/transformerWorker/typescript/userUtils/pointClouds.ts",
    );

    expect(config.rules["@coscene-io/license-header"]?.[0]).toBe(2);
  });

  it("detects dependency cycles using relative, aliased, and mixed imports", () => {
    const fixtureRoot = "packages/studio-base/src/__tests__/eslintCycleFixtures";
    const result = spawnSync(
      path.join(rootDir, "node_modules/.bin/oxlint"),
      ["--deny", "import/no-cycle", "--format=json", fixtureRoot],
      {
        cwd: rootDir,
        encoding: "utf8",
      },
    );

    if (result.error != undefined) {
      throw result.error;
    }
    expect(result.status).toBe(1);

    const output = JSON.parse(result.stdout) as {
      diagnostics: Array<{ code: string; filename: string; message: string }>;
    };
    const cycleDiagnostics = output.diagnostics.filter(
      (diagnostic) => diagnostic.code === "import(no-cycle)",
    );

    for (const importStyle of ["relative", "alias", "mixed"]) {
      const messages = cycleDiagnostics.filter((diagnostic) =>
        path.basename(diagnostic.filename).startsWith(importStyle),
      );

      expect(messages).toHaveLength(2);
      for (const message of messages) {
        expect(message.message).toBe("Dependency cycle detected");
      }
    }
  }, 30_000);

  it("restricts studio-base entry points without dropping React restrictions", () => {
    const typescriptConfig = oxlintOverride("packages/studio-base/src/**/*.ts");
    const reactConfig = oxlintOverride("packages/studio-base/src/**/*.tsx");
    const restrictedImportNames = (config: OxlintOverride): Array<string | undefined> => {
      const restrictedImportsRule = config.rules["no-restricted-imports"] as
        | [string, { paths?: Array<{ name?: string }> }]
        | undefined;

      return restrictedImportsRule?.[1].paths?.map((entry) => entry.name) ?? [];
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
