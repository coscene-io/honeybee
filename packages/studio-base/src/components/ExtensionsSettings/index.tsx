// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { List, ListItem, ListItemButton, ListItemText, Typography } from "@mui/material";
import * as _ from "lodash-es";
import { useMemo, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { Immutable } from "@foxglove/studio";
import { ExtensionDetails } from "@foxglove/studio-base/components/ExtensionDetails";
import Stack from "@foxglove/studio-base/components/Stack";
import { useExtensionCatalog } from "@foxglove/studio-base/context/ExtensionCatalogContext";
import { ExtensionMarketplaceDetail } from "@foxglove/studio-base/context/ExtensionMarketplaceContext";

const useStyles = makeStyles()((theme) => ({
  listItemButton: {
    "&:hover": { color: theme.palette.primary.main },
  },
}));

function displayNameForNamespace(namespace: string): string {
  switch (namespace) {
    case "org":
      return "Organization";
    default:
      return namespace;
  }
}

function ExtensionListEntry(props: {
  entry: Immutable<ExtensionMarketplaceDetail>;
  onClick: () => void;
}): React.JSX.Element {
  const {
    entry: { id, description, name, publisher, version },
    onClick,
  } = props;
  const { classes } = useStyles();
  return (
    <ListItem disablePadding key={id}>
      <ListItemButton className={classes.listItemButton} onClick={onClick}>
        <ListItemText
          disableTypography
          primary={
            <Stack direction="row" alignItems="baseline" gap={0.5}>
              <Typography variant="subtitle2" fontWeight={600}>
                {name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {version}
              </Typography>
            </Stack>
          }
          secondary={
            <Stack gap={0.5}>
              <Typography variant="body2" color="text.secondary">
                {description}
              </Typography>
              <Typography color="text.primary" variant="body2">
                {publisher}
              </Typography>
            </Stack>
          }
        />
      </ListItemButton>
    </ListItem>
  );
}

export default function ExtensionsSettings(): React.ReactElement {
  const [focusedExtension, setFocusedExtension] = useState<
    | {
        installed: boolean;
        entry: Immutable<ExtensionMarketplaceDetail>;
      }
    | undefined
  >(undefined);
  const installed = useExtensionCatalog((state) => state.installedExtensions);
  const installedEntries = useMemo(
    () =>
      (installed ?? []).map((entry) => {
        return {
          id: entry.id,
          installed: true,
          name: entry.displayName,
          displayName: entry.displayName,
          description: entry.description,
          publisher: entry.publisher,
          homepage: entry.homepage,
          license: entry.license,
          version: entry.version,
          keywords: entry.keywords,
          namespace: entry.namespace,
          qualifiedName: entry.qualifiedName,
        };
      }),
    [installed],
  );

  const namespacedEntries = useMemo(
    () => _.groupBy(installedEntries, (entry) => entry.namespace),
    [installedEntries],
  );

  if (focusedExtension != undefined) {
    return (
      <ExtensionDetails
        installed={focusedExtension.installed}
        extension={focusedExtension.entry}
        onClose={() => {
          setFocusedExtension(undefined);
        }}
      />
    );
  }

  return (
    <Stack gap={1}>
      {!_.isEmpty(namespacedEntries) ? (
        Object.entries(namespacedEntries).map(([namespace, entries]) => (
          <List key={namespace}>
            <Stack paddingY={0.25} paddingX={2}>
              <Typography component="li" variant="overline" color="text.secondary">
                {displayNameForNamespace(namespace)}
              </Typography>
            </Stack>
            {entries.map((entry) => (
              <ExtensionListEntry
                key={entry.id}
                entry={entry}
                onClick={() => {
                  setFocusedExtension({ installed: true, entry });
                }}
              />
            ))}
          </List>
        ))
      ) : (
        <List>
          <ListItem>
            <ListItemText primary="No installed extensions" />
          </ListItem>
        </List>
      )}
    </Stack>
  );
}
