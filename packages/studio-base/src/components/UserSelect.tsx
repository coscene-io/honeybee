// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { User } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/user_pb";
import { Autocomplete, Box, TextField } from "@mui/material";
import PinyinMatch from "pinyin-match";
import { useEffect } from "react";
import { useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";

const useStyles = makeStyles()(() => ({
  avatar: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    marginRight: 5,
  },
}));

export function UserSelect({
  value,
  onChange,
  onMetaDataKeyDown,
  allowClear,
  disabled,
  error,
}: {
  allowClear?: boolean;
  value: string;
  onChange: (value: User) => void;
  onMetaDataKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  disabled?: boolean;
  error?: boolean;
}): React.ReactNode {
  const consoleApi = useConsoleApi();
  const { classes } = useStyles();

  const [users, getUsers] = useAsyncFn(async () => {
    return await consoleApi.listOrganizationUsers();
  }, [consoleApi]);

  useEffect(() => {
    getUsers().catch((err: unknown) => {
      console.error(err);
    });
  }, [getUsers]);

  if (users.value == undefined) {
    return;
  }

  const activatedUsers = users.value.filter((user) => user.active);
  const targetUser = activatedUsers.find((user) => user.name === value) ?? undefined;

  return (
    <Autocomplete
      size="small"
      disabled={disabled}
      disableClearable={allowClear === false}
      options={activatedUsers}
      getOptionLabel={(option) => option.nickname ?? ""}
      renderInput={(params) => <TextField {...params} variant="filled" error={error} />}
      renderOption={(optionProps, option) => (
        <Box component="li" {...optionProps} key={option.name}>
          <img className={classes.avatar} src={option.avatar} />
          {option.nickname}
        </Box>
      )}
      value={targetUser}
      isOptionEqualToValue={(option, value) => option.name === value.name}
      onChange={(_event, option) => {
        if (option) {
          onChange(option);
        }
      }}
      filterOptions={(options, { inputValue }) => {
        if (!inputValue) {
          return options;
        }
        return options.filter((option) => {
          const pinyinMatch = PinyinMatch.match(option.nickname ?? "", inputValue);
          return (option.nickname ?? "").includes(inputValue) || pinyinMatch !== false;
        });
      }}
      onKeyDown={onMetaDataKeyDown}
    />
  );
}
