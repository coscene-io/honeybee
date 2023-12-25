// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useMemo } from "react";

import CoSceneCurrentUserContext, {
  User,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";

export default function CoSceneUserProvider({ children }: React.PropsWithChildren): JSX.Element {
  const currentUser = useMemo(() => {
    return localStorage.getItem("current_user") != undefined
      ? (JSON.parse(localStorage.getItem("current_user")!) as User)
      : undefined;
  }, []);

  return (
    <CoSceneCurrentUserContext.Provider value={currentUser}>
      {children}
    </CoSceneCurrentUserContext.Provider>
  );
}
