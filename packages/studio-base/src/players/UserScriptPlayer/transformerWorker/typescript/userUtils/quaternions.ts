// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export type Quaternion = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type Euler = {
  roll: number;
  pitch: number;
  yaw: number;
};

/**
 * Converts a quaternion to a Euler roll, pitch, yaw representation, in degrees.
 *
 * @param quaternion Input quaternion.
 * @returns Converted Euler angle roll, pitch, yaw representation, in degrees.
 */
export function quaternionToEuler(quaternion: Quaternion): Euler {
  const { x, y, z, w } = quaternion;

  const toDegrees = 180 / Math.PI;
  const dcm00 = w * w + x * x - y * y - z * z;
  const dcm10 = 2 * (x * y + w * z);
  const dcm20 = 2 * (x * z - w * y);
  const dcm21 = 2 * (w * x + y * z);
  const dcm22 = w * w - x * x - y * y + z * z;
  const roll = toDegrees * Math.atan2(dcm21, dcm22);
  const pitch = toDegrees * Math.asin(-dcm20);
  const yaw = toDegrees * Math.atan2(dcm10, dcm00);
  return {
    roll,
    pitch,
    yaw,
  };
}

/** Convert roll (X), pitch (Y), yaw (Z) in degrees to a unit quaternion (ZYX). */
export function eulerToQuaternion({ roll, pitch, yaw }: Euler): Quaternion {
  const halfRadians = Math.PI / 360;
  const cr = Math.cos(roll * halfRadians);
  const sr = Math.sin(roll * halfRadians);
  const cp = Math.cos(pitch * halfRadians);
  const sp = Math.sin(pitch * halfRadians);
  const cy = Math.cos(yaw * halfRadians);
  const sy = Math.sin(yaw * halfRadians);
  return {
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
    w: cr * cp * cy + sr * sp * sy,
  };
}
