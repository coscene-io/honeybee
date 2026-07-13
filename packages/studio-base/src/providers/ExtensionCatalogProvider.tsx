// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import race from "race-as-promised";
import React, { PropsWithChildren, useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { StoreApi, createStore } from "zustand";

import Logger from "@foxglove/log";
import {
  ExtensionContext,
  ExtensionModule,
  PanelSettings,
  RegisterMessageConverterArgs,
  TopicAliasFunction,
} from "@foxglove/studio";
import {
  ExtensionCatalog,
  ExtensionCatalogContext,
  ExtensionCatalogLoadError,
  RegisteredPanel,
} from "@foxglove/studio-base/context/ExtensionCatalogContext";
import { TopicAliasFunctions } from "@foxglove/studio-base/players/TopicAliasingPlayer/aliasing";
import { ExtensionLoader } from "@foxglove/studio-base/services/ExtensionLoader";
import { ExtensionInfo, ExtensionNamespace } from "@foxglove/studio-base/types/Extensions";

const log = Logger.getLogger(__filename);

const EXTENSION_LIST_DEADLINE_MS = 5_000;
const EXTENSION_LOAD_DEADLINE_MS = 10_000;
const EXTENSION_LOAD_CONCURRENCY = 4;

class ExtensionLoadTimeoutError extends Error {}

function createDeadline(
  timeoutMs: number,
  message: string,
): {
  promise: Promise<never>;
  clear: () => void;
} {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ExtensionLoadTimeoutError(message));
    }, timeoutMs);
  });
  return {
    promise,
    clear: () => {
      clearTimeout(timer);
    },
  };
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const deadline = createDeadline(timeoutMs, message);
  try {
    return await race([operation, deadline.promise]);
  } finally {
    deadline.clear();
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeLoadError(
  loader: ExtensionLoader,
  stage: ExtensionCatalogLoadError["stage"],
  error: unknown,
  extensionId?: string,
): ExtensionCatalogLoadError {
  return {
    namespace: loader.namespace,
    stage,
    extensionId,
    message: getErrorMessage(error),
    timedOut: error instanceof ExtensionLoadTimeoutError,
  };
}

function makeUnexpectedRefreshError(error: unknown): ExtensionCatalogLoadError {
  return {
    namespace: "internal",
    stage: "refresh",
    message: getErrorMessage(error),
    timedOut: error instanceof ExtensionLoadTimeoutError,
  };
}

async function settle<T>(operation: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: "fulfilled", value: await operation };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

function fallbackSourceHash(source: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < source.length; index++) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

async function extensionSourceRevision(extension: ExtensionInfo, source: string): Promise<string> {
  let digest: string;
  const runtimeCrypto = Reflect.get(globalThis, "crypto") as Crypto | undefined;
  const subtle = runtimeCrypto?.subtle;
  if (subtle != undefined) {
    const bytes = new TextEncoder().encode(source);
    const hash = new Uint8Array(await subtle.digest("SHA-256", bytes));
    digest = Array.from(hash, (value) => value.toString(16).padStart(2, "0")).join("");
  } else {
    // Web Crypto is present in supported browser/Electron contexts. Keep non-secure development
    // contexts functional without retaining complete extension sources solely for identity checks.
    digest = fallbackSourceHash(source);
  }
  return `${extension.id}:${extension.version}:${source.length}:${digest}`;
}

type MessageConverter = RegisterMessageConverterArgs<unknown> & {
  extensionNamespace?: ExtensionNamespace;
};

type ContributionPoints = {
  panels: Record<string, RegisteredPanel>;
  messageConverters: MessageConverter[];
  topicAliasFunctions: TopicAliasFunctions;
  panelSettings: Record<string, Record<string, PanelSettings<unknown>>>;
};

function activateExtension(
  extension: ExtensionInfo,
  unwrappedExtensionSource: string,
  extensionRevision: string,
): { contributionPoints: ContributionPoints; error?: unknown } {
  // registered panels stored by their fully qualified id
  // the fully qualified id is the extension name + panel name
  const panels: Record<string, RegisteredPanel> = {};

  const messageConverters: RegisterMessageConverterArgs<unknown>[] = [];

  const panelSettings: Record<string, Record<string, PanelSettings<unknown>>> = {};

  const topicAliasFunctions: ContributionPoints["topicAliasFunctions"] = [];

  log.debug(`Activating extension ${extension.qualifiedName}`);

  const module = { exports: {} };
  const require = (name: string) => {
    return { react: React, "react-dom": ReactDOM }[name];
  };

  const extensionMode =
    process.env.NODE_ENV === "production"
      ? "production"
      : process.env.NODE_ENV === "test"
        ? "test"
        : "development";

  const ctx: ExtensionContext = {
    mode: extensionMode,

    registerPanel: (params) => {
      log.debug(`Extension ${extension.qualifiedName} registering panel: ${params.name}`);

      const fullId = `${extension.qualifiedName}.${params.name}`;
      if (panels[fullId]) {
        log.warn(`Panel ${fullId} is already registered`);
        return;
      }

      panels[fullId] = {
        extensionName: extension.qualifiedName,
        extensionNamespace: extension.namespace,
        extensionRevision,
        registration: params,
      };
    },

    registerMessageConverter: <Src,>(args: RegisterMessageConverterArgs<Src>) => {
      log.debug(
        `Extension ${extension.qualifiedName} registering message converter from: ${args.fromSchemaName} to: ${args.toSchemaName}`,
      );
      messageConverters.push({
        ...args,
        extensionNamespace: extension.namespace,
      } as MessageConverter);

      const converterSettings = _.mapValues(args.panelSettings, (settings) => ({
        [args.fromSchemaName]: settings,
      }));

      _.merge(panelSettings, converterSettings);
    },

    registerTopicAliases: (aliasFunction: TopicAliasFunction) => {
      topicAliasFunctions.push({ aliasFunction, extensionId: extension.id });
    },
  };

  try {
    // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
    const fn = new Function("module", "require", unwrappedExtensionSource);

    // load the extension module exports
    fn(module, require, {});
    const wrappedExtensionModule = module.exports as ExtensionModule;

    wrappedExtensionModule.activate(ctx);
  } catch (err) {
    log.error(err);
    return {
      contributionPoints: {
        panels,
        messageConverters,
        topicAliasFunctions,
        panelSettings,
      },
      error: err,
    };
  }

  return {
    contributionPoints: {
      panels,
      messageConverters,
      topicAliasFunctions,
      panelSettings,
    },
  };
}

function createExtensionRegistryStore(
  loaders: readonly ExtensionLoader[],
  mockMessageConverters: readonly RegisterMessageConverterArgs<unknown>[] | undefined,
): StoreApi<ExtensionCatalog> {
  let refreshGeneration = 0;
  // Extension contribution overrides are order-sensitive. Keep this ordering internal so callers
  // cannot accidentally allow organization extensions to override locally installed extensions.
  const orderedLoaders = [
    ...loaders.filter((loader) => loader.namespace === "org"),
    ...loaders.filter((loader) => loader.namespace === "local"),
  ];

  return createStore((set, get) => ({
    downloadExtension: async (url: string) => {
      const res = await fetch(url);
      return new Uint8Array(await res.arrayBuffer());
    },

    installExtension: async (namespace: ExtensionNamespace, coeFileData: Uint8Array) => {
      const namespacedLoader = orderedLoaders.find((loader) => loader.namespace === namespace);
      if (namespacedLoader == undefined) {
        throw new Error("No extension loader found for namespace " + namespace);
      }
      const info = await namespacedLoader.installExtension(coeFileData);
      await get().refreshExtensions();
      return info;
    },

    refreshExtensions: async () => {
      const generation = ++refreshGeneration;

      if (orderedLoaders.length === 0) {
        set({ loadState: "ready", loadErrors: [], installedExtensions: [] });
        return;
      }

      set({ loadState: "loading", loadErrors: [] });
      try {
        const start = performance.now();
        const extensionList: ExtensionInfo[] = [];
        const loadErrors: ExtensionCatalogLoadError[] = [];
        const allContributionPoints: ContributionPoints = {
          panels: {},
          messageConverters: [],
          topicAliasFunctions: [],
          panelSettings: {},
        };

        const listDeadline = createDeadline(
          EXTENSION_LIST_DEADLINE_MS,
          "Timed out listing extensions",
        );
        let listResults: PromiseSettledResult<ExtensionInfo[]>[];
        try {
          const listRequests = orderedLoaders.map(
            async (loader) =>
              await race([
                Promise.resolve().then(async () => await loader.getExtensions()),
                listDeadline.promise,
              ]),
          );
          listResults = await Promise.allSettled(listRequests);
        } finally {
          listDeadline.clear();
        }

        if (generation !== refreshGeneration) {
          return;
        }

        const listedExtensions: { loader: ExtensionLoader; extension: ExtensionInfo }[] = [];
        for (let loaderIndex = 0; loaderIndex < orderedLoaders.length; loaderIndex++) {
          const loader = orderedLoaders[loaderIndex]!;
          const listResult = listResults[loaderIndex]!;
          if (listResult.status === "rejected") {
            const error = makeLoadError(loader, "list", listResult.reason);
            loadErrors.push(error);
            log.error("Error loading extension list", error);
            continue;
          }

          if (!Array.isArray(listResult.value)) {
            const error = makeLoadError(
              loader,
              "list",
              new TypeError("Extension loader returned a non-array extension list"),
            );
            loadErrors.push(error);
            log.error("Invalid extension list", error);
            continue;
          }

          for (const extension of listResult.value) {
            extensionList.push(extension);
            listedExtensions.push({ loader, extension });
          }
        }

        // Keep source work bounded: extension archives can expand into large strings, so retaining
        // every source until the slowest load finishes creates an avoidable all-extensions memory
        // spike. A small look-ahead preserves concurrency while activation and release remain in the
        // original org -> local order.
        type LoadedSource = { source: string; revision: string };
        const sourceLoads = new Map<number, Promise<PromiseSettledResult<LoadedSource>>>();
        const startSourceLoad = (extensionIndex: number) => {
          const { loader, extension } = listedExtensions[extensionIndex]!;
          sourceLoads.set(
            extensionIndex,
            settle(
              withTimeout(
                Promise.resolve().then(async () => {
                  const source = await loader.loadExtension(extension.id);
                  return {
                    source,
                    revision: await extensionSourceRevision(extension, source),
                  };
                }),
                EXTENSION_LOAD_DEADLINE_MS,
                `Timed out loading extension ${extension.id}`,
              ),
            ),
          );
        };
        for (
          let extensionIndex = 0;
          extensionIndex < Math.min(EXTENSION_LOAD_CONCURRENCY, listedExtensions.length);
          extensionIndex++
        ) {
          startSourceLoad(extensionIndex);
        }
        for (let extensionIndex = 0; extensionIndex < listedExtensions.length; extensionIndex++) {
          const { loader, extension } = listedExtensions[extensionIndex]!;
          const sourceResult = await sourceLoads.get(extensionIndex)!;
          sourceLoads.delete(extensionIndex);
          if (generation !== refreshGeneration) {
            return;
          }
          const nextExtensionIndex = extensionIndex + EXTENSION_LOAD_CONCURRENCY;
          if (nextExtensionIndex < listedExtensions.length) {
            startSourceLoad(nextExtensionIndex);
          }
          if (sourceResult.status === "rejected") {
            const error = makeLoadError(loader, "load", sourceResult.reason, extension.id);
            loadErrors.push(error);
            log.error("Error loading extension", error);
            continue;
          }

          const activationResult = activateExtension(
            extension,
            sourceResult.value.source,
            sourceResult.value.revision,
          );
          if ("error" in activationResult) {
            loadErrors.push(
              makeLoadError(loader, "activate", activationResult.error, extension.id),
            );
            continue;
          }
          const contributionPoints = activationResult.contributionPoints;
          Object.assign(allContributionPoints.panels, contributionPoints.panels);
          _.merge(allContributionPoints.panelSettings, contributionPoints.panelSettings);
          allContributionPoints.messageConverters.push(...contributionPoints.messageConverters);
          allContributionPoints.topicAliasFunctions.push(...contributionPoints.topicAliasFunctions);
        }

        if (generation !== refreshGeneration) {
          return;
        }

        log.info(
          `Loaded ${extensionList.length} extensions in ${(performance.now() - start).toFixed(1)}ms`,
        );
        set({
          loadState: loadErrors.length === 0 ? "ready" : "degraded",
          loadErrors,
          installedExtensions: extensionList,
          installedPanels: allContributionPoints.panels,
          installedMessageConverters: allContributionPoints.messageConverters,
          installedTopicAliasFunctions: allContributionPoints.topicAliasFunctions,
          panelSettings: allContributionPoints.panelSettings,
        });
      } catch (error) {
        if (generation === refreshGeneration) {
          const loadError = makeUnexpectedRefreshError(error);
          log.error("Unexpected error refreshing extensions", loadError);
          // Preserve the last successfully published catalog. On the initial load the built-in
          // catalog remains available and the settings UI exposes the same refresh action as retry.
          set({ loadState: "degraded", loadErrors: [loadError] });
        }
        throw error;
      }
    },

    // If there are no loaders then we know there will not be any installed extensions
    installedExtensions: orderedLoaders.length === 0 ? [] : undefined,

    loadState: orderedLoaders.length === 0 ? "ready" : "loading",

    loadErrors: [],

    installedPanels: {},

    installedMessageConverters: mockMessageConverters ?? [],

    installedTopicAliasFunctions: [],

    panelSettings: _.merge(
      {},
      ...(mockMessageConverters ?? []).map(({ fromSchemaName, panelSettings }) =>
        _.mapValues(panelSettings, (settings) => ({ [fromSchemaName]: settings })),
      ),
    ),

    uninstallExtension: async (namespace: ExtensionNamespace, id: string) => {
      const namespacedLoader = orderedLoaders.find((loader) => loader.namespace === namespace);
      if (namespacedLoader == undefined) {
        throw new Error("No extension loader found for namespace " + namespace);
      }
      await namespacedLoader.uninstallExtension(id);
      await get().refreshExtensions();
    },
  }));
}

export default function ExtensionCatalogProvider({
  children,
  loaders,
  mockMessageConverters,
}: PropsWithChildren<{
  loaders: readonly ExtensionLoader[];
  mockMessageConverters?: readonly RegisterMessageConverterArgs<unknown>[];
}>): React.JSX.Element {
  const [store] = useState(createExtensionRegistryStore(loaders, mockMessageConverters));

  // Request an initial refresh on first mount
  const refreshExtensions = store.getState().refreshExtensions;
  useEffect(() => {
    refreshExtensions().catch((err: unknown) => {
      log.error(err);
    });
  }, [refreshExtensions]);

  return (
    <ExtensionCatalogContext.Provider value={store}>{children}</ExtensionCatalogContext.Provider>
  );
}
