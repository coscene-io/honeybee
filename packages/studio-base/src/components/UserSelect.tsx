// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { User } from "@coscene-io/cosceneapis-es/coscene/dataplatform/v1alpha1/resources/user_pb";
import PersonIcon from "@mui/icons-material/Person";
import { Autocomplete, Box, TextField, Chip, Avatar } from "@mui/material";
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

interface BaseUserSelectProps {
  allowClear?: boolean;
  value: string | string[];
  onMetaDataKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  disabled?: boolean;
  error?: boolean;
  placeholder?: string;
}

interface SingleUserSelectProps extends BaseUserSelectProps {
  multiple?: false;
  onChange: (value: User) => void;
}

interface MultipleUserSelectProps extends BaseUserSelectProps {
  multiple: true;
  onChange: (value: User[]) => void;
}

// union type
type UserSelectProps = SingleUserSelectProps | MultipleUserSelectProps;

export function UserSelect({
  value,
  onChange,
  onMetaDataKeyDown,
  allowClear,
  disabled,
  error,
  multiple,
  placeholder,
}: UserSelectProps): React.ReactNode {
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

  // 处理单选和多选的值
  if (multiple === true) {
    // 多选模式
    const valueArray = Array.isArray(value) ? value : [value];
    const selectedUsers = activatedUsers.filter((user) => valueArray.includes(user.name));

    return (
      <Autocomplete
        size="small"
        disabled={disabled}
        disableClearable={allowClear === false}
        multiple
        disableCloseOnSelect={true}
        options={activatedUsers}
        getOptionLabel={(option) => option.nickname ?? ""}
        renderInput={(params) => (
          <TextField
            {...params}
            variant="filled"
            error={error}
            placeholder={selectedUsers.length > 0 ? undefined : placeholder}
          />
        )}
        renderOption={(optionProps, option) => (
          <Box component="li" {...optionProps} key={option.name}>
            <Avatar src={option.avatar} className={classes.avatar} variant="rounded">
              {(option.avatar == undefined || option.avatar === "") && (
                <PersonIcon color="secondary" />
              )}
            </Avatar>
            {option.nickname}
          </Box>
        )}
        value={selectedUsers}
        isOptionEqualToValue={(option, value) => option.name === value.name}
        renderValue={(value, getTagProps) =>
          value.map((option, index) => {
            const { key: _key, ...tagProps } = getTagProps({ index });
            return (
              <Chip
                label={option.nickname ?? ""}
                size="small"
                {...tagProps}
                key={`${option.name}-${index}`}
              />
            );
          })
        }
        onChange={(_event, options) => {
          onChange(options);
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
  } else {
    // 单选模式
    const singleValue = Array.isArray(value) ? value[0] : value;
    const selectedUser = activatedUsers.find((user) => user.name === singleValue) ?? undefined;

    return (
      <Autocomplete
        size="small"
        disabled={disabled}
        disableClearable={allowClear === false}
        options={activatedUsers}
        getOptionLabel={(option) => option.nickname ?? ""}
        renderInput={(params) => (
          <TextField {...params} variant="filled" error={error} placeholder={placeholder} />
        )}
        renderOption={(optionProps, option) => (
          <Box component="li" {...optionProps} key={option.name}>
            <Avatar src={option.avatar} className={classes.avatar} variant="rounded">
              {(option.avatar == undefined || option.avatar === "") && (
                <PersonIcon color="secondary" />
              )}
            </Avatar>
            {option.nickname}
          </Box>
        )}
        value={selectedUser}
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
}
