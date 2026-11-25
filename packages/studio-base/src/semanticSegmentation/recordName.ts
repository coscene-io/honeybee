// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const RECORD_NAME = /^warehouses\/[^/]+\/projects\/[^/]+\/records\/[^/]+$/;

/** True for a cloud record the annotation service can address. */
export function isAnnotationRecordName(recordName: string | undefined): recordName is string {
  return recordName != undefined && RECORD_NAME.test(recordName);
}
