// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const TOPIC_MESSAGE_FREQUENCIES_EXTENSION_DATA_KEY = "topicMessageFrequencies";

export type TopicMessageFrequencies = Record<string, number | undefined>;

export function getTopicMessageFrequencies(
  extensionData: Record<string, unknown> | undefined,
): TopicMessageFrequencies | undefined {
  const frequencies = extensionData?.[TOPIC_MESSAGE_FREQUENCIES_EXTENSION_DATA_KEY];
  if (frequencies == undefined || typeof frequencies !== "object") {
    return undefined;
  }

  return frequencies as TopicMessageFrequencies;
}
