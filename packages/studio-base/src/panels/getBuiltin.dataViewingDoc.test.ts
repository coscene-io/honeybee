// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import fs from "fs";
import path from "path";

import {
  layoutPermissionIsProject,
  layoutPermissionIsRead,
} from "@foxglove/studio-base/services/CoSceneILayoutStorage";
import { TAB_PANEL_TYPE } from "@foxglove/studio-base/util/globalConstants";

import { getBuiltin } from "./index";

/**
 * Grounds docs/data-viewing-and-layouts.md in the real builtin panel catalog
 * and in layout ownership constants used by the product.
 */
describe("data viewing methods + layout support (doc inventory)", () => {
  const identityT = ((key: string) => key) as unknown as Parameters<typeof getBuiltin>[0];

  it("exposes every builtin panel type via getBuiltin (shipped catalog)", () => {
    const panels = getBuiltin(identityT);
    const types = panels.map((p) => p.type).sort();

    // Explicit inventory matching docs/data-viewing-and-layouts.md §A.1
    const expected = [
      "3D",
      "CallService",
      "DataCollection",
      "DiagnosticStatusPanel",
      "DiagnosticSummary",
      "Gauge",
      "GlobalVariableSliderPanel",
      "Image",
      "Indicator",
      "NodePlayground",
      "Parameters",
      "Plot",
      "Publish",
      "RawMessages",
      "RosOut",
      "SourceInfo",
      "StateTransitions",
      "Table",
      "Teleop",
      "TopicGraph",
      "map",
      "MomentsBar",
      TAB_PANEL_TYPE,
    ].sort();

    expect(types).toEqual(expected);
    expect(types).toHaveLength(23);
    expect(TAB_PANEL_TYPE).toBe("Tab");
  });

  it("documents each builtin type and core layout permissions in data-viewing-and-layouts.md", () => {
    const docPath = path.resolve(__dirname, "../../../../docs/data-viewing-and-layouts.md");
    expect(fs.existsSync(docPath)).toBe(true);
    const doc = fs.readFileSync(docPath, "utf8");

    for (const panel of getBuiltin(identityT)) {
      expect(doc).toContain(`\`${panel.type}\``);
    }

    // Layout support mechanisms called out in the answer doc
    for (const token of [
      "PERSONAL_WRITE",
      "PROJECT_WRITE",
      "PROJECT_READ",
      "share-manifest",
      "sampleLayout",
      "layoutId",
      "defaultLayout",
      "projectRecommandedLayout",
      "recordDefaultLayout",
    ]) {
      expect(doc).toContain(token);
    }

    // Must separate viewing methods from layout support (document structure)
    expect(doc).toMatch(/Data Viewing Methods/);
    expect(doc).toMatch(/Layout support/i);
    expect(doc).toMatch(/Mapping: viewing goals to layouts/);
  });

  it("keeps LayoutPermission union aligned with documented ownership types", () => {
    // Runtime helpers encode the same personal vs project ownership set documented above.
    expect(layoutPermissionIsProject("PROJECT_WRITE")).toBe(true);
    expect(layoutPermissionIsProject("PROJECT_READ")).toBe(true);
    expect(layoutPermissionIsProject("PERSONAL_WRITE")).toBe(false);
    expect(layoutPermissionIsRead("PROJECT_READ")).toBe(true);
    expect(layoutPermissionIsRead("PROJECT_WRITE")).toBe(false);
    expect(layoutPermissionIsRead("PERSONAL_WRITE")).toBe(false);
  });
});
