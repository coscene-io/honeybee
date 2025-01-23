// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from "react";
import { useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import { CoSceneBaseStore, useBaseInfo } from "@foxglove/studio-base/context/CoSceneBaseContext";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoSceneProjectStore,
  useProject,
} from "@foxglove/studio-base/context/CoSceneProjectContext";

const log = Logger.getLogger(__filename);

const selectSetProjects = (state: CoSceneProjectStore) => state.setProject;
const selectBaseInfo = (store: CoSceneBaseStore) => store.baseInfo;

export function ProjectsSyncAdapter(): ReactNull {
  const setProject = useProject(selectSetProjects);
  const baseInfo = useBaseInfo(selectBaseInfo);
  const consoleApi = useConsoleApi();

  const [_projects, syncProjects] = useAsyncFn(async () => {
    if (baseInfo.value?.warehouseId && baseInfo.value.projectId) {
      const projectName = `warehouses/${baseInfo.value.warehouseId}/projects/${baseInfo.value.projectId}`;
      const project = await consoleApi.getProject({ projectName });

      setProject({ loading: false, value: project });
    }
  }, [consoleApi, setProject, baseInfo.value?.warehouseId, baseInfo.value?.projectId]);

  useEffect(() => {
    syncProjects().catch((error: unknown) => {
      log.error(error);
    });
  }, [syncProjects]);

  return ReactNull;
}
