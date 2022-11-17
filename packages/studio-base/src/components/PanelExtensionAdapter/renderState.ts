// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toSec } from "@foxglove/rostime";
import {
  AppSettingValue,
  MessageEvent,
  ParameterValue,
  RegisterMessageConverterArgs,
  RenderState,
  Subscription,
  Topic,
} from "@foxglove/studio";
import {
  EMPTY_GLOBAL_VARIABLES,
  GlobalVariables,
} from "@foxglove/studio-base/hooks/useGlobalVariables";
import { PlayerState, Topic as PlayerTopic } from "@foxglove/studio-base/players/types";
import { HoverValue } from "@foxglove/studio-base/types/hoverValue";

const EmptyParameters = new Map<string, ParameterValue>();

type BuilderRenderStateInput = {
  watchedFields: Set<string>;
  playerState: PlayerState | undefined;
  appSettings: Map<string, AppSettingValue> | undefined;
  currentFrame: MessageEvent<unknown>[] | undefined;
  colorScheme: RenderState["colorScheme"] | undefined;
  globalVariables: GlobalVariables;
  hoverValue: HoverValue | undefined;
  sortedTopics: readonly PlayerTopic[];
  subscriptions: Subscription[];
  messageConverters?: RegisterMessageConverterArgs[];
};

type BuildRenderStateFn = (input: BuilderRenderStateInput) => Readonly<RenderState> | undefined;

/**
 * initRenderStateBuilder creates a function that transforms render state input into a new
 * RenderState
 *
 * This function tracks previous input to determine what parts of the existing render state to
 * update or whether there are any updates
 *
 * @returns a function that accepts render state input and returns a new RenderState to render or
 * undefined if there's no update for rendering
 */
