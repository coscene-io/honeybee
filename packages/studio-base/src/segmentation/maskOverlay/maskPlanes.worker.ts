// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@coscene-io/comlink";

import { buildMaskPlanes, type MaskPlanes } from "./maskPlanes";

// RLE decode + bit-plane fill stays off the main thread; planes are transferred, never copied.
export const service = {
  buildMaskPlanes(width: number, height: number, counts: readonly string[]): MaskPlanes {
    const planes = buildMaskPlanes(width, height, counts);
    return Comlink.transfer(
      planes,
      planes.planes.map((plane) => plane.buffer),
    );
  },
};
Comlink.expose(service);
