// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TypeOptions } from "i18next";

// Generic global translation
export const general: Partial<TypeOptions["resources"]["general"]> = {
  // Note that we use the term `CoScene` as an English word rather than a Japanese
  // word since it would sound very different - フォックスグローブ (Fokusugorobu).
  foxglove: "coScene",
  learnMore: "もっと学ぶ",
  on: undefined,
  off: undefined,
  auto: undefined,
  sec: "秒",
  seekStep: "ステップ幅",
  seekStepHelp: "一時停止中の移動間隔",
  enableMomentSubtitles: "Enable moment subtitles",
  disableMomentSubtitles: "Disable moment subtitles",
  decreaseMomentSubtitleFontSize: "Decrease subtitle font size",
  increaseMomentSubtitleFontSize: "Increase subtitle font size",
  resetMomentSubtitlePosition: "Reset subtitle position",
  resetToDefault: "Reset to default",
  panTimeline: "Pan timeline",
  timelineHeight: "タイムラインの高さ",
  timelineControls: "タイムライン操作",
  timelineMoreTools: "その他のタイムラインツール",
  playbackTime: "現在の再生時刻",
  timeDisplayFormat: "時刻表示形式",
  dataSourceInfo: "データソース情報",
  totalDuration: "合計時間",
  elapsedTime: "再生経過時間",
  relativeTimeSeconds: "相対時間（秒）",
};
