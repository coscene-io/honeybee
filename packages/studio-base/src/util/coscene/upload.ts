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
