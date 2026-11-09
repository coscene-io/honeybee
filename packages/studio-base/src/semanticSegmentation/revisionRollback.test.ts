// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createMockSemanticSegmentationService } from "./mockService";
import { createSemanticSegmentationStore } from "./store";

it("rejects a rollback when another commit advances the authoritative head during its delay", async () => {
  const service = createMockSemanticSegmentationService({ controls: { delayMs: 0 } });
  const store = createSemanticSegmentationStore(service);
  await store.getState().initialize();
  const expectedHead = store.getState().revisions[0]!.id;
  service.setControls({ delayMs: 40 });
  const rollback = store.getState().rollbackRevision("revision-0", expectedHead);
  const rejected = rollback.catch((error: unknown) => error);
  service.setControls({ delayMs: 0 });
  const newer = await service.submit({
    id: "other-user-commit",
    message: "Newer authoritative work",
    operations: [
      {
        id: "external-class",
        label: "External class",
        expectedVersions: {},
        patch: {
          classes: { external: { id: "external", name: "Do not overwrite", color: "#ffffff" } },
        },
      },
    ],
    expectedVersions: {},
  });
  expect(await rejected).toHaveProperty("message", expect.stringContaining("版本并发冲突"));
  expect((await service.listRevisions())[0]?.id).toBe(newer.revision?.id);
  expect((await service.loadDocument()).classes.some((item) => item.id === "external")).toBe(true);
  expect((await service.listRevisions()).some((item) => item.message.startsWith("Rollback"))).toBe(
    false,
  );
  store.getState().dispose();
});

it("keeps legacy rollback calls compatible and appends a revision for an unchanged head", async () => {
  const service = createMockSemanticSegmentationService({ controls: { delayMs: 0 } });
  const result = await service.rollbackRevision("revision-0");
  expect(result.status).toBe("succeeded");
  expect((await service.listRevisions())[0]?.id).toBe(result.revision?.id);
});
