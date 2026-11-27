/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ProjectSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/project_pb";
import { EventSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";
import { RecordSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/record_pb";
import {
  CustomFieldSchemaSchema,
  CustomFieldValueSchema,
  EnumValueSchema,
  PropertySchema,
  TextValueSchema,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import toast from "react-hot-toast";

import { EventsList } from "@foxglove/studio-base/components/Events/EventsList";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { type CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { type DialogsStore, useDialogs } from "@foxglove/studio-base/context/DialogsContext";
import {
  type EventsStore,
  type MomentCustomFieldFilter,
  type MomentCustomFieldFilters,
  type TimelinePositionedEvent,
  useEvents,
} from "@foxglove/studio-base/context/EventsContext";
import { useTimelineInteractionState } from "@foxglove/studio-base/context/TimelineInteractionStateContext";
import MomentsList from "@foxglove/studio-base/panels/MomentsBar/MomentsList";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import DialogsProvider from "@foxglove/studio-base/providers/DialogsProvider";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import TimelineInteractionStateProvider from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import { SegmentationWorkspaceSlots } from "@foxglove/studio-base/segmentation/components/SegmentationWorkspaceSlots";
import {
  TestHostProvider,
  installSegmentationTestHost,
  testHost,
} from "@foxglove/studio-base/segmentation/testing/host";
import { createMockSegmentationRuntime } from "@foxglove/studio-base/segmentation/testing/mockRuntime";
import {
  createSeedDocument,
  setMockControls,
} from "@foxglove/studio-base/segmentation/testing/mockService";
import type { MomentCustomFieldSchema } from "@foxglove/studio-base/services/api/moment-custom-field/types";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import { DOUBTFUL_FIELD_KEY } from "../momentDoubtful";

installSegmentationTestHost();

jest.mock("react-hot-toast", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock(
  "@foxglove/studio-base/components/CustomFieldProperty/field/CustomFieldValuesFields",
  () => ({
    CustomFieldValuesFields: function MockCustomFieldValuesFields() {
      return undefined;
    },
  }),
);

type DeleteEvent = (args: { eventName: string }) => Promise<unknown>;
type DeleteFile = (args: { name: string }) => Promise<unknown>;

const selectDialogs = (store: DialogsStore) => store.dialogs;
const DELETE_CONFIRM_PROMPT =
  "After deletion, moments cannot be restored. Please proceed with caution.";
const FILTER_PROJECT = "warehouses/warehouse/projects/project";

function TestDialogs(): React.JSX.Element {
  const dialogs = useDialogs(selectDialogs);
  return (
    <>
      {Array.from(dialogs.entries()).map(([key, dialog]) => (
        <div key={key}>{dialog}</div>
      ))}
    </>
  );
}

function makeEvent({
  file,
  name,
  recordDisplayName = "Record",
  startNsec = 0,
  startSec,
}: {
  file?: string;
  name: string;
  recordDisplayName?: string;
  startNsec?: number;
  startSec: number;
}): TimelinePositionedEvent {
  return {
    event: create(EventSchema, {
      name,
      displayName: name,
      triggerTime: create(TimestampSchema, { seconds: BigInt(startSec), nanos: startNsec }),
      duration: create(DurationSchema, { seconds: BigInt(1), nanos: 0 }),
      files: file == undefined ? [] : [file],
    }),
    startTime: { sec: startSec, nsec: startNsec },
    endTime: { sec: startSec + 1, nsec: startNsec },
    color: "#00ADEF",
    startPosition: startSec / 10,
    endPosition: (startSec + 1) / 10,
    secondsSinceStart: startSec,
    projectDisplayName: "Project",
    recordDisplayName,
  };
}

function SeedCoreData({
  projectArchived = false,
  recordArchived = false,
}: {
  projectArchived?: boolean;
  recordArchived?: boolean;
}): ReactNull {
  const setProject = useCoreData((store: CoreDataStore) => store.setProject);
  const setRecord = useCoreData((store: CoreDataStore) => store.setRecord);

  useEffect(() => {
    setProject({ loading: false, value: create(ProjectSchema, { isArchived: projectArchived }) });
    setRecord({ loading: false, value: create(RecordSchema, { isArchived: recordArchived }) });
  }, [projectArchived, recordArchived, setProject, setRecord]);

  return ReactNull;
}

function SeedEvents({
  events,
  schema,
  initialFilters,
}: {
  events: TimelinePositionedEvent[];
  schema?: MomentCustomFieldSchema;
  initialFilters?: MomentCustomFieldFilters;
}): ReactNull {
  const setEvents = useEvents((store: EventsStore) => store.setEvents);
  const setSchema = useEvents((store: EventsStore) => store.setCustomFieldSchema);
  const setFilters = useEvents((store: EventsStore) => store.setCustomFieldFilters);

  useEffect(() => {
    setEvents({ loading: false, value: events });
  }, [events, setEvents]);

  useEffect(() => {
    setSchema(schema, FILTER_PROJECT);
    if (initialFilters != undefined) {
      setFilters(FILTER_PROJECT, initialFilters);
    }
  }, [schema, setSchema, initialFilters, setFilters]);

  return ReactNull;
}

function EventFetchCountProbe(): React.JSX.Element {
  const eventFetchCount = useEvents((store: EventsStore) => store.eventFetchCount);
  return <div data-testid="event-fetch-count">{eventFetchCount}</div>;
}

function EventToModifyProbe(): React.JSX.Element {
  const startTime = useEvents((store: EventsStore) => store.toModifyEvent?.startTime);
  const metadata = useEvents((store: EventsStore) => store.toModifyEvent?.metadataEntries);
  return (
    <>
      <div data-testid="event-to-modify-start">{`${startTime?.sec}:${startTime?.nsec}`}</div>
      <div data-testid="event-to-modify-metadata">{JSON.stringify(metadata)}</div>
    </>
  );
}

function HoverProbe(): React.JSX.Element {
  const name = useTimelineInteractionState((store) => store.hoveredEvent?.event.name);
  const focus = useTimelineInteractionState((store) => store.eventToFocus);
  const hover = useTimelineInteractionState((store) => store.hoverValue);
  return (
    <>
      <div data-testid="hover-state">{`${name ?? ""}|${hover?.componentId ?? ""}`}</div>
      <div data-testid="focused-event">{focus?.event.name}</div>
    </>
  );
}

function ScrollInteractionProbe({ event }: { event: TimelinePositionedEvent }): React.JSX.Element {
  const setHoveredEvent = useTimelineInteractionState((store) => store.setHoveredEvent);
  const selected = useEvents((store) => store.selectedEventId);
  return (
    <>
      <div data-testid="selected-event">{selected}</div>
      <button
        onClick={() => {
          setHoveredEvent(event);
        }}
      >
        Hover external moment
      </button>
    </>
  );
}

function Wrapper({
  consoleApi,
  view = "sidebar",
  events,
  schema,
  initialFilters,
  projectArchived,
  recordArchived,
  seekPlayback,
  externalHoverEvent,
  withReferences,
}: {
  consoleApi: React.ContextType<typeof CoSceneConsoleApiContext>;
  view?: "sidebar" | "moments";
  events: TimelinePositionedEvent[];
  schema?: MomentCustomFieldSchema;
  initialFilters?: MomentCustomFieldFilters;
  projectArchived?: boolean;
  recordArchived?: boolean;
  seekPlayback?: (time: { sec: number; nsec: number }) => void;
  externalHoverEvent?: TimelinePositionedEvent;
  withReferences?: boolean;
}): React.JSX.Element {
  return (
    <ThemeProvider isDark>
      <WorkspaceContextProvider disablePersistence>
        <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
          <CoSceneConsoleApiContext.Provider value={consoleApi}>
            <DialogsProvider>
              <CoreDataProvider>
                <EventsProvider>
                  <TimelineInteractionStateProvider>
                    <MockMessagePipelineProvider
                      seekPlayback={seekPlayback}
                      startTime={{ sec: 0, nsec: 0 }}
                      currentTime={{ sec: 0, nsec: 0 }}
                      endTime={{ sec: 10, nsec: 0 }}
                    >
                      <SeedCoreData
                        projectArchived={projectArchived}
                        recordArchived={recordArchived}
                      />
                      <SeedEvents events={events} schema={schema} initialFilters={initialFilters} />
                      {withReferences === true && <SegmentationWorkspaceSlots />}
                      <EventFetchCountProbe />
                      <EventToModifyProbe />
                      <HoverProbe />
                      {externalHoverEvent && <ScrollInteractionProbe event={externalHoverEvent} />}
                      {view === "sidebar" ? <EventsList /> : <MomentsList events={events} />}
                      <TestDialogs />
                    </MockMessagePipelineProvider>
                  </TimelineInteractionStateProvider>
                </EventsProvider>
              </CoreDataProvider>
            </DialogsProvider>
          </CoSceneConsoleApiContext.Provider>
        </AppConfigurationContext.Provider>
      </WorkspaceContextProvider>
    </ThemeProvider>
  );
}

function makeConsoleApi({
  deleteEvent = jest.fn().mockResolvedValue({}),
  deleteFile = jest.fn().mockResolvedValue({}),
  canDelete = true,
}: {
  canDelete?: boolean;
  deleteEvent?: jest.MockedFunction<DeleteEvent>;
  deleteFile?: jest.MockedFunction<DeleteFile>;
} = {}): React.ContextType<typeof CoSceneConsoleApiContext> {
  return {
    batchGetUsers: jest.fn().mockResolvedValue({ users: [] }),
    deleteEvent: Object.assign(deleteEvent, { permission: () => canDelete }),
    deleteFile,
    getDiagnosisRule: jest.fn().mockResolvedValue(undefined),
    updateEvent: Object.assign(jest.fn(), { permission: () => true }),
  } as unknown as React.ContextType<typeof CoSceneConsoleApiContext>;
}

function renderFilterEvents(initial?: { category: string; typeId: string }) {
  const issue = create(PropertySchema, {
    id: "issue",
    name: "Issue category",
    description: "Enter issue category",
    type: { case: "text", value: {} },
  });
  const type = create(PropertySchema, {
    id: "type",
    name: "Moment type",
    type: { case: "enums", value: { values: { ann: "Annotation", diag: "Diagnosis" } } },
  });
  const score = create(PropertySchema, {
    id: "score",
    name: "Score",
    type: { case: "number", value: {} },
  });
  const schema = create(CustomFieldSchemaSchema, { properties: [issue, type, score] });
  const events = [
    { name: "First Moment", category: "Emergency brake", typeId: "ann", project: FILTER_PROJECT },
    { name: "Second Moment", category: "Emergency brake", typeId: "diag", project: FILTER_PROJECT },
    { name: "Third Moment", category: "Camera", typeId: "diag", project: FILTER_PROJECT },
    {
      name: "Other project Moment",
      category: "Emergency brake",
      typeId: "ann",
      project: "warehouses/warehouse/projects/other",
    },
  ].map(({ name, category, typeId, project }, index) => {
    const entry = makeEvent({ name: `${project}/events/${index}`, startSec: index + 1 });
    entry.event.displayName = name;
    entry.event.customFieldValues = [
      create(CustomFieldValueSchema, {
        property: issue,
        value: { case: "text", value: { value: category } },
      }),
      create(CustomFieldValueSchema, {
        property: type,
        value: { case: "enums", value: { id: typeId } },
      }),
    ];
    return entry;
  });
  const initialFilters =
    initial &&
    new Map<string, MomentCustomFieldFilter>([
      ["issue", { case: "text", value: create(TextValueSchema, { value: initial.category }) }],
      ["type", { case: "enums", value: create(EnumValueSchema, { id: initial.typeId }) }],
    ]);
  render(
    <Wrapper
      events={events}
      consoleApi={makeConsoleApi()}
      schema={schema}
      initialFilters={initialFilters}
    />,
  );
}

function getFilterDialog() {
  return within(screen.getByRole("dialog", { name: "Filter by custom fields" }));
}

function getActiveFilters() {
  return within(screen.getByRole("group", { name: "Active moment filters" }));
}

function chooseOption(element: HTMLElement, name: string) {
  fireEvent.mouseDown(element);
  fireEvent.click(screen.getByRole("option", { name }));
}

function getMomentTypeInput(dialog: ReturnType<typeof getFilterDialog>) {
  return within(dialog.getByRole("group", { name: "Moment type" })).getByRole<HTMLInputElement>(
    "combobox",
  );
}

it("applies custom field conditions together and shows the active filters", async () => {
  renderFilterEvents();
  fireEvent.click(screen.getByRole("button", { name: "Filter Moments" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Filter by custom fields" }));
  const dialog = getFilterDialog();
  const addCondition = () =>
    dialog.getByRole<HTMLInputElement>("combobox", { name: "Add a condition" });
  fireEvent.change(addCondition(), { target: { value: "Issue category" } });
  fireEvent.click(screen.getByRole("option", { name: "Issue category" }));
  expect(addCondition().value).toBe("");
  fireEvent.change(dialog.getByRole("textbox"), { target: { value: "BRAKE" } });
  fireEvent.mouseDown(addCondition());
  expect(screen.queryByRole("option", { name: "Issue category" })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: "Moment type" }));
  chooseOption(getMomentTypeInput(dialog), "Annotation");
  chooseOption(addCondition(), "Score");
  expect(screen.queryByText("Second Moment")).not.toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "Apply filters" }));

  await waitFor(() => {
    expect(screen.queryByText("First Moment")).not.toBeNull();
    expect(screen.queryByText("Second Moment")).toBeNull();
    expect(screen.queryByText("Other project Moment")).toBeNull();
  });
  expect(getActiveFilters().getByRole("button", { name: "Issue category: BRAKE" })).toBeTruthy();
  expect(getActiveFilters().getByRole("button", { name: "Moment type: Annotation" })).toBeTruthy();
  expect(getActiveFilters().queryByText("Score")).toBeNull();

  expect(screen.getByTestId("event-fetch-count").textContent).toBe("0");
});

it("discards canceled custom field edits and applies the next draft", async () => {
  renderFilterEvents({ category: "BRAKE", typeId: "ann" });
  fireEvent.click(getActiveFilters().getByRole("button", { name: "Moment type: Annotation" }));
  const firstDialog = getFilterDialog();
  const issue = firstDialog.getByRole<HTMLInputElement>("textbox");
  expect(issue.value).toBe("BRAKE");
  expect(getMomentTypeInput(firstDialog).value).toBe("Annotation");
  fireEvent.change(issue, { target: { value: "Camera" } });
  fireEvent.click(firstDialog.getByRole("button", { name: "Remove Moment type condition" }));
  fireEvent.click(firstDialog.getByRole("button", { name: "Cancel" }));

  fireEvent.click(getActiveFilters().getByRole("button", { name: "Issue category: BRAKE" }));
  const nextDialog = getFilterDialog();
  const restoredIssue = nextDialog.getByRole<HTMLInputElement>("textbox");
  expect(restoredIssue.value).toBe("BRAKE");
  const restoredType = getMomentTypeInput(nextDialog);
  expect(restoredType.value).toBe("Annotation");
  fireEvent.change(restoredIssue, { target: { value: "Camera" } });
  chooseOption(restoredType, "Diagnosis");
  fireEvent.click(nextDialog.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => {
    expect(screen.queryByText("Third Moment")).not.toBeNull();
    expect(screen.queryByText("First Moment")).toBeNull();
    expect(screen.queryByText("Second Moment")).toBeNull();
  });
  const activeFilters = getActiveFilters();
  expect(activeFilters.getByRole("button", { name: "Issue category: Camera" })).toBeTruthy();
  expect(activeFilters.getByRole("button", { name: "Moment type: Diagnosis" })).toBeTruthy();
  expect(screen.getByTestId("event-fetch-count").textContent).toBe("0");
});

it("removes one active custom field filter and clears the rest", async () => {
  renderFilterEvents({ category: "Camera", typeId: "diag" });
  expect(screen.queryByText("Second Moment")).toBeNull();
  fireEvent.keyUp(getActiveFilters().getByRole("button", { name: "Issue category: Camera" }), {
    key: "Delete",
  });
  await waitFor(() => {
    expect(screen.queryByText("Second Moment")).not.toBeNull();
  });
  expect(getActiveFilters().queryByText("Issue category: Camera")).toBeNull();

  fireEvent.click(getActiveFilters().getByRole("button", { name: "Moment type: Diagnosis" }));
  const dialog = getFilterDialog();
  fireEvent.click(dialog.getByRole("button", { name: "Clear conditions" }));
  fireEvent.click(dialog.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => {
    expect(screen.queryByText("Second Moment")).not.toBeNull();
    expect(screen.queryByText("Other project Moment")).not.toBeNull();
  });
  expect(screen.queryByRole("group", { name: "Active moment filters" })).toBeNull();
  expect(screen.getByTestId("event-fetch-count").textContent).toBe("0");
});

function renderRangeFilterEvents(initialFilters?: MomentCustomFieldFilters) {
  const score = create(PropertySchema, {
    id: "score",
    name: "Score",
    type: { case: "number", value: {} },
  });
  const time = create(PropertySchema, {
    id: "observed",
    name: "Observed at",
    type: { case: "time", value: {} },
  });
  const schema = create(CustomFieldSchemaSchema, { properties: [score, time] });
  const events = [
    { name: "Matching moment", number: 0, minute: 1 },
    { name: "Too high", number: 3, minute: 1 },
    { name: "Too late", number: 0, minute: 2 },
    { name: "Too high and too late", number: 3, minute: 2 },
  ].map(({ name, number, minute }, index) => {
    const entry = makeEvent({ name: `${FILTER_PROJECT}/events/${index}`, startSec: index + 1 });
    entry.event.displayName = name;
    entry.event.customFieldValues = [
      create(CustomFieldValueSchema, {
        property: score,
        value: { case: "number", value: { value: number } },
      }),
      create(CustomFieldValueSchema, {
        property: time,
        value: {
          case: "time",
          value: { value: timestampFromDate(new Date(2026, 0, 10, 10, minute, 59)) },
        },
      }),
    ];
    return entry;
  });
  render(
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Wrapper
        events={events}
        consoleApi={makeConsoleApi()}
        schema={schema}
        initialFilters={initialFilters}
      />
    </LocalizationProvider>,
  );
}

it("validates numeric bounds before applying a range", async () => {
  renderRangeFilterEvents();
  fireEvent.click(screen.getByRole("button", { name: "Filter Moments" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Filter by custom fields" }));
  const dialog = getFilterDialog();
  chooseOption(dialog.getByRole("combobox", { name: "Add a condition" }), "Score");
  const apply = dialog.getByRole<HTMLButtonElement>("button", { name: "Apply filters" });
  const maximum = dialog.getByRole("textbox", { name: "Maximum" });

  fireEvent.change(dialog.getByRole("textbox", { name: "Minimum" }), { target: { value: "0" } });
  expect(dialog.getByText("Enter both the minimum and maximum.")).toBeTruthy();
  expect(apply.disabled).toBe(true);
  fireEvent.change(maximum, { target: { value: "-0.5" } });
  expect(dialog.getByText("The minimum must be less than or equal to the maximum.")).toBeTruthy();
  expect(apply.disabled).toBe(true);
  fireEvent.change(maximum, { target: { value: "2" } });
  expect(apply.disabled).toBe(false);
  fireEvent.click(apply);
  expect(await screen.findByRole("button", { name: "Score: 0 – 2" })).toBeTruthy();
  expect(screen.queryByText("Too high")).toBeNull();
  expect(screen.getByText("Too late")).toBeTruthy();
});

it("validates a date range and applies it together with an active numeric range", async () => {
  renderRangeFilterEvents(
    new Map([["score", { case: "number", operator: "between", min: 0, max: 2 }]]),
  );
  fireEvent.click(getActiveFilters().getByRole("button", { name: "Score: 0 – 2" }));
  const dialog = getFilterDialog();
  chooseOption(dialog.getByRole("combobox", { name: "Add a condition" }), "Observed at");
  const apply = dialog.getByRole<HTMLButtonElement>("button", { name: "Apply filters" });
  const start = dialog.getByLabelText("Start Time", { selector: "input" });
  const end = dialog.getByLabelText("End Time", { selector: "input" });
  fireEvent.change(start, { target: { value: "2026-01-10 10:02" } });
  fireEvent.change(end, { target: { value: "2026-01-10 10:01" } });
  expect(dialog.getByText("The start must be before or at the end.")).toBeTruthy();
  expect(apply.disabled).toBe(true);
  fireEvent.change(start, { target: { value: "2026-01-10 10:00" } });
  expect(apply.disabled).toBe(false);
  fireEvent.click(apply);
  await waitFor(() => {
    expect(screen.queryByText("Matching moment")).not.toBeNull();
    expect(screen.queryByText("Too high")).toBeNull();
    expect(screen.queryByText("Too late")).toBeNull();
  });
});

it("changes an applied numeric range to a comparison while keeping the date range", async () => {
  renderRangeFilterEvents(
    new Map<string, MomentCustomFieldFilter>([
      ["score", { case: "number", operator: "between", min: 0, max: 2 }],
      [
        "observed",
        {
          case: "time",
          start: new Date(2026, 0, 10, 10, 0).getTime(),
          end: new Date(2026, 0, 10, 10, 1).getTime(),
        },
      ],
    ]),
  );
  fireEvent.click(getActiveFilters().getByRole("button", { name: "Score: 0 – 2" }));
  const dialog = getFilterDialog();
  expect(dialog.getByRole<HTMLInputElement>("textbox", { name: "Minimum" }).value).toBe("0");
  chooseOption(dialog.getByRole("combobox", { name: "Comparison" }), ">");
  expect(dialog.queryByRole("textbox", { name: "Maximum" })).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => {
    expect(screen.queryByText("Matching moment")).toBeNull();
    expect(screen.queryByText("Too high")).not.toBeNull();
    expect(screen.queryByText("Too late")).toBeNull();
    expect(screen.queryByText("Too high and too late")).toBeNull();
  });
});

it("filters doubtful display with keyword AND semantics while Delete All retains the complete collection", async () => {
  const first = makeEvent({ name: "Doubtful target", startSec: 1 });
  first.event.customizedFields[DOUBTFUL_FIELD_KEY] = "true";
  const second = makeEvent({ name: "Ordinary target", startSec: 2 });
  const deleteEvent = jest.fn().mockResolvedValue({});
  render(<Wrapper events={[first, second]} consoleApi={makeConsoleApi({ deleteEvent })} />);
  fireEvent.click(screen.getByRole("button", { name: "Filter Moments" }));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Doubtful" }));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await waitFor(() => {
    expect(screen.queryByText("Ordinary target")).toBeNull();
  });
  await waitFor(() => {
    expect(document.body.textContent).toContain("Doubtful target");
  });
  const search = screen.getByPlaceholderText("Search moment");
  fireEvent.change(search, { target: { value: "Ordinary" } });
  expect(screen.queryByText("Doubtful target")).toBeNull();
  fireEvent.change(search, { target: { value: "target" } });
  await waitFor(() => {
    expect(document.body.textContent).toContain("Doubtful target");
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete All" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
  await waitFor(() => {
    expect(deleteEvent).toHaveBeenCalledTimes(2);
  });
});

describe("<EventsList />", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(["sidebar", "moments"] as const)(
    "clears hover when a %s row scrolls out of the virtual window without mouseleave",
    async (view) => {
      const events = Array.from({ length: 100 }, (_, index) =>
        makeEvent({ name: `events/row-${index}`, startSec: index }),
      );
      render(<Wrapper consoleApi={makeConsoleApi()} events={events} view={view} />);
      const label = await screen.findByText("events/row-0");
      let viewport = label.parentElement;
      while (viewport != undefined && viewport.style.overflow !== "auto") {
        viewport = viewport.parentElement;
      }
      expect(viewport).not.toBeNull();
      Object.defineProperties(viewport!, {
        clientHeight: { value: 600 },
        scrollHeight: { value: 20000 },
        clientWidth: { value: 300 },
        scrollWidth: { value: 20000 },
      });
      fireEvent.mouseEnter(label);
      expect(screen.getByTestId("hover-state").textContent).toBe("events/row-0|event_events/row-0");
      await act(async () => {
        fireEvent.scroll(viewport!, {
          target: view === "sidebar" ? { scrollTop: 5000 } : { scrollLeft: 5000 },
        });
      });
      expect(screen.queryByText("events/row-0")).toBeNull();
      expect(screen.getByTestId("hover-state").textContent).toBe("|");
    },
  );

  it.each(["sidebar", "moments"] as const)(
    "keeps %s local hover and selection still, then follows external hover after leaving",
    async (view) => {
      const events = Array.from({ length: 100 }, (_, index) =>
        makeEvent({ name: `events/row-${index}`, startSec: index }),
      );
      const seekPlayback = jest.fn();
      render(
        <Wrapper
          consoleApi={makeConsoleApi()}
          events={events}
          view={view}
          seekPlayback={seekPlayback}
          externalHoverEvent={events[90]}
        />,
      );
      // Use an edge row: scrolling the first row would also leave the offset at zero.
      const index = view === "sidebar" ? 3 : 1;
      const label = await screen.findByText(`events/row-${index}`);
      let viewport = label.parentElement;
      while (viewport != undefined && viewport.style.overflow !== "auto") {
        viewport = viewport.parentElement;
      }
      expect(viewport).not.toBeNull();
      const offset = view === "sidebar" ? "scrollTop" : "scrollLeft";
      expect(viewport![offset]).toBe(0);
      fireEvent.mouseEnter(label);
      expect(screen.getByTestId("hover-state").textContent).toBe(
        `events/row-${index}|event_events/row-${index}`,
      );
      expect(viewport![offset]).toBe(0);
      fireEvent.click(label);
      expect(screen.getByTestId("selected-event").textContent).toBe(`events/row-${index}`);
      expect(seekPlayback).toHaveBeenLastCalledWith(events[index]!.startTime);
      expect(viewport![offset]).toBe(0);
      fireEvent.mouseLeave(label);
      fireEvent.click(screen.getByRole("button", { name: "Hover external moment" }));
      await waitFor(() => {
        expect(screen.getByText("events/row-90")).toBeTruthy();
        expect(viewport![offset]).toBeGreaterThan(0);
      });
    },
  );

  it("resumes external hover after the horizontal list is emptied while hovered", async () => {
    const events = Array.from({ length: 100 }, (_, index) =>
      makeEvent({ name: `events/row-${index}`, startSec: index }),
    );
    const consoleApi = makeConsoleApi();
    const { rerender } = render(
      <Wrapper
        consoleApi={consoleApi}
        events={events}
        view="moments"
        externalHoverEvent={events[90]}
      />,
    );
    fireEvent.mouseEnter(await screen.findByText("events/row-1"));
    rerender(<Wrapper consoleApi={consoleApi} events={[]} view="moments" />);
    expect(screen.queryByText("events/row-1")).toBeNull();
    // Removing the hovered DOM node does not dispatch mouseleave.
    rerender(
      <Wrapper
        consoleApi={consoleApi}
        events={events}
        view="moments"
        externalHoverEvent={events[90]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hover external moment" }));
    expect(await screen.findByText("events/row-90")).toBeTruthy();
  });

  it("preserves initial group expansion when a refresh reorders records", async () => {
    const first = makeEvent({ name: "events/first", recordDisplayName: "Record A", startSec: 1 });
    const second = makeEvent({ name: "events/second", recordDisplayName: "Record B", startSec: 2 });
    const consoleApi = makeConsoleApi();
    const { rerender } = render(<Wrapper consoleApi={consoleApi} events={[first, second]} />);
    expect(
      (await screen.findByRole("button", { name: "Record A" })).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Record B" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    await act(async () => {
      rerender(<Wrapper consoleApi={consoleApi} events={[second, first]} />);
    });
    expect(screen.getByRole("button", { name: "Record A" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Record B" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.getByText("events/first")).toBeTruthy();
    expect(screen.queryByText("events/second")).toBeNull();
  });

  it("keeps explicit expansion choices across reorder and content refresh", async () => {
    const first = makeEvent({ name: "events/first", recordDisplayName: "Record A", startSec: 1 });
    const second = makeEvent({ name: "events/second", recordDisplayName: "Record B", startSec: 2 });
    const consoleApi = makeConsoleApi();
    const { rerender } = render(<Wrapper consoleApi={consoleApi} events={[first, second]} />);
    const firstHeader = await screen.findByRole("button", { name: "Record A" });
    await act(async () => {
      fireEvent.click(firstHeader);
      fireEvent.click(screen.getByRole("button", { name: "Record B" }));
    });
    await act(async () => {
      rerender(<Wrapper consoleApi={consoleApi} events={[{ ...second }, { ...first }]} />);
    });
    expect(screen.getByRole("button", { name: "Record A" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.getByRole("button", { name: "Record B" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(screen.queryByText("events/first")).toBeNull();
    expect(screen.getByText("events/second")).toBeTruthy();
  });

  it("initializes new groups once and discards expansion only when their group disappears", async () => {
    const first = makeEvent({ name: "events/first", recordDisplayName: "Record A", startSec: 1 });
    const second = makeEvent({ name: "events/second", recordDisplayName: "Record B", startSec: 2 });
    const inserted = makeEvent({
      name: "events/inserted",
      recordDisplayName: "Record C",
      startSec: 3,
    });
    const consoleApi = makeConsoleApi();
    const { rerender } = render(<Wrapper consoleApi={consoleApi} events={[first, second]} />);
    await screen.findByRole("button", { name: "Record A" });
    await act(async () => {
      rerender(<Wrapper consoleApi={consoleApi} events={[inserted, first, second]} />);
    });
    expect(screen.getByRole("button", { name: "Record C" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Record A" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Record B" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    await act(async () => {
      rerender(<Wrapper consoleApi={consoleApi} events={[second]} />);
    });
    expect(screen.getByRole("button", { name: "Record B" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    await act(async () => {
      rerender(<Wrapper consoleApi={consoleApi} events={[]} />);
    });
    expect(screen.queryByRole("button", { name: "Record B" })).toBeNull();
    await act(async () => {
      rerender(<Wrapper consoleApi={consoleApi} events={[second]} />);
    });
    expect(screen.getByRole("button", { name: "Record B" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(screen.getByText("events/second")).toBeTruthy();
  });

  it.each(["mounted", "unmounted"])(
    "reports deletion failure once even if the original row is %s",
    async (rowState) => {
      let rejectDeletion: (reason: Error) => void = () => {
        throw new Error("Deletion has not started");
      };
      const deleteEvent: jest.MockedFunction<DeleteEvent> = jest.fn().mockImplementation(
        async () =>
          await new Promise((_resolve, reject) => {
            rejectDeletion = reject;
          }),
      );
      const events = Array.from({ length: 100 }, (_, index) =>
        makeEvent({ name: `events/row-${index}`, startSec: index }),
      );
      render(<Wrapper consoleApi={makeConsoleApi({ deleteEvent })} events={events} />);
      const label = await screen.findByText("events/row-0");
      let viewport = label.parentElement;
      while (viewport != undefined && viewport.style.overflow !== "auto") {
        viewport = viewport.parentElement;
      }
      const button = screen.getAllByTitle("Delete")[0]!;
      fireEvent.pointerDown(button);
      fireEvent.click(button);
      fireEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }),
      );
      await waitFor(() => {
        expect(deleteEvent).toHaveBeenCalledTimes(1);
      });
      if (rowState === "unmounted") {
        Object.defineProperties(viewport!, {
          clientHeight: { value: 600 },
          scrollHeight: { value: 20000 },
        });
        await act(async () => {
          fireEvent.scroll(viewport!, { target: { scrollTop: 5000 } });
        });
        const nextRow = screen.getAllByTestId("sidebar-event").find((row) => !row.contains(label))!;
        fireEvent.pointerDown(nextRow);
        expect(screen.queryByText("events/row-0")).toBeNull();
      }
      await act(async () => {
        rejectDeletion(new Error("Delete failed"));
      });
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith("Error deleting event");
      expect(toast.success).not.toHaveBeenCalled();
      expect(screen.getByTestId("event-fetch-count").textContent).toBe("0");
    },
  );

  it("deletes all loaded events even when the list is filtered", async () => {
    const events = [
      makeEvent({ name: "events/event_1", startSec: 1 }),
      makeEvent({ name: "events/event_2", startSec: 2 }),
      makeEvent({ name: "events/event_3", startSec: 3 }),
    ];
    const deleteEvent: jest.MockedFunction<DeleteEvent> = jest.fn().mockResolvedValue({});

    render(<Wrapper consoleApi={makeConsoleApi({ deleteEvent })} events={events} />);

    fireEvent.change(await screen.findByPlaceholderText("Search moment"), {
      target: { value: "event_1" },
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("sidebar-event")).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete All" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(DELETE_CONFIRM_PROMPT)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteEvent).toHaveBeenCalledTimes(3);
    });

    expect(deleteEvent.mock.calls.map(([args]) => args.eventName)).toEqual(
      events.map((event) => event.event.name),
    );
    expect(toast.success).toHaveBeenCalledWith("Deleted 3 moments");
    expect(screen.getByTestId("event-fetch-count").textContent).toBe("1");
  });

  it("keeps deleting events when file deletion fails", async () => {
    const events = [makeEvent({ file: "files/event_1", name: "events/event_1", startSec: 1 })];
    const deleteEvent: jest.MockedFunction<DeleteEvent> = jest.fn().mockResolvedValue({});
    const fileDeleteError = new Error("file delete failed");
    const deleteFile: jest.MockedFunction<DeleteFile> = jest
      .fn()
      .mockRejectedValue(fileDeleteError);

    render(<Wrapper consoleApi={makeConsoleApi({ deleteEvent, deleteFile })} events={events} />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete All" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => {
      expect(deleteEvent).toHaveBeenCalledWith({ eventName: "events/event_1" });
    });
    expect(deleteFile).toHaveBeenCalledWith(expect.objectContaining({ name: "files/event_1" }));
    expect(toast.success).toHaveBeenCalledWith("Deleted 1 moments");

    expect(console.error).toHaveBeenCalledWith("Error deleting file", fileDeleteError);
    (console.error as jest.Mock).mockClear();
  });

  it("continues deleting events and reports partial failures", async () => {
    const events = [
      makeEvent({ name: "events/event_1", startSec: 1 }),
      makeEvent({ name: "events/event_2", startSec: 2 }),
      makeEvent({ name: "events/event_3", startSec: 3 }),
    ];
    const deleteEvent: jest.MockedFunction<DeleteEvent> = jest.fn(async ({ eventName }) => {
      if (eventName === "events/event_2") {
        throw new Error("failed");
      }

      return {};
    });

    render(<Wrapper consoleApi={makeConsoleApi({ deleteEvent })} events={events} />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete All" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => {
      expect(deleteEvent).toHaveBeenCalledTimes(3);
    });

    expect(toast.error).toHaveBeenCalledWith("Deleted 2 moments. Failed to delete 1 moments.");
    expect(screen.getByTestId("event-fetch-count").textContent).toBe("1");
  });

  it("does not render delete all without delete permission", async () => {
    const events = [makeEvent({ name: "events/event_1", startSec: 1 })];
    const deleteEvent: jest.MockedFunction<DeleteEvent> = jest.fn();

    render(
      <Wrapper consoleApi={makeConsoleApi({ canDelete: false, deleteEvent })} events={events} />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("sidebar-event")).toHaveLength(1);
    });

    expect(screen.queryByRole("button", { name: "Delete All" })).toBeNull();
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it("does not render delete all for archived project or record", async () => {
    const events = [makeEvent({ name: "events/event_1", startSec: 1 })];
    const consoleApi = makeConsoleApi();

    const { rerender } = render(
      <Wrapper consoleApi={consoleApi} events={events} projectArchived />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("sidebar-event")).toHaveLength(1);
    });
    expect(screen.queryByRole("button", { name: "Delete All" })).toBeNull();

    rerender(<Wrapper consoleApi={consoleApi} events={events} recordArchived />);

    await waitFor(() => {
      expect(screen.getAllByTestId("sidebar-event")).toHaveLength(1);
    });
    expect(screen.queryByRole("button", { name: "Delete All" })).toBeNull();
  });

  it("keeps a fetched sub-millisecond trigger time exact when entering edit", async () => {
    const event = makeEvent({
      name: "events/precise",
      startSec: 1,
      startNsec: 123_456_789,
    });

    render(<Wrapper consoleApi={makeConsoleApi()} events={[event]} />);

    fireEvent.click(await screen.findByTitle("Edit Moment"));

    await waitFor(() => {
      expect(screen.getByTestId("event-to-modify-start").textContent).toBe("1:123456789");
    });
  });
});

it("preserves the doubtful flag in the edit payload while hiding it from public metadata", async () => {
  const event = makeEvent({ name: "events/doubtful", startSec: 1 });
  event.event.customizedFields = { _doubtful: "true", public: "visible" };
  render(<Wrapper consoleApi={makeConsoleApi()} events={[event]} />);
  expect(screen.queryByText("_doubtful")).toBeNull();
  fireEvent.click(await screen.findByTitle("Edit Moment"));
  expect(JSON.parse(screen.getByTestId("event-to-modify-metadata").textContent)).toEqual([
    { key: "_doubtful", value: "true" },
    { key: "public", value: "visible" },
  ]);
});

it("offers sidebar focus and read-only details without seeking or opening an editor", async () => {
  const event = makeEvent({ name: "events/readonly", startSec: 1 });
  const seek = jest.fn();
  render(
    <Wrapper consoleApi={makeConsoleApi()} projectArchived events={[event]} seekPlayback={seek} />,
  );
  fireEvent.click(await screen.findByTitle("Focus this moment"));
  expect(screen.getByTestId("focused-event").textContent).toBe(event.event.name);
  expect(seek).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTitle("View Moment"));
  expect(screen.getByRole("dialog", { name: "View Moment" })).toBeTruthy();
  expect(screen.getByTestId("event-to-modify-start").textContent).toBe("undefined:undefined");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(seek).not.toHaveBeenCalled();
});

it("renders reference text verbatim in the Moment name and description", async () => {
  const runtime = createMockSegmentationRuntime(createSeedDocument());
  setMockControls(runtime.service, { delayMs: 0 });
  await runtime.initialize();
  testHost().session.setState({ runtime });
  try {
    const value = "spatial://record-1/class/class-1";
    const event = makeEvent({ name: "details", startSec: 1 });
    event.event.displayName = value;
    event.event.description = value;
    event.event.customizedFields = { target: value };
    render(
      <Wrapper consoleApi={makeConsoleApi()} projectArchived events={[event]} withReferences />,
      { wrapper: TestHostProvider },
    );
    fireEvent.click(await screen.findByTitle("View Moment"));
    const details = within(screen.getByRole("dialog", { name: "View Moment" }));
    expect(details.getAllByText(value)).toHaveLength(2);
    expect(details.getByText("Class · Person · class-1")).toBeTruthy();
  } finally {
    runtime.dispose();
  }
});

it("searches by the displayed target label and refreshes matches after a rename", async () => {
  const runtime = createMockSegmentationRuntime(createSeedDocument());
  setMockControls(runtime.service, { delayMs: 0 });
  await runtime.initialize();
  testHost().session.setState({ runtime });
  try {
    const event = makeEvent({ name: "With annotation", startSec: 1 });
    event.event.customizedFields = { target: "spatial://record-1/class/class-1" };
    render(<Wrapper consoleApi={makeConsoleApi()} events={[event]} withReferences />, {
      wrapper: TestHostProvider,
    });
    expect(await screen.findByText("Class · Person · class-1")).toBeTruthy();
    const search = screen.getByPlaceholderText("Search moment");
    fireEvent.change(search, { target: { value: "person" } });
    expect(screen.getByText("With annotation")).toBeTruthy();
    act(() => {
      runtime.store.getState().renameClass("class-1", "Technician");
    });
    expect(screen.queryByText("With annotation")).toBeNull();
    await act(async () => {
      fireEvent.change(search, { target: { value: "technician" } });
    });
    expect(screen.getByText("With annotation")).toBeTruthy();
    expect(screen.getByText("Technician").tagName).toBe("MARK");
    fireEvent.change(search, { target: { value: "spatial://" } });
    expect(screen.getByText("With annotation")).toBeTruthy();
  } finally {
    runtime.dispose();
  }
});
