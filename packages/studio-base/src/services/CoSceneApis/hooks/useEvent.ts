// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable no-restricted-syntax */

import { coSceneContextAtom } from "@coscene-io/coscene/atoms";
import { EventInfo, ListEventsProps } from "@coscene-io/coscene/models";
import {
  CreateEventRequest,
  DeleteEventRequest,
  Event,
  GetEventRequest,
  ListEventsRequest,
  UpdateEventRequest,
} from "@coscene-io/coscene/proto/v1alpha2";
import {
  Endpoint,
  GENERAL_STALE_TIME_DEFAULT,
  Gated,
  eventClient,
  queryClient,
  useBatchGetUsers,
  usePaginatedQuery,
} from "@coscene-io/coscene/queries";
import { FieldMask } from "google-protobuf/google/protobuf/field_mask_pb";
import { useMutation, useQuery } from "react-query";
import { useRecoilValue } from "recoil";

interface ListEventsPropsLocal extends ListEventsProps {
  headless: boolean;
}

export const useListEvents = new Gated(
  (HavePermission) => (params: ListEventsPropsLocal) => {
    const { headless = true } = params;

    const { data, ...rest } = usePaginatedQuery(
      ["getEventList", params.parent],
      () => new ListEventsRequest().setParent(params.parent).setOrderBy(params.orderBy),
      async (req: ListEventsRequest) => await eventClient.listEvents(req),
      {
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        initialPageSize: params.initializePageSize || 10,
        defaultFilter: params.filter,
        options: { enabled: HavePermission, staleTime: GENERAL_STALE_TIME_DEFAULT },
      },
      headless,
    );

    const eventList = data?.getEventsList() || [];
    const eventInfoList: EventInfo[] = eventList.map((event) => {
      return {
        metadata: event,
        relatedRecordList: [],
        assigner: "",
        assignerAvatar: "",
        assignee: "",
        assigneeAvatar: "",
      };
    });

    const userIds: string[] = [];
    eventList.forEach((event) => {
      const assignee: undefined | string = event.getTask()?.getAssignee();
      const assigner: undefined | string = event.getTask()?.getAssigner();
      if (assignee) {
        userIds.push(assignee);
      }
      if (assigner) {
        userIds.push(assigner);
      }
    });

    const { data: userInfoData } = useBatchGetUsers.hook(userIds);

    const userInfoList = userInfoData?.getUsersList() || [];
    const eventInfoWithUsers = eventInfoList.map((eventInfo) => {
      const assigner =
        userInfoList
          .find((user) => user.getName() === eventInfo.metadata.getTask()?.getAssigner())
          ?.getNickname() || "";
      const assignerAvatar =
        userInfoList
          .find((user) => user.getName() === eventInfo.metadata.getTask()?.getAssigner())
          ?.getAvatar() || "";
      const assignee =
        userInfoList
          .find((user) => user.getName() === eventInfo.metadata.getTask()?.getAssignee())
          ?.getNickname() || "";
      const assigneeAvatar =
        userInfoList
          .find((user) => user.getName() === eventInfo.metadata.getTask()?.getAssignee())
          ?.getAvatar() || "";

      return {
        assigner,
        assignerAvatar,
        assignee,
        assigneeAvatar,
        metadata: eventInfo.metadata,
        relatedRecordList: eventInfo.relatedRecordList,
      };
    });

    return {
      eventInfoList: eventInfoWithUsers,
      ...rest,
    };
  },
  Endpoint.ListEvents,
);

export const useGetEvent = new Gated(
  (havePermission) => (eventId?: string) => {
    return useQuery(
      ["getEvent", eventId],
      async () => {
        const req = new GetEventRequest();
        req.setName(eventId!);
        try {
          return await eventClient.getEvent(req);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          console.log("error code: ", error.code);
          console.log("error message: ", error.message);
          throw new Error("Error calling the GRPC API");
        }
      },
      { enabled: !!eventId && havePermission },
    );
  },
  Endpoint.GetEvent,
);

export const useCreateNewEvent = new Gated(
  () => () => {
    const { currentWarehouseId, currentProjectId } = useRecoilValue(coSceneContextAtom);
    return useMutation(
      async ({ newEvent, recordId }: { newEvent: Event; recordId: string }) => {
        const createEventRequest = new CreateEventRequest();
        createEventRequest.setParent(
          `warehouses/${currentWarehouseId}/projects/${currentProjectId}`,
        );
        createEventRequest.setEvent(newEvent);
        createEventRequest.setRecord(recordId);

        try {
          await eventClient.createEvent(createEventRequest);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          console.log("error code: ", error.code);
          console.log("error message: ", error.message);
          throw new Error("Error calling the GRPC API");
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries(["getEventList"]);
        },
      },
    );
  },
  Endpoint.CreateEvent,
);

export const useDeleteEvent = new Gated(
  () => () => {
    return useMutation(async (name: string) => {
      const req = new DeleteEventRequest().setName(name);

      try {
        await eventClient.deleteEvent(req);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        console.log("error code: ", error.code);
        console.log("error message: ", error.message);
        throw new Error("Error calling the GRPC API");
      }
    });
  },
  Endpoint.DeleteEvent,
);

export const useUpdateEvent = new Gated(
  () => () => {
    return useMutation(async ({ event, updateMask }: { event: Event; updateMask: FieldMask }) => {
      const req = new UpdateEventRequest();
      req.setEvent(event);
      req.setUpdateMask(updateMask);

      try {
        await eventClient.updateEvent(req);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        console.log("error code: ", error.code);
        console.log("error message: ", error.message);
        throw new Error("Error calling the GRPC API");
      }
    });
  },
  Endpoint.UpdateEvent,
);
