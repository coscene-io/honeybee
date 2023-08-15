// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import CloseIcon from "@mui/icons-material/Close";
import { Dialog, DialogTitle, IconButton } from "@mui/material";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { useEffect } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useAsyncFn } from "react-use";
import { makeStyles } from "tss-react/mui";

import Logger from "@foxglove/log";
import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { LayoutData } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";

const useStyles = makeStyles()((theme) => ({
  paper: { maxWidth: "700px", width: "70%" },
  noTemplate: {
    width: "100%",
    height: "200px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  spin: {
    width: "100%",
    height: "200px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  tableRow: {
    cursor: "pointer",
    ":hover": {
      backgroundColor: theme.palette.action.hover,
    },
  },
}));

const log = Logger.getLogger(__filename);

export default function SelectLayoutTemplateModal({
  open,
  onClose,
  onSelectedLayout,
}: {
  open: boolean;
  onClose: () => void;
  onSelectedLayout: (layout: LayoutData, layoutName: string) => void;
}): JSX.Element {
  const { classes } = useStyles();
  const consoleApi = useConsoleApi();
  const { t } = useTranslation("cosLayout");

  const [layoutTemplateIndex, getLayoutTemplateIndex] = useAsyncFn(async () => {
    let templateIndex: { [key: string]: { path: string; updateTime: string } } = {};
    try {
      const index = await consoleApi.getLayoutTemplatesIndex(
        `${APP_CONFIG.LAYOUT_TEMPLATE_INDEX_OSS_URL}?v=${Date.now()}`,
      );
      templateIndex = index;
    } catch (error) {
      log.error(error);
      toast.error(t("loadLayoutTemplateFailed"));
      throw new Error(error);
    }

    return templateIndex;
  }, [consoleApi, t]);

  const [layoutInfo, getLayoutInfo] = useAsyncFn(
    async ({ layoutPath, layoutName }: { layoutPath: string; layoutName: string }) => {
      try {
        const layout = await consoleApi.getLayoutTemplate(layoutPath);
        onSelectedLayout(layout, layoutName);
      } catch (error) {
        log.error(error);
        toast.error(t("loadLayoutTemplateFailed"));
        throw new Error(error);
      }
    },
    [consoleApi, onSelectedLayout, t],
  );

  useEffect(() => {
    if (open) {
      void getLayoutTemplateIndex();
    }
  }, [getLayoutTemplateIndex, open]);

  return (
    <Dialog classes={{ paper: classes.paper }} fullWidth open={open} onClose={onClose}>
      <DialogTitle>{t("selectTemplate")}</DialogTitle>
      <IconButton
        aria-label="close"
        onClick={onClose}
        style={{
          position: "absolute",
          right: 8,
          top: 8,
        }}
      >
        <CloseIcon />
      </IconButton>

      {layoutTemplateIndex.loading || layoutInfo.loading ? (
        <Box className={classes.spin}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper}>
          {layoutTemplateIndex.value ? (
            <Table aria-label="simple table">
              <TableHead>
                <TableRow>
                  <TableCell>
                    {t("name", {
                      ns: "cosGeneral",
                    })}
                  </TableCell>
                  <TableCell align="right">{t("updateTime")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.keys(layoutTemplateIndex.value).map((templateKey) => {
                  const template = layoutTemplateIndex.value[templateKey];
                  if (template) {
                    return (
                      <TableRow
                        key={templateKey}
                        onClick={() => {
                          void getLayoutInfo({
                            layoutPath: template.path,
                            layoutName: templateKey,
                          });
                        }}
                        className={classes.tableRow}
                      >
                        <TableCell component="th" scope="row">
                          {templateKey}
                        </TableCell>
                        <TableCell align="right">{template.updateTime}</TableCell>
                      </TableRow>
                    );
                  }

                  return <></>;
                })}
              </TableBody>
            </Table>
          ) : (
            <h1 className={classes.noTemplate}>{t("noTemplates")}</h1>
          )}
        </TableContainer>
      )}
    </Dialog>
  );
}
