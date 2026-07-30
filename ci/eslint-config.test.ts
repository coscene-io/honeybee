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
const residualConfig = loadModule("../eslint.config.cjs") as Linter.Config[];

const residualEslint = new ESLint({
  cwd: rootDir,
  overrideConfig: residualConfig,
  overrideConfigFile: true,
});

const residualEslintWithoutInlineConfig = new ESLint({
  allowInlineConfig: false,
  cwd: rootDir,
  overrideConfig: residualConfig,
  overrideConfigFile: true,
});

const baseResidualRuleNames = [
  "@coscene-io/filename-match-exported",
  "@coscene-io/license-header",
  "@coscene-io/link-target",
  "@coscene-io/lodash-ramda-imports",
  "@coscene-io/no-regexp-lookbehind-assertions",
  "@coscene-io/no-return-promise-resolve",
  "@coscene-io/prefer-hash-private",
  "@coscene-io/strict-equality",
  "import/export",
  "import/named",
  "import/no-useless-path-segments",
  "import/order",
  "no-dupe-args",
  "no-implied-eval",
  "no-octal",
  "no-restricted-syntax",
  "no-undef",
  "no-unsafe-optional-chaining",
  "tss-unused-classes/unused-classes",
];

const typescriptResidualRuleNames = [
  ...baseResidualRuleNames.filter(
    (ruleId) => !["import/named", "no-dupe-args", "no-implied-eval", "no-undef"].includes(ruleId),
  ),
  "@coscene-io/no-boolean-parameters",
  "@coscene-io/no-map-type-argument",
  "@coscene-io/ramda-usage",
  "@typescript-eslint/explicit-module-boundary-types",
  "@typescript-eslint/no-deprecated",
  "@typescript-eslint/no-duplicate-enum-values",
  "@typescript-eslint/no-unnecessary-condition",
  "@typescript-eslint/no-unnecessary-type-assertion",
  "@typescript-eslint/no-unsafe-argument",
  "@typescript-eslint/prefer-nullish-coalescing",
  "@typescript-eslint/prefer-optional-chain",
  "@typescript-eslint/prefer-promise-reject-errors",
];

const reactResidualRuleNames = [
  "react-hooks/exhaustive-deps",
  "react/jsx-curly-brace-presence",
  "react/jsx-uses-vars",
  "react/no-deprecated",
  "react/no-unused-prop-types",
  "react/require-render-return",
];

function oxlintOverride(files: string): OxlintOverride {
  const override = oxlintConfig.overrides.find((entry) => entry.files.includes(files));
  if (override == undefined) {
    throw new Error(`No Oxlint override matched ${files}`);
  }
  return override;
}

async function residualConfigFor(relativePath: string): Promise<Linter.Config> {
  const config = (await residualEslint.calculateConfigForFile(path.join(rootDir, relativePath))) as
    | Linter.Config
    | undefined;
  if (config == undefined) {
    throw new Error(`No residual ESLint configuration matched ${relativePath}`);
  }
  return config;
}

