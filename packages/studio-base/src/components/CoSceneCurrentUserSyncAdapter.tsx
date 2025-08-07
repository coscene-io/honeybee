// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Role } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/role_pb";
import { useEffect } from "react";
import { useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  useCurrentUser,
  UserStore,
  OrganizationRoleEnum,
  ProjectRoleEnum,
  OrganizationRoleWeight,
  ProjectRoleWeight,
  User,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

const log = Logger.getLogger(__filename);

const selectCurrentUser = (store: UserStore) => store.user;
const selectLoginStatus = (store: UserStore) => store.loginStatus;

const selectSetUserRole = (store: UserStore) => store.setRole;
const selectSetUser = (store: UserStore) => store.setUser;

const selectExternalInitConfig = (state: CoreDataStore) => state.externalInitConfig;

export function CoSceneCurrentUserSyncAdapter(): ReactNull {
  const loginStatus = useCurrentUser(selectLoginStatus);
  const currentUser = useCurrentUser(selectCurrentUser);

  const setUserRole = useCurrentUser(selectSetUserRole);
  const setUser = useCurrentUser(selectSetUser);

  const externalInitConfig = useCoreData(selectExternalInitConfig);

  const consoleApi = useConsoleApi();

  const [_userRole, syncUserRole] = useAsyncFn(async () => {
    if (currentUser != undefined) {
      const projectRoles = await consoleApi.listUserRoles({ isProjectRole: true });

      const orgRoles = await consoleApi.listUserRoles({ isProjectRole: false });

      const projectRoleCode = projectRoles.userRoles[0] ?? new Role();

      const orgRolesCode = orgRoles.userRoles[0] ?? new Role();

      setUserRole(
        OrganizationRoleWeight[orgRolesCode.code as OrganizationRoleEnum],
        ProjectRoleWeight[projectRoleCode.code as ProjectRoleEnum],
      );
    }
  }, [consoleApi, currentUser, setUserRole]);

  const [_userInfo, syncUserInfo] = useAsyncFn(async () => {
    if (loginStatus === "alreadyLogin") {
      const userInfo = await consoleApi.getUser("users/current");
      const userId = userInfo.name.split("/").pop() ?? "";

      setUser({
        ...(currentUser ?? {}),
        avatarUrl: userInfo.avatar ?? "",
        email: userInfo.email,
        nickName: userInfo.nickname,
        phoneNumber: userInfo.phoneNumber,
        targetSite: `https://${APP_CONFIG.DOMAIN_CONFIG["default"]?.webDomain}`,
        userId,
      } as User);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consoleApi, loginStatus, setUser]);

  useEffect(() => {
    if (externalInitConfig?.projectId != undefined && externalInitConfig.warehouseId != undefined) {
      syncUserRole().catch((err: unknown) => {
        log.error("syncUserRole", err);
      });
    }
  }, [syncUserRole, externalInitConfig]);

  useEffect(() => {
    syncUserInfo().catch((err: unknown) => {
      log.error("syncUserInfo", err);
    });
  }, [loginStatus, syncUserInfo]);

  return ReactNull;
}
