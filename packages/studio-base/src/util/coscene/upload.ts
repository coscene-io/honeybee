// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
export const generateFileName = ({
  directory,
  filename,
  recordName,
  targetDir,
}: {
  directory?: boolean;
  filename: string;
  recordName: string;
  targetDir?: string;
}): string => {
  let formattedTargetDir = "";
  if (targetDir) {
    formattedTargetDir = targetDir;
    if (!targetDir.startsWith("/")) {
      formattedTargetDir = "/" + targetDir;
    }
  }

  let formattedFilename = filename || "";
  if (!filename.startsWith("/")) {
    formattedFilename = "/" + formattedFilename;
  }
  if (directory != undefined && directory && !filename.endsWith("/")) {
    formattedFilename += "/";
  }

  return `${recordName}/files${formattedTargetDir}${formattedFilename}`;
};

export async function uploadWithProgress(
  url: string,
  file: File,
  method: "PUT" | "POST" = "PUT",
  abortController: AbortController,
  onProgress: (progress: number) => void,
): Promise<unknown> {
  const xhr = new XMLHttpRequest();

  // 监听上传进度
  xhr.upload.addEventListener("progress", (event) => {
    if (event.lengthComputable) {
      const progress = (event.loaded / event.total) * 100;
      onProgress(progress);
    }
  });

  abortController.signal.addEventListener("abort", () => {
    xhr.abort();
  });

  return await new Promise((resolve, reject) => {
    xhr.open(method, url);

    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve(xhr.response);
      } else {
        reject(new Error("Upload failed"));
      }
    };

    xhr.onerror = () => {
      reject(new Error("Upload failed"));
    };
    xhr.send(file);
  });
}
