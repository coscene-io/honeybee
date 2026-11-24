// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useId, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { StoreApi } from "zustand";

import { useTreeState } from "./treeState";
import type { TreeEnv } from "./treeState";
import { useTreeIndex } from "./useTreeIndex";
import type { TreeIndex } from "./useTreeIndex";
import { segmentationErrorText } from "../../errors";
import type { SemanticSegmentationStore } from "../../types";

export type TreeShell = {
  env: TreeEnv;
  hintId: string;
  collapsed: string[];
  setCollapsed: Dispatch<SetStateAction<string[]>>;
  setSelecting: Dispatch<SetStateAction<boolean>>;
  error: string | undefined;
  setError: (message: string | undefined) => void;
  treeFrameIds: string[];
  overview: boolean;
  index: TreeIndex["index"];
};

/** The tree's state, derived data and the environment its commands read. */
export function useTreeShell({
  store,
  disabled,
}: {
  store: StoreApi<SemanticSegmentationStore>;
  disabled: boolean;
}): TreeShell {
  const { t } = useTranslation("segmentation");
  const state = useTreeState(store);
  const { document, index, surfaces, treeFrameIds, overview, selection, contextKey } =
    useTreeIndex(state);
  const hintId = useId();
  const locked = disabled || ["running", "stopping"].includes(state.propagationStatus);
  const [selecting, setSelecting] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const env: TreeEnv = {
    store,
    state,
    document,
    surfaces,
    selection,
    selecting,
    disabled,
    locked,
    contextKey,
    t,
    setError,
    run: (action) => {
      if (locked) {
        return;
      }
      try {
        state.runTransaction("opLabelEditTree", action);
        setError(undefined);
      } catch (err) {
        setError(segmentationErrorText(err));
      }
    },
  };
  return {
    env,
    hintId,
    collapsed,
    setCollapsed,
    setSelecting,
    error,
    setError,
    treeFrameIds,
    overview,
    index,
  };
}
