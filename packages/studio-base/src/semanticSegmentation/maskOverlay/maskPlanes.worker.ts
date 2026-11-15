// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { buildMaskPlanes } from "./maskPlanes";

type Request = { id: number; width: number; height: number; counts: string[] };

// RLE decode + bit-plane fill stays off the main thread; planes are transferred, never copied.
(globalThis as unknown as Worker).onmessage = (event: MessageEvent<Request>) => {
  const { id, width, height, counts } = event.data;
  try {
    const planes = buildMaskPlanes(width, height, counts);
    (globalThis as unknown as Worker).postMessage(
      { id, planes },
      planes.planes.map((plane) => plane.buffer),
    );
  } catch (error) {
    (globalThis as unknown as Worker).postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
