// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useSnackbar } from "notistack";
import { useEffect } from "react";
import type { MarkOptional } from "ts-essentials";

import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import {
  LayoutID,
  useCurrentLayoutActions,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import { migratePanelsState } from "@foxglove/studio-base/services/migrateLayout";
import { replaceNullWithUndefined } from "@foxglove/studio-base/util/coscene";
import {
  SHARE_MANIFEST_DATA_SOURCE_ID,
  windowShareManifestParseResult,
} from "@foxglove/studio-base/util/shareManifest";

const selectDataSource = (state: CoreDataStore) => state.dataSource;
const SHARE_LAYOUT_ID = "share-manifest-layout" as LayoutID;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != undefined && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function setBlankSharedLayout(
  setCurrentLayout: ReturnType<typeof useCurrentLayoutActions>["setCurrentLayout"],
) {
  setCurrentLayout({
    id: SHARE_LAYOUT_ID,
    name: "Shared layout",
    data: {
      configById: {},
      globalVariables: {},
      userNodes: {},
    },
    transient: true,
  });
}

async function fetchDirectManifestLayoutUrl(
  manifestUrl: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const response = await fetch(manifestUrl, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const rawManifest = await response.json();
  if (!isRecord(rawManifest) || !isRecord(rawManifest.links)) {
    return undefined;
  }
  const layout = rawManifest.links.layout;
  return typeof layout === "string" && isHttpUrl(layout) ? layout : undefined;
}

export function ShareManifestLayoutSyncAdapter(): ReactNull {
  const dataSource = useCoreData(selectDataSource);
  const { setCurrentLayout } = useCurrentLayoutActions();
  const { enqueueSnackbar } = useSnackbar();

  useEffect(() => {
    if (dataSource?.id !== SHARE_MANIFEST_DATA_SOURCE_ID) {
      return;
    }

    const controller = new AbortController();
    void (async () => {
      const manifestResult = windowShareManifestParseResult();
      if (manifestResult.status !== "valid") {
        return;
      }

      try {
        const layoutUrl =
          manifestResult.kind === "encoded"
            ? manifestResult.manifest.links.layout
            : (manifestResult.layoutUrl ??
              (await fetchDirectManifestLayoutUrl(manifestResult.manifestUrl, controller.signal)));
        if (layoutUrl == undefined) {
          setBlankSharedLayout(setCurrentLayout);
          return;
        }

        const response = await fetch(layoutUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const rawLayout = replaceNullWithUndefined(await response.json());
        const data = migratePanelsState(rawLayout as MarkOptional<LayoutData, "configById">);
        setCurrentLayout({
          id: SHARE_LAYOUT_ID,
          name: "Shared layout",
          data,
          transient: true,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        enqueueSnackbar(`Shared layout could not be loaded. ${(error as Error).message}`, {
          variant: "error",
        });
        setBlankSharedLayout(setCurrentLayout);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [dataSource?.id, enqueueSnackbar, setCurrentLayout]);

  return ReactNull;
}
