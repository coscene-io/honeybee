// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { create } from "@bufbuild/protobuf";
import {
  User,
  UserSchema,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/user_pb";
import PersonIcon from "@mui/icons-material/Person";
import { Autocomplete, Box, TextField, Chip, Avatar } from "@mui/material";
import PinyinMatch from "pinyin-match";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCoreData } from "@foxglove/studio-base/context/CoreDataContext";

const NO_USERS: User[] = [];

function useDirectoryUsers(load: (() => Promise<User[]>) | undefined): User[] {
  const [result, fetchUsers] = useAsyncFn(async () => ({ load, users: await load?.() }), [load]);
  useEffect(() => {
    if (load) {
      void fetchUsers();
    }
  }, [load, fetchUsers]);
  // useAsyncFn retains its previous value while the new project is loading.
  return result.value?.load === load ? (result.value?.users ?? NO_USERS) : NO_USERS;
}

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
  onClear?: () => void;
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
  onClear,
  disabled,
  error,
  multiple,
  placeholder,
}: UserSelectProps): React.ReactNode {
  const consoleApi = useConsoleApi();
  const { classes } = useStyles();

  const { t } = useTranslation("general");
  const config = useCoreData((state) => state.externalInitConfig);
  const parent =
    config?.warehouseId && config.projectId
      ? `warehouses/${config.warehouseId}/projects/${config.projectId}`
      : undefined;
  const directory = consoleApi.getProjectUserDirectory(parent);
  const members = useDirectoryUsers(directory?.listMembers);
  const excluded = useDirectoryUsers(directory?.listExcluded);
  const { usersByName, activatedUsers, memberNames } = useMemo(() => {
    const byName = new Map<string, User>();
    const projectMembers = new Set(members.map((user) => user.name));
    for (const user of [...members, ...excluded]) {
      if (!byName.has(user.name)) {
        byName.set(user.name, user);
      }
    }
    return {
      usersByName: byName,
      activatedUsers: Array.from(byName.values()).filter((user) => user.active),
      memberNames: projectMembers,
    };
  }, [members, excluded]);
  const groupBy = (user: User) =>
    memberNames.has(user.name) ? t("projectInternalMembers") : t("projectExcludedMembers");
  const selectedUsers = useMemo(() => {
    const values = Array.isArray(value) ? value : [value];
    const names = multiple === true ? values : values.slice(0, 1);
    // Keep unresolved and inactive selections visible without making them options.
    return names
      .filter((name) => name.split("/").pop())
      .map((name) => usersByName.get(name) ?? create(UserSchema, { name }));
  }, [multiple, usersByName, value]);
  const getUserLabel = (user: User) =>
    user.nickname != undefined && user.nickname !== "" ? user.nickname : user.name;

  // 处理单选和多选的值
  if (multiple === true) {
    // 多选模式
    return (
      <Autocomplete
        size="small"
        disabled={disabled}
        disableClearable={allowClear === false}
        multiple
        disableCloseOnSelect={true}
        options={activatedUsers}
        groupBy={groupBy}
        getOptionLabel={getUserLabel}
        renderInput={(params) => (
          <TextField
            {...params}
            variant="filled"
            error={error}
            placeholder={selectedUsers.length > 0 ? undefined : placeholder}
          />
        )}
        renderOption={({ key: _key, ...optionProps }, option) => (
          <Box key={option.name} component="li" {...optionProps}>
            <Avatar src={option.avatar} className={classes.avatar} variant="rounded">
              {(option.avatar == undefined || option.avatar === "") && (
                <PersonIcon color="secondary" />
              )}
            </Avatar>
            {getUserLabel(option)}
          </Box>
        )}
        value={selectedUsers}
        isOptionEqualToValue={(option, value) => option.name === value.name}
        renderValue={(value, getTagProps) =>
          value.map((option, index) => {
            const { key: _key, ...tagProps } = getTagProps({ index });
            return (
              <Chip
                label={getUserLabel(option)}
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
    const selectedUser = selectedUsers[0] ?? ReactNull;

    return (
      <Autocomplete
        size="small"
        disabled={disabled}
        disableClearable={allowClear === false}
        options={activatedUsers}
        groupBy={groupBy}
        getOptionLabel={getUserLabel}
        renderInput={(params) => (
          <TextField {...params} variant="filled" error={error} placeholder={placeholder} />
        )}
        renderOption={({ key: _key, ...optionProps }, option) => (
          <Box key={option.name} component="li" {...optionProps}>
            <Avatar src={option.avatar} className={classes.avatar} variant="rounded">
              {(option.avatar == undefined || option.avatar === "") && (
                <PersonIcon color="secondary" />
              )}
            </Avatar>
            {getUserLabel(option)}
          </Box>
        )}
        value={selectedUser}
        isOptionEqualToValue={(option, value) => option.name === value.name}
        onChange={(_event, option) => {
          if (option) {
            onChange(option);
          } else {
            onClear?.();
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
