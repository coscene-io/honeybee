#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Credential from "@alicloud/credentials";
import Esa20240910 from "@alicloud/esa20240910";
import OpenApi from "@alicloud/openapi-client";
import TeaUtil from "@alicloud/tea-util";
import JSZip from "jszip";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ASSETS_SINGLE_FILE_LIMIT_BYTES = 25 * 1024 * 1024;
const BUILD_STATUS_TIMEOUT_MS = 5 * 60 * 1000;
const BUILD_STATUS_INTERVAL_MS = 1000;

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);

const routineName = process.env.ESA_ROUTINE_NAME;
const routineDescription =
  process.env.ESA_ROUTINE_DESCRIPTION ?? "Honeybee web ESA static deployment";
const assetsPath = path.resolve(
  process.env.ESA_ASSETS_PATH ?? path.join(currentDirPath, "..", "web", ".webpack"),
);
const siteId = process.env.ESA_SITE_ID ? Number(process.env.ESA_SITE_ID) : undefined;
const esaDomain = process.env.ESA_DOMAIN ?? "viewer.coscene.cn";
const routeName = process.env.ESA_ROUTE_NAME ?? "viewer-coscene-cn";
const routeRule = process.env.ESA_ROUTE_RULE ?? `(http.host eq "${esaDomain}")`;

function log(message) {
  console.warn(message);
}

function assertRequiredEnv(name) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function configureAliyunCredentials() {
  assertRequiredEnv("ESA_ACCESS_KEY");
  assertRequiredEnv("ESA_SECRET_KEY");
  process.env.ALIBABA_CLOUD_ACCESS_KEY_ID = process.env.ESA_ACCESS_KEY;
  process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET = process.env.ESA_SECRET_KEY;
}

function formatError(error) {
  const parts = [
    `message=${error?.message ?? "(none)"}`,
    `code=${error?.code ?? error?.data?.Code ?? "(none)"}`,
    `statusCode=${
      error?.statusCode ??
      error?.status ??
      error?.data?.statusCode ??
      error?.data?.httpCode ??
      "(none)"
    }`,
  ];

  if (error?.data) {
    parts.push(`data=${JSON.stringify(error.data)}`);
  }

  return parts.join(" ");
}

function getErrorCode(error) {
  return error?.code ?? error?.data?.Code;
}

function getErrorStatusCode(error) {
  return error?.statusCode ?? error?.status ?? error?.data?.statusCode ?? error?.data?.httpCode;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isErServiceEnabled(status) {
  return ["online", "running"].includes((status ?? "").toLowerCase());
}

function createClient() {
  const credential = new Credential.default();
  const config = new OpenApi.Config({
    credential,
    endpoint: "esa.cn-hangzhou.aliyuncs.com",
    userAgent: "coscene-honeybee-esa-deploy",
  });
  return new Esa20240910.default(config);
}

async function ensureServiceEnabled(client) {
  const status = await client.getErService(new Esa20240910.GetErServiceRequest({}));
  if (isErServiceEnabled(status.body?.status)) {
    log(`Edge Routine service is ${status.body.status}.`);
    return;
  }

  log(`Edge Routine service status is ${status.body?.status ?? "(unknown)"}; enabling...`);
  try {
    await client.openErService(new Esa20240910.OpenErServiceRequest({}));
  } catch (error) {
    if (getErrorCode(error) !== "ErService.HasOpened") {
      throw error;
    }
    log("Edge Routine service is already activated.");
  }

  const recheck = await client.getErService(new Esa20240910.GetErServiceRequest({}));
  if (!isErServiceEnabled(recheck.body?.status)) {
    throw new Error(
      `Failed to enable Edge Routine service; current status is ${
        recheck.body?.status ?? "(unknown)"
      }`,
    );
  }

  log("Edge Routine service enabled.");
}

async function createOrVerifyRoutine(client) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await client.createRoutine(
        new Esa20240910.CreateRoutineRequest({
          name: routineName,
          description: routineDescription,
          hasAssets: true,
        }),
      );
      log(`Created ESA routine: ${routineName}`);
      return;
    } catch (error) {
      const code = getErrorCode(error);
      const statusCode = getErrorStatusCode(error);

      if (
        statusCode === 400 &&
        ["RoutineNameAlreadyExists", "RoutineAlreadyExist"].includes(code)
      ) {
        log(`ESA routine already exists: ${routineName}`);
        return;
      }

      if (code === "Throttling.Api" && attempt < 3) {
        log(`CreateRoutine throttled; retrying in 2s (attempt ${attempt + 1}/3)...`);
        await sleep(2000);
        continue;
      }

      throw new Error(`CreateRoutine failed: ${formatError(error)}`);
    }
  }
}

