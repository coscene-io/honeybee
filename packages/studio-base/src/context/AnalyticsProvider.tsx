// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PropsWithChildren, useEffect, useMemo } from "react";

import AnalyticsContext from "@foxglove/studio-base/context/AnalyticsContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCurrentUser } from "@foxglove/studio-base/context/CurrentUserContext";
import { AmplitudeAnalytics } from "@foxglove/studio-base/services/AmplitudeAnalytics";

export default function AnalyticsProvider(props: PropsWithChildren): React.ReactElement {
  const { currentUser } = useCurrentUser();
  const consoleApi = useConsoleApi();

  const analytics = useMemo(() => {
    return new AmplitudeAnalytics({ consoleApi });
  }, [consoleApi]);

  useEffect(() => {
    if (currentUser) {
      analytics.setUser(currentUser);
    }
  }, [analytics, currentUser]);

  return <AnalyticsContext.Provider value={analytics}>{props.children}</AnalyticsContext.Provider>;
}
