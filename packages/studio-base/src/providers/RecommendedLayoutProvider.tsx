// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import {
  RecommendedLayoutContext,
  type RecommendedLayoutState,
} from "@foxglove/studio-base/context/RecommendedLayoutContext";
import { useFeatureIsOnWithConfig } from "@foxglove/studio-base/providers/GrowthBookProvider";
import {
  hasCompressedVideoTopic,
  listRecommendedLayouts,
  loadRecommendedLayoutData,
  loadRecommendedLayoutManifest,
  resolveRecommendedLayout,
} from "@foxglove/studio-base/services/RecommendedLayouts";

const selectRecord = (state: CoreDataStore) => state.record;
const selectShowtUrlKey = (state: CoreDataStore) => state.showtUrlKey;
const selectRecordId = (state: CoreDataStore) => state.externalInitConfig?.recordId;
const selectDataSource = (state: CoreDataStore) => state.dataSource;
const RECOMMENDED_LAYOUTS_FEATURE_FLAG = "honeybee_recommended_layouts";

export default function RecommendedLayoutProvider({
  children,
  enabled = true,
}: PropsWithChildren<{ enabled?: boolean }>): React.JSX.Element {
  const consoleApi = useConsoleApi();
  const record = useCoreData(selectRecord);
  const showtUrlKey = useCoreData(selectShowtUrlKey);
  const recordId = useCoreData(selectRecordId);
  const dataSource = useCoreData(selectDataSource);
  const hasSelectedDataSourceRef = useRef(dataSource != undefined);
  const [state, setState] = useState<RecommendedLayoutState>({ status: "loading", layouts: [] });
  const currentRecord = record.loading ? undefined : record.value;
  const hasCurrentRecord = currentRecord != undefined;
  const deviceTypeValue = currentRecord?.customMetadata?.attributes["deviceType"];
  const deviceType =
    deviceTypeValue?.kind.case === "stringValue" ? deviceTypeValue.kind.value : undefined;

  useEffect(() => {
    if (!enabled) {
      setState({ status: "ready", layouts: [] });
      return;
    }

    if (dataSource != undefined) {
      hasSelectedDataSourceRef.current = true;
    }
    const isRecordPlayback =
      dataSource?.type === "connection" && dataSource.id === "coscene-data-platform";

    if (!recordId) {
      setState({ status: "ready", layouts: [] });
      return;
    }
    if (!isRecordPlayback) {
      const isRecordPlaybackInitializing =
        dataSource == undefined &&
        !hasSelectedDataSourceRef.current &&
        (record.loading || showtUrlKey != undefined);
      setState(
        isRecordPlaybackInitializing
          ? { status: "loading", layouts: [] }
          : { status: "ready", layouts: [] },
      );
      return;
    }
    if (record.loading || !showtUrlKey) {
      setState({ status: "loading", layouts: [] });
      return;
    }
    if (!hasCurrentRecord) {
      setState({ status: "ready", layouts: [] });
      return;
    }

    if (!deviceType) {
      setState({ status: "ready", layouts: [] });
      return;
    }

    let cancelled = false;
    setState({ status: "loading", layouts: [] });
    const resolve = async () => {
      const manifest = await loadRecommendedLayoutManifest();
      if (!manifest.robots[deviceType]) {
        return { status: "ready", layouts: [] } as const;
      }

      const layouts = listRecommendedLayouts(manifest, deviceType);
      if (layouts.length === 0) {
        return { status: "ready", robot: deviceType, layouts } as const;
      }

      const metadata = await consoleApi.topics(showtUrlKey);
      const transport = hasCompressedVideoTopic(metadata.metaData) ? "h264" : "default";
      const resolvedAutomaticLayout = resolveRecommendedLayout(manifest, deviceType, transport);
      const automaticLayout = resolvedAutomaticLayout
        ? (layouts.find((layout) => layout.id === resolvedAutomaticLayout.id) ??
          resolvedAutomaticLayout)
        : undefined;
      return { status: "ready", robot: deviceType, layouts, automaticLayout } as const;
    };

    const resolveWithRetry = async () => {
      try {
        return await resolve();
      } catch {
        return await resolve();
      }
    };

    void resolveWithRetry()
      .then((nextState) => {
        if (!cancelled) {
          setState(nextState);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            layouts: [],
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    consoleApi,
    dataSource,
    deviceType,
    enabled,
    hasCurrentRecord,
    record.loading,
    recordId,
    showtUrlKey,
  ]);

  const loadLayout = useCallback(loadRecommendedLayoutData, []);
  const value = useMemo(() => ({ ...state, loadLayout }), [loadLayout, state]);
  return (
    <RecommendedLayoutContext.Provider value={value}>{children}</RecommendedLayoutContext.Provider>
  );
}

export function GrowthBookRecommendedLayoutProvider({
  children,
  enabled,
}: PropsWithChildren<{ enabled?: boolean }>): React.JSX.Element {
  const growthBookEnabled = useFeatureIsOnWithConfig(RECOMMENDED_LAYOUTS_FEATURE_FLAG, {
    fallback: false,
  });

  return (
    <RecommendedLayoutProvider enabled={enabled ?? growthBookEnabled}>
      {children}
    </RecommendedLayoutProvider>
  );
}
