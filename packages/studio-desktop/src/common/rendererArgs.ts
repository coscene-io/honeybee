// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Logger from "@foxglove/log";
import { User } from "@foxglove/studio-base/src/context/CoSceneCurrentUserContext";

const log = Logger.getLogger(__filename);

type RendererArgTypes = {
  deepLinks: string[];
  syncUserInfo?: User;
};

/**
 * Encode arguments passed from main to renderer process using base64,
 * to avoid breaking on Windows when the values contain special characters like ":".
 *
 * https://github.com/foxglove/studio/issues/4896
 * https://github.com/electron/electron/issues/32064
 * https://github.com/electron/electron/issues/31168
 */
export function encodeRendererArg<K extends keyof RendererArgTypes>(
  argName: K,
  value: RendererArgTypes[K],
): string {
  return `--${argName}=${Buffer.from(JSON.stringify(value) ?? "").toString("base64")}`;
}

export function decodeRendererArg<K extends keyof RendererArgTypes>(
  argName: K,
  args: string[],
): RendererArgTypes[K] | undefined {
  const argPrefix = `--${argName}=`;
  const argValue = args.find((str) => str.startsWith(argPrefix))?.substring(argPrefix.length);
  if (!argValue) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(argValue, "base64").toString());
  } catch (error) {
    log.error(error);
    return undefined;
  }
}
