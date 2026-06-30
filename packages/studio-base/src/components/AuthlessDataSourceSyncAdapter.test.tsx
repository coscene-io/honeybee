/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";

import { AuthlessDataSourceSyncAdapter } from "@foxglove/studio-base/components/AuthlessDataSourceSyncAdapter";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import { isAuthlessDataSource } from "@foxglove/studio-base/util/coscene";
import { SHARE_MANIFEST_DATA_SOURCE_ID } from "@foxglove/studio-base/util/shareManifest";

const selectSetDataSource = (state: CoreDataStore) => state.setDataSource;

function encodeBase64Url(value: unknown): string {
  const json = JSON.stringify(value);
  if (json == undefined) {
    throw new Error("Unable to encode share manifest");
  }
  return Buffer.from(json, "utf8").toString("base64url");
}

function SetDataSource({ sourceId }: { sourceId: string | undefined }): ReactNull {
  const setDataSource = useCoreData(selectSetDataSource);
  useEffect(() => {
    setDataSource(sourceId == undefined ? undefined : { id: sourceId, type: "connection" });
  }, [setDataSource, sourceId]);

  return ReactNull;
}

function renderWithSource(sourceId: string | undefined): ReturnType<typeof render> {
  return render(
    <CoreDataProvider>
      <AuthlessDataSourceSyncAdapter />
      <SetDataSource sourceId={sourceId} />
    </CoreDataProvider>,
  );
}

describe("<AuthlessDataSourceSyncAdapter />", () => {
  beforeEach(() => {
    const manifest = encodeBase64Url({
      version: 1,
      expireTime: "2026-06-30T10:00:00Z",
      links: {
        mini_mcap: "https://mock-storage.example.com/artifacts/process.mini.mcap",
        layout: "https://mock-storage.example.com/shares/layout.json",
      },
    });
    window.history.replaceState(
      undefined,
      "",
      `${window.location.origin}/viz#manifest=${manifest}`,
    );
  });

  it("uses the current data source instead of the URL hash", async () => {
    const { rerender } = renderWithSource("coscene-data-platform");

    await waitFor(() => {
      expect(isAuthlessDataSource()).toBe(false);
    });

    rerender(
      <CoreDataProvider>
        <AuthlessDataSourceSyncAdapter />
        <SetDataSource sourceId={SHARE_MANIFEST_DATA_SOURCE_ID} />
      </CoreDataProvider>,
    );

    await waitFor(() => {
      expect(isAuthlessDataSource()).toBe(true);
    });
  });
});
