// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AddIcon from "@mui/icons-material/Add";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import { Button, FormLabel } from "@mui/material";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import Stack from "@foxglove/studio-base/components/Stack";

const useStyles = makeStyles()((theme) => ({
  addFileButton: {
    display: "flex",
    gap: theme.spacing(0.5),
    whiteSpace: "nowrap",
  },
}));

interface ImageUploadProps {
  imageFile?: File;
  imgUrl?: string;
  onImageChange: (file?: File) => void;
}

export function ImageUpload({
  imageFile,
  imgUrl,
  onImageChange,
}: ImageUploadProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("cosEvent");
  const inputRef = useRef<HTMLInputElement>(ReactNull);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    onImageChange(file);
  };

  const handleDelete = () => {
    onImageChange(undefined);
  };

  const handleClick = () => {
    inputRef.current?.click();
  };

  return (
    <Stack paddingX={3} paddingTop={2}>
      <FormLabel>{t("photo")}</FormLabel>
      {imageFile ? (
        <Stack>
          <img
            onClick={handleClick}
            src={URL.createObjectURL(imageFile)}
            style={{
              maxHeight: "200px",
              objectFit: "contain",
              cursor: "pointer",
            }}
          />
        </Stack>
      ) : (
        imgUrl && (
          <Stack>
            <img
              onClick={handleClick}
              src={imgUrl}
              style={{
                maxHeight: "200px",
                objectFit: "contain",
                cursor: "pointer",
              }}
            />
          </Stack>
        )
      )}

      {imgUrl ? (
        <Button className={classes.addFileButton} onClick={handleDelete}>
          <DeleteForeverIcon />
          {t("delete", { ns: "cosGeneral" })}
        </Button>
      ) : (
        <Button className={classes.addFileButton} onClick={handleClick}>
          <AddIcon />
          {t("addPhoto")}
        </Button>
      )}
      <input
        hidden
        ref={inputRef}
        type="file"
        accept="image/*"
        value=""
        onChange={handleFileChange}
      />
    </Stack>
  );
}
