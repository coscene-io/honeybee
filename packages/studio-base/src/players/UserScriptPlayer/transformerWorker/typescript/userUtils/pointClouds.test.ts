// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  POINT_CLOUD_MESSAGE,
  POINT_CLOUD_WITH_ADDITIONAL_FIELDS,
} from "./fixtures/pointCloudMessage";
import { readPoints } from "./pointClouds";

describe("pointClouds", () => {
  describe("readPoints", () => {
    it("reads points from a point cloud", () => {
      expect(readPoints(POINT_CLOUD_MESSAGE)).toEqual([
        [-2238.780517578125, -705.6009521484375, -2.371227741241455, 1.1744180134718396e-38],
      ]);
    });
    it("reads points from a point cloud with additional fields", () => {
      expect(readPoints(POINT_CLOUD_WITH_ADDITIONAL_FIELDS)).toEqual([
        [0, 1, 2, 7, 6, 5, 265],
        [0, 1, 2, 9, 8, 7, 2],
      ]);
    });
  });
});
