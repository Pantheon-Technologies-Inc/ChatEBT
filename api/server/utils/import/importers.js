const { v4: uuidv4 } = require('uuid');
const { EModelEndpoint, Constants, openAISettings, CacheKeys } = require('librechat-data-provider');
const { createImportBatchBuilder } = require('./importBatchBuilder');
const { cloneMessagesWithTimestamps } = require('./fork');
const getLogStores = require('~/cache/getLogStores');
const logger = require('~/config/winston');

/**
 * Returns the appropriate importer function based on the provided JSON data.
 *
 * @param {Object} jsonData - The JSON data to import.
 * @returns {Function} - The importer function.
 * @throws {Error} - If the import type is not supported.
 */
function getImporter(jsonData) {
  // For ChatGPT
  if (Array.isArray(jsonData)) {
    logger.info('Importing ChatGPT conversation');
    return importChatGptConvo;
  }

  // For ChatbotUI
  if (jsonData.version && Array.isArray(jsonData.history)) {
    logger.info('Importing ChatbotUI conversation');
    return importChatBotUiConvo;
  }

  // For LibreChat
  if (jsonData.conversationId && (jsonData.messagesTree || jsonData.messages)) {
    logger.info('Importing LibreChat conversation');
    return importLibreChatConvo;
  }

  throw new Error('Unsupported import type');
}

/**
 * Imports a chatbot-ui V1  conversation from a JSON file and saves it to the database.
 *
 * @param {Object} jsonData - The JSON data containing the chatbot conversation.
 * @param {string} requestUserId - The ID of the user making the import request.
 * @param {Function} [builderFactory=createImportBatchBuilder] - The factory function to create an import batch builder.
 * @returns {Promise<void>} - A promise that resolves when the import is complete.
 * @throws {Error} - If there is an error creating the conversation from the JSON file.
 */
async function importChatBotUiConvo(
  jsonData,
  requestUserId,
  builderFactory = createImportBatchBuilder,
) {
  // this have been tested with chatbot-ui V1 export https://github.com/mckaywrigley/chatbot-ui/tree/b865b0555f53957e96727bc0bbb369c9eaecd83b#legacy-code
  try {
    /** @type {ImportBatchBuilder} */
    const importBatchBuilder = builderFactory(requestUserId);

    for (const historyItem of jsonData.history) {
      importBatchBuilder.startConversation(EModelEndpoint.openAI);
      for (const message of historyItem.messages) {
        if (message.role === 'assistant') {
          importBatchBuilder.addGptMessage(message.content, historyItem.model.id);
        } else if (message.role === 'user') {
          importBatchBuilder.addUserMessage(message.content);
        }
      }
      importBatchBuilder.finishConversation(historyItem.name, new Date());
    }
    await importBatchBuilder.saveBatch();
    logger.info(`user: ${requestUserId} | ChatbotUI conversation imported`);
  } catch (error) {
    logger.error(`user: ${requestUserId} | Error creating conversation from ChatbotUI file`, error);
  }
}

/**
 * Imports a LibreChat conversation from JSON.
 *
 * @param {Object} jsonData - The JSON data representing the conversation.
 * @param {string} requestUserId - The ID of the user making the import request.
 * @param {Function} [builderFactory=createImportBatchBuilder] - The factory function to create an import batch builder.
 * @returns {Promise<void>} - A promise that resolves when the import is complete.
 */
