// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from "react";
import type { PropsWithChildren } from "react";

import type { UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { useCurrentUser } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { getGrowthBookClient } from "@foxglove/studio-base/providers/GrowthBookProvider";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

const selectUser = (store: UserStore) => store.user;
const selectLoginStatus = (store: UserStore) => store.loginStatus;

export default function GrowthBookUserProvider({ children }: PropsWithChildren): React.JSX.Element {
  const user = useCurrentUser(selectUser);
  const loginStatus = useCurrentUser(selectLoginStatus);
  const identifiedUser = loginStatus === "alreadyLogin" ? user : undefined;

  useEffect(() => {
    void getGrowthBookClient().setAttributes({
      locationHostName: window.location.hostname,
      platform: isDesktopApp() ? "coStudio" : "honeybee",
      ...(identifiedUser
        ? {
            email: identifiedUser.email,
            nickName: identifiedUser.nickName,
            phoneNumber: identifiedUser.phoneNumber,
            userId: identifiedUser.userId,
          }
        : {}),
    });
  }, [identifiedUser]);

  return <>{children}</>;
}
