// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createStore } from "zustand/vanilla";

/**
 * The open cloud record, published by mounted image panels for the app bar. Annotation always
 * reads and saves through the AnnotationService, so a source without a record cannot be annotated.
 */
export const annotationRecord = createStore<{ recordName: string | undefined }>(() => ({
  recordName: undefined,
}));
