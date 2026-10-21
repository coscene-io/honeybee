// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { CustomFieldValue } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { createContext } from "react";
import { type StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";

export type MomentCreationDefaultsStore = {
  id: string;
  customFieldValues: CustomFieldValue[];
  rememberCustomFieldValues: (values: CustomFieldValue[]) => void;
};

export const MomentCreationDefaultsContext = createContext<
  StoreApi<MomentCreationDefaultsStore> | undefined
>(undefined);

export function useMomentCreationDefaults<T>(
  selector: (store: MomentCreationDefaultsStore) => T,
): T {
  return useStore(useGuaranteedContext(MomentCreationDefaultsContext), selector);
}
