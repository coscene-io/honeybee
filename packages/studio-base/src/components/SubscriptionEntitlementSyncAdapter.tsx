// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo } from "react";
import { useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import {
  useSubscriptionEntitlement,
  SubscriptionEntitlementStore,
} from "@foxglove/studio-base/context/SubscriptionEntitlementContext";

const log = Logger.getLogger(__filename);

const selectSetSubscription = (store: SubscriptionEntitlementStore) => store.setSubscription;
const selectOrganization = (store: CoreDataStore) => store.organization;

export function SubscriptionEntitlementSyncAdapter(): ReactNull {
  const setSubscription = useSubscriptionEntitlement(selectSetSubscription);
  const consoleApi = useConsoleApi();
  const organization = useCoreData(selectOrganization);

  const orgId = useMemo(() => organization.value?.name.split("/").pop(), [organization]);

  const [, syncSubscription] = useAsyncFn(async () => {
    const subscriptions = await consoleApi.listOrganizationSubscriptions({
      parent: `organizations/${orgId}`,
      pageSize: 1000,
    });
    const subscription = subscriptions.subscriptions.find((s) => s.active);

    setSubscription(subscription);
  }, [consoleApi, orgId, setSubscription]);

  useEffect(() => {
    if (orgId) {
      syncSubscription().catch((err: unknown) => {
        log.error("syncSubscription", err);
      });
    }
  }, [orgId, syncSubscription]);

  return ReactNull;
}