function collectAssetFiles(dir, relativeDir = "") {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...collectAssetFiles(fullPath, relativePath));
      continue;
    }

    if (entry.isFile()) {
      files.push({ fullPath, relativePath });
    }
  }
  return files;
}

function validateAssets() {
  if (!fs.existsSync(assetsPath) || !fs.statSync(assetsPath).isDirectory()) {
    throw new Error(`ESA assets path is not a directory: ${assetsPath}`);
  }

  const files = collectAssetFiles(assetsPath);
  if (files.length === 0) {
    throw new Error(`ESA assets path is empty: ${assetsPath}`);
  }

  if (!files.some((file) => file.relativePath === "index.html")) {
    throw new Error(`ESA assets path must contain index.html: ${assetsPath}`);
  }

  if (!files.some((file) => file.relativePath.endsWith(".js"))) {
    throw new Error(`ESA assets path must contain JavaScript build artifacts: ${assetsPath}`);
  }

  for (const file of files) {
    const size = fs.statSync(file.fullPath).size;
    if (size > ASSETS_SINGLE_FILE_LIMIT_BYTES) {
      throw new Error(
        `ESA asset exceeds 25MB single-file limit: ${file.relativePath} (${size} bytes)`,
      );
    }
  }

  log(`Validated ${files.length} ESA asset files from ${assetsPath}`);
  return files;
}

async function createAssetsCodeVersion(client, runtime) {
  const result = await client.createRoutineWithAssetsCodeVersionWithOptions(
    new Esa20240910.CreateRoutineWithAssetsCodeVersionRequest({
      name: routineName,
      codeDescription: routineDescription,
    }),
    runtime,
  );

  const ossPostConfig = result.body?.ossPostConfig ?? result.body?.OssPostConfig;
  const codeVersion = result.body?.codeVersion ?? result.body?.CodeVersion;
  if (!ossPostConfig || !codeVersion) {
    throw new Error(
      `CreateRoutineWithAssetsCodeVersion returned incomplete response fields: ${Object.keys(
        result.body ?? {},
      ).join(", ")}`,
    );
  }

  log(`Created ESA assets code version: ${codeVersion}`);
  return { ossPostConfig, codeVersion };
}

function normalizeOssPostConfig(ossPostConfig) {
  const normalized = {
    OSSAccessKeyId: ossPostConfig.OSSAccessKeyId,
    signature: ossPostConfig.signature ?? ossPostConfig.Signature,
    policy: ossPostConfig.policy ?? ossPostConfig.Policy,
    key: ossPostConfig.key ?? ossPostConfig.Key,
    url: ossPostConfig.url ?? ossPostConfig.Url,
    XOssSecurityToken: ossPostConfig.XOssSecurityToken,
  };
  const missingFields = Object.entries(normalized)
    .filter(([name, value]) => name !== "XOssSecurityToken" && !value)
    .map(([name]) => name);
  if (missingFields.length > 0) {
    throw new Error(`OSS post config is missing required fields: ${missingFields.join(", ")}`);
  }
  return normalized;
}

