// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Box, Button, Divider, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks/useAppConfigurationValue";
import {
  PlaybackDiagnosticsContext,
  type PlaybackDiagnostics,
  type PanelStats,
} from "@foxglove/studio-base/services/playbackDiagnostics";
import type {
  Finding,
  FindingKind,
  TopicDiagnostics,
} from "@foxglove/studio-base/services/videoDiagnostics";

const Row = styled("li")(({ theme }) => ({
  paddingBlock: theme.spacing(0.5),
  "&:hover, &:focus-visible": { backgroundColor: theme.palette.action.hover },
}));
const List = styled("ul")(({ theme }) => ({
  listStyle: "none",
  margin: 0,
  paddingLeft: theme.spacing(1),
}));
const Content = styled(Stack)(({ theme }) => ({
  padding: theme.spacing(1.5),
  overflowWrap: "anywhere",
  ...theme.typography.body2,
}));
const SettingsArea = styled("div")({ maxHeight: "45vh", overflowY: "auto" });
const ScrollArea = styled("div")({ height: "100%", overflowY: "auto" });

const PAGE_SIZE = 20;
const kinds: FindingKind[] = [
  "order",
  "regression",
  "bFrame",
  "gap",
  "parameters",
  "annexB",
  "empty",
  "malformed",
  "decodeError",
];
function number(value: number | undefined, digits = 1): string {
  return value == undefined ? "—" : value.toFixed(digits);
}
function stamp(session: PlaybackDiagnostics, time: bigint): string {
  return number(Number(time - session.start) / 1e9, 3) + " s";
}

function FindingRow({
  session,
  finding,
}: {
  session: PlaybackDiagnostics;
  finding: Finding;
}): React.JSX.Element | ReactNull {
  const { t } = useTranslation("workspace");
  const owner = useRef({});
  const enter = (kind: "hovered" | "focused") => {
    session.preview.setState({ [kind]: { owner: owner.current, range: finding } });
  };
  const leave = (kind: "hovered" | "focused") => {
    if (session.preview.getState()[kind]?.owner === owner.current) {
      session.preview.setState({ [kind]: undefined });
    }
  };
  const { start, end } = finding;
  useEffect(() => {
    const { hovered, focused } = session.preview.getState();
    const token = owner.current;
    if (hovered?.owner === token || focused?.owner === token) {
      const entry = { owner: token, range: { start, end } };
      session.preview.setState({
        hovered: hovered?.owner === token ? entry : hovered,
        focused: focused?.owner === token ? entry : focused,
      });
    }
  }, [session, start, end]);
  useEffect(() => {
    const token = owner.current;
    return () => {
      const { hovered, focused } = session.preview.getState();
      if (hovered?.owner === token || focused?.owner === token) {
        session.preview.setState({
          hovered: hovered?.owner === token ? undefined : hovered,
          focused: focused?.owner === token ? undefined : focused,
        });
      }
    };
  }, [session]);
  return (
    <Row
      tabIndex={0}
      onMouseEnter={() => {
        enter("hovered");
      }}
      onFocus={() => {
        enter("focused");
      }}
      onBlur={() => {
        leave("focused");
      }}
      onMouseLeave={() => {
        leave("hovered");
      }}
    >
      {stamp(session, finding.start)}
      {finding.end !== finding.start && " – " + stamp(session, finding.end)}
      {finding.otherTopic && (
        <div>
          {finding.otherTopic} → {finding.topic}
        </div>
      )}
      {finding.duration != undefined && (
        <div>
          {finding.open === true && "≥ "}
          {number(finding.duration, 3)} s {finding.clock && t(`diagnostics.${finding.clock}`)}
        </div>
      )}
      {finding.detail && <div>{finding.detail}</div>}
      {finding.kind === "regression" && <div>{t("diagnostics.frameTime")}</div>}
      {finding.resetDecoder === true && <div>{t("diagnostics.resetDecoder")}</div>}
    </Row>
  );
}

function Findings({
  session,
  group,
  kind,
  threshold,
  otherTopic,
}: {
  session: PlaybackDiagnostics;
  group: Iterable<[string, Finding]> & { size: number };
  kind: FindingKind;
  threshold: number;
  otherTopic?: string;
}): React.JSX.Element | ReactNull {
  const { t } = useTranslation("workspace");
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const filtered = kind === "gap" || otherTopic != undefined;
  let count = filtered ? 0 : group.size;
  const rows: [string, Finding][] = [];
  if (filtered || open) {
    let index = 0;
    for (const entry of group) {
      const item = entry[1];
      if (
        (kind === "gap" && (item.duration ?? 0) <= threshold) ||
        (otherTopic != undefined && otherTopic !== item.otherTopic)
      ) {
        continue;
      }
      if (filtered) {
        count++;
      }
      if (open && index >= page * PAGE_SIZE && rows.length < PAGE_SIZE) {
        rows.push(entry);
      }
      index++;
      if (!filtered && rows.length === PAGE_SIZE) {
        break;
      }
    }
  }
  const lastPage = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1);
  if (page > lastPage) {
    setPage(lastPage);
  }
  if (count === 0) {
    return ReactNull;
  }
  return (
    <div>
      <Button
        size="small"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setPage(0);
        }}
      >
        {open ? "▾ " : "▸ "}
        {t(`diagnostics.${kind}`)} · {count}
      </Button>
      {open && (
        <>
          <List>
            {rows.map(([key, finding]) => (
              <FindingRow key={key} finding={finding} session={session} />
            ))}
          </List>
          {count > PAGE_SIZE && (
            <Stack direction="row">
              <Button
                disabled={page === 0}
                onClick={() => {
                  setPage(page - 1);
                }}
              >
                {t("diagnostics.prev")}
              </Button>
              <Button
                disabled={(page + 1) * PAGE_SIZE >= count}
                onClick={() => {
                  setPage(page + 1);
                }}
              >
                {t("diagnostics.next")}
              </Button>
            </Stack>
          )}
        </>
      )}
    </div>
  );
}

