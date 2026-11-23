// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { v5 as uuidv5 } from "uuid";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Namespace for polygon wire ids derived from editor ids. Fixed forever: changing it renames ids. */
const POLYGON_NAMESPACE = "0b6a8f3e-5c1d-4e2a-9f7b-3d8c6e4a1b20";

/** The annotation API names classes, instances and polygons by UUID. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * The wire id of an editor polygon. Polygons read from the service already carry UUIDs; others
 * (drawn or propagated in this session) map to a UUIDv5 of record, instance and editor id, so the
 * same polygon keeps one wire id across saves.
 */
export function polygonWireId(record: string, instanceName: string, editorId: string): string {
  return isUuid(editorId)
    ? editorId
    : uuidv5(`${record}/${instanceName}/polygons/${editorId}`, POLYGON_NAMESPACE);
}
