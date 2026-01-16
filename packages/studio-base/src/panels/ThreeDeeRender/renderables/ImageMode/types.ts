// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { ImageModeConfig } from "@foxglove/studio-base/panels/ThreeDeeRender/IRenderer";
import { DEFAULT_IMAGE_CONFIG } from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/ImageMode/constants";

export interface ImageModeEventMap extends THREE.Object3DEventMap {
  hasModifiedViewChanged: object;
}

export type ConfigWithDefaults = ImageModeConfig & typeof DEFAULT_IMAGE_CONFIG;
