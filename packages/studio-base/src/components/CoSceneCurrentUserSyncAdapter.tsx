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
  OrganizationRoleCode,
  ProjectRoleCode,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";

const log = Logger.getLogger(__filename);

const selectCurrentUser = (store: UserStore) => store.user;
const selectSetUserRole = (store: UserStore) => store.setRole;

const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;

export function CoSceneCurrentUserSyncAdapter(): ReactNull {
  const currentUser = useCurrentUser(selectCurrentUser);
  const setUserRole = useCurrentUser(selectSetUserRole);

  const consoleApi = useConsoleApi();

  const asyncBaseInfo = useBaseInfo(selectBaseInfo);
  const baseInfo = useMemo(() => asyncBaseInfo.value ?? {}, [asyncBaseInfo]);

  const [_userRole, syncUserRole] = useAsyncFn(async () => {
    if (currentUser != undefined) {
      const res = await consoleApi.getRoleLists();
      const roles = res.roles;

      const projectRoles = await consoleApi.batchGetProjectUserRoles(
        `warehouses/${baseInfo.warehouseId}/projects/${baseInfo.projectId}`,
        [`users/${currentUser.userId}`],
      );

      let projectRoleCode = "";

      if (projectRoles.userRoles.length > 0) {
        projectRoleCode = projectRoles.userRoles[0]?.role ?? "";
      }

      const organizationRole = roles.find((role) => role.name === currentUser.role);

      const projectRole = roles.find((role) => role.name === projectRoleCode);

      if (organizationRole != undefined && projectRole != undefined) {
        setUserRole(
          organizationRole.code as OrganizationRoleCode,
          projectRole.code as ProjectRoleCode,
        );
      }
    }
  });

  useEffect(() => {
    if (baseInfo.projectId != undefined && baseInfo.warehouseId != undefined) {
      syncUserRole().catch((err) => {
        log.error("syncUserRole", err);
      });
    }
  }, [syncUserRole, baseInfo]);

  return ReactNull;
}