async function importLibreChatConvo(
  jsonData,
  requestUserId,
  builderFactory = createImportBatchBuilder,
) {
  try {
    /** @type {ImportBatchBuilder} */
    const importBatchBuilder = builderFactory(requestUserId);
    const options = jsonData.options || {};

    /* Endpoint configuration */
    let endpoint = jsonData.endpoint ?? options.endpoint ?? EModelEndpoint.openAI;
    const cache = getLogStores(CacheKeys.CONFIG_STORE);
    const endpointsConfig = await cache.get(CacheKeys.ENDPOINT_CONFIG);
    const endpointConfig = endpointsConfig?.[endpoint];
    if (!endpointConfig && endpointsConfig) {
      endpoint = Object.keys(endpointsConfig)[0];
    } else if (!endpointConfig) {
      endpoint = EModelEndpoint.openAI;
    }

    importBatchBuilder.startConversation(endpoint);

    let firstMessageDate = null;

    const messagesToImport = jsonData.messagesTree || jsonData.messages;

    if (jsonData.recursive) {
      /**
       * Flatten the recursive message tree into a flat array
       * @param {TMessage[]} messages
       * @param {string} parentMessageId
       * @param {TMessage[]} flatMessages
       */
      const flattenMessages = (
        messages,
        parentMessageId = Constants.NO_PARENT,
        flatMessages = [],
      ) => {
        for (const message of messages) {
          if (!message.text && !message.content) {
            continue;
          }

          const flatMessage = {
            ...message,
            parentMessageId: parentMessageId,
            children: undefined, // Remove children from flat structure
          };
          flatMessages.push(flatMessage);

          if (!firstMessageDate && message.createdAt) {
            firstMessageDate = new Date(message.createdAt);
          }

          if (message.children && message.children.length > 0) {
            flattenMessages(message.children, message.messageId, flatMessages);
          }
        }
        return flatMessages;
      };

      const flatMessages = flattenMessages(messagesToImport);
      cloneMessagesWithTimestamps(flatMessages, importBatchBuilder);
    } else if (messagesToImport) {
      cloneMessagesWithTimestamps(messagesToImport, importBatchBuilder);
      for (const message of messagesToImport) {
        if (!firstMessageDate && message.createdAt) {
          firstMessageDate = new Date(message.createdAt);
        }
      }
    } else {
      throw new Error('Invalid LibreChat file format');
    }

    if (firstMessageDate === 'Invalid Date') {
      firstMessageDate = null;
    }

    importBatchBuilder.finishConversation(jsonData.title, firstMessageDate ?? new Date(), options);
    await importBatchBuilder.saveBatch();
    logger.debug(`user: ${requestUserId} | Conversation "${jsonData.title}" imported`);
  } catch (error) {
    logger.error(`user: ${requestUserId} | Error creating conversation from LibreChat file`, error);
  }
}

/**
 * Imports ChatGPT conversations from provided JSON data.
 * Initializes the import process by creating a batch builder and processing each conversation in the data.
 *
 * @param {ChatGPTConvo[]} jsonData - Array of conversation objects to be imported.
 * @param {string} requestUserId - The ID of the user who initiated the import process.
 * @param {Function} builderFactory - Factory function to create a new import batch builder instance, defaults to createImportBatchBuilder.
 * @returns {Promise<void>} Promise that resolves when all conversations have been imported.
 */
async function importChatGptConvo(
  jsonData,
  requestUserId,
  builderFactory = createImportBatchBuilder,
  progressCallback = null,
) {
  try {
    const totalConvos = jsonData.length;
    logger.info(
      `user: ${requestUserId} | Starting import of ${totalConvos} ChatGPT conversations`,
    );

    // Process one conversation at a time to minimize memory usage
    const batchSize = 1;
    let processed = 0;

    for (let i = 0; i < jsonData.length; i += batchSize) {
      const importBatchBuilder = builderFactory(requestUserId);

      // Log every 10 conversations
      if (i % 10 === 0 || i === 0) {
        logger.info(
          `user: ${requestUserId} | Processing conversation ${i + 1}/${totalConvos}`,
        );
      }

      const conv = jsonData[i];
      try {
        processConversation(conv, importBatchBuilder, requestUserId);
        processed++;
      } catch (convError) {
        logger.error(
          `user: ${requestUserId} | Error processing conversation "${conv.title}":`,
          convError,
        );
        // Continue processing other conversations even if one fails
        continue;
      }

      try {
        await importBatchBuilder.saveBatch();

        // Report progress to callback
        if (progressCallback) {
          progressCallback(processed, totalConvos);
        }
      } catch (saveError) {
        logger.error(
          `user: ${requestUserId} | Error saving conversation ${i + 1}:`,
          saveError,
        );
        // Continue with next conversation instead of failing entire import
        continue;
      }

      // Log every 50 conversations
      if ((i + 1) % 50 === 0) {
        logger.info(
          `user: ${requestUserId} | Progress: ${processed}/${totalConvos} conversations imported`,
        );
        // Suggest garbage collection every 50 conversations
        if (global.gc) {
          global.gc();
        }
      }
    }

    logger.info(
      `user: ${requestUserId} | Successfully imported ${processed}/${totalConvos} conversations`,
    );
  } catch (error) {
    logger.error(`user: ${requestUserId} | Error creating conversation from imported file`, error);
    throw error; // Re-throw to trigger error response
  }
}

