// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { ExecOptions } from "@actions/exec";

// eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval -- Preserve native import for Actions v3 in CommonJS tooling.
const importExec = new Function("return import('@actions/exec')") as () => Promise<
  typeof import("@actions/exec")
>;

export async function execOutput(
  program: string,
  args?: string[],
  options?: ExecOptions,
): Promise<{ status: number; stdout: string }> {
  const { exec: execAction } = await importExec();
  let stdout = "";
  const status = await execAction(program, args, {
    ...options,
    silent: true,
    listeners: {
      stdout: (data) => {
        stdout += data.toString();
      },
    },
  });

  return { status, stdout };
}
