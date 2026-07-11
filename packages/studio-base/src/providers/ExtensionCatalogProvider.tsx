// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import React, { PropsWithChildren, useEffect, useState } from "react";
import * as ReactJSXDevRuntime from "react/jsx-dev-runtime";
import * as ReactJSXRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
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
  RegisteredPanel,
} from "@foxglove/studio-base/context/ExtensionCatalogContext";
import { TopicAliasFunctions } from "@foxglove/studio-base/players/TopicAliasingPlayer/aliasing";
import { ExtensionLoader } from "@foxglove/studio-base/services/ExtensionLoader";
import { ExtensionInfo, ExtensionNamespace } from "@foxglove/studio-base/types/Extensions";

const log = Logger.getLogger(__filename);

type LegacyRootContainer = Parameters<typeof ReactDOMClient.createRoot>[0];
type LegacyRoot = Pick<ReturnType<typeof ReactDOMClient.createRoot>, "render" | "unmount">;
type CreateLegacyRoot = (container: LegacyRootContainer) => LegacyRoot;

export type LegacyReactDOMFacade = Omit<typeof ReactDOM, "render" | "unmountComponentAtNode"> & {
  render: (node: React.ReactNode, container: LegacyRootContainer, callback?: () => void) => void;
  unmountComponentAtNode: (container: LegacyRootContainer) => boolean;
};

/**
 * Temporary compatibility bridge for extensions compiled against the pre-React 19 `react-dom`
 * entrypoint. Roots are deliberately tracked only when they are created through this facade, so
 * an extension cannot unmount roots owned by the host or by `react-dom/client` consumers.
 *
 * This bridge preserves the modern `react-dom` exports, but intentionally does not emulate the
 * legacy render return value, legacy hydration, or callback `this` binding. It can be removed once
 * the supported extension baseline uses `react-dom/client`.
 */
export function createLegacyReactDOMFacade(
  modernReactDOM: typeof ReactDOM,
  createRoot: CreateLegacyRoot = ReactDOMClient.createRoot,
): LegacyReactDOMFacade {
  const roots = new WeakMap<LegacyRootContainer, LegacyRoot>();

  return {
    ...modernReactDOM,
    render: (node, container, callback) => {
      let root = roots.get(container);
      if (root == undefined) {
        root = createRoot(container);
        roots.set(container, root);
      }

      // Extension panels initialize from a layout effect. React 19 rejects flushSync inside that
      // lifecycle, so preserve the legacy synchronous commit at the next safe microtask boundary.
      const scheduledRoot = root;
      queueMicrotask(() => {
        if (roots.get(container) !== scheduledRoot) {
          return;
        }
        modernReactDOM.flushSync(() => {
          scheduledRoot.render(node);
        });
        callback?.();
      });
    },
    unmountComponentAtNode: (container) => {
      const root = roots.get(container);
      if (root == undefined) {
        return false;
      }

      roots.delete(container);
      queueMicrotask(() => {
        root.unmount();
      });
      return true;
    },
  };
}

const legacyReactDOM = createLegacyReactDOMFacade(ReactDOM);
const extensionModules: Readonly<Record<string, unknown>> = Object.freeze({
  react: React,
  "react-dom": legacyReactDOM,
  "react-dom/client": ReactDOMClient,
  "react/jsx-dev-runtime": ReactJSXDevRuntime,
  "react/jsx-runtime": ReactJSXRuntime,
});

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
): ContributionPoints {
  // registered panels stored by their fully qualified id
  // the fully qualified id is the extension name + panel name
  const panels: Record<string, RegisteredPanel> = {};

  const messageConverters: RegisterMessageConverterArgs<unknown>[] = [];

  const panelSettings: Record<string, Record<string, PanelSettings<unknown>>> = {};

  const topicAliasFunctions: ContributionPoints["topicAliasFunctions"] = [];

  log.debug(`Activating extension ${extension.qualifiedName}`);

  const module = { exports: {} };
  const require = (name: string): unknown => extensionModules[name];

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
  }

  return {
    panels,
    messageConverters,
    topicAliasFunctions,
    panelSettings,
  };
}

function createExtensionRegistryStore(
  loaders: readonly ExtensionLoader[],
  mockMessageConverters: readonly RegisterMessageConverterArgs<unknown>[] | undefined,
): StoreApi<ExtensionCatalog> {
  return createStore((set, get) => ({
    downloadExtension: async (url: string) => {
      const res = await fetch(url);
      return new Uint8Array(await res.arrayBuffer());
    },

    installExtension: async (namespace: ExtensionNamespace, coeFileData: Uint8Array) => {
      const namespacedLoader = loaders.find((loader) => loader.namespace === namespace);
      if (namespacedLoader == undefined) {
        throw new Error("No extension loader found for namespace " + namespace);
      }
      const info = await namespacedLoader.installExtension(coeFileData);
      await get().refreshExtensions();
      return info;
    },

    refreshExtensions: async () => {
      if (loaders.length === 0) {
        return;
      }

      const start = performance.now();
      const extensionList: ExtensionInfo[] = [];
      const allContributionPoints: ContributionPoints = {
        panels: {},
        messageConverters: [],
        topicAliasFunctions: [],
        panelSettings: {},
      };
      for (const loader of loaders) {
        try {
          for (const extension of await loader.getExtensions()) {
            try {
              extensionList.push(extension);
              const unwrappedExtensionSource = await loader.loadExtension(extension.id);
              const contributionPoints = activateExtension(extension, unwrappedExtensionSource);
              Object.assign(allContributionPoints.panels, contributionPoints.panels);
              _.merge(allContributionPoints.panelSettings, contributionPoints.panelSettings);
              allContributionPoints.messageConverters.push(...contributionPoints.messageConverters);
              allContributionPoints.topicAliasFunctions.push(
                ...contributionPoints.topicAliasFunctions,
              );
            } catch (err) {
              log.error("Error loading extension", err);
            }
          }
        } catch (err) {
          log.error("Error loading extension list", err);
        }
      }
      log.info(
        `Loaded ${extensionList.length} extensions in ${(performance.now() - start).toFixed(1)}ms`,
      );
      set({
        installedExtensions: extensionList,
        installedPanels: allContributionPoints.panels,
        installedMessageConverters: allContributionPoints.messageConverters,
        installedTopicAliasFunctions: allContributionPoints.topicAliasFunctions,
        panelSettings: allContributionPoints.panelSettings,
      });
    },

    // If there are no loaders then we know there will not be any installed extensions
    installedExtensions: loaders.length === 0 ? [] : undefined,

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
      const namespacedLoader = loaders.find((loader) => loader.namespace === namespace);
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