function activeRuleNames(config: Linter.Config): string[] {
  return Object.entries(config.rules ?? {})
    .filter(([, value]) => (Array.isArray(value) ? value[0] : value) !== 0)
    .map(([ruleId]) => ruleId)
    .sort();
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
    const [javascriptConfig, typescriptConfig, reactConfig, jestConfig] = await Promise.all([
      residualConfigFor("packages/eslint-plugin/index.js"),
      residualConfigFor("eslint-test.ts"),
      residualConfigFor("packages/studio-base/src/components/Panel.tsx"),
      residualConfigFor("packages/studio-base/src/components/Panel.test.tsx"),
    ]);

    expect(javascriptConfig.plugins).toHaveProperty("@coscene-io");
    expect(javascriptConfig.plugins).not.toHaveProperty("oxlint");
    expect(javascriptConfig.plugins).not.toHaveProperty("prettier");
    expect(typescriptConfig.rules?.["@typescript-eslint/no-floating-promises"]).toBeUndefined();
    expect(reactConfig.rules?.["import/no-cycle"]).toBeUndefined();
    expect(reactConfig.rules?.["prettier/prettier"]).toBeUndefined();

    expect(activeRuleNames(javascriptConfig)).toEqual([...baseResidualRuleNames].sort());
    expect(activeRuleNames(typescriptConfig)).toEqual([...typescriptResidualRuleNames].sort());
    expect(activeRuleNames(reactConfig)).toEqual(
      [...typescriptResidualRuleNames, ...reactResidualRuleNames].sort(),
    );
    expect(activeRuleNames(jestConfig)).toEqual(
      [
        ...typescriptResidualRuleNames,
        ...reactResidualRuleNames,
        "jest/no-standalone-expect",
      ].sort(),
    );

    const rules = typescriptConfig.rules as Record<string, unknown>;
    expect(Object.keys(rules).some((ruleId) => ruleId.startsWith("@foxglove/"))).toBe(false);
  });

  it("executes representative rules in every residual plugin group", async () => {
    const licensePreamble =
      "// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>\n" +
      "// SPDX-License-Identifier: MPL-2.0\n\n";
    const cases = [
      {
        file: "packages/eslint-plugin/index.js",
        source: `${licensePreamble}missingGlobal();\n`,
        ruleId: "no-undef",
      },
      {
        file: "packages/eslint-plugin/index.js",
        source:
          `${licensePreamble}import path from "node:path";\n` +
          'import fs from "node:fs";\n' +
          "void path;\n" +
          "void fs;\n",
        ruleId: "import/order",
      },
      {
        file: "packages/studio-base/src/components/Panel.tsx",
        source:
          `${licensePreamble}export function Panel({ value }: { value: string }): React.JSX.Element {\n` +
          "  useAsync(() => { console.debug(value); }, []);\n" +
          "  return <div>{value}</div>;\n" +
          "}\n",
        ruleId: "react-hooks/exhaustive-deps",
      },
      {
        file: "packages/studio-base/src/components/Panel.tsx",
        source:
          `${licensePreamble}export function Panel(): React.JSX.Element {\n` +
          '  return <div>{"value"}</div>;\n' +
          "}\n",
        ruleId: "react/jsx-curly-brace-presence",
      },
      {
        file: "packages/studio-base/src/components/Panel.tsx",
        source:
          `${licensePreamble}const useStyles = makeStyles()({ unused: {} });\n` +
          "void useStyles;\n",
        ruleId: "tss-unused-classes/unused-classes",
      },
      {
        file: "packages/studio-base/src/components/Panel.test.tsx",
        source: `${licensePreamble}expect(true).toBe(true);\n`,
        ruleId: "jest/no-standalone-expect",
      },
    ];

    for (const testCase of cases) {
      const [result] = await residualEslint.lintText(testCase.source, {
        filePath: path.join(rootDir, testCase.file),
      });
      expect(result?.messages.map((message) => message.ruleId)).toContain(testCase.ruleId);
    }
  });

  it("executes type-aware residual rules against project source", async () => {
    const cases = [
      {
        file: "packages/den/image/decodings.ts",
        ruleId: "@coscene-io/no-boolean-parameters",
      },
      {
        file: "packages/studio-base/src/components/Events/CreateEventContainer/index.tsx",
        ruleId: "@typescript-eslint/prefer-nullish-coalescing",
      },
    ];

    const results = await residualEslintWithoutInlineConfig.lintFiles(
      cases.map((testCase) => path.join(rootDir, testCase.file)),
    );

    for (const testCase of cases) {
      const result = results.find((entry) => entry.filePath === path.join(rootDir, testCase.file));
      expect(result?.messages.map((message) => message.ruleId)).toContain(testCase.ruleId);
    }
  });

  it("preserves the custom exhaustive-deps exemption", async () => {
    const [result] = await residualEslint.lintText(
      "export function Panel({ value }: { value: string }): React.JSX.Element {\n" +
        "  useAsyncAppConfigurationValue(() => { console.debug(value); }, []);\n" +
        "  return <div>{value}</div>;\n" +
        "}\n",
      {
        filePath: path.join(rootDir, "packages/studio-base/src/components/Panel.tsx"),
      },
    );

    expect(result?.messages.map((message) => message.ruleId)).not.toContain(
      "react-hooks/exhaustive-deps",
    );
  });

  it("moves the complete supported Jest recommendation and project overrides to Oxlint", () => {
    const config = oxlintOverride("**/*.test.{js,jsx,ts,tsx}");

    expect(config.rules["jest/no-focused-tests"]).toBe("error");
    expect(config.rules["jest/consistent-test-it"]?.[0]).toBe("error");
    expect(config.rules["jest/expect-expect"]?.[0]).toBe("error");
  });

  it("keeps the desktop import resolver exceptions", async () => {
    const config = await residualConfigFor("packages/studio-desktop/src/main/index.ts");

    expect(config.rules?.["import/no-unresolved"]).toBeUndefined();
  });

  it("enforces the local license rule for user script utilities", async () => {
    const config = await residualConfigFor(
      "packages/studio-base/src/players/UserScriptPlayer/transformerWorker/typescript/userUtils/pointClouds.ts",
    );

    expect(activeRuleNames(config)).toContain("@coscene-io/license-header");
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