function TopicSummary({
  session,
  data,
}: {
  session: PlaybackDiagnostics;
  data: TopicDiagnostics;
}): React.JSX.Element | ReactNull {
  const { t } = useTranslation("workspace");
  const video = data.format === "h264" || data.format === "h265";
  const bCount = data.slices?.size ?? 0;
  return (
    <>
      <Typography variant="body2">{data.format.toUpperCase()}</Typography>
      {(data.truncated || data.slices?.truncated === true) && (
        <Typography variant="caption">{t("diagnostics.historyLimited")}</Typography>
      )}
      {data.coverage.length > 0 && (
        <details>
          <summary>
            {t("diagnostics.coverage")} · {data.coverage.length}
          </summary>
          {data.coverage.map((range) => (
            <div key={String(range.start)}>
              {stamp(session, range.start)} – {stamp(session, range.end)}
            </div>
          ))}
        </details>
      )}
      {video && (
        <>
          <div>
            {t("diagnostics.bFrame")} ·{" "}
            {bCount > 0
              ? bCount
              : t(
                  data.slices?.allObservedSlicesClassified() === true
                    ? "diagnostics.notObserved"
                    : "diagnostics.unknown",
                )}
          </div>
          {data.slices?.first != undefined && data.slices.last != undefined && (
            <div>
              {t("diagnostics.firstLast")} · {stamp(session, data.slices.first)} /{" "}
              {stamp(session, data.slices.last)}
            </div>
          )}
          <div>
            {t("diagnostics.reorder")} ·{" "}
            {t(
              data.reorder == undefined
                ? "diagnostics.unknown"
                : data.reorder
                  ? "diagnostics.yes"
                  : "diagnostics.no",
            )}
          </div>
          <div>
            {t("diagnostics.gopSummary")} ·{" "}
            {data.recentGap
              ? `${number(data.recentGap.duration, 3)} s (${t(`diagnostics.${data.recentGap.clock}`)})`
              : "—"}{" "}
            /{" "}
            {data.longestGap
              ? `${number(data.longestGap.duration, 3)} s (${t(`diagnostics.${data.longestGap.clock}`)})`
              : "—"}
          </div>
          <div>
            {t("diagnostics.packetCheck")} ·{" "}
            {t(
              data.findings.has("empty") ||
                data.findings.has("annexB") ||
                data.findings.has("malformed") ||
                data.findings.has("parameters")
                ? "diagnostics.issues"
                : data.sawKey
                  ? "diagnostics.passed"
                  : "diagnostics.unknown",
            )}
          </div>
        </>
      )}
    </>
  );
}

function PanelSummary({
  panel,
  session,
}: {
  panel: PanelStats;
  session: PlaybackDiagnostics;
}): React.JSX.Element | ReactNull {
  const { t } = useTranslation("workspace");
  const sorted = [...panel.samples].sort((a, b) => a - b);
  return (
    <Box>
      <Typography variant="caption">
        {panel.panelId} · {t(`diagnostics.${panel.status}`)}
      </Typography>
      <div>
        {t("diagnostics.decodeWait")} · {number(panel.decodeMs)} ms
      </div>
      <div>
        {t("diagnostics.frameLag")} · {number(session.frameLagMs(panel))} ms
      </div>
      <div>
        {t("diagnostics.seek")} · {number(panel.samples.at(-1), 0)} /{" "}
        {number(sorted[Math.ceil(sorted.length * 0.95) - 1], 0)} ms
      </div>
      <div>
        {t("diagnostics.attempts")} · {panel.successes} / {panel.cancelled} / {panel.timeouts}
      </div>
    </Box>
  );
}

