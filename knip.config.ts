// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import type { KnipConfig } from "knip";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Some loaders, ambient types and injected modules do not have a normal import.
// Keep the existing explicit-use annotations scoped to their owning workspace.
function explicitlyUsedDependencies(directory: string): string[] {
  const used = new Set<string>();
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (
          ![
            "node_modules",
            ".git",
            ".yarn",
            ".webpack",
            ".webpack-moments",
            "dist",
            "temp",
          ].includes(entry.name) &&
          !(
            directory === "." &&
            current === "." &&
            ["packages", "web", "desktop", "benchmark"].includes(entry.name)
          )
        ) {
          pending.push(filename);
        }
        continue;
      }
      if (!entry.isFile() || !/\.(?:[cm]?js|tsx?)$/.test(entry.name)) {
        continue;
      }
      const source = readFileSync(filename, "utf8");
      for (const match of source.matchAll(/foxglove-depcheck-used: ([@/\w\-_, \t]+)/g)) {
        for (const name of match[1]!.split(/[,\s]+/).filter(Boolean)) {
          used.add(name);
        }
      }
      for (const match of source.matchAll(/^\s*\/\/\/\s*<reference types="([^"]+)"/gm)) {
        used.add(match[1]!);
        used.add(`@types/${match[1]!}`);
      }
    }
  }
  const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = { ...manifest.dependencies, ...manifest.devDependencies };
  return [...used].filter((name) => name in declared);
}

const directories = [
  ".",
  "web",
  "desktop",
  "benchmark",
  ...readdirSync("packages", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "@types")
    .map((entry) => `packages/${entry.name}`),
];

const peerProviders: Record<string, string[]> = {
  ".": ["react", "react-refresh"],
  "packages/hooks": ["react", "react-dom"],
  "packages/studio-base": ["@mui/system", "electron"],
  "packages/studio-desktop": ["@emotion/react", "@testing-library/dom", "@types/react"],
  "packages/studio-web": ["@emotion/react", "@types/react", "i18next"],
  "packages/theme": ["@mui/system", "react-dom"],
  web: ["webpack"],
  desktop: ["webpack"],
  benchmark: ["webpack"],
};

const config: KnipConfig = {
  // These are ambient declaration providers, as in the previous dependency check.
  ignoreWorkspaces: ["packages/@types/*"],
  // The workflow builds the separately checked-out extension generator.
  ignoreBinaries: ["build"],
  workspaces: Object.fromEntries(
    directories.map((directory) => [
      directory,
      {
        // Like the former dependency check, account for imports in every source/test file.
        entry:
          directory === "."
            ? ["*.{ts,js,cjs}", "ci/**/*.{ts,js,cjs}"]
            : ["**/*.{ts,tsx,js,cjs,mjs}"],
        project: ["**/*.{ts,tsx,js,cjs,mjs}"],
        ignoreDependencies: [
          ...explicitlyUsedDependencies(directory),
          ...(peerProviders[directory] ?? []),
        ],
      },
    ]),
  ),
};

// eslint-disable-next-line @coscene-io/filename-match-exported -- Knip's conventional config filename.
export default config;