function initRenderStateBuilder(): BuildRenderStateFn {
  let prevVariables: GlobalVariables = EMPTY_GLOBAL_VARIABLES;
  let prevBlocks: unknown;
  let prevSeekTime: number | undefined;
  let prevSubscriptions: BuilderRenderStateInput["subscriptions"];
  let prevSortedTopics: BuilderRenderStateInput["sortedTopics"] | undefined;
  let prevMessageConverters: BuilderRenderStateInput["messageConverters"] | undefined;

  // Topics which we are subscribed without a conversion, these are topics we want to receive the original message
  const topicNoConversions: Set<string> = new Set();

  // Topic -> convertTo mapping. These are topics which we want to receive some converted data in the convertTo schema
  const topicConversions: Map<string, string> = new Map();

  // from + to -> converter mapping. Allows for quick lookup of a converter by its from and to schema names
  const convertersByKey: Map<string, RegisterMessageConverterArgs> = new Map();

  const prevRenderState: RenderState = {};

  return function buildRenderState(input: BuilderRenderStateInput) {
    const {
      playerState,
      watchedFields,
      appSettings,
      currentFrame,
      colorScheme,
      globalVariables,
      hoverValue,
      sortedTopics,
      messageConverters,
      subscriptions,
    } = input;

    // If the player has loaded all the blocks, the blocks reference won't change so our message
    // pipeline handler for allFrames won't create a new set of all frames for the newly
    // subscribed topic. To ensure a new set of allFrames with the newly subscribed topic is
    // created, we unset the blocks ref which will force re-creating allFrames.
    if (subscriptions !== prevSubscriptions) {
      prevBlocks = undefined;

      for (const subscription of subscriptions) {
        // fixme - what if the convertTo is the same as the topic datatype?
        // handle that here? elsewhere?
        // maybe in the subscription logic?
        if (subscription.convertTo) {
          topicConversions.set(subscription.topic, subscription.convertTo);
        } else {
          topicNoConversions.add(subscription.topic);
        }
      }
    }
    prevSubscriptions = subscriptions;

    // Should render indicates whether any fields of render state are updated
    let shouldRender = false;

    const activeData = playerState?.activeData;

    // The render state starts with the previous render state and changes are applied as detected
    const renderState: RenderState = prevRenderState;

    if (watchedFields.has("didSeek")) {
      const didSeek = prevSeekTime !== activeData?.lastSeekTime;
      if (didSeek !== renderState.didSeek) {
        renderState.didSeek = didSeek;
        shouldRender = true;
      }
      prevSeekTime = activeData?.lastSeekTime;
    }

    if (watchedFields.has("parameters")) {
      const parameters = activeData?.parameters ?? EmptyParameters;
      if (parameters !== renderState.parameters) {
        shouldRender = true;
        renderState.parameters = parameters;
      }
    }

    if (watchedFields.has("variables")) {
      if (globalVariables !== prevVariables) {
        shouldRender = true;
        prevVariables = globalVariables;
        renderState.variables = new Map(Object.entries(globalVariables));
      }
    }

    if (watchedFields.has("topics")) {
      if (sortedTopics !== prevSortedTopics || prevMessageConverters !== messageConverters) {
        shouldRender = true;

        const topics: Topic[] = [];

        for (const topic of sortedTopics) {
          const newTopic: Topic = {
            name: topic.name,
            datatype: topic.schemaName,
            schemaName: topic.schemaName,
          };

          if (messageConverters) {
            const additionalSchemaNames: string[] = [];

            // find any converters that can convert _from_ the schema name of the topic
            // the _to_ names of the converter become additional schema names for the topic entry
            for (const converter of messageConverters) {
              if (converter.fromSchemaName === topic.schemaName) {
                if (!additionalSchemaNames.includes(converter.toSchemaName)) {
                  additionalSchemaNames.push(converter.toSchemaName);
                }
              }
            }

            if (additionalSchemaNames.length > 0) {
              newTopic.additionalSchemaNames = additionalSchemaNames;
            }
          }

          topics.push(newTopic);
        }

        renderState.topics = topics;
        prevSortedTopics = sortedTopics;
      }
    }

    // Update the mapping of converters.
    // This needs to happen _after_ the above topics processing which re-runs if the message converters have changed,
    // and _before_ currentFrame and _allFrames_ processing which use this cache.
    if (messageConverters !== prevMessageConverters) {
      convertersByKey.clear();

      if (messageConverters) {
        for (const converter of messageConverters) {
          const key = converter.fromSchemaName + converter.toSchemaName;
          convertersByKey.set(key, converter);
        }
      }
    }
    prevMessageConverters = messageConverters;

    if (watchedFields.has("currentFrame")) {
      // If there are new frames we render
      // If there are old frames we render (new frames either replace old or no new frames)
      // Note: renderState.currentFrame.length !== currentFrame.length is wrong because it
      // won't render when the number of messages is the same from old to new
      if (renderState.currentFrame?.length !== 0 || currentFrame?.length !== 0) {
        shouldRender = true;

        if (currentFrame) {
          const postProcessedFrame: MessageEvent<unknown>[] = [];

          for (const messageEvent of currentFrame) {
            if (topicNoConversions.has(messageEvent.topic)) {
              postProcessedFrame.push(messageEvent);
            }

            // When subscribing with a convertTo, we have a topic + destination schema
            // to identify a potential converter to use we lookup a converter by the src schema + dest schema.
            // The src schema comes from the message event and the destination schema from the subscription

            // Lookup any subscriptions for this topic which want a conversion
            const subConvertTo = topicConversions.get(messageEvent.topic);
            if (subConvertTo) {
              const convertKey = messageEvent.schemaName + subConvertTo;
              const converter = convertersByKey.get(convertKey);
              if (converter) {
                const convertedMessage = converter.converter(messageEvent.message);
                postProcessedFrame.push({
                  topic: messageEvent.topic,
                  schemaName: converter.toSchemaName,
                  receiveTime: messageEvent.receiveTime,
                  message: convertedMessage,
                  originalMessageEvent: messageEvent,
                  sizeInBytes: messageEvent.sizeInBytes,
                });
              }
            }
          }

          renderState.currentFrame = postProcessedFrame;
        } else {
          renderState.currentFrame = undefined;
        }
      }
    }

    if (watchedFields.has("allFrames")) {
      // see comment for prevBlocksRef on why extended message store updates are gated this way
      const newBlocks = playerState?.progress.messageCache?.blocks;
      if (newBlocks && prevBlocks !== newBlocks) {
        shouldRender = true;
        const frames: MessageEvent<unknown>[] = (renderState.allFrames = []);
        for (const block of newBlocks) {
          if (!block) {
            continue;
          }

          for (const messageEvents of Object.values(block.messagesByTopic)) {
            for (const messageEvent of messageEvents) {
              // Message blocks may contain topics that we are not subscribed to so we need to filter those out.
              // We use the topicNoConversions and topicConversions to determine if we should include the message event

              if (topicNoConversions.has(messageEvent.topic)) {
                frames.push(messageEvent);
              }

              // Lookup any subscriptions for this topic which want a conversion
              const subConvertTo = topicConversions.get(messageEvent.topic);
              if (subConvertTo) {
                const convertKey = messageEvent.schemaName + subConvertTo;
                const converter = convertersByKey.get(convertKey);
                if (converter) {
                  const convertedMessage = converter.converter(messageEvent.message);
                  frames.push({
                    topic: messageEvent.topic,
                    schemaName: converter.toSchemaName,
                    receiveTime: messageEvent.receiveTime,
                    message: convertedMessage,
                    originalMessageEvent: messageEvent,
                    sizeInBytes: messageEvent.sizeInBytes,
                  });
                }
              }
            }
          }
        }
      }
      prevBlocks = newBlocks;
    }

    if (watchedFields.has("currentTime")) {
      const currentTime = activeData?.currentTime;

      if (currentTime != undefined && currentTime !== renderState.currentTime) {
        shouldRender = true;
        renderState.currentTime = currentTime;
      } else {
        if (renderState.currentTime != undefined) {
          shouldRender = true;
        }
        renderState.currentTime = undefined;
      }
    }

    if (watchedFields.has("previewTime")) {
      const startTime = activeData?.startTime;

      if (startTime != undefined && hoverValue != undefined) {
        const stamp = toSec(startTime) + hoverValue.value;
        if (stamp !== renderState.previewTime) {
          shouldRender = true;
        }
        renderState.previewTime = stamp;
      } else {
        if (renderState.previewTime != undefined) {
          shouldRender = true;
        }
        renderState.previewTime = undefined;
      }
    }

    if (watchedFields.has("colorScheme")) {
      if (colorScheme !== renderState.colorScheme) {
        shouldRender = true;
        renderState.colorScheme = colorScheme;
      }
    }

    if (watchedFields.has("appSettings")) {
      if (renderState.appSettings !== appSettings) {
        shouldRender = true;
        renderState.appSettings = appSettings;
      }
    }

    if (!shouldRender) {
      return undefined;
    }

    return renderState;
  };
}

export { initRenderStateBuilder };
