// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// ts-node compiles this file as CommonJS, so a static import of @actions/exec becomes
// require(), which cannot load the ESM-only package.
// foxglove-depcheck-used: @actions/exec
// eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval -- Preserve native import() for @actions/exec's ESM-only export.
const importExec = new Function("return import('@actions/exec')") as () => Promise<
  typeof import("@actions/exec")
>;

type ExecFn = Awaited<ReturnType<typeof importExec>>["exec"];

export async function execOutput(
  program: string,
  args?: Parameters<ExecFn>[1],
  options?: Parameters<ExecFn>[2],
): Promise<{ status: number; stdout: string }> {
  const { exec } = await importExec();
  let stdout = "";
  const status = await exec(program, args, {
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
