// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useMemo } from "react";
import { useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import { useBaseInfo, CoSceneBaseStore } from "@foxglove/studio-base/context/CoSceneBaseContext";
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
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

const log = Logger.getLogger(__filename);

const selectCurrentUser = (store: UserStore) => store.user;
const selectLoginStatus = (store: UserStore) => store.loginStatus;

const selectSetUserRole = (store: UserStore) => store.setRole;
const selectSetUser = (store: UserStore) => store.setUser;

const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;

export function CoSceneCurrentUserSyncAdapter(): ReactNull {
  const loginStatus = useCurrentUser(selectLoginStatus);
  const currentUser = useCurrentUser(selectCurrentUser);

  const setUserRole = useCurrentUser(selectSetUserRole);
  const setUser = useCurrentUser(selectSetUser);

  const consoleApi = useConsoleApi();

  const asyncBaseInfo = useBaseInfo(selectBaseInfo);
  const baseInfo = useMemo(() => asyncBaseInfo.value ?? {}, [asyncBaseInfo]);

  const [_userRole, syncUserRole] = useAsyncFn(
    async (warehouseId, projectId) => {
      if (currentUser != undefined) {
        const res = await consoleApi.getRoleLists();
        const roles = res.roles;

        const projectRoles = await consoleApi.getProjectUserRoles(
          `warehouses/${warehouseId}/projects/${projectId}`,
          `users/current`,
        );

        const orgRoles = await consoleApi.getOrgUserRoles(`users/current`);

        const projectRoleCode = projectRoles.role;

        const orgRolesCode = orgRoles.role;

        const organizationRole = roles.find((role) => role.name === orgRolesCode);

        const projectRole = roles.find((role) => role.name === projectRoleCode);

        setUserRole(
          OrganizationRoleWeight[organizationRole?.code as OrganizationRoleEnum],
          ProjectRoleWeight[projectRole?.code as ProjectRoleEnum],
        );
      }
    },
    [consoleApi, currentUser, setUserRole],
  );

  const [_userInfo, syncUserInfo] = useAsyncFn(async () => {
    if (loginStatus === "alreadyLogin") {
      const userInfo = await consoleApi.getUser("users/current");

      const currentOrg = await consoleApi.getOrg("organizations/current");

      const userId = userInfo.name.split("/").pop() ?? "";

      setUser({
        ...(currentUser ?? {}),
        avatarUrl: userInfo.avatar ?? "",
        email: userInfo.email,
        nickName: userInfo.nickname,
        phoneNumber: userInfo.phoneNumber,
        orgDisplayName: currentOrg.displayName,
        orgId: currentOrg.name.split("/")[1],
        orgSlug: currentOrg.slug,
        targetSite: `https://${APP_CONFIG.DOMAIN_CONFIG["default"]?.webDomain}`,
        userId,
      } as User);
    } else {
      setUser(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consoleApi, loginStatus, setUser]);

  useEffect(() => {
    if (baseInfo.projectId != undefined && baseInfo.warehouseId != undefined) {
      syncUserRole(baseInfo.warehouseId, baseInfo.projectId).catch((err: unknown) => {
        log.error("syncUserRole", err);
      });
    }
  }, [syncUserRole, baseInfo]);

  useEffect(() => {
    syncUserInfo().catch((err: unknown) => {
      log.error("syncUserInfo", err);
    });
  }, [loginStatus, syncUserInfo]);

  return ReactNull;
}
