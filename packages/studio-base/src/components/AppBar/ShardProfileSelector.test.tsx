/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import type { PlayerURLState } from "@foxglove/studio-base/players/types";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { ShardProfileSelector } from "./ShardProfileSelector";

function renderSelector(urlState: PlayerURLState): ReturnType<typeof render> {
  return render(
    <ThemeProvider isDark>
      <MockMessagePipelineProvider urlState={urlState}>
        <ShardProfileSelector />
      </MockMessagePipelineProvider>
    </ThemeProvider>,
  );
}

describe("<ShardProfileSelector />", () => {
  const manifestUrl = "https://mock-storage.example.com/public/shards/manifest.json";
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        profiles: [
          { id: "360p", modality: "video", label: "360p", params: { h: 360 } },
          { id: "720p", modality: "video", label: "720p", params: { h: 720 } },
          { id: "raw", modality: "video", label: "Raw", params: { h: 1080 } },
        ],
      }),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("does not render for encoded share manifest playback", () => {
    renderSelector({
      sourceId: "coscene-share-manifest",
      parameters: { manifest: "encoded" },
    });

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not render for direct share manifest playback with one effective profile", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        profiles: [
          { id: "720p", modality: "video", label: "720p", params: { h: 720 } },
          { id: "raw", modality: "video", label: "Raw", params: { h: 1080 } },
        ],
      }),
    });

    renderSelector({
      sourceId: "coscene-share-manifest",
      parameters: { shardMode: "manifest", manifestUrl },
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(manifestUrl);
    });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("renders direct share manifest profiles only when multiple effective profiles exist", async () => {
    renderSelector({
      sourceId: "coscene-share-manifest",
      parameters: { shardMode: "manifest", manifestUrl },
    });

    const select = await screen.findByRole("combobox");
    fireEvent.mouseDown(select);

    expect(await screen.findByRole("option", { name: "360p" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "720p" })).not.toBeNull();
    expect(screen.queryByText("Raw")).toBeNull();
    expect(screen.queryByText("Raw Data")).toBeNull();
  });

  it("keeps raw available for data-platform shard manifest playback", async () => {
    renderSelector({
      sourceId: "coscene-data-platform",
      parameters: { shardMode: "manifest", manifestUrl },
    });

    const select = await screen.findByRole("combobox");
    fireEvent.mouseDown(select);

    expect(await screen.findByRole("option", { name: "Raw Data" })).not.toBeNull();
  });
});
