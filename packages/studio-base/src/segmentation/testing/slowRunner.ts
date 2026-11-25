// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { configure } from "@testing-library/react";

/**
 * The editor's jsdom UI tests take well under a second each locally, but a loaded CI runner has
 * run them 10-20x slower, past Jest's 5 s test timeout and Testing Library's 1 s `waitFor`
 * timeout. Call once at the top of such a test file. Nothing here asserts elapsed time; like the
 * `jest.setTimeout` of StateTransitionsCoordinator.perfprobe.test.ts, it only leaves room.
 * Tests only.
 */
export function allowSlowRunner(): void {
  jest.setTimeout(30_000);
  configure({ asyncUtilTimeout: 10_000 });
}
