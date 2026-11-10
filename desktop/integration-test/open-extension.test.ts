// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { launchApp } from "./launchApp";
import { exerciseExtensionLifecycle } from "../../web/integration-test/reactUpgradeExtension";

it("installs the generated React 19 .coe and completes two panel lifecycles", async () => {
  await using app = await launchApp();
  const errors: string[] = [];
  app.renderer.on("pageerror", (error) => errors.push(error.message));
  try {
    await exerciseExtensionLifecycle(app.renderer);
  } catch (error) {
    console.error(await app.renderer.locator("body").innerText());
    throw error;
  }
  expect(errors).toEqual([]);
}, 90_000);
