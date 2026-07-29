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

async function cycleMessagesFor(importStyle: string) {
  const fixtureRoot = "packages/studio-base/src/__tests__/eslintCycleFixtures";
  const results = await eslintWithCycleFixtures.lintFiles([
    path.join(rootDir, fixtureRoot, `${importStyle}A.ts`),
    path.join(rootDir, fixtureRoot, `${importStyle}B.ts`),
  ]);

  return results.flatMap((result) =>
    result.messages.filter((message) => message.ruleId === "import/no-cycle"),
  );
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

  it.each(["relative", "alias", "mixed"])(
    "detects dependency cycles using %s imports",
    async (importStyle) => {
      const messages = await cycleMessagesFor(importStyle);

      expect(messages).toHaveLength(2);
      for (const message of messages) {
        expect(message.message).toMatch(/^Dependency cycle/);
      }
    },
  );

  it.each(["@foxglove/studio-base", "@foxglove/studio-base/index"])(
    "rejects internal imports from the studio-base entry point (%s)",
    async (entryPoint) => {
      const [result] = await eslintCi.lintText(`import "${entryPoint}";`, {
        filePath: path.join(rootDir, "packages/studio-base/src/util/appURLState.ts"),
      });

      expect(result?.messages.some((message) => message.ruleId === "no-restricted-imports")).toBe(
        true,
      );
    },
  );

  it("preserves the existing React import restrictions in studio-base", async () => {
    const config = await eslintCi.calculateConfigForFile(
      path.join(rootDir, "packages/studio-base/src/components/Panel.tsx"),
    );
    const ruleOptions = config?.rules["no-restricted-imports"]?.[1] as
      | { paths?: Array<{ name?: string }> }
      | undefined;

    expect(ruleOptions?.paths?.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        "@mui/material",
        "@mui/styles",
        "@mui/material/styles/styled",
        "@emotion/styled",
        "@foxglove/studio-base",
        "@foxglove/studio-base/index",
      ]),
    );
  });
});
