// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import type { Entitlement } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/common/charge_pb";
import { PlanFeatureEnum_PlanFeature } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/enums/plan_feature_pb";
import type { Subscription } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/subscription_pb";
import { createContext } from "react";
import { StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";

export type SubscriptionEntitlementStore = {
  subscription: Subscription | undefined;
  setSubscription: (subscription: Subscription | undefined) => void;
  getEntitlement: (feature: PlanFeatureEnum_PlanFeature) => Entitlement | undefined;
};

export const SubscriptionEntitlementContext = createContext<
  StoreApi<SubscriptionEntitlementStore> | undefined
>(undefined);

export function useSubscriptionEntitlement<T>(
  selector: (store: SubscriptionEntitlementStore) => T,
): T {
  const context = useGuaranteedContext(SubscriptionEntitlementContext);
  return useStore(context, selector);
}
