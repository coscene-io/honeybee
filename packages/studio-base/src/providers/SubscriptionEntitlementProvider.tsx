// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PlanFeatureEnum_PlanFeature } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/enums/plan_feature_pb";
import type { Subscription } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/subscription_pb";
import { ReactNode, useState } from "react";
import { createStore } from "zustand";

import {
  SubscriptionEntitlementContext,
  SubscriptionEntitlementStore,
} from "@foxglove/studio-base/context/SubscriptionEntitlementContext";

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

function createSubscriptionEntitlementStore() {
  return createStore<SubscriptionEntitlementStore>((set, get) => ({
    paid: false,
    subscription: undefined,
    setSubscription: (subscription: Subscription | undefined) => {
      const code = subscription?.plan?.code.toLowerCase();
      const paid = !!code && code !== "free";
      set({ subscription, paid });
    },
    getEntitlement: (feature: PlanFeatureEnum_PlanFeature) => {
      const data = get().subscription;

      if (!data) {
        return undefined;
      }

      const target = data.charges.find((item) => item.feature === feature)?.entitlement;

      return target?.hardLimit === true ? target : undefined;
    },
  }));
}

export default function SubscriptionEntitlementProvider({
  children,
}: {
  children?: ReactNode;
}): ReactNode {
  const [store] = useState(createSubscriptionEntitlementStore);

  return (
    <SubscriptionEntitlementContext.Provider value={store}>
      {children}
    </SubscriptionEntitlementContext.Provider>
  );
}
