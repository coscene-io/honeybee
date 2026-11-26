// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import path from "path";

import { GlobalVariables } from "@foxglove/studio-base/hooks/useGlobalVariables";
import {
  DIAGNOSTIC_SEVERITY,
  SOURCES,
  ERROR_CODES,
} from "@foxglove/studio-base/players/UserScriptPlayer/constants";
import {
  Diagnostic,
  ProcessMessageOutput,
  RegistrationOutput,
  UserScriptLog,
} from "@foxglove/studio-base/players/UserScriptPlayer/types";
import { DEFAULT_STUDIO_SCRIPT_PREFIX } from "@foxglove/studio-base/util/globalConstants";

// Each script runtime worker runs one script at a time, hence why we have one
// global declaration of 'nodeCallback'.
let nodeCallback: (
  message: unknown,
  globalVariables: GlobalVariables,
) => Record<string, unknown> | undefined;

if (process.env.NODE_ENV === "test") {
  // When in tests, clear out the callback between tests.
  beforeEach(() => {
    nodeCallback = () => {
      return undefined;
    };
  });
}

export const containsFuncDeclaration = (args: unknown[]): boolean => {
  for (const arg of args) {
    if (typeof arg === "function") {
      return true;
    } else if (typeof arg === "object" && arg != undefined) {
      for (const value of Object.values(arg)) {
        if (containsFuncDeclaration([value])) {
          return true;
        }
      }
    }
  }
  return false;
};

export const stringifyFuncsInObject = (arg: unknown): unknown => {
  if (typeof arg === "function") {
    return `${arg}`;
  } else if (typeof arg === "object" && arg != undefined) {
    const newArg: Record<string, unknown> = { ...arg };
    for (const [key, value] of Object.entries(arg)) {
      newArg[key] = stringifyFuncsInObject(value);
    }
    return newArg;
  }
  return arg;
};

const getArgsToPrint = (args: unknown[]) => {
  return args
    .map(stringifyFuncsInObject)
    .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : arg));
};

// Exported for tests.
export const requireImplementation = (id: string, projectCode: Map<string, string>): unknown => {
  return createRequire(projectCode)(id);
};

// CommonJS modules share exports within one registration, including circular imports.
function createRequire(projectCode: Map<string, string>) {
  const modules = new Map<string, Record<string, unknown>>();
  function require(id: string): unknown {
    const file = path.join(DEFAULT_STUDIO_SCRIPT_PREFIX, id.endsWith(".js") ? id : id + ".js");
    const cached = modules.get(file);
    if (cached) {
      return cached;
    }
    const source =
      projectCode.get(file) ?? projectCode.get(path.relative(DEFAULT_STUDIO_SCRIPT_PREFIX, file));
    if (source == undefined) {
      throw new Error(`User script required unknown module: '${id}'`);
    }
    const exports = {};
    modules.set(file, exports);
    try {
      // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
      new Function("exports", "require", source)(exports, require);
      return exports;
    } catch (error) {
      modules.delete(file);
      throw error;
    }
  }
  return require;
}

export const registerScript = ({
  scriptCode,
  projectCode,
}: {
  scriptCode: string;
  projectCode: Map<string, string>;
}): RegistrationOutput => {
  const userScriptLogs: UserScriptLog[] = [];
  const userScriptDiagnostics: Diagnostic[] = [];
  (self as { log?: unknown }).log = function (...args: unknown[]) {
    // recursively check that args do not contain a function declaration
    if (containsFuncDeclaration(args)) {
      const argsToPrint = getArgsToPrint(args);
      throw new Error(
        `Cannot invoke log() with a function argument (registerScript) - log(${argsToPrint
          .map((arg) => JSON.stringify(arg))
          .join(", ")})`,
      );
    }
    userScriptLogs.push(...args.map((value) => ({ source: "registerScript" as const, value })));
  };
  try {
    const nodeExports: { default?: typeof nodeCallback } = {};

    const require = createRequire(projectCode);

    // Using new Function in order to execute user-input text in User Scripts as code
    // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
    new Function("exports", "require", scriptCode)(nodeExports, require);
    nodeCallback = nodeExports.default!;
    return {
      error: undefined,
      userScriptLogs,
      userScriptDiagnostics,
    };
  } catch (e) {
    const error: string = e.toString();
    return {
      error: error.length > 0 ? error : `Unknown error encountered registering this node.`,
      userScriptLogs,
      userScriptDiagnostics,
    };
  }
};

export const processMessage = ({
  message,
  globalVariables,
}: {
  message: unknown;
  globalVariables: GlobalVariables;
}): ProcessMessageOutput => {
  const userScriptLogs: UserScriptLog[] = [];
  const userScriptDiagnostics: Diagnostic[] = [];
  (self as { log?: unknown }).log = function (...args: unknown[]) {
    // recursively check that args do not contain a function declaration
    if (containsFuncDeclaration(args)) {
      const argsToPrint = getArgsToPrint(args);
      throw new Error(
        `Cannot invoke log() with a function argument (processMessage) - log(${argsToPrint
          .map((arg) => JSON.stringify(arg))
          .join(", ")})`,
      );
    }
    userScriptLogs.push(...args.map((value) => ({ source: "processMessage" as const, value })));
  };
  const start = performance.now();
  try {
    const newMessage = nodeCallback(message, globalVariables);
    return {
      elapsedMs: performance.now() - start,
      message: newMessage,
      error: undefined,
      userScriptLogs,
      userScriptDiagnostics,
    };
  } catch (err: unknown) {
    const error: string = (err as Error).toString();
    const diagnostic: Diagnostic = {
      source: SOURCES.Runtime,
      severity: DIAGNOSTIC_SEVERITY.Error,
      message: error.length > 0 ? error : "Unknown error encountered running this node.",
      code: ERROR_CODES.RUNTIME,
    };

    return {
      elapsedMs: performance.now() - start,
      message: undefined,
      error: undefined,
      userScriptLogs,
      userScriptDiagnostics: [diagnostic],
    };
  }
};
