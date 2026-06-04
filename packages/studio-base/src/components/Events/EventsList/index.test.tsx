/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { ProjectSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/project_pb";
import { EventSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";
import { RecordSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/record_pb";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  type TimelinePositionedEvent,
  useEvents,
} from "@foxglove/studio-base/context/EventsContext";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import DialogsProvider from "@foxglove/studio-base/providers/DialogsProvider";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import TimelineInteractionStateProvider from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

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
  startSec,
}: {
  file?: string;
  name: string;
  startSec: number;
}): TimelinePositionedEvent {
  return {
    event: create(EventSchema, {
      name,
      displayName: name,
      triggerTime: create(TimestampSchema, { seconds: BigInt(startSec), nanos: 0 }),
      duration: create(DurationSchema, { seconds: BigInt(1), nanos: 0 }),
      files: file == undefined ? [] : [file],
    }),
    startTime: { sec: startSec, nsec: 0 },
    endTime: { sec: startSec + 1, nsec: 0 },
    color: "#00ADEF",
    startPosition: startSec / 10,
    endPosition: (startSec + 1) / 10,
    secondsSinceStart: startSec,
    projectDisplayName: "Project",
    recordDisplayName: "Record",
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

function SeedEvents({ events }: { events: TimelinePositionedEvent[] }): ReactNull {
  const setEvents = useEvents((store: EventsStore) => store.setEvents);

  useEffect(() => {
    setEvents({ loading: false, value: events });
  }, [events, setEvents]);

  return ReactNull;
}

function EventFetchCountProbe(): React.JSX.Element {
  const eventFetchCount = useEvents((store: EventsStore) => store.eventFetchCount);
  return <div data-testid="event-fetch-count">{eventFetchCount}</div>;
}

function Wrapper({
  consoleApi,
  events,
  projectArchived,
  recordArchived,
}: {
  consoleApi: React.ContextType<typeof CoSceneConsoleApiContext>;
  events: TimelinePositionedEvent[];
  projectArchived?: boolean;
  recordArchived?: boolean;
}): React.JSX.Element {
  return (
    <ThemeProvider isDark>
      <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
        <CoSceneConsoleApiContext.Provider value={consoleApi}>
          <DialogsProvider>
            <CoreDataProvider>
              <EventsProvider>
                <TimelineInteractionStateProvider>
                  <MockMessagePipelineProvider
                    startTime={{ sec: 0, nsec: 0 }}
                    currentTime={{ sec: 0, nsec: 0 }}
                    endTime={{ sec: 10, nsec: 0 }}
                  >
                    <SeedCoreData
                      projectArchived={projectArchived}
                      recordArchived={recordArchived}
                    />
                    <SeedEvents events={events} />
                    <EventFetchCountProbe />
                    <EventsList />
                    <TestDialogs />
                  </MockMessagePipelineProvider>
                </TimelineInteractionStateProvider>
              </EventsProvider>
            </CoreDataProvider>
          </DialogsProvider>
        </CoSceneConsoleApiContext.Provider>
      </AppConfigurationContext.Provider>
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

describe("<EventsList />", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
});
