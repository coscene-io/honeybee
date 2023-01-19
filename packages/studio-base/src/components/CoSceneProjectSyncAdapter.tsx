import {
  CoSceneProjectStore,
  useProject,
} from "@foxglove/studio-base/context/CoSceneProjectContext";
import { useConsoleApi } from "@foxglove/studio-base/context/ConsoleApiContext";
import { useAsyncFn } from "react-use";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@foxglove/studio-base/components/MessagePipeline";
import { useEffect } from "react";
import Logger from "@foxglove/log";

const log = Logger.getLogger(__filename);

const selectSetProjects = (state: CoSceneProjectStore) => state.setProject;
const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

export function ProjectsSyncAdapter(): ReactNull {
  const setProject = useProject(selectSetProjects);
  const urlState = useMessagePipeline(selectUrlState);
  const consoleApi = useConsoleApi();

  const [_projects, syncProjects] = useAsyncFn(async () => {
    if (urlState?.parameters?.warehouseId && urlState?.parameters?.projectId) {
      const projectName = `warehouses/${urlState?.parameters?.warehouseId}/projects/${urlState?.parameters?.projectId}`;
      const project = await consoleApi.getProject({ projectName });

      setProject({ loading: false, value: project });
    }
  }, [consoleApi, setProject, urlState?.parameters?.warehouseId, urlState?.parameters?.projectId]);

  useEffect(() => {
    syncProjects().catch((error) => log.error(error));
  }, [syncProjects]);

  return ReactNull;
}