async function uploadAssets(ossPostConfig, files) {
  const normalizedOssPostConfig = normalizeOssPostConfig(ossPostConfig);
  const zip = new JSZip();
  for (const file of files) {
    zip.file(`assets/${file.relativePath}`, fs.readFileSync(file.fullPath));
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  log(`Packaged ESA assets zip: ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`);

  const formData = new FormData();
  formData.append("OSSAccessKeyId", normalizedOssPostConfig.OSSAccessKeyId);
  formData.append("Signature", normalizedOssPostConfig.signature);
  formData.append("policy", normalizedOssPostConfig.policy);
  formData.append("key", normalizedOssPostConfig.key);
  if (normalizedOssPostConfig.XOssSecurityToken) {
    formData.append("x-oss-security-token", normalizedOssPostConfig.XOssSecurityToken);
  }
  formData.append("file", new Blob([zipBuffer]), "assets.zip");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(normalizedOssPostConfig.url, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OSS upload failed with HTTP ${response.status}: ${await response.text()}`);
    }
  } finally {
    clearTimeout(timeout);
  }

  log("Uploaded ESA assets zip to OSS.");
}

async function waitForCodeVersion(client, runtime, codeVersion) {
  const startedAt = Date.now();
  const params = new OpenApi.Params({
    action: "GetRoutineCodeVersionInfo",
    version: "2024-09-10",
    protocol: "https",
    method: "GET",
    authType: "AK",
    bodyType: "json",
    reqBodyType: "json",
    style: "RPC",
    pathname: "/",
  });

  while (Date.now() - startedAt < BUILD_STATUS_TIMEOUT_MS) {
    const info = await client.callApi(
      params,
      new OpenApi.OpenApiRequest({
        query: { Name: routineName, CodeVersion: codeVersion },
      }),
      runtime,
    );

    const status = (info.body?.Status ?? "").toLowerCase();
    if (status === "available") {
      log(`ESA code version is available: ${codeVersion}`);
      return;
    }

    if (status && status !== "init") {
      throw new Error(`ESA code version build failed with status: ${status}`);
    }

    process.stdout.write(".");
    await sleep(BUILD_STATUS_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for ESA code version to become available: ${codeVersion}`);
}

async function deployCodeVersion(client, runtime, codeVersion) {
  await client.createRoutineCodeDeploymentWithOptions(
    new Esa20240910.CreateRoutineCodeDeploymentRequest({
      name: routineName,
      env: "production",
      strategy: "percentage",
      codeVersions: [
        new Esa20240910.CreateRoutineCodeDeploymentRequestCodeVersions({
          percentage: 100,
          codeVersion,
        }),
      ],
    }),
    runtime,
  );

  log(`Deployed ESA code version ${codeVersion} to production.`);
}

async function getRoutineAccessUrl(client, runtime) {
  const routine = await client.getRoutine(new Esa20240910.GetRoutineRequest({ name: routineName }));
  const defaultRecord = routine.body?.defaultRelatedRecord;
  if (!defaultRecord) {
    return undefined;
  }

  const tokenResponse = await client.getRoutineAccessTokenWithOptions(
    new Esa20240910.GetRoutineAccessTokenRequest({ name: routineName }),
    runtime,
  );
  const token = tokenResponse.body?.token ?? tokenResponse.body?.Token;
  return token ? `https://${defaultRecord}?esa_er_token=${token}` : `https://${defaultRecord}`;
}

function getRoutesFromResponse(response) {
  return (
    response.body?.routes ??
    response.body?.Routes ??
    response.body?.configs ??
    response.body?.Configs ??
    response.body?.routineRoutes ??
    response.body?.RoutineRoutes ??
    []
  );
}

function getRouteField(route, field) {
  const pascalField = `${field[0].toUpperCase()}${field.slice(1)}`;
  return route[field] ?? route[pascalField];
}

function getRouteConfigId(route) {
  const rawConfigId = getRouteField(route, "configId");
  const configId = typeof rawConfigId === "number" ? rawConfigId : Number(rawConfigId);
  return Number.isFinite(configId) ? configId : undefined;
}

function getRelatedRecordsFromResponse(response) {
  return response.body?.relatedRecords ?? response.body?.RelatedRecords ?? [];
}

function getRelatedRecordField(relatedRecord, field) {
  const pascalField = `${field[0].toUpperCase()}${field.slice(1)}`;
  return relatedRecord[field] ?? relatedRecord[pascalField];
}

function findRoute(routes) {
  return routes.find((route) => {
    const existingName = getRouteField(route, "routeName");
    const existingRule = getRouteField(route, "rule");
    return existingName === routeName || existingRule === routeRule;
  });
}

function findRelatedRecord(relatedRecords) {
  return relatedRecords.find((relatedRecord) => {
    const existingRecordName = getRelatedRecordField(relatedRecord, "recordName");
    return existingRecordName === esaDomain;
  });
}

function validateRouteShape(route) {
  const existingName = getRouteField(route, "routeName");
  const existingRule = getRouteField(route, "rule");
  const existingEnabled = getRouteField(route, "routeEnable");
  const existingBypass = getRouteField(route, "bypass");

  if (existingName === routeName && existingRule !== routeRule) {
    throw new Error(
      `ESA route ${routeName} exists with unexpected rule ${existingRule}; expected ${routeRule}`,
    );
  }
  if (existingEnabled && existingEnabled !== "on") {
    throw new Error(`ESA route ${existingName} is not enabled; RouteEnable=${existingEnabled}`);
  }
  if (existingBypass && existingBypass !== "off") {
    throw new Error(
      `ESA route ${existingName} has unexpected Bypass=${existingBypass}; expected off`,
    );
  }
}

function validateRelatedRecordShape(relatedRecord) {
  const existingRecordName = getRelatedRecordField(relatedRecord, "recordName");
  const existingSiteId = getRelatedRecordField(relatedRecord, "siteId");

  if (existingRecordName !== esaDomain) {
    throw new Error(
      `ESA related record has unexpected domain ${existingRecordName}; expected ${esaDomain}`,
    );
  }

  if (siteId && existingSiteId && Number(existingSiteId) !== siteId) {
    throw new Error(
      `ESA related record ${esaDomain} is bound to unexpected SiteId ${existingSiteId}; expected ${siteId}`,
    );
  }
}

async function listRoutineRelatedRecords(client) {
  const relatedRecords = [];
  const pageSize = 500;
  let pageNumber = 1;
  let totalCount = 0;

  do {
    const response = await client.listRoutineRelatedRecords(
      new Esa20240910.ListRoutineRelatedRecordsRequest({
        name: routineName,
        pageNumber,
        pageSize,
      }),
    );
    relatedRecords.push(...getRelatedRecordsFromResponse(response));
    totalCount = Number(response.body?.totalCount ?? response.body?.TotalCount ?? 0);
    pageNumber++;
  } while (relatedRecords.length < totalCount);

  return relatedRecords;
}

async function ensureRelatedRecord(client) {
  if (process.env.ESA_SITE_ID && !Number.isFinite(siteId)) {
    throw new Error(`ESA_SITE_ID must be a number; received ${process.env.ESA_SITE_ID}`);
  }

  if (!siteId) {
    log("ESA_SITE_ID is not set; skipping custom domain binding.");
    return;
  }

  const existingRelatedRecord = findRelatedRecord(await listRoutineRelatedRecords(client));
  if (existingRelatedRecord) {
    validateRelatedRecordShape(existingRelatedRecord);
    log(`ESA domain binding already exists for ${esaDomain}.`);
    return;
  }

  try {
    await client.createRoutineRelatedRecord(
      new Esa20240910.CreateRoutineRelatedRecordRequest({
        name: routineName,
        recordName: esaDomain,
        siteId,
      }),
    );
  } catch (error) {
    const retryRelatedRecord = findRelatedRecord(await listRoutineRelatedRecords(client));
    if (!retryRelatedRecord) {
      throw new Error(`CreateRoutineRelatedRecord failed: ${formatError(error)}`);
    }

    validateRelatedRecordShape(retryRelatedRecord);
    log(`ESA domain binding already exists for ${esaDomain}.`);
    return;
  }

  log(`Created ESA domain binding for ${esaDomain}.`);
}

async function listSiteRoutes(client) {
  const routes = [];
  const pageSize = 500;
  let pageNumber = 1;
  let totalPage = 1;

  do {
    const response = await client.listSiteRoutes(
      new Esa20240910.ListSiteRoutesRequest({
        siteId,
        pageNumber,
        pageSize,
      }),
    );
    routes.push(...getRoutesFromResponse(response));
    totalPage = Number(response.body?.totalPage ?? response.body?.TotalPage ?? 1);
    pageNumber++;
  } while (pageNumber <= totalPage);

  return routes;
}

async function updateRoute(client, route) {
  validateRouteShape(route);
  const configId = getRouteConfigId(route);
  if (!configId) {
    throw new Error(`ESA route ${routeName} is missing ConfigId; cannot update route`);
  }

  await client.updateRoutineRoute(
    new Esa20240910.UpdateRoutineRouteRequest({
      siteId,
      configId,
      routineName,
      routeName,
      rule: routeRule,
      routeEnable: "on",
      bypass: "off",
    }),
  );

  log(`Updated ESA route ${routeName} to routine ${routineName}: ${routeRule}`);
}

async function ensureRoute(client) {
  if (process.env.ESA_SITE_ID && !Number.isFinite(siteId)) {
    throw new Error(`ESA_SITE_ID must be a number; received ${process.env.ESA_SITE_ID}`);
  }

  if (!siteId) {
    log("ESA_SITE_ID is not set; skipping custom domain route setup.");
    return;
  }

  const routesResponse = await client.listRoutineRoutes(
    new Esa20240910.ListRoutineRoutesRequest({ routineName }),
  );
  const routes = getRoutesFromResponse(routesResponse);
  const existingRoute = findRoute(routes);

  if (existingRoute) {
    validateRouteShape(existingRoute);
    log(`ESA route already exists for ${routeRule}.`);
    return;
  }

  const existingSiteRoute = findRoute(await listSiteRoutes(client));
  if (existingSiteRoute) {
    await updateRoute(client, existingSiteRoute);
    return;
  }

  try {
    await client.createRoutineRoute(
      new Esa20240910.CreateRoutineRouteRequest({
        siteId,
        routineName,
        routeName,
        rule: routeRule,
        routeEnable: "on",
        bypass: "off",
      }),
    );
  } catch (error) {
    if (getErrorCode(error) !== "ConfigConflicts") {
      throw error;
    }

    const conflictingRoute = findRoute(await listSiteRoutes(client));
    if (!conflictingRoute) {
      throw new Error(`CreateRoutineRoute failed: ${formatError(error)}`);
    }

    await updateRoute(client, conflictingRoute);
    return;
  }

  log(`Created ESA route ${routeName}: ${routeRule}`);
}

async function main() {
  configureAliyunCredentials();
  assertRequiredEnv("ESA_ROUTINE_NAME");

  const files = validateAssets();
  const client = createClient();
  const runtime = new TeaUtil.RuntimeOptions({});

  await ensureServiceEnabled(client);
  await createOrVerifyRoutine(client);
  const { ossPostConfig, codeVersion } = await createAssetsCodeVersion(client, runtime);
  await uploadAssets(ossPostConfig, files);
  await waitForCodeVersion(client, runtime, codeVersion);
  await deployCodeVersion(client, runtime, codeVersion);
  await ensureRelatedRecord(client);
  await ensureRoute(client);

  const defaultAccessUrl = await getRoutineAccessUrl(client, runtime);
  if (defaultAccessUrl) {
    log(`Default ESA access URL (token valid for 1 hour): ${defaultAccessUrl}`);
  }
  log(`Custom domain URL: https://${esaDomain}/`);
}

main().catch((error) => {
  console.error(`ESA deployment failed: ${formatError(error)}`);
  process.exit(1);
});