/**
 * Processes a single conversation, adding messages to the batch builder based on author roles and handling text content.
 * It directly manages the addition of messages for different roles and handles citations for assistant messages.
 *
 * @param {ChatGPTConvo} conv - A single conversation object that contains multiple messages and other details.
 * @param {ImportBatchBuilder} importBatchBuilder - The batch builder instance used to manage and batch conversation data.
 * @param {string} requestUserId - The ID of the user who initiated the import process.
 * @returns {void}
 */
function processConversation(conv, importBatchBuilder, requestUserId) {
  try {
    logger.debug(`user: ${requestUserId} | Processing conversation: "${conv.title}"`);
    importBatchBuilder.startConversation(EModelEndpoint.openAI);

    // First pass: Map all valid message IDs (including system) to new UUIDs for parent tracking
    const messageMap = new Map();
    logger.debug(`user: ${requestUserId} | Mapping message IDs...`);
    for (const [id, mapping] of Object.entries(conv.mapping)) {
      if (mapping.message && mapping.message.content && mapping.message.content.content_type) {
        const newMessageId = uuidv4();
        messageMap.set(id, newMessageId);
      }
    }
    logger.debug(`user: ${requestUserId} | Mapped ${messageMap.size} message IDs`);

    // Second pass: Create messages only for user/assistant, preserving parent relationships
    const messages = [];
    let lastValidMessageId = null; // Track the last valid message to create linear chain

    logger.debug(`user: ${requestUserId} | Processing messages...`);
    for (const [id, mapping] of Object.entries(conv.mapping)) {
      const role = mapping.message?.author?.role;
      const contentType = mapping.message?.content?.content_type;

      // Skip entries without messages or system messages
      if (!mapping.message) {
        continue;
      }
      if (role === 'system') {
        continue;
      }

      // Skip special content types that aren't actual conversation messages
      if (
        contentType === 'user_editable_context' ||
        contentType === 'system_message' ||
        contentType === 'model_editable_context' ||
        contentType === 'thoughts' ||
        contentType === 'reasoning_recap'
      ) {
        continue;
      }

      const newMessageId = messageMap.get(id);
      if (!newMessageId) {
        logger.warn(`user: ${requestUserId} | Skipping message ${id} - no mapped ID`);
        continue;
      }

      const messageText = formatMessageText(mapping.message);

      // Skip empty messages
      if (!messageText || messageText.trim() === '') {
        logger.debug(`user: ${requestUserId} | Skipping empty message ${id}`);
        continue;
      }

      // Determine parent: use the last valid message to maintain linear conversation
      let parentMessageId = Constants.NO_PARENT;

      if (lastValidMessageId) {
        // If we have a previous message, chain to it
        parentMessageId = lastValidMessageId;
      } else {
        // First message - try to find parent in tree, otherwise use NO_PARENT
        let currentParent = mapping.parent;

        while (currentParent && conv.mapping[currentParent]) {
          const parentMapping = conv.mapping[currentParent];
          const parentRole = parentMapping.message?.author?.role;
          const parentContentType = parentMapping.message?.content?.content_type;

          // Skip system messages and special content types
          const isSpecialContent =
            parentContentType === 'user_editable_context' ||
            parentContentType === 'system_message' ||
            parentContentType === 'model_editable_context' ||
            parentContentType === 'thoughts' ||
            parentContentType === 'reasoning_recap';

          // If parent is user or assistant with normal content, use it
          if (
            parentRole &&
            parentRole !== 'system' &&
            !isSpecialContent &&
            messageMap.has(currentParent)
          ) {
            parentMessageId = messageMap.get(currentParent);
            break;
          }

          // Otherwise, continue up the tree
          currentParent = parentMapping.parent;
        }
      }

      const isCreatedByUser = role === 'user';
      const model =
        mapping.message.metadata?.model_slug || openAISettings.model.default;

      // Determine sender based on model
      let sender = 'ChatGPT';
      if (isCreatedByUser) {
        sender = 'user';
      } else if (model) {
        if (model.includes('gpt-4')) {
          sender = 'GPT-4';
        } else if (model.includes('gpt-3.5')) {
          sender = 'GPT-3.5';
        } else if (model.includes('o1')) {
          sender = 'o1';
        } else {
          sender = model; // Use the actual model name
        }
      }

      messages.push({
        messageId: newMessageId,
        parentMessageId,
        text: messageText,
        sender,
        isCreatedByUser,
        model,
        user: requestUserId,
        endpoint: EModelEndpoint.openAI,
      });

      // Update last valid message for linear chaining
      lastValidMessageId = newMessageId;
    }

    logger.debug(`user: ${requestUserId} | Saving ${messages.length} messages...`);
    for (const message of messages) {
      importBatchBuilder.saveMessage(message);
    }

    logger.debug(`user: ${requestUserId} | Finishing conversation...`);
    importBatchBuilder.finishConversation(conv.title, new Date(conv.create_time * 1000));
    logger.debug(`user: ${requestUserId} | Conversation processed successfully`);
  } catch (error) {
    logger.error(`user: ${requestUserId} | Error in processConversation:`, error);
    throw error;
  }
}

