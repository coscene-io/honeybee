// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function checkCliInstalled(cliName: string): Promise<boolean> {
  try {
    await execAsync(`which ${cliName}`);
    return true;
  } catch {
    return false;
  }
}
