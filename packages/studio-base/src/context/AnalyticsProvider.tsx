// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PropsWithChildren, useEffect, useMemo } from "react";

import AnalyticsContext from "@foxglove/studio-base/context/AnalyticsContext";
import { UserStore, useCurrentUser } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { AmplitudeAnalytics } from "@foxglove/studio-base/services/AmplitudeAnalytics";

const selectUser = (store: UserStore) => store.user;
const selectUserLoginStatus = (store: UserStore) => store.loginStatus;
const selectOrganization = (store: CoreDataStore) => store.organization;

export default function AnalyticsProvider(props: PropsWithChildren): React.ReactElement {
  const currentUser = useCurrentUser(selectUser);
  const loginStatus = useCurrentUser(selectUserLoginStatus);
  const organization = useCoreData(selectOrganization);

  const analytics = useMemo(() => {
    return new AmplitudeAnalytics();
  }, []);

  useEffect(() => {
    if (currentUser && loginStatus === "alreadyLogin" && organization.value) {
      analytics.setUser(currentUser, organization.value);
    }
  }, [analytics, currentUser, loginStatus, organization]);

  return <AnalyticsContext.Provider value={analytics}>{props.children}</AnalyticsContext.Provider>;
}
