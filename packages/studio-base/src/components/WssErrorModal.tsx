// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CloseIcon from "@mui/icons-material/Close";
import { Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { Immutable } from "@foxglove/studio";
import { PlayerProblem } from "@foxglove/studio-base/players/types";

import WssErrorModalScreenshot from "./WssErrorModal.png";

const useStyles = makeStyles()({
  image: {
    maxWidth: "24rem",
  },
  dialogTitle: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
});

export default function WssErrorModal(
  props: Immutable<{ playerProblems?: PlayerProblem[] }>,
): JSX.Element {
  const { playerProblems } = props;
  const { classes } = useStyles();

  const [open, setOpen] = useState(true);
  const [hasDismissedWssErrorModal, setHasDismissedWssErrorModal] = useState(false);
  const { t } = useTranslation("cosWebsocket");

  const handleClose = () => {
    setOpen(false);
    setHasDismissedWssErrorModal(true);
  };

  const hasWssConnectionProblem = playerProblems?.find(
    (problem) =>
      problem.severity === "error" && problem.message === "Insecure WebSocket connection",
  );

  if (hasDismissedWssErrorModal || !hasWssConnectionProblem) {
    return <></>;
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogTitle className={classes.dialogTitle}>
        {t("websocketSSLError")}
        <IconButton
          onClick={() => {
            setOpen(false);
          }}
          edge="end"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack gap={2}>
          <Typography variant="body1" color="text.secondary">
            <Trans
              t={t}
              i18nKey="websocketSSLErrorDesc"
              components={{
                code: <code />,
              }}
            />
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t("websocketSSLErrorDesc2")}
          </Typography>
          <img src={WssErrorModalScreenshot} alt="WSS screenshot" className={classes.image} />
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
