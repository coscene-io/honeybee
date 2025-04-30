// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { DataSourceArgs } from "@foxglove/studio-base/context/PlayerSelectionContext";

enum AppEvent {
  APP_INIT = "app_initialized",

  // Dialog events
  DIALOG_SELECT_VIEW = "dialog_view_selected",
  DIALOG_CLOSE = "dialog_closed",
  DIALOG_CLICK_CTA = "dialog_cta_clicked",

  // App Bar events
  APP_BAR_CLICK_CTA = "app_bar_cta_clicked",

  // Tour events
  TOUR_PROMPT_SHOWN = "new_ui_tour_prompt_shown",
  TOUR_STARTED = "new_ui_tour_started",
  TOUR_BACK = "new_ui_tour_step_back",
  TOUR_NEXT = "new_ui_tour_step_next",
  TOUR_COMPLETED = "new_ui_tour_completed",
  TOUR_DISMISSED = "new_ui_tour_dismissed",

  // App Menu events
  APP_MENU_CLICK = "app_menu_clicked",

  // Help Menu events
  HELP_MENU_CLICK_CTA = "help_menu_cta_clicked",

  // Player events
  PLAYER_CONSTRUCTED = "player_constructed",
  PLAYER_PLAY = "player_played",
  PLAYER_SEEK = "player_seeked",
  PLAYER_SET_SPEED = "player_speed_set",
  PLAYER_PAUSE = "player_paused",
  PLAYER_CLOSE = "player_closed",

  // Layout events
  LAYOUT_UPDATE = "layout_updated",
  LAYOUT_CREATE = "layout_created",
  LAYOUT_DUPLICATE = "layout_duplicated",
  LAYOUT_RENAME = "layout_renamed",
  LAYOUT_DELETE = "layout_deleted",
  LAYOUT_SELECT = "layout_selected",
  LAYOUT_IMPORT = "layout_imported",
  LAYOUT_EXPORT = "layout_exported",
  LAYOUT_SHARE = "layout_shared",
  LAYOUT_OVERWRITE = "layout_overwritten",
  LAYOUT_REVERT = "layout_reverted",
  LAYOUT_MAKE_PERSONAL_COPY = "layout_personal_copy_made",

  // Panel events
  PANEL_ADD = "panel_added",
  PANEL_DELETE = "panel_deleted",

  // Variable events
  VARIABLE_ADD = "variable_added",
  VARIABLE_DELETE = "variable_deleted",

  // Image events
  IMAGE_DOWNLOAD = "image_downloaded",

  // Extension events
  EXTENSION_INSTALL = "extension_installed",
  EXTENSION_UNINSTALL = "extension_uninstalled",

  // Experimental features
  EXPERIMENTAL_FEATURE_TOGGLE = "experimental_feature_toggled",

  // User engagement
  USER_OBSERVATION = "user_makes_observation",
  USER_ACTIVATION = "user_activated",

  // Player events
  PLAYER_RECORD_PLAYS_EVERY_FIVE_SECONDS_TOTAL = "player_records_plays_every_five_seconds_total",
  PLAYER_INIT = "player_initialized",

  // File events
  FILE_UPLOAD = "file_uploaded",

  // Player state events
  PLAYER_INITIALIZING_TIME = "player_initializing_time",
  PLAYER_BUFFERING_TIME = "player_buffering_time",
}

interface IAnalytics {
  logEvent(event: AppEvent, data?: { [key: string]: unknown }): void | Promise<void>;
  setSpeed(speed: number): void;
  initPlayer(sourceId: string, args?: DataSourceArgs): void;
}

export { AppEvent };
export default IAnalytics;
