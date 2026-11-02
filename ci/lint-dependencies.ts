// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import depcheck, { Detector } from "depcheck";
import { globIterate } from "glob";
import path from "path";

// ts-node compiles this file as CommonJS, so a static import of @actions/core becomes
// require(), which cannot load the ESM-only package.
// eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval -- Preserve native import() for @actions/core's ESM-only export.
const importActionsCore = new Function("return import('@actions/core')") as () => Promise<
  typeof import("@actions/core")
>;

type CoreLog = Pick<Awaited<ReturnType<typeof importActionsCore>>, "info" | "warning" | "error">;

/**
 * Detect comments of the form
 * // foxglove-depcheck-used: ..., ...
 */
const commentDetector: Detector = (node) => {
  const results: string[] = [];
  if (node.type === "CommentBlock" || node.type === "CommentLine") {
    for (const match of (node.value as string).matchAll(
      /foxglove-depcheck-used: ([@/\w\-_,\s]+)/g,
    )) {
      results.push(...match[1]!.split(/[,\s]+/));
    }
  }
  return results;
};

/**
 * Detect TypeScript triple slash references
 */
const tripleSlashDetector: Detector = (node) => {
  const results: string[] = [];
  if (node.type === "CommentLine") {
    for (const match of (node.value as string).matchAll(/^\/ <reference types="(.+)" \/>/g)) {
      results.push(match[1]!);
    }
  }
  return results;
};

async function run(rootPath: string, log: CoreLog) {
  log.info(`Linting dependencies in ${rootPath}...`);
  const options: depcheck.Options = {
    detectors: [...Object.values(depcheck.detector), commentDetector, tripleSlashDetector],
    ignoreMatches: ["~"],
  };
  return await depcheck(rootPath, options);
}

function printAndAnalyzeResults(unused: depcheck.Results, packageName: string, log: CoreLog) {
  let hadError = false;

  if (unused.devDependencies.length > 0) {
    hadError = true;

    log.error(`Unused devDependencies in ${packageName}:`);
    for (const dep of unused.devDependencies) {
      log.info(`- ${dep}`);
    }
    log.info("");
  }

  if (unused.dependencies.length > 0) {
    hadError = true;
    log.error(`Unused dependencies in ${packageName}:`);
    for (const dep of unused.dependencies) {
      log.info(`- ${dep}`);
    }
    log.info("");
  }

  // Don't consider the package itself to be a missing dep
  // https://github.com/depcheck/depcheck/issues/564
  delete unused.missing[packageName];

  if (Object.keys(unused.missing).length > 0) {
    hadError = true;
    log.error(`Missing dependencies in ${packageName}:`);
    for (const [dep, locations] of Object.entries(unused.missing)) {
      log.info(`- ${dep} (used in ${locations[0]!})`);
    }
    log.info("");
  }

  if (Object.keys(unused.invalidFiles).length > 0) {
    hadError = true;
    log.error(`Invalid files in ${packageName}:`);
    for (const [filePath, err] of Object.entries(unused.invalidFiles)) {
      log.info(`- ${filePath} (${err})`);
    }
    log.info("");
  }

  if (Object.keys(unused.invalidDirs).length > 0) {
    hadError = true;
    log.error(`Invalid directories in ${packageName}:`);
    for (const [dirPath, err] of Object.entries(unused.invalidDirs)) {
      log.info(`- ${dirPath} (${err})`);
    }
    log.info("");
  }

  if (!hadError) {
    log.info(`No missing or unused dependencies in ${packageName}!`);
    log.info("");
  }

  return !hadError;
}

async function getAllWorkspacePackages(roots: string[], log: CoreLog) {
  const results: { name: string; path: string }[] = [];
  const workspacePackages: string[] = [];
  for (const workspaceRoot of roots) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const workspaceInfo = require(path.resolve(process.cwd(), workspaceRoot, "package.json"));
    const patterns: string[] = Array.isArray(workspaceInfo.workspaces)
      ? workspaceInfo.workspaces
      : Array.isArray(workspaceInfo.workspaces?.packages)
        ? workspaceInfo.workspaces.packages
        : [];
    for (const pattern of patterns) {
      const cwd = path.resolve(process.cwd(), workspaceRoot);
      for await (const packagePath of globIterate(pattern, { cwd, withFileTypes: false })) {
        workspacePackages.push(packagePath);
      }
    }
  }
  for (const packagePath of workspacePackages) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const packageInfo = require(path.join(packagePath, "package.json"));
      const name = packageInfo.name;
      if (typeof name !== "string") {
        log.warning(`No name in package.json at ${packagePath}`);
        continue;
      }
      if (name.startsWith("@types/")) {
        log.info(`Skipping types package ${name}`);
        continue;
      }
      results.push({ path: packagePath, name });
    } catch {
      // skip directories without package.json
    }
  }
  return results;
}

async function main() {
  const log = await importActionsCore();
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    log.error("Usage: lint-dependencies [workspace1] [workspace2] ...");
    process.exit(1);
  }
  log.info(`Linting dependencies in workspaces: ${JSON.stringify(roots, undefined, 2)}`);
  const packages = await getAllWorkspacePackages(roots, log);
  let hadError = false;
  for (const pkg of packages) {
    const results = await run(pkg.path, log);
    if (!printAndAnalyzeResults(results, pkg.name, log)) {
      hadError = true;
    }
  }
  if (hadError) {
    log.info(
      "NOTE: Dependencies can be marked explicitly used with a comment, e.g.:\n  // foxglove-depcheck-used: foo-package",
    );
    process.exit(1);
  } else {
    log.info("No errors!");
  }
}

main().catch(console.error);
