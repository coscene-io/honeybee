// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect } from "react";
import { useAsyncFn } from "react-use";

import Logger from "@foxglove/log";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoSceneProjectStore,
  useProject,
} from "@foxglove/studio-base/context/CoSceneProjectContext";

const log = Logger.getLogger(__filename);

const selectSetProjects = (state: CoSceneProjectStore) => state.setProject;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

export function ProjectsSyncAdapter(): ReactNull {
  const setProject = useProject(selectSetProjects);
  const urlState = useMessagePipeline(selectUrlState);
  const consoleApi = useConsoleApi();

  const [_projects, syncProjects] = useAsyncFn(async () => {
    if (urlState?.parameters?.warehouseId && urlState.parameters.projectId) {
      const projectName = `warehouses/${urlState.parameters.warehouseId}/projects/${urlState.parameters.projectId}`;
      const project = await consoleApi.getProject({ projectName });

      setProject({ loading: false, value: project });
    }
  }, [consoleApi, setProject, urlState?.parameters?.warehouseId, urlState?.parameters?.projectId]);

  useEffect(() => {
    syncProjects().catch((error) => log.error(error));
  }, [syncProjects]);

  return ReactNull;
}
