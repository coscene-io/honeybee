// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useState } from "react";

import { CoSceneLayoutDrawer } from "./CoSceneLayoutDrawer";
import { LayoutButton } from "./components/LayoutButton";
import { useCurrentLayout } from "./hooks/useCurrentLayout";

export function CoSceneLayoutButton(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { currentLayout, layouts } = useCurrentLayout();

  // todo: 实现
  // const onSelectLayout = () => {};
  // const onDeleteLayout = () => {};
  // const onRenameLayout = () => {};
  // const onRevertLayout = () => {};
  // const onCreateNewLayout = () => {};

  return (
    <>
      <LayoutButton
        currentLayout={currentLayout}
        loading={layouts.loading}
        onClick={() => {
          setOpen(true);
        }}
      />
      {open && (
        <CoSceneLayoutDrawer
          open
          layouts={layouts.value}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
