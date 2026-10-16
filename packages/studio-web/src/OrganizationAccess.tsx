// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getDomainConfig, getWebBasePathname } from "@foxglove/studio-base/util/appConfig";
import { getBrowserAuthUrl } from "@foxglove/studio-base/util/browserSession";

export type Organization = { name: string; displayName: string };
export type OrganizationAccess = {
  status:
    | "loading"
    | "ready"
    | "organization-mismatch"
    | "organization-unavailable"
    | "denied"
    | "unavailable"
    | "error"
    | "login";
  organization?: Organization;
  currentOrganization?: Organization;
};

export function getOrganizationSwitchUrl(organization?: Organization): string {
  const login = new URL(getBrowserAuthUrl("/auth/login"), window.location.href);
  const target = new URL("/switch-organization", login.origin);
  target.searchParams.set("returnTo", login.searchParams.get("redirectToPath") ?? "/");
  if (organization) target.searchParams.set("organization", organization.name);
  return target.href;
}

/** A separate, metadata-only request. It must never use a stale session API client. */
export async function fetchOrganizationAccess(
  baseUrl: string,
  key: string,
  credential: string,
  signal: AbortSignal,
): Promise<OrganizationAccess> {
  if (!credential) return { status: "login" };
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/bff/shortenUrl/${encodeURIComponent(key)}/access`,
    {
      headers: { Authorization: credential },
      signal,
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (response.status === 401) return { status: "login" };
  if (response.status === 403) return { status: "denied" };
  if (response.status === 404) return { status: "unavailable" };
  if (!response.ok) throw new Error("Access check failed");
  const result = (await response.json()) as OrganizationAccess;
  if (!["ready", "organization-mismatch", "organization-unavailable"].includes(result.status))
    throw new Error("Invalid access response");
  if (
    result.status === "organization-mismatch" &&
    (!result.organization ||
      !/^organizations\/[\w-]+$/.test(result.organization.name) ||
      typeof result.organization.displayName !== "string")
  )
    throw new Error("Invalid organization response");
  return result;
}

export function OrganizationAccessView({
  access,
  changed,
  modal,
  recovery,
  onRetry,
}: {
  access: OrganizationAccess;
  changed: boolean;
  modal: boolean;
  recovery?: "recover" | "logged-out";
  onRetry: () => void;
}): React.JSX.Element {
  const { t } = useTranslation("appBar");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // If the browser's unsaved-edit confirmation cancels navigation, the action
    // must remain available. A confirmed navigation will discard this document.
    const reset = () => {
      setBusy(false);
    };
    window.addEventListener("beforeunload", reset);
    return () => {
      window.removeEventListener("beforeunload", reset);
    };
  }, []);
  const mismatch = access.status === "organization-mismatch";
  const login = recovery != undefined || access.status === "login";
  const loading = access.status === "loading" && !login;
  const title = login
    ? t(recovery === "logged-out" ? "sessionLoggedOut" : "sessionRecoveryRequired")
    : loading
      ? t("checkingOrganization")
      : mismatch
        ? t(changed ? "organizationChanged" : "switchOrganizationTitle")
        : changed && access.status === "ready"
          ? t("sessionChanged")
          : t("linkUnavailableTitle");
  const home = getWebBasePathname() === "/" ? `https://${getDomainConfig().webDomain}/` : "/";
  const accountUrl = new URL(getBrowserAuthUrl("/auth/login"), window.location.href);
  accountUrl.pathname = "/auth/change-account";
  const content = (
    <Stack spacing={3} sx={{ maxWidth: 520, width: "100%", p: 2 }}>
      <Typography variant="overline" color="text.secondary">
        {t("visualization")}
      </Typography>
      <Typography id="organization-access-title" variant="h5">
        {title}
      </Typography>
      {mismatch && (
        <Stack spacing={1}>
          <Typography>
            {t("linkOrganization", { organization: access.organization?.displayName })}
          </Typography>
          {access.currentOrganization && (
            <Typography color="text.secondary">
              {t("currentOrganization", { organization: access.currentOrganization.displayName })}
            </Typography>
          )}
        </Stack>
      )}
      {loading && <CircularProgress size={24} />}
      {access.status === "organization-unavailable" && (
        <Typography>{t("organizationUnavailable")}</Typography>
      )}
      {access.status === "denied" && <Typography>{t("resourceDenied")}</Typography>}
      {access.status === "unavailable" && <Typography>{t("linkUnavailable")}</Typography>}
      {access.status === "error" && <Alert severity="error">{t("accessCheckFailed")}</Alert>}
      {!loading && (
        <Stack direction="row" flexWrap="wrap" gap={1}>
          {login ? (
            <Button
              variant="contained"
              target="_self"
              href={getBrowserAuthUrl(
                recovery === "logged-out" ? "/auth/logged-out" : "/auth/recover",
              )}
            >
              {t("openSessionRecovery")}
            </Button>
          ) : mismatch ? (
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                window.location.assign(getOrganizationSwitchUrl(access.organization));
              }}
            >
              {t(
                busy
                  ? "switchingOrganization"
                  : changed
                    ? "switchBackOrganization"
                    : "switchOrganization",
                { organization: access.organization?.displayName },
              )}
            </Button>
          ) : access.status === "error" ? (
            <Button variant="contained" onClick={onRetry}>
              {t("retryAccessCheck")}
            </Button>
          ) : changed && access.status === "ready" ? (
            <Button
              variant="contained"
              onClick={() => {
                window.location.reload();
              }}
            >
              {t("continueVisualization")}
            </Button>
          ) : access.status === "denied" || access.status === "organization-unavailable" ? (
            <Button variant="contained" target="_self" href={accountUrl.href}>
              {t("useAnotherAccount")}
            </Button>
          ) : (
            <Button variant="contained" target="_self" href={getOrganizationSwitchUrl()}>
              {t("chooseOrganization")}
            </Button>
          )}
          <Button target="_self" href={home}>
            {t("currentOrganizationHome")}
          </Button>
        </Stack>
      )}
      {(mismatch || changed) && (
        <Typography variant="body2" color="text.secondary">
          {t("organizationSwitchAffectsTabs")}
        </Typography>
      )}
    </Stack>
  );
  return modal ? (
    <Dialog
      open
      disableEscapeKeyDown
      aria-labelledby="organization-access-title"
      maxWidth="sm"
      fullWidth
    >
      <DialogContent>{content}</DialogContent>
    </Dialog>
  ) : (
    <Box
      component="main"
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        bgcolor: "background.default",
        color: "text.primary",
        p: 3,
      }}
    >
      {content}
    </Box>
  );
}
