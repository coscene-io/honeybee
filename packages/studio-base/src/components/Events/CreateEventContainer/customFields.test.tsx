/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { ProjectSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/project_pb";
import { EventSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";
import { RecordSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/record_pb";
import { CustomFieldValueSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { createStore } from "zustand";

import { EventsList } from "@foxglove/studio-base/components/Events/EventsList";
import { EventsSyncAdapter } from "@foxglove/studio-base/components/Events/EventsSyncAdapter";
import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import { MomentTrackList } from "@foxglove/studio-base/components/PlaybackControls/MomentTrackList";
import {
  getMomentTracks,
  layoutMomentTracks,
} from "@foxglove/studio-base/components/PlaybackControls/momentTracks";
import { makeTimelineViewport } from "@foxglove/studio-base/components/PlaybackControls/timelineViewport";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoScenePlaylistContext,
  type CoScenePlaylistStore,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { useEvents } from "@foxglove/studio-base/context/EventsContext";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import DialogsProvider from "@foxglove/studio-base/providers/DialogsProvider";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import TimelineInteractionStateProvider from "@foxglove/studio-base/providers/TimelineInteractionStateProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import { CustomFieldSchemaSchema } from "@foxglove/studio-base/services/api/moment-custom-field/generated/common/custom_field_pb";
import { makeMomentFixture } from "@foxglove/studio-base/test/fixtures/moments";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import { CreateEventContainer } from ".";

const owner = "warehouses/warehouse/projects/project";
const schema = create(CustomFieldSchemaSchema, {
  properties: [
    {
      id: "creation-type",
      name: "Creation type",
      description: "Creation type",
      type: { case: "enums", value: { values: { auto: "Automatic", manual: "Manual" } } },
    },
    {
      id: "kind",
      name: "Kind",
      description: "Kind",
      type: { case: "enums", value: { values: { qa: "QA" } } },
    },
  ],
  groupingRules: [{ propertyId: "kind" }, { propertyId: "creation-type" }],
});

function SeedCoreData(): ReactNull {
  const setExternalInitConfig = useCoreData((store) => store.setExternalInitConfig);
  const setProject = useCoreData((store) => store.setProject);
  const setRecord = useCoreData((store) => store.setRecord);
  useEffect(() => {
    setExternalInitConfig({ warehouseId: "warehouse", projectId: "project", recordId: "record" });
    setProject({ loading: false, value: create(ProjectSchema, { name: owner }) });
    setRecord({ loading: false, value: create(RecordSchema, { name: `${owner}/records/record` }) });
  }, [setExternalInitConfig, setProject, setRecord]);
  return ReactNull;
}

function Views(): React.JSX.Element {
  const events = useEvents((store) => store.events.value);
  const currentSchema = useEvents((store) => store.customFieldSchema);
  const toModifyEvent = useEvents((store) => store.toModifyEvent);
  const setToModifyEvent = useEvents((store) => store.setToModifyEvent);
  const layout = layoutMomentTracks({
    tracks: getMomentTracks(events ?? [], currentSchema, owner),
    view: {},
    viewport: makeTimelineViewport(0, 10),
  });
  return (
    <>
      <EventsSyncAdapter />
      <section data-testid="list">
        <EventsList />
      </section>
      <MomentTrackList layout={layout} view={{}} onViewChange={() => {}} />
      {toModifyEvent && (
        <section data-testid="editor">
          <CreateEventContainer
            onClose={() => {
              setToModifyEvent(undefined);
            }}
          />
        </section>
      )}
    </>
  );
}

function setup({ keepAnother = false, withKind = true } = {}) {
  const playlistStore = createStore<CoScenePlaylistStore>(() => ({
    bagFiles: {
      loading: false,
      value: [
        {
          name: `${owner}/records/record/files/file`,
          displayName: "file",
          fileType: "NORMAL_FILE",
          mediaStatues: "OK",
          startTime: { sec: 0, nsec: 0 },
          endTime: { sec: 3600, nsec: 0 },
        },
      ],
    },
    setBagFiles: jest.fn(),
    setCurrentBagFiles: jest.fn(),
  }));
  const entries = makeMomentFixture(keepAnother ? 2 : 1, "short", { sec: 0, nsec: 0 });
  let saved = entries.map(({ event }, index) =>
    create(EventSchema, {
      ...event,
      name: `${owner}/events/${index}`,
      displayName: `Moment ${index}`,
      record: `${owner}/records/record`,
      customFieldValues: schema.properties
        .filter((property) => withKind || property.id !== "kind")
        .map((property) =>
          create(CustomFieldValueSchema, {
            property,
            value: { case: "enums", value: { id: property.id === "kind" ? "qa" : "auto" } },
          }),
        ),
    }),
  );
  const getEvents = jest.fn(async () =>
    saved.map((event) => ({
      event: fromBinary(EventSchema, toBinary(EventSchema, event)),
      recordDisplayName: "Record",
      projectDisplayName: "Project",
    })),
  );
  type UpdateArgs = Parameters<
    NonNullable<React.ContextType<typeof CoSceneConsoleApiContext>>["updateEvent"]
  >[0];
  const updateEvent = jest.fn(async ({ event, updateMask }: UpdateArgs) => {
    expect(updateMask.paths).toContain("customFieldValues");
    // Model replacement under the update mask, including an empty repeated field on the wire.
    const decoded = fromBinary(EventSchema, toBinary(EventSchema, event));
    saved = saved.map((old) =>
      old.name === event.name ? { ...old, customFieldValues: decoded.customFieldValues } : old,
    );
  });
  const consoleApi = {
    getEvents,
    getMomentCustomFieldSchema: jest.fn().mockResolvedValue(schema),
    updateEvent: Object.assign(updateEvent, { permission: () => true }),
    deleteEvent: Object.assign(jest.fn(), { permission: () => false }),
    batchGetUsers: jest.fn().mockResolvedValue({ users: [] }),
    getDiagnosisRule: jest.fn().mockResolvedValue(undefined),
  } as unknown as React.ContextType<typeof CoSceneConsoleApiContext>;
  const content = (
    <ThemeProvider isDark={false}>
      <WorkspaceContextProvider disablePersistence>
        <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
          <CoSceneConsoleApiContext.Provider value={consoleApi}>
            <DialogsProvider>
              <CoreDataProvider>
                <CoScenePlaylistContext.Provider value={playlistStore}>
                  <EventsProvider>
                    <TimelineInteractionStateProvider>
                      <MockMessagePipelineProvider
                        startTime={{ sec: 0, nsec: 0 }}
                        currentTime={{ sec: 0, nsec: 0 }}
                        endTime={{ sec: 3600, nsec: 0 }}
                      >
                        <SeedCoreData />
                        <Views />
                      </MockMessagePipelineProvider>
                    </TimelineInteractionStateProvider>
                  </EventsProvider>
                </CoScenePlaylistContext.Provider>
              </CoreDataProvider>
            </DialogsProvider>
          </CoSceneConsoleApiContext.Provider>
        </AppConfigurationContext.Provider>
      </WorkspaceContextProvider>
    </ThemeProvider>
  );
  return { ...render(content), content, getEvents, updateEvent };
}

function clearCreationType() {
  const editor = within(screen.getByTestId("editor"));
  const input = editor.getByRole("combobox", { name: "Creation type" });
  fireEvent.focus(input);
  const field = input.closest(".MuiAutocomplete-root")!;
  fireEvent.click(within(field as HTMLElement).getByTitle("Clear"));
  expect((input as HTMLInputElement).value).toBe("");
}

it.each([
  { keepAnother: false, withKind: true },
  { keepAnother: true, withKind: true },
  { keepAnother: false, withKind: false },
])(
  "persists clearing through refresh and reopening, updating list and groups (another=$keepAnother, other field=$withKind)",
  async ({ keepAnother, withKind }) => {
    const { updateEvent, getEvents, unmount, content } = setup({ keepAnother, withKind });
    await screen.findByText(`Creation type: Automatic (${keepAnother ? 2 : 1})`);
    fireEvent.click(screen.getAllByTitle("Edit Moment")[0]!);
    clearCreationType();
    fireEvent.click(within(screen.getByTestId("editor")).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByTestId("editor")).toBeNull();
    });
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(
      updateEvent.mock.calls[0]![0].event.customFieldValues.map((field) => field.property?.id),
    ).toEqual(withKind ? ["kind"] : []);
    expect(getEvents).toHaveBeenCalledTimes(2);
    const list = within(screen.getByTestId("list"));
    await waitFor(() => {
      expect(list.queryAllByText("Automatic")).toHaveLength(keepAnother ? 1 : 0);
    });
    expect(list.queryAllByText("QA")).toHaveLength(withKind ? (keepAnother ? 2 : 1) : 0);
    expect(
      within(screen.getByTestId("moment-track-list")).getByText(
        withKind ? `Kind: QA (${keepAnother ? 2 : 1})` : "Not filled (1)",
      ),
    ).toBeTruthy();
    if (keepAnother) {
      expect(screen.getByText("Creation type: Automatic (1)")).toBeTruthy();
    } else {
      expect(screen.queryByText(/Creation type:/)).toBeNull();
    }
    fireEvent.click(screen.getAllByTitle("Edit Moment")[0]!);
    expect(
      within(screen.getByTestId("editor")).getByRole<HTMLInputElement>("combobox", {
        name: "Creation type",
      }).value,
    ).toBe("");
    fireEvent.click(within(screen.getByTestId("editor")).getByRole("button", { name: "Cancel" }));
    // A fresh provider tree forces a server read instead of relying on the previous form or store.
    unmount();
    render(content);
    await waitFor(() => {
      expect(screen.getAllByTitle("Edit Moment")).toHaveLength(keepAnother ? 2 : 1);
    });
    fireEvent.click(screen.getAllByTitle("Edit Moment")[0]!);
    expect(
      within(screen.getByTestId("editor")).getByRole<HTMLInputElement>("combobox", {
        name: "Creation type",
      }).value,
    ).toBe("");
  },
);

it("keeps the saved value and grouping when a clear is cancelled", async () => {
  const { updateEvent } = setup();
  await screen.findByText("Creation type: Automatic (1)");
  fireEvent.click(screen.getByTitle("Edit Moment"));
  clearCreationType();
  fireEvent.click(within(screen.getByTestId("editor")).getByRole("button", { name: "Cancel" }));
  expect(updateEvent).not.toHaveBeenCalled();
  expect(within(screen.getByTestId("list")).getByText("Automatic")).toBeTruthy();
  expect(screen.getByText("Creation type: Automatic (1)")).toBeTruthy();
  fireEvent.click(screen.getByTitle("Edit Moment"));
  expect(
    within(screen.getByTestId("editor")).getByRole<HTMLInputElement>("combobox", {
      name: "Creation type",
    }).value,
  ).toBe("Automatic");
});

it("retains the cleared draft on save failure without changing saved list values or groups", async () => {
  const { updateEvent, getEvents } = setup();
  const error = new Error("Update failed");
  updateEvent.mockRejectedValueOnce(error);
  await screen.findByText("Creation type: Automatic (1)");
  fireEvent.click(screen.getByTitle("Edit Moment"));
  clearCreationType();
  fireEvent.click(within(screen.getByTestId("editor")).getByRole("button", { name: "Save" }));
  await waitFor(() => {
    expect(console.error).toHaveBeenCalledWith(error);
  });
  (console.error as jest.Mock).mockClear();
  expect(getEvents).toHaveBeenCalledTimes(1);
  expect(within(screen.getByTestId("list")).getByText("Automatic")).toBeTruthy();
  expect(screen.getByText("Creation type: Automatic (1)")).toBeTruthy();
  const editor = within(screen.getByTestId("editor"));
  expect(editor.getByRole<HTMLInputElement>("combobox", { name: "Creation type" }).value).toBe("");
  // Retrying the same cleared draft must persist it rather than restoring the previous value.
  fireEvent.click(editor.getByRole("button", { name: "Save" }));
  await waitFor(() => {
    expect(screen.queryByTestId("editor")).toBeNull();
  });
  expect(updateEvent).toHaveBeenCalledTimes(2);
  expect(within(screen.getByTestId("list")).queryByText("Automatic")).toBeNull();
  expect(screen.queryByText(/Creation type:/)).toBeNull();
});
