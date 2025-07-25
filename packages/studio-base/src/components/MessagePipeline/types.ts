// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@foxglove/rostime";
import { Immutable, MessageEvent, Metadata, ParameterValue } from "@foxglove/studio";
import { BuiltinPanelExtensionContext } from "@foxglove/studio-base/components/PanelExtensionAdapter";
import {
  AdvertiseOptions,
  PlaybackSpeed,
  PlayerState,
  PublishPayload,
  SubscribePayload,
  Topic,
} from "@foxglove/studio-base/players/types";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

type ResumeFrame = () => void;
export type MessagePipelineContext = Immutable<{
  playerState: PlayerState;
  sortedTopics: Topic[];
  datatypes: RosDatatypes;
  subscriptions: SubscribePayload[];
  messageEventsBySubscriberId: Map<string, MessageEvent[]>;
  setSubscriptions: (id: string, subscriptionsForId: Immutable<SubscribePayload[]>) => void;
  setPublishers: (id: string, publishersForId: AdvertiseOptions[]) => void;
  setParameter: (key: string, value: ParameterValue) => void;
  publish: (request: PublishPayload) => void;
  getMetadata: () => ReadonlyArray<Readonly<Metadata>>;
  callService: (service: string, request: unknown) => Promise<unknown>;
  fetchAsset: BuiltinPanelExtensionContext["unstable_fetchAsset"];
  startPlayback?: () => void;
  pausePlayback?: () => void;
  setPlaybackSpeed?: (speedFraction: PlaybackSpeed) => void;
  // eslint-disable-next-line @foxglove/no-boolean-parameters
  enableRepeatPlayback?: (enable: boolean) => void;
  playUntil?: (time: Time) => void;
  seekPlayback?: (time: Time) => void;
  // Don't render the next frame until the returned function has been called.
  pauseFrame: (name: string) => ResumeFrame;
  close: () => void;
  reOpen: () => void;
}>;
