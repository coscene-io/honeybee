// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Log from "@foxglove/log";
import { Time } from "@foxglove/rostime";

import { PersistentCacheIterableSource } from "./PersistentCacheIterableSource";
import { IndexedDbMessageStore } from "../../persistence/IndexedDbMessageStore";
import type { PersistentMessageCache } from "../../persistence/PersistentMessageCache";
import { IterablePlayer } from "../IterablePlayer/IterablePlayer";
import type { Player, PlayerMetricsCollectorInterface } from "../types";

const log = Log.getLogger(__filename);

export interface PersistentCachePlayerOptions {
  /** Optional metrics collector */
  metricsCollector?: PlayerMetricsCollectorInterface;

  /** Session ID to load data from (if not provided, will try to find the most recent session) */
  sessionId?: string;

  /** Optional name for the player */
  name?: string;

  /** Source ID for URL state management */
  sourceId: string;

  /** Optional URL parameters */
  urlParams?: Record<string, string>;

  /** Whether to enable preloading (default: true) */
  enablePreload?: boolean;
}

/**
 * PersistentCachePlayer loads and plays back messages stored in IndexedDB
 * by the FoxgloveWebSocketPlayer's persistent cache functionality.
 */
export class PersistentCachePlayer {
  #cache?: PersistentMessageCache;
  #iterablePlayer?: IterablePlayer;
  #initialized = false;

  public constructor(private readonly options: PersistentCachePlayerOptions) {}

  /**
   * Initialize the player by discovering and loading the appropriate session data
   */
  public async initialize(): Promise<Player> {
    if (this.#initialized) {
      throw new Error("PersistentCachePlayer is already initialized");
    }

    try {
      // Create the IndexedDB message store
      const cache = new IndexedDbMessageStore({
        autoClearOnInit: false, // Don't clear existing data
        sessionId: this.options.sessionId, // Will be overridden if we need to find sessions
      });

      await cache.waitForInit();

      // If no session ID provided, try to find the most recent session with data
      if (!this.options.sessionId) {
        const stats = await cache.stats();
        if (stats.count === 0) {
          throw new Error(
            "No cached data found in IndexedDB. Please ensure the FoxgloveWebSocketPlayer has cached some data first.",
          );
        }
        log.info(`Found ${stats.count} cached messages from session ${cache.getSessionId()}`);
      } else {
        // Verify the specified session has data
        const stats = await cache.stats();
        if (stats.count === 0) {
          throw new Error(`No cached data found for session ${this.options.sessionId}`);
        }
        log.info(`Loading ${stats.count} cached messages from session ${this.options.sessionId}`);
      }

      this.#cache = cache;

      // Create the persistent cache iterable source
      const source = new PersistentCacheIterableSource({
        cache: this.#cache,
        name: this.options.name ?? `Cached Data (${cache.getSessionId()})`,
      });

      // Create the iterable player
      this.#iterablePlayer = new IterablePlayer({
        source,
        metricsCollector: this.options.metricsCollector,
        name: this.options.name,
        sourceId: this.options.sourceId,
        urlParams: this.options.urlParams,
        enablePreload: this.options.enablePreload ?? true,
      });

      this.#initialized = true;
      return this.#iterablePlayer;
    } catch (error) {
      log.error("Failed to initialize PersistentCachePlayer:", error);
      throw error;
    }
  }

  /**
   * Get statistics about the cached data
   */
  public async getStats(): Promise<
    | {
        sessionId: string;
        count: number;
        earliest?: Time;
        latest?: Time;
        retentionWindowMs: number;
        windowUtilization: number;
      }
    | undefined
  > {
    if (!this.#cache) {
      return undefined;
    }

    const cacheStore = this.#cache as IndexedDbMessageStore;
    const stats = await cacheStore.stats();
    const windowStats = await cacheStore.getWindowStats();

    return {
      sessionId: cacheStore.getSessionId(),
      ...stats,
      retentionWindowMs: windowStats.retentionWindowMs,
      windowUtilization: windowStats.windowUtilization,
    };
  }

  /**
   * Close the player and cleanup resources
   */
  public async close(): Promise<void> {
    this.#iterablePlayer?.close();
    await this.#cache?.close();
    this.#iterablePlayer = undefined;
    this.#cache = undefined;
    this.#initialized = false;
  }

  /**
   * Get the underlying player instance (only available after initialization)
   */
  public getPlayer(): Player | undefined {
    return this.#iterablePlayer;
  }

  /**
   * Check if player is initialized
   */
  public getIsInitialized(): boolean {
    return this.#initialized;
  }
}

/**
 * Utility function to create a PersistentCachePlayer and initialize it
 */
export async function createPersistentCachePlayer(
  options: PersistentCachePlayerOptions,
): Promise<Player> {
  const cachePlayer = new PersistentCachePlayer(options);
  return await cachePlayer.initialize();
}

/**
 * Utility function to list available cached sessions
 */
export async function listAvailableCachedSessions(): Promise<
  Array<{
    sessionId: string;
    count: number;
    earliest?: Time;
    latest?: Time;
    retentionWindowMs: number;
  }>
> {
  // This is a bit tricky since we need to enumerate sessions
  // For now, we'll create a temporary store and check if there's data
  const tempStore = new IndexedDbMessageStore({
    autoClearOnInit: false,
  });

  try {
    await tempStore.init();
    const stats = await tempStore.stats();

    if (stats.count === 0) {
      return [];
    }

    // Since IndexedDbMessageStore doesn't provide session enumeration,
    // we return the current session if it has data
    return [
      {
        sessionId: tempStore.getSessionId(),
        count: stats.count,
        earliest: stats.earliest,
        latest: stats.latest,
        retentionWindowMs: tempStore.getRetentionWindowMs(),
      },
    ];
  } catch (error) {
    log.error("Failed to list cached sessions:", error);
    return [];
  } finally {
    await tempStore.close();
  }
}
