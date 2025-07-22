// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Avatar as MuiAvatar, Tooltip } from "@mui/material";
import { useAsync } from "react-use";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";

export default function Avatar(params: { userName: string; size?: number }): React.JSX.Element {
  const consoleApi = useConsoleApi();

  const userInfo = useAsync(async () => {
    const userInfo = await consoleApi.batchGetUsers([params.userName]);
    return userInfo.users[0];
  }, [consoleApi, params.userName]);

  return (
    <Tooltip title={userInfo.value?.nickname}>
      {userInfo.value?.avatar ? (
        <MuiAvatar
          src={userInfo.value.avatar}
          variant="circular"
          style={{ width: params.size ?? 24, height: params.size ?? 24 }}
        />
      ) : (
        <MuiAvatar
          variant="circular"
          style={{ width: params.size ?? 24, height: params.size ?? 24 }}
        >
          {userInfo.value?.nickname?.split("/").pop()}
        </MuiAvatar>
      )}
    </Tooltip>
  );
}
