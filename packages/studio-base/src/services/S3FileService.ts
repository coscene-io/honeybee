// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  GetObjectCommand,
  HeadObjectCommand,
  HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";

import { getAppConfig } from "@foxglove/studio-base/util/appConfig";

import type CoSceneConsoleApi from "./api/CoSceneConsoleApi";

export type S3GetObjectResult = {
  data: Uint8Array;
  mediaType: string | undefined;
};

/**
 * Service for fetching files from S3 storage.
 * This service manages S3 client credentials and provides methods to fetch files.
 * It does NOT handle caching - callers are responsible for their own caching strategy.
 */
export class S3FileService {
  #consoleApi: CoSceneConsoleApi;
  #s3Client?: { key: string; client: S3Client };

  public constructor(consoleApi: CoSceneConsoleApi) {
    this.#consoleApi = consoleApi;
  }

  /**
   * Ensure S3 client is initialized for the given project
   */
  async #ensureS3Client(project: string): Promise<S3Client> {
    if (this.#s3Client != undefined && this.#s3Client.key === project) {
      return this.#s3Client.client;
    }

    const appConfig = getAppConfig();
    const response = await this.#consoleApi.generateSecurityToken({
      project,
      expireDuration: { seconds: BigInt(60 * 60 * 24 * 30) },
    });

    this.#s3Client = {
      key: project,
      client: new S3Client({
        region: appConfig.S3_REGION,
        endpoint: `https://${response.endpoint}`,
        forcePathStyle: true,
        credentials: {
          accessKeyId: response.accessKeyId,
          secretAccessKey: response.accessKeySecret,
          sessionToken: response.sessionToken,
        },
      }),
    };

    return this.#s3Client.client;
  }

  /**
   * Get object metadata (HEAD request) - useful for cache validation
   * @param project Project name
   * @param key S3 object key
   * @param opts Options including abort signal
   * @returns HeadObjectCommandOutput from S3
   */
  public async headObject(
    project: string,
    key: string,
    opts?: { signal?: AbortSignal },
  ): Promise<HeadObjectCommandOutput> {
    const client = await this.#ensureS3Client(project);

    const command = new HeadObjectCommand({
      Bucket: "default",
      Key: key,
    });

    return await client.send(command, {
      abortSignal: opts?.signal,
    });
  }

  /**
   * Get object content from S3
   * @param project Project name
   * @param key S3 object key
   * @param opts Options including abort signal
   * @returns Object data and metadata
   */
  public async getObject(
    project: string,
    key: string,
    opts?: { signal?: AbortSignal },
  ): Promise<S3GetObjectResult> {
    const client = await this.#ensureS3Client(project);

    const command = new GetObjectCommand({
      Bucket: "default",
      Key: key,
    });

    const response = await client.send(command, {
      abortSignal: opts?.signal,
    });

    if (!response.Body) {
      throw new Error(`No body in S3 response for key: ${key}`);
    }

    const bodyBytes = await response.Body.transformToByteArray();
    const data = new Uint8Array(bodyBytes);

    return {
      data,
      mediaType: response.ContentType,
    };
  }
}