/**
 * Processes text content of messages authored by an assistant, inserting citation links as required.
 * Uses citation start and end indices to place links at the correct positions.
 *
 * @param {ChatGPTMessage} messageData - The message data containing metadata about citations.
 * @param {string} messageText - The original text of the message which may be altered by inserting citation links.
 * @returns {string} - The updated message text after processing for citations.
 */
function processAssistantMessage(messageData, messageText) {
  if (!messageText) {
    return messageText;
  }

  const citations = messageData.metadata?.citations ?? [];

  const sortedCitations = [...citations].sort((a, b) => b.start_ix - a.start_ix);

  let result = messageText;
  for (const citation of sortedCitations) {
    if (
      !citation.metadata?.type ||
      citation.metadata.type !== 'webpage' ||
      typeof citation.start_ix !== 'number' ||
      typeof citation.end_ix !== 'number' ||
      citation.start_ix >= citation.end_ix
    ) {
      continue;
    }

    const replacement = ` ([${citation.metadata.title}](${citation.metadata.url}))`;

    result = result.slice(0, citation.start_ix) + replacement + result.slice(citation.end_ix);
  }

  return result;
}

/**
 * Formats the text content of a message based on its content type and author role.
 * @param {ChatGPTMessage} messageData - The message data.
 * @returns {string} - The updated message text after processing.
 */
function formatMessageText(messageData) {
  const isText = messageData.content.content_type === 'text';
  let messageText = '';

  if (isText && messageData.content.parts) {
    messageText = messageData.content.parts.join(' ');
  } else if (messageData.content.content_type === 'code') {
    messageText = `\`\`\`${messageData.content.language}\n${messageData.content.text}\n\`\`\``;
  } else if (messageData.content.content_type === 'execution_output') {
    messageText = `Execution Output:\n> ${messageData.content.text}`;
  } else if (messageData.content.parts) {
    for (const part of messageData.content.parts) {
      if (typeof part === 'string') {
        messageText += part + ' ';
      } else if (typeof part === 'object') {
        messageText = `\`\`\`json\n${JSON.stringify(part, null, 2)}\n\`\`\`\n`;
      }
    }
    messageText = messageText.trim();
  } else {
    messageText = `\`\`\`json\n${JSON.stringify(messageData.content, null, 2)}\n\`\`\``;
  }

  if (isText && messageData.author.role !== 'user') {
    messageText = processAssistantMessage(messageData, messageText);
  }

  return messageText;
}

module.exports = { getImporter, processAssistantMessage };
