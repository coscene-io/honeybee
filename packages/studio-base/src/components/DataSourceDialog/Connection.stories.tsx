// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { StoryFn, StoryObj } from "@storybook/react";

import PlayerSelectionContext, {
  PlayerSelection,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import MockCurrentLayoutProvider from "@foxglove/studio-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";

import { DataSourceDialog } from "./DataSourceDialog";

const Wrapper = (Story: StoryFn): React.JSX.Element => {
  return (
    <MockCurrentLayoutProvider>
      <WorkspaceContextProvider
        initialState={{
          dialogs: {
            dataSource: {
              activeDataSource: undefined,
              item: "connection",
              open: true,
            },
            preferences: {
              initialTab: undefined,
              open: false,
            },
          },
        }}
      >
        <PlayerSelectionContext.Provider value={playerSelection}>
          <Story />
        </PlayerSelectionContext.Provider>
      </WorkspaceContextProvider>
    </MockCurrentLayoutProvider>
  );
};

export default {
  title: "components/DataSourceDialog/Connection",
  component: DataSourceDialog,
  decorators: [Wrapper],
};

// Connection
const playerSelection: PlayerSelection = {
  selectSource: () => {},
  selectRecent: () => {},
  recentSources: [],
  availableSources: [
    {
      id: "foo",
      type: "connection",
      displayName: "My Data Source",
      description: "Data source description",
      iconName: "ROS",
      warning: "This is a warning",

      formConfig: {
        fields: [{ id: "key", label: "Some Label" }],
      },

      initialize: () => {
        return undefined;
      },
    },
    {
      id: "bar",
      type: "connection",
      displayName: "Another data source",
      description: "Another description (with default icon)",

      initialize: () => {
        return undefined;
      },
    },
    {
      id: "bar",
      type: "connection",
      displayName: "Another data source",
      description: "Another description (with default icon)",
      iconName: "GenericScan",

      initialize: () => {
        return undefined;
      },
    },
  ],
};

export const Light: StoryObj = {
  render: () => <DataSourceDialog backdropAnimation={false} />,
  name: "Default (light)",
  parameters: { colorScheme: "light" },
};

export const LightChinese: StoryObj = {
  ...Light,
  name: "Default Chinese",
  parameters: { forceLanguage: "zh", colorScheme: "light" },
};

export const LightJapanese: StoryObj = {
  ...Light,
  name: "Default Japanese",
  parameters: { forceLanguage: "ja", colorScheme: "light" },
};

export const Dark: StoryObj = {
  render: () => <DataSourceDialog backdropAnimation={false} />,
  name: "Default (dark)",
  parameters: { colorScheme: "dark" },
};
