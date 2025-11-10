// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import Logger from "@foxglove/log";
import { useCurrentUser, UserStore } from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
import {
  DataSourceArgs,
  usePlayerSelection,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import {
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@foxglove/studio-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@foxglove/studio-base/context/Workspace/useWorkspaceActions";
import { useInitialDeepLinkState } from "@foxglove/studio-base/hooks/useCoSceneInitialDeepLinkState";
import { getDomainConfig } from "@foxglove/studio-base/util/appConfig";
import { parseAppURLState } from "@foxglove/studio-base/util/appURLState";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

const log = Logger.getLogger(__filename);

const selectUser = (store: UserStore) => store.user;
const selectUserLoginStatus = (store: UserStore) => store.loginStatus;
const selectWorkspaceDataSourceDialog = (store: WorkspaceContextStore) => store.dialogs.dataSource;
const selectSelectEvent = (store: EventsStore) => store.selectEvent;

const DEFAULT_DEEPLINKS = Object.freeze([]);

export function DeepLinksSyncAdapter({
  deepLinks = DEFAULT_DEEPLINKS,
}: {
  deepLinks?: readonly string[];
}): ReactNull {
  const { t } = useTranslation("workspace");
  const domainConfig = getDomainConfig();

  const { selectSource } = usePlayerSelection();
  const currentUser = useCurrentUser(selectUser);
  const loginStatus = useCurrentUser(selectUserLoginStatus);
  const dataSourceDialog = useWorkspaceStore(selectWorkspaceDataSourceDialog);
  const { dialogActions } = useWorkspaceActions();
  const selectEvent = useEvents(selectSelectEvent);

  // Initialize deep link state - must be called inside SourceArgsSyncAdapter
  useInitialDeepLinkState(deepLinks);

  const targetUrlState = useMemo(() => {
    if (deepLinks[0] == undefined) {
      return undefined;
    }

    const url = new URL(deepLinks[0]);
    const parsedUrl = parseAppURLState(url);

    if (
      isDesktopApp() &&
      parsedUrl?.ds === "coscene-data-platform" &&
      url.hostname !== domainConfig.webDomain
    ) {
      dialogActions.dataSource.close();
      setTimeout(() => {
        toast.error(t("invalidDomain", { domain: domainConfig.webDomain }));
      }, 1000);
      return undefined;
    }

    return parsedUrl;
  }, [deepLinks, t, domainConfig.webDomain, dialogActions.dataSource]);

  const [unappliedSourceArgs, setUnappliedSourceArgs] = useState(
    targetUrlState ? { ds: targetUrlState.ds, dsParams: targetUrlState.dsParams } : undefined,
  );

  // Ensure that the data source is initialised only once
  const currentSource = useRef<(DataSourceArgs & { id: string }) | undefined>(undefined);

  const debouncedPleaseLoginFirstToast = useMemo(() => {
    return _.debounce(() => {
      toast.error(t("pleaseLoginFirst", { ns: "openDialog" }));
      setTimeout(() => {
        if (isDesktopApp()) {
          window.open(`https://${domainConfig.webDomain}/studio/login`);
        } else {
          // In web environment, navigate to login page with redirect
          window.location.href = `/login?redirectToPath=${encodeURIComponent(
            window.location.pathname + window.location.search,
          )}`;
        }
      }, 500);
    }, 1000);
  }, [t, domainConfig.webDomain]);

  // Load data source from URL.
  useEffect(() => {
    if (unappliedSourceArgs?.ds == undefined) {
      return;
    }

    if (dataSourceDialog.open) {
      dialogActions.dataSource.close();
    }

    if (loginStatus === "notLogin" && unappliedSourceArgs.ds === "coscene-data-platform") {
      debouncedPleaseLoginFirstToast();
      setUnappliedSourceArgs(undefined);
      return;
    }

    // sync user info need time, so in some case, loginStatus is alreadyLogin but currentUser is undefined
    if (currentUser?.userId == undefined) {
      return;
    }

    // Apply any available data source args
    log.debug("Initialising source from url", unappliedSourceArgs);
    const sourceParams: DataSourceArgs = {
      type: "connection",
      params: {
        ...currentUser,
        ...unappliedSourceArgs.dsParams,
      },
    };

    if (_.isEqual({ id: unappliedSourceArgs.ds, ...sourceParams }, currentSource.current)) {
      return;
    }

    currentSource.current = { id: unappliedSourceArgs.ds, ...sourceParams };

    selectSource(unappliedSourceArgs.ds, sourceParams);

    selectEvent(unappliedSourceArgs.dsParams?.eventId);
    setUnappliedSourceArgs({ ds: undefined, dsParams: undefined });
  }, [
    currentUser,
    selectEvent,
    selectSource,
    unappliedSourceArgs,
    setUnappliedSourceArgs,
    currentSource,
    loginStatus,
    t,
    dialogActions.dataSource,
    dataSourceDialog.open,
    debouncedPleaseLoginFirstToast,
  ]);

  return ReactNull;
}
