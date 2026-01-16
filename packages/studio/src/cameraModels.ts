// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export type FloatArray = number[] | Float32Array | Float64Array;

export type DistortionModel = "plumb_bob" | "rational_polynomial" | (string & {});

export type CameraInfo = Readonly<{
  width: number;
  height: number;
  binning_x: number;
  binning_y: number;
  roi: {
    x_offset: number;
    y_offset: number;
    height: number;
    width: number;
    do_rectify: boolean;
  };
  distortion_model: DistortionModel;
  D: FloatArray;
  K: FloatArray;
  P: FloatArray;
  R: FloatArray;
}>;

export type Vector2 = { x: number; y: number };
export type Vector3 = { x: number; y: number; z: number };

export interface PinholeCameraModel {
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  projectPixelTo3dPlane(out: Vector3, pixel: Readonly<Vector2>): Vector3;
  projectPixelTo3dRay(out: Vector3, pixel: Readonly<Vector2>): Vector3;
}