function Analysis({
  session,
  topic,
  panelId,
}: {
  session: PlaybackDiagnostics;
  topic?: string;
  panelId?: string;
}): React.JSX.Element | ReactNull {
  const { t } = useTranslation("workspace");
  const [lag, setLag] = useState<number>();
  const [, refresh] = useState(0);
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [threshold = 1, setThreshold] = useAppConfigurationValue<number>(
    AppSetting.KEYFRAME_WARNING_SECONDS,
  );
  useEffect(() => {
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      if (document.visibilityState !== "hidden") {
        setLag(Math.max(0, now - previous - 500));
        for (const panel of session.panels.values()) {
          session.expire(panel, now);
        }
        refresh((n) => n + 1);
      }
      previous = now;
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, [session]);
  const topics = Array.from(session.topics.keys());
  const selected = topic ?? filter;
  const panels = Array.from(session.panels.values());
  const slowest = panels
    .filter(
      (p) =>
        p.active && p.samples.length > 0 && p.lastSuccessSequence === session.latestSeekSequence(),
    )
    .sort((a, b) => b.samples.at(-1)! - a.samples.at(-1)!)[0];
  return (
    <Content spacing={1}>
      {!panelId && (
        <>
          <Typography variant="subtitle2">{t("diagnostics.playback")}</Typography>
          <div>
            {t("diagnostics.speed")} · {number(session.targetSpeed)}× /{" "}
            {number(session.actualSpeed)}×
          </div>
          <div>
            {t("diagnostics.throughput")} · {number(session.mbps)} Mb/s
          </div>
          <div>
            {t("diagnostics.mainLag")} · {number(lag, 0)} ms
          </div>
          <div>
            {t("diagnostics.buffering")} ·{" "}
            {t(session.buffering ? "diagnostics.yes" : "diagnostics.no")}
          </div>
          {slowest && (
            <div>
              {t("diagnostics.slowest")} · {slowest.topic} · {slowest.panelId} ·{" "}
              {number(slowest.samples.at(-1), 0)} ms
            </div>
          )}
          <Divider />
          <TextField
            select
            size="small"
            label={t("topics")}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
            }}
          >
            <MenuItem value="">{t("diagnostics.all")}</MenuItem>
            {topics.map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </TextField>
        </>
      )}
      <TextField
        select
        size="small"
        label={t("diagnostics.history")}
        value={kindFilter}
        onChange={(e) => {
          setKindFilter(e.target.value);
        }}
      >
        <MenuItem value="">{t("diagnostics.all")}</MenuItem>
        {kinds.map((kind) => (
          <MenuItem key={kind} value={kind}>
            {t(`diagnostics.${kind}`)}
          </MenuItem>
        ))}
      </TextField>
      {!panelId && (
        <TextField
          select
          size="small"
          label={t("diagnostics.threshold")}
          value={threshold}
          onChange={(e) => void setThreshold(Number(e.target.value))}
        >
          {[0.5, 1, 2, 5, 10].map((n) => (
            <MenuItem key={n} value={n}>
              {n} s
            </MenuItem>
          ))}
        </TextField>
      )}
      {(topics.length === 0 || (selected !== "" && !session.topics.has(selected))) &&
        t("diagnostics.awaitData")}
      {topics.map((name) => {
        const data = session.topics.get(name)!;
        const related = selected !== "" && name !== selected;
        if (related && !data.findings.has("order")) {
          return ReactNull;
        }
        return (
          <Stack key={name} spacing={0.5}>
            {!related && (
              <>
                <Typography variant="subtitle2">{name}</Typography>
                <TopicSummary session={session} data={data} />
                {panels
                  .filter((p) => p.topic === name && (!panelId || panelId === p.panelId))
                  .map((p) => (
                    <PanelSummary key={p.panelId} panel={p} session={session} />
                  ))}
              </>
            )}
            {kinds.map((kind) => {
              const group = kind === "bFrame" ? data.slices : data.findings.get(kind);
              return group &&
                (!kindFilter || kind === kindFilter) &&
                (!related || kind === "order") ? (
                <Findings
                  key={`${kind}/${selected}/${threshold}`}
                  group={group}
                  session={session}
                  kind={kind}
                  threshold={threshold}
                  otherTopic={related ? selected : undefined}
                />
              ) : (
                ReactNull
              );
            })}
          </Stack>
        );
      })}
    </Content>
  );
}

export function ImageDiagnostics({
  panelId,
  topic,
}: {
  panelId: string;
  topic?: string;
}): React.JSX.Element | ReactNull {
  const { t } = useTranslation("workspace");
  const session = useContext(PlaybackDiagnosticsContext);
  const [open, setOpen] = useState(false);
  return session ? (
    <SettingsArea>
      <Button
        size="small"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? "▾ " : "▸ "}
        {t("diagnostics.image")}
      </Button>
      {open &&
        (topic ? (
          <Analysis
            key={`${session.id}/${topic}`}
            session={session}
            panelId={panelId}
            topic={topic}
          />
        ) : (
          <Typography variant="caption">{t("diagnostics.awaitData")}</Typography>
        ))}
    </SettingsArea>
  ) : (
    ReactNull
  );
}

export function PerformanceSidebar(): React.JSX.Element | ReactNull {
  const session = useContext(PlaybackDiagnosticsContext);
  return session ? (
    <ScrollArea>
      <Analysis key={session.id} session={session} />
    </ScrollArea>
  ) : (
    ReactNull
  );
}
