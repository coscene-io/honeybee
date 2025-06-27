// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import type { Entitlement } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/common/charge_pb";
import { PlanFeatureEnum_PlanFeature } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/enums/plan_feature_pb";
import type { Subscription } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/subscription_pb";
import { createContext } from "react";
import { useTranslation } from "react-i18next";
import { StoreApi, useStore } from "zustand";

import { useGuaranteedContext } from "@foxglove/hooks";
import { useConfirm } from "@foxglove/studio-base/hooks/useConfirm";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

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

const selectGetEntitlement = (state: SubscriptionEntitlementStore) => state.getEntitlement;

export function useEntitlementWithDialog(
  feature:
    | PlanFeatureEnum_PlanFeature.OUTBOUND_TRAFFIC
    | PlanFeatureEnum_PlanFeature.INTERNAL_STORAGE,
): [Entitlement | undefined, () => void] {
  const { t } = useTranslation("workspace");
  const confirm = useConfirm();

  const getEntitlement = useSubscriptionEntitlement(selectGetEntitlement);
  const entitlement = getEntitlement(feature);

  const featureConfirmMessageMap = {
    [PlanFeatureEnum_PlanFeature.OUTBOUND_TRAFFIC]: {
      title: t("outboundTrafficLimitReached"),
      prompt: t("outboundTrafficLimitReachedDesc"),
      ok: t("upgradeSubscriptionPlan"),
      cancel: t("iKnow"),
    },
    [PlanFeatureEnum_PlanFeature.INTERNAL_STORAGE]: {
      title: t("storageLimitReached"),
      prompt: t("storageLimitReachedDesc"),
      ok: t("upgradeSubscriptionPlan"),
      cancel: t("iKnow"),
    },
  };

  const entitlementDialog = () => {
    void confirm({
      title: featureConfirmMessageMap[feature].title,
      prompt: featureConfirmMessageMap[feature].prompt,
      ok: featureConfirmMessageMap[feature].ok,
      cancel: featureConfirmMessageMap[feature].cancel,
    })
      .then((result) => {
        if (result === "ok") {
          window.open(`${APP_CONFIG.OFFICIAL_WEB_URL}/pricing`, "_blank");
        } else {
          window.close();
        }
      })
      .catch((error: unknown) => {
        console.error("Error during confirmation:", error);
      });
  };

  return [entitlement, entitlementDialog];
}
