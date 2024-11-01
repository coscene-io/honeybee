// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from "react";
import { useCookies } from "react-cookie";

import { getAuthStatusCookieName } from "@foxglove/studio-base/util/appConfig";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

import { AuthStatus } from "./constant";

function AuthSignOutListener(): JSX.Element {
  const authStatusCookieName = getAuthStatusCookieName();
  const [cookies] = useCookies([authStatusCookieName]);
  const signOut = cookies[authStatusCookieName]?.status === AuthStatus.SIGN_OUT;

  useEffect(() => {
    if (signOut && process.env.NODE_ENV !== "development" && !isDesktopApp()) {
      window.location.href = "/login";
    }
  }, [signOut]);

  return <></>;
}

export { AuthSignOutListener };
