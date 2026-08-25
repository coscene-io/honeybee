// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Rendering layers for the multipass rendering used for the selection effect.
 *
 * When a renderable is selected the scene is drawn once on {@link LAYER_DEFAULT}, then a dimming
 * backdrop is drawn over it, then the depth buffer is cleared and {@link LAYER_SELECTED} is drawn on
 * top. Objects that must stay visible in both passes need to enable both layers.
 */
export const LAYER_DEFAULT = 0;
export const LAYER_SELECTED = 1;
