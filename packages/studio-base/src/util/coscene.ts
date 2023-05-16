// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// coScene custom tools

export function getPlaybackQualityLevelByLocalStorage(): "ORIGINAL" | "HIGH" | "MID" | "LOW" {
  const localPlaybackQualityLevel = localStorage.getItem("playbackQualityLevel");
  let playbackQualityLevel: "ORIGINAL" | "HIGH" | "MID" | "LOW" = "ORIGINAL";

  switch (localPlaybackQualityLevel) {
    case "ORIGINAL":
      playbackQualityLevel = "ORIGINAL";
      break;
    case "HIGH":
      playbackQualityLevel = "HIGH";
      break;
    case "MID":
      playbackQualityLevel = "MID";
      break;
    case "LOW":
      playbackQualityLevel = "LOW";
      break;
    default:
      playbackQualityLevel = "ORIGINAL";
  }

  return playbackQualityLevel;
}
