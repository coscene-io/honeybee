// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext } from "react";

export type User = {
  userId: string;
  nickName: string;
  avatarUrl: string;
  phoneNumber: string;
  agreedAgreement: string;
  role: string;
};

const CoSceneCurrentUserContext = createContext<User | undefined>({
  userId: "",
  nickName: "",
  avatarUrl: "",
  phoneNumber: "",
  agreedAgreement: "",
  role: "",
});

CoSceneCurrentUserContext.displayName = "CurrentUserContext";

export function useCurrentUser(): User | undefined {
  return useContext(CoSceneCurrentUserContext);
}

export default CoSceneCurrentUserContext;
