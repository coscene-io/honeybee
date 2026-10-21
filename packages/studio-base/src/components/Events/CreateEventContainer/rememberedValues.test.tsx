/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { UserSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/user_pb";
import {
  EventSchema,
  type Event,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha2/resources/event_pb";
import {
  CustomFieldSchemaSchema,
  CustomFieldValueSchema,
  type CustomFieldValue,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import cloneDeep from "lodash-es/cloneDeep";
import { useContext, useEffect, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { toast } from "react-hot-toast";
import type { StoreApi } from "zustand";

import {
  CustomFieldValuesForm,
  type FormWithCustomFieldValues,
} from "@foxglove/studio-base/components/CustomFieldProperty/form/CustomFieldValuesForm";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CoSceneCurrentUserContext,
  type UserStore,
} from "@foxglove/studio-base/context/CoSceneCurrentUserContext";
import { CoreDataContext, type CoreDataStore } from "@foxglove/studio-base/context/CoreDataContext";
import {
  EventsContext,
  useEvents,
  type EventsStore,
} from "@foxglove/studio-base/context/EventsContext";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import EventsProvider from "@foxglove/studio-base/providers/EventsProvider";
import MockCoSceneCurrentUserProvider from "@foxglove/studio-base/providers/MockCoSceneCurrentUserProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";

import { CreateEventContainer } from ".";
import type { CreateEventForm } from "./types";

let mockForm: UseFormReturn<CreateEventForm>;

// Keep the real custom-field controls and creation orchestration; omit unrelated
// playback/image controls so these tests can observe the form and API together.
jest.mock("./component/EventForm", () => ({
  EventForm: ({ form }: { form: UseFormReturn<CreateEventForm> }) => {
    mockForm = form;
    const schema = useEvents((store) => store.customFieldSchema);
    return (
      <CustomFieldValuesForm
        form={form as unknown as FormWithCustomFieldValues}
        properties={schema?.properties}
      />
    );
  },
}));
jest.mock("./component/TaskForm", () => ({ TaskForm: () => ReactNull }));

const projectName = "warehouses/warehouse/projects/project";
const samples: CustomFieldValue[] = [
  create(CustomFieldValueSchema, {
    property: {
      id: "text",
      name: "Text",
      description: "Text value",
      type: { case: "text", value: {} },
    },
    value: { case: "text", value: { value: "remember me" } },
  }),
  create(CustomFieldValueSchema, {
    property: {
      id: "number",
      name: "Number",
      description: "Number value",
      type: { case: "number", value: {} },
    },
    value: { case: "number", value: { value: 0 } },
  }),
  create(CustomFieldValueSchema, {
    property: { id: "time", name: "Time", type: { case: "time", value: {} } },
    value: { case: "time", value: { value: { seconds: 1785401051n, nanos: 363000001 } } },
  }),
  ...[false, true].map((multiple) =>
    create(CustomFieldValueSchema, {
      property: {
        id: `enum-${String(multiple)}`,
        name: `Enum ${String(multiple)}`,
        description: `Enum ${String(multiple)}`,
        type: { case: "enums", value: { multiple, values: { a: "Option A", b: "Option B" } } },
      },
      value: { case: "enums", value: multiple ? { ids: ["a", "b"] } : { id: "a" } },
    }),
  ),
  ...[false, true].map((multiple) =>
    create(CustomFieldValueSchema, {
      property: {
        id: `user-${String(multiple)}`,
        name: `User ${String(multiple)}`,
        description: `User ${String(multiple)}`,
        type: { case: "user", value: { multiple } },
      },
      value: { case: "user", value: { ids: multiple ? ["alice", "bob"] : ["alice"] } },
    }),
  ),
];
const schema = create(CustomFieldSchemaSchema, {
  properties: samples.map((value) => value.property!),
});

let coreStore: StoreApi<CoreDataStore>;
let eventsStore: StoreApi<EventsStore>;
let userStore: StoreApi<UserStore>;
let apiBaseUrl: string;
const createEvent = jest.fn(async ({ event }: { event: Event }) => event);
const createTask = Object.assign(
  jest.fn(async () => ({ name: "tasks/task" })),
  { permission: () => true },
);
const updateEvent = jest.fn(async () => create(EventSchema));
const listUsers = jest.fn(async () => [
  create(UserSchema, { name: "users/alice", nickname: "Alice", active: true }),
  create(UserSchema, { name: "users/bob", nickname: "Bob", active: true }),
]);
const apiMethods = {
  createEvent,
  createTask,
  updateEvent,
  listOrganizationUsers: listUsers,
  getBaseUrl: () => apiBaseUrl,
};
const api = apiMethods as unknown as NonNullable<
  React.ContextType<typeof CoSceneConsoleApiContext>
>;

function Seed(): ReactNull {
  coreStore = useContext(CoreDataContext)!;
  eventsStore = useContext(EventsContext)!;
  userStore = useContext(CoSceneCurrentUserContext)!;
  useEffect(() => {
    userStore.getState().setUser({
      userId: "mock-user",
      nickName: "Mock User",
      avatarUrl: "",
      phoneNumber: "",
      agreedAgreement: "",
      role: "",
      email: "mock@example.com",
      targetSite: "",
    });
    coreStore.getState().setExternalInitConfig({
      warehouseId: "warehouse",
      projectId: "project",
      recordId: "record",
    });
    eventsStore.getState().setCustomFieldSchema(schema, projectName);
    eventsStore
      .getState()
      .setEventMarks([{ key: "start", time: { sec: 1, nsec: 0 }, position: 0 }]);
  }, []);
  return ReactNull;
}

function Dialog(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
        }}
      >
        Open moment
      </button>
      {open && (
        <CreateEventContainer
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function TestRoot({ consoleApi = api }: { consoleApi?: typeof api }) {
  return (
    <ThemeProvider isDark>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <CoSceneConsoleApiContext.Provider value={consoleApi}>
          <CoreDataProvider>
            <EventsProvider>
              <CoScenePlaylistProvider>
                <MockCoSceneCurrentUserProvider>
                  <Seed />
                  <Dialog />
                </MockCoSceneCurrentUserProvider>
              </CoScenePlaylistProvider>
            </EventsProvider>
          </CoreDataProvider>
        </CoSceneConsoleApiContext.Provider>
      </LocalizationProvider>
    </ThemeProvider>
  );
}

function setup() {
  return render(<TestRoot />);
}

async function fill(values = samples) {
  await act(async () => {
    mockForm.setValue(
      "customFieldValues",
      Object.fromEntries(values.map((value) => [value.property!.id, cloneDeep(value)])),
    );
  });
}

async function submit() {
  fireEvent.click(document.getElementById("create-moment")!);
  await waitFor(() => {
    expect(document.getElementById("create-moment")).toBeNull();
  });
}

async function open() {
  await act(async () => {
    fireEvent.click(screen.getByText("Open moment"));
  });
}

beforeEach(() => {
  createEvent.mockClear();
  createTask.mockClear();
  updateEvent.mockClear();
  listUsers.mockReset();
  listUsers.mockResolvedValue([
    create(UserSchema, { name: "users/alice", nickname: "Alice", active: true }),
    create(UserSchema, { name: "users/bob", nickname: "Bob", active: true }),
  ]);
  apiBaseUrl = "https://api.test";
  jest.spyOn(toast, "success").mockImplementation(() => "success");
  jest.spyOn(toast, "error").mockImplementation(() => "error");
});

it("carries all supported field values through two creations, including zero and precise timestamps", async () => {
  setup();
  await open();
  await fill();
  await submit();
  await open();
  await waitFor(() => {
    expect(mockForm.getValues("customFieldValues.user-true").value.case).toBe("user");
  });
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("remember me");
  expect(screen.getByPlaceholderText<HTMLInputElement>("Number value").value).toBe("0");
  expect(Object.values(mockForm.getValues("customFieldValues") ?? {})).toEqual(samples);
  await submit();
  expect(createEvent).toHaveBeenCalledTimes(2);
  expect(createEvent.mock.calls[1]?.[0].event.customFieldValues).toEqual(samples);
});

it("does not let cancelled edits mutate the remembered snapshot", async () => {
  setup();
  await open();
  await fill();
  await submit();
  await open();
  await waitFor(() => {
    expect(mockForm.getValues("customFieldValues.user-true").value.case).toBe("user");
  });
  fireEvent.change(screen.getByPlaceholderText("Text value"), { target: { value: "cancelled" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await open();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("remember me");
  expect(createEvent).toHaveBeenCalledTimes(1);
});

it("retains earlier defaults after a failed create and supports retry", async () => {
  setup();
  await open();
  await fill();
  await submit();
  await open();
  fireEvent.change(screen.getByPlaceholderText("Text value"), { target: { value: "retry value" } });
  createEvent.mockRejectedValueOnce(new Error("failed create"));
  fireEvent.click(document.getElementById("create-moment")!);
  await waitFor(() => {
    expect(toast.error).toHaveBeenCalled();
  });
  expect(console.error).toHaveBeenCalledWith(expect.any(Error));
  (console.error as jest.Mock).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await open();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("remember me");
  await submit();
  expect(createEvent).toHaveBeenCalledTimes(3);
});

it("records clearing every custom field as the next empty default", async () => {
  setup();
  await open();
  await fill();
  await submit();
  await open();
  await waitFor(() => {
    expect(mockForm.getValues("customFieldValues.user-true").value.case).toBe("user");
  });
  await act(async () => {
    for (const sample of samples) {
      mockForm.setValue(
        `customFieldValues.${sample.property!.id}`,
        create(CustomFieldValueSchema, { property: sample.property }),
      );
    }
  });
  await submit();
  await open();
  await submit();
  expect(createEvent.mock.calls[2]?.[0].event.customFieldValues).toEqual([]);
  expect(createEvent.mock.calls[1]?.[0].event.customFieldValues).toEqual([]);
});

it("clears single and multi-select enums and people through the real controls", async () => {
  setup();
  await open();
  await fill();
  await submit();
  await open();
  for (const placeholder of ["Enum false", "Enum true", "User false", "User true"]) {
    const control = screen.getByText(placeholder).closest<HTMLElement>(".MuiFormControl-root")!;
    await act(async () => {
      fireEvent.click(within(control).getByLabelText("Clear"));
    });
  }
  fireEvent.change(screen.getByPlaceholderText("Text value"), { target: { value: "" } });
  fireEvent.change(screen.getByPlaceholderText("Number value"), { target: { value: "" } });
  await submit();
  expect(
    createEvent.mock.calls[1]?.[0].event.customFieldValues.map((value) => value.property?.id),
  ).toEqual(["time"]);
  await open();
  expect(mockForm.getValues("customFieldValues.enum-false")).toBeUndefined();
  expect(mockForm.getValues("customFieldValues.user-false")).toBeUndefined();
  expect(mockForm.getValues("customFieldValues.user-true")).toBeUndefined();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("");
  expect(screen.getByPlaceholderText<HTMLInputElement>("Number value").value).toBe("");
});

it("keeps defaults when an optional task fails after the Moment was created", async () => {
  setup();
  await open();
  await fill();
  fireEvent.click(screen.getByRole("checkbox"));
  createTask.mockRejectedValueOnce(new Error("task failed"));
  await submit();
  expect(console.error).toHaveBeenCalledWith(expect.any(Error));
  (console.error as jest.Mock).mockClear();
  await open();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("remember me");
});

it("does not overwrite remembered defaults when editing an existing Moment", async () => {
  setup();
  await open();
  await fill();
  await submit();
  await act(async () => {
    eventsStore.getState().setToModifyEvent({
      name: `${projectName}/events/existing`,
      eventName: "existing",
      startTime: { sec: 2, nsec: 0 },
      duration: 1,
      durationUnit: "sec",
      description: "",
      metadataEntries: [],
      enabledCreateNewTask: false,
      fileName: "",
      record: "",
      customFieldValues: [],
    });
  });
  await open();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("");
  fireEvent.change(screen.getByPlaceholderText("Text value"), { target: { value: "edited" } });
  await submit();
  await act(async () => {
    eventsStore.getState().setToModifyEvent(undefined);
  });
  await open();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("remember me");
  expect(updateEvent).toHaveBeenCalledTimes(1);
});

it("fills a late schema without replacing fields already entered by the user", async () => {
  setup();
  await open();
  await fill();
  await submit();
  await act(async () => {
    eventsStore.getState().setCustomFieldSchema(undefined);
  });
  await open();
  await act(async () => {
    mockForm.setValue(
      "customFieldValues.text",
      create(CustomFieldValueSchema, {
        property: samples[0]!.property,
        value: { case: "text", value: { value: "typed before schema" } },
      }),
    );
  });
  await act(async () => {
    eventsStore.getState().setCustomFieldSchema(schema, projectName);
  });
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe(
    "typed before schema",
  );
  expect(screen.getByPlaceholderText<HTMLInputElement>("Number value").value).toBe("0");
});

it("keeps defaults between records but clears them when the project changes", async () => {
  setup();
  await open();
  await fill();
  await submit();
  await act(async () => {
    coreStore.getState().setExternalInitConfig({
      warehouseId: "warehouse",
      projectId: "project",
      recordId: "other-record",
    });
  });
  await open();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("remember me");
  await act(async () => {
    coreStore
      .getState()
      .setExternalInitConfig({ warehouseId: "warehouse", projectId: "other-project" });
  });
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("");
});

it("ignores a late success after leaving and returning to a project and keeps the new dialog open", async () => {
  setup();
  await open();
  await fill();
  let resolve: (event: Event) => void = () => {};
  createEvent.mockImplementationOnce(
    async () =>
      await new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(document.getElementById("create-moment")!);
  await waitFor(() => {
    expect(createEvent).toHaveBeenCalledTimes(1);
  });
  await act(async () => {
    coreStore
      .getState()
      .setExternalInitConfig({ warehouseId: "warehouse", projectId: "other-project" });
  });
  await act(async () => {
    coreStore.getState().setExternalInitConfig({ warehouseId: "warehouse", projectId: "project" });
  });
  await act(async () => {
    resolve(create(EventSchema));
  });
  expect(document.getElementById("create-moment")).not.toBeNull();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("");
});

it("ignores remembered defaults from a different known account or endpoint", async () => {
  setup();
  await act(async () => {
    coreStore.getState().setBaseUrl("https://api.test");
  });
  await open();
  await fill();
  await submit();
  await act(async () => {
    userStore.getState().setUser({ ...userStore.getState().user!, userId: "other-user" });
  });
  await open();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("");
  await fill();
  await submit();
  await act(async () => {
    coreStore.getState().setBaseUrl("https://other-api.test");
  });
  await open();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("");
});

it("starts empty after the page providers are remounted", async () => {
  const view = setup();
  await open();
  await fill();
  await submit();
  view.unmount();
  setup();
  await open();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("");
  expect(screen.getByPlaceholderText<HTMLInputElement>("Number value").value).toBe("");
});

it("preserves input and defaults when the API client returns to its configured URL", async () => {
  const view = setup();
  apiBaseUrl = "https://cluster-api.test";
  await act(async () => {
    coreStore.getState().setBaseUrl(apiBaseUrl);
  });
  await open();
  await fill();
  await submit();
  await open();
  fireEvent.change(screen.getByPlaceholderText("Text value"), {
    target: { value: "current input" },
  });
  apiBaseUrl = "https://configured-api.test";
  await act(async () => {
    view.rerender(<TestRoot consoleApi={{ ...apiMethods } as unknown as typeof api} />);
  });
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("current input");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await open();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("remember me");
});

it("submits no hidden fields while schema is unavailable and preserves earlier defaults", async () => {
  setup();
  await open();
  await fill();
  await submit();
  await act(async () => {
    eventsStore.getState().setCustomFieldSchema(undefined, projectName);
  });
  await open();
  await fill();
  await submit();
  expect(createEvent.mock.calls[1]?.[0].event.customFieldValues).toEqual([]);
  await act(async () => {
    eventsStore.getState().setCustomFieldSchema(schema, projectName);
  });
  await open();
  expect(Object.values(mockForm.getValues("customFieldValues") ?? {})).toEqual(samples);
});

it("excludes fields removed from the schema while the dialog is open", async () => {
  setup();
  await open();
  await fill();
  await act(async () => {
    eventsStore
      .getState()
      .setCustomFieldSchema(
        create(CustomFieldSchemaSchema, { properties: [samples[0]!.property!] }),
        projectName,
      );
  });
  await submit();
  expect(createEvent.mock.calls[0]?.[0].event.customFieldValues).toEqual([samples[0]]);
});

it("does not restore a cancelled pending create into a newly opened form", async () => {
  setup();
  await open();
  await fill();
  let resolve: (event: Event) => void = () => {};
  createEvent.mockImplementationOnce(
    async () =>
      await new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(document.getElementById("create-moment")!);
  await waitFor(() => {
    expect(createEvent).toHaveBeenCalledTimes(1);
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => {
    eventsStore.getState().setCustomFieldSchema(undefined, projectName);
  });
  await open();
  await act(async () => {
    resolve(create(EventSchema));
    eventsStore.getState().setCustomFieldSchema(schema, projectName);
  });
  expect(document.getElementById("create-moment")).not.toBeNull();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await open();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("");
});

it.each(["create", "update", "task"] as const)(
  "refreshes a successful %s after the dialog was cancelled",
  async (kind) => {
    setup();
    if (kind === "update") {
      await act(async () => {
        eventsStore.getState().setToModifyEvent({
          name: `${projectName}/events/existing`,
          eventName: "existing",
          startTime: { sec: 2, nsec: 0 },
          duration: 1,
          durationUnit: "sec",
          description: "",
          metadataEntries: [],
          enabledCreateNewTask: false,
          fileName: "",
          record: "",
          customFieldValues: [],
        });
      });
    }
    await open();
    await fill();
    let resolve: () => void = () => {};
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    if (kind === "create") {
      createEvent.mockImplementationOnce(async ({ event }) => {
        await pending;
        return event;
      });
    }
    if (kind === "update") {
      updateEvent.mockImplementationOnce(async () => {
        await pending;
        return create(EventSchema);
      });
    }
    if (kind === "task") {
      fireEvent.click(screen.getByRole("checkbox"));
      createTask.mockImplementationOnce(async () => {
        await pending;
        return { name: "tasks/task" };
      });
    }
    fireEvent.click(document.getElementById("create-moment")!);
    await waitFor(() => {
      expect(
        kind === "update" ? updateEvent : kind === "task" ? createTask : createEvent,
      ).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(eventsStore.getState().eventFetchCount).toBe(0);
    await act(async () => {
      resolve();
    });
    expect(eventsStore.getState().eventFetchCount).toBe(1);
  },
);

it("allows creation and editing when current-user information remains unavailable", async () => {
  setup();
  await act(async () => {
    userStore.getState().setUser(undefined);
  });
  await open();
  await fill();
  await submit();
  await act(async () => {
    eventsStore.getState().setToModifyEvent({
      name: `${projectName}/events/existing`,
      eventName: "existing",
      startTime: { sec: 2, nsec: 0 },
      duration: 1,
      durationUnit: "sec",
      description: "",
      metadataEntries: [],
      enabledCreateNewTask: false,
      fileName: "",
      record: "",
      customFieldValues: [samples[1]!],
    });
  });
  await open();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("");
  expect(screen.getByPlaceholderText<HTMLInputElement>("Number value").value).toBe("0");
  await submit();
  expect(createEvent).toHaveBeenCalledTimes(1);
  expect(updateEvent).toHaveBeenCalledTimes(1);
  expect(userStore.getState().user).toBeUndefined();
});

it("keeps the current draft when account information arrives late", async () => {
  setup();
  const user = userStore.getState().user;
  await act(async () => {
    userStore.getState().setUser(undefined);
  });
  await open();
  fireEvent.change(screen.getByPlaceholderText("Text value"), {
    target: { value: "typed before account hydration" },
  });
  await act(async () => {
    userStore.getState().setUser(user);
  });
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe(
    "typed before account hydration",
  );
  await submit();
  await open();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe(
    "typed before account hydration",
  );
});

it("preserves defaults and input when endpoint configuration hydrates with the current URL", async () => {
  setup();
  await open();
  await fill();
  await submit();
  await open();
  fireEvent.change(screen.getByPlaceholderText("Text value"), {
    target: { value: "unsaved input" },
  });
  await act(async () => {
    coreStore.getState().setBaseUrl(apiBaseUrl);
  });
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("unsaved input");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await open();
  expect(screen.getByPlaceholderText<HTMLInputElement>("Text value").value).toBe("remember me");
});
