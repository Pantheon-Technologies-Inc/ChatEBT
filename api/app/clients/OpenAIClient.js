const { OllamaClient } = require('./OllamaClient');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SplitStreamHandler, CustomOpenAIClient: OpenAI } = require('@librechat/agents');
const {
  isEnabled,
  Tokenizer,
  createFetch,
  resolveHeaders,
  constructAzureURL,
  genAzureChatCompletion,
  createStreamEventHandlers,
} = require('@librechat/api');
const {
  Constants,
  ImageDetail,
  ContentTypes,
  parseTextParts,
  EModelEndpoint,
  KnownEndpoints,
  openAISettings,
  ImageDetailCost,
  CohereConstants,
  getResponseSender,
  validateVisionModel,
  mapModelToAzureConfig,
} = require('librechat-data-provider');
const {
  truncateText,
  formatMessage,
  CUT_OFF_PROMPT,
  titleInstruction,
  createContextHandlers,
} = require('./prompts');
const { baseSystemPrompt } = require('./prompts/systemPrompt');
const { extractBaseURL, getModelMaxTokens, getModelMaxOutputTokens } = require('~/utils');
const { encodeAndFormat } = require('~/server/services/Files/images/encode');
const { addSpaceIfNeeded, sleep } = require('~/server/utils');
const { spendTokens } = require('~/models/spendTokens');
const { handleOpenAIErrors } = require('./tools/util');
const { createLLM, RunManager } = require('./llm');
const { summaryBuffer } = require('./memory');
const { runTitleChain } = require('./chains');
const { tokenSplit } = require('./document');
const BaseClient = require('./BaseClient');
const { logger } = require('~/config');

class OpenAIClient extends BaseClient {
  constructor(apiKey, options = {}) {
    super(apiKey, options);
    this.contextStrategy = options.contextStrategy
      ? options.contextStrategy.toLowerCase()
      : 'discard';
    this.shouldSummarize = this.contextStrategy === 'summarize';
    /** @type {AzureOptions} */
    this.azure = options.azure || false;
    this.setOptions(options);
    this.metadata = {};

    /** @type {string | undefined} - The API Completions URL */
    this.completionsUrl;

    /** @type {OpenAIUsageMetadata | undefined} */
    this.usage;
    /** @type {boolean|undefined} */
    this.isOmni;
    /** @type {SplitStreamHandler | undefined} */
    this.streamHandler;
  }

  // TODO: PluginsClient calls this 3x, unneeded
  setOptions(options) {
    if (this.options && !this.options.replaceOptions) {
      this.options.modelOptions = {
        ...this.options.modelOptions,
        ...options.modelOptions,
      };
      delete options.modelOptions;
      this.options = {
        ...this.options,
        ...options,
      };
    } else {
      this.options = options;
    }

    if (this.options.openaiApiKey) {
      this.apiKey = this.options.openaiApiKey;
    }

    this.modelOptions = Object.assign(
      {
        model: openAISettings.model.default,
      },
      this.modelOptions,
      this.options.modelOptions,
    );

    if (typeof this.options.userSystemPrompt !== 'string') {
      this.options.userSystemPrompt = '';
    }

    this.defaultVisionModel = this.options.visionModel ?? 'gpt-4-vision-preview';
    if (typeof this.options.attachments?.then === 'function') {
      this.options.attachments.then((attachments) => this.checkVisionRequest(attachments));
    } else {
      this.checkVisionRequest(this.options.attachments);
    }

    const omniPattern = /\b(o\d)\b/i;
    this.isOmni = omniPattern.test(this.modelOptions.model);

    const { OPENAI_FORCE_PROMPT } = process.env ?? {};
    const { reverseProxyUrl: reverseProxy } = this.options;

    if (
      !this.useOpenRouter &&
      ((reverseProxy && reverseProxy.includes(KnownEndpoints.openrouter)) ||
        (this.options.endpoint &&
          this.options.endpoint.toLowerCase().includes(KnownEndpoints.openrouter)))
    ) {
      this.useOpenRouter = true;
    }

    if (this.options.endpoint?.toLowerCase() === 'ollama') {
      this.isOllama = true;
    }

    this.FORCE_PROMPT =
      isEnabled(OPENAI_FORCE_PROMPT) ||
      (reverseProxy && reverseProxy.includes('completions') && !reverseProxy.includes('chat'));

    if (typeof this.options.forcePrompt === 'boolean') {
      this.FORCE_PROMPT = this.options.forcePrompt;
    }

    if (this.azure && process.env.AZURE_OPENAI_DEFAULT_MODEL) {
      this.azureEndpoint = genAzureChatCompletion(this.azure, this.modelOptions.model, this);
      this.modelOptions.model = process.env.AZURE_OPENAI_DEFAULT_MODEL;
    } else if (this.azure) {
      this.azureEndpoint = genAzureChatCompletion(this.azure, this.modelOptions.model, this);
    }

    const { model } = this.modelOptions;

    this.isChatCompletion =
      omniPattern.test(model) || model.includes('gpt') || this.useOpenRouter || !!reverseProxy;
    this.isChatGptModel = this.isChatCompletion;
    if (
      model.includes('text-davinci') ||
      model.includes('gpt-3.5-turbo-instruct') ||
      this.FORCE_PROMPT
    ) {
      this.isChatCompletion = false;
      this.isChatGptModel = false;
    }
    const { isChatGptModel } = this;
    this.isUnofficialChatGptModel =
      model.startsWith('text-chat') || model.startsWith('text-davinci-002-render');

    this.maxContextTokens =
      this.options.maxContextTokens ??
      getModelMaxTokens(
        model,
        this.options.endpointType ?? this.options.endpoint,
        this.options.endpointTokenConfig,
      ) ??
      4095; // 1 less than maximum

    if (this.shouldSummarize) {
      this.maxContextTokens = Math.floor(this.maxContextTokens / 2);
    }

    if (this.options.debug) {
      logger.debug('[OpenAIClient] maxContextTokens', this.maxContextTokens);
    }

    this.maxResponseTokens =
      this.modelOptions.max_tokens ??
      getModelMaxOutputTokens(
        model,
        this.options.endpointType ?? this.options.endpoint,
        this.options.endpointTokenConfig,
      ) ??
      1024;
    this.maxPromptTokens =
      this.options.maxPromptTokens || this.maxContextTokens - this.maxResponseTokens;

    if (this.maxPromptTokens + this.maxResponseTokens > this.maxContextTokens) {
      throw new Error(
        `maxPromptTokens + max_tokens (${this.maxPromptTokens} + ${this.maxResponseTokens} = ${
          this.maxPromptTokens + this.maxResponseTokens
        }) must be less than or equal to maxContextTokens (${this.maxContextTokens})`,
      );
    }

    this.sender =
      this.options.sender ??
      getResponseSender({
        model: this.modelOptions.model,
        endpoint: this.options.endpoint,
        endpointType: this.options.endpointType,
        modelDisplayLabel: this.options.modelDisplayLabel,
        chatGptLabel: this.options.chatGptLabel || this.options.modelLabel,
      });

    this.userLabel = this.options.userLabel || 'User';
    this.chatGptLabel = this.options.chatGptLabel || 'Assistant';

    this.setupTokens();

    if (reverseProxy) {
      this.completionsUrl = reverseProxy;
      this.langchainProxy = extractBaseURL(reverseProxy);
    } else if (isChatGptModel) {
      this.completionsUrl = 'https://api.openai.com/v1/chat/completions';
    } else {
      this.completionsUrl = 'https://api.openai.com/v1/completions';
    }

    if (this.azureEndpoint) {
      this.completionsUrl = this.azureEndpoint;
    }

    if (this.azureEndpoint && this.options.debug) {
      logger.debug('Using Azure endpoint');
    }

    return this;
  }

  /**
   *
   * Checks if the model is a vision model based on request attachments and sets the appropriate options:
   * - Sets `this.modelOptions.model` to `gpt-4-vision-preview` if the request is a vision request.
   * - Sets `this.isVisionModel` to `true` if vision request.
   * - Deletes `this.modelOptions.stop` if vision request.
   * @param {MongoFile[]} attachments
   */
  checkVisionRequest(attachments) {
    if (!attachments) {
      return;
    }

    const availableModels = this.options.modelsConfig?.[this.options.endpoint];
    if (!availableModels) {
      return;
    }

    let visionRequestDetected = false;
    for (const file of attachments) {
      if (file?.type?.includes('image')) {
        visionRequestDetected = true;
        break;
      }
    }
    if (!visionRequestDetected) {
      return;
    }

    this.isVisionModel = validateVisionModel({ model: this.modelOptions.model, availableModels });
    if (this.isVisionModel) {
      delete this.modelOptions.stop;
      return;
    }

    for (const model of availableModels) {
      if (!validateVisionModel({ model, availableModels })) {
        continue;
      }
      this.modelOptions.model = model;
      this.isVisionModel = true;
      delete this.modelOptions.stop;
      return;
    }

    if (!availableModels.includes(this.defaultVisionModel)) {
      return;
    }
    if (!validateVisionModel({ model: this.defaultVisionModel, availableModels })) {
      return;
    }

    this.modelOptions.model = this.defaultVisionModel;
    this.isVisionModel = true;
    delete this.modelOptions.stop;
  }

  setupTokens() {
    if (this.isChatCompletion) {
      this.startToken = '||>';
      this.endToken = '';
    } else if (this.isUnofficialChatGptModel) {
      this.startToken = '<|im_start|>';
      this.endToken = '<|im_end|>';
    } else {
      this.startToken = '||>';
      this.endToken = '';
    }
  }

  getEncoding() {
    return this.modelOptions?.model && /gpt-4[^-\s]/.test(this.modelOptions.model)
      ? 'o200k_base'
      : 'cl100k_base';
  }

  /**
   * Returns the token count of a given text. It also checks and resets the tokenizers if necessary.
   * @param {string} text - The text to get the token count for.
   * @returns {number} The token count of the given text.
   */
  getTokenCount(text) {
    const encoding = this.getEncoding();
    return Tokenizer.getTokenCount(text, encoding);
  }

  /**
   * Calculate the token cost for an image based on its dimensions and detail level.
   *
   * @param {Object} image - The image object.
   * @param {number} image.width - The width of the image.
   * @param {number} image.height - The height of the image.
   * @param {'low'|'high'|string|undefined} [image.detail] - The detail level ('low', 'high', or other).
   * @returns {number} The calculated token cost.
   */
  calculateImageTokenCost({ width, height, detail }) {
    if (detail === 'low') {
      return ImageDetailCost.LOW;
    }

    // Calculate the number of 512px squares
    const numSquares = Math.ceil(width / 512) * Math.ceil(height / 512);

    // Default to high detail cost calculation
    return numSquares * ImageDetailCost.HIGH + ImageDetailCost.ADDITIONAL;
  }

  getSaveOptions() {
    return {
      artifacts: this.options.artifacts,
      maxContextTokens: this.options.maxContextTokens,
      chatGptLabel: this.options.chatGptLabel,
      promptPrefix: this.options.promptPrefix,
      resendFiles: this.options.resendFiles,
      imageDetail: this.options.imageDetail,
      modelLabel: this.options.modelLabel,
      iconURL: this.options.iconURL,
      greeting: this.options.greeting,
      spec: this.options.spec,
      ...this.modelOptions,
    };
  }

  getBuildMessagesOptions(opts) {
    return {
      isChatCompletion: this.isChatCompletion,
      promptPrefix: opts.promptPrefix,
      abortController: opts.abortController,
    };
  }

  /**
   *
   * Adds image URLs to the message object and returns the files
   *
   * @param {TMessage[]} messages
   * @param {MongoFile[]} files
   * @returns {Promise<MongoFile[]>}
   */
  async addImageURLs(message, attachments) {
    const { files, image_urls } = await encodeAndFormat(
      this.options.req,
      attachments,
      this.options.endpoint,
    );
    message.image_urls = image_urls.length ? image_urls : undefined;
    return files;
  }

  async buildMessages(messages, parentMessageId, { promptPrefix: requestPromptPrefix = null }, opts) {
    let orderedMessages = this.constructor.getMessagesForConversation({
      messages,
      parentMessageId,
      summary: this.shouldSummarize,
    });

    let payload;
    let instructions;
    let tokenCountMap;
    let promptTokens;

    const providedPromptPrefix = (requestPromptPrefix || this.options.promptPrefix || '').trim();
    const userSystemPrompt = (this.options.userSystemPrompt || '').trim();
    const basePrompt = baseSystemPrompt.trim();

    let promptPrefixSegments = [basePrompt, userSystemPrompt, providedPromptPrefix].filter(
      (segment) => typeof segment === 'string' && segment.length > 0,
    );

    if (typeof this.options.artifactsPrompt === 'string' && this.options.artifactsPrompt) {
      const artifactsPrompt = this.options.artifactsPrompt.trim();
      if (artifactsPrompt.length > 0) {
        promptPrefixSegments = [...promptPrefixSegments, artifactsPrompt];
      }
    }

    let promptPrefix = promptPrefixSegments.join('\n\n');

    if (this.options.attachments) {
      const attachments = await this.options.attachments;

      if (this.message_file_map) {
        this.message_file_map[orderedMessages[orderedMessages.length - 1].messageId] = attachments;
      } else {
        this.message_file_map = {
          [orderedMessages[orderedMessages.length - 1].messageId]: attachments,
        };
      }

      const files = await this.addImageURLs(
        orderedMessages[orderedMessages.length - 1],
        attachments,
      );

      this.options.attachments = files;
    }

    if (this.message_file_map) {
      this.contextHandlers = createContextHandlers(
        this.options.req,
        orderedMessages[orderedMessages.length - 1].text,
      );
    }

    const formattedMessages = orderedMessages.map((message, i) => {
      const formattedMessage = formatMessage({
        message,
        userName: this.options?.name,
        assistantName: this.options?.chatGptLabel,
      });

      const needsTokenCount = this.contextStrategy && !orderedMessages[i].tokenCount;

      /* If tokens were never counted, or, is a Vision request and the message has files, count again */
      if (needsTokenCount || (this.isVisionModel && (message.image_urls || message.files))) {
        orderedMessages[i].tokenCount = this.getTokenCountForMessage(formattedMessage);
      }

      /* If message has files, calculate image token cost */
      if (this.message_file_map && this.message_file_map[message.messageId]) {
        const attachments = this.message_file_map[message.messageId];
        for (const file of attachments) {
          if (file.embedded) {
            this.contextHandlers?.processFile(file);
            continue;
          }
          if (file.metadata?.fileIdentifier) {
            continue;
          }

          orderedMessages[i].tokenCount += this.calculateImageTokenCost({
            width: file.width,
            height: file.height,
            detail: this.options.imageDetail ?? ImageDetail.auto,
          });
        }
      }

      return formattedMessage;
    });

    if (this.contextHandlers) {
      this.augmentedPrompt = await this.contextHandlers.createContext();
      promptPrefix = this.augmentedPrompt + promptPrefix;
    }

    const noSystemModelRegex = /\b(o1-preview|o1-mini)\b/i.test(this.modelOptions.model);

    if (promptPrefix && !noSystemModelRegex) {
      promptPrefix = `Instructions:\n${promptPrefix.trim()}`;
      instructions = {
        role: 'system',
        content: promptPrefix,
      };

      if (this.contextStrategy) {
        instructions.tokenCount = this.getTokenCountForMessage(instructions);
      }
    }

    // TODO: need to handle interleaving instructions better
    if (this.contextStrategy) {
      ({ payload, tokenCountMap, promptTokens, messages } = await this.handleContextStrategy({
        instructions,
        orderedMessages,
        formattedMessages,
      }));
    }

    const result = {
      prompt: payload,
      promptTokens,
      messages,
    };

    /** EXPERIMENTAL */
    if (promptPrefix && noSystemModelRegex) {
      const lastUserMessageIndex = payload.findLastIndex((message) => message.role === 'user');
      if (lastUserMessageIndex !== -1) {
        if (Array.isArray(payload[lastUserMessageIndex].content)) {
          const firstTextPartIndex = payload[lastUserMessageIndex].content.findIndex(
            (part) => part.type === ContentTypes.TEXT,
          );
          if (firstTextPartIndex !== -1) {
            const firstTextPart = payload[lastUserMessageIndex].content[firstTextPartIndex];
            payload[lastUserMessageIndex].content[firstTextPartIndex].text =
              `${promptPrefix}\n${firstTextPart.text}`;
          } else {
            payload[lastUserMessageIndex].content.unshift({
              type: ContentTypes.TEXT,
              text: promptPrefix,
            });
          }
        } else {
          payload[lastUserMessageIndex].content =
            `${promptPrefix}\n${payload[lastUserMessageIndex].content}`;
        }
      }
    }

    if (tokenCountMap) {
      tokenCountMap.instructions = instructions?.tokenCount;
      result.tokenCountMap = tokenCountMap;
    }

    if (promptTokens >= 0 && typeof opts?.getReqData === 'function') {
      opts.getReqData({ promptTokens });
    }

    return result;
  }

  /** @type {sendCompletion} */
  async sendCompletion(payload, opts = {}) {
    let reply = '';
    let result = null;
    let streamResult = null;
    this.modelOptions.user = this.user;
    const invalidBaseUrl = this.completionsUrl && extractBaseURL(this.completionsUrl) === null;
    const useOldMethod = !!(invalidBaseUrl || !this.isChatCompletion);

    // Check if we should use Responses API (enabled by default for OpenAI chat completions)
    // Allow per-request override via modelOptions.useResponsesApi (boolean)
    const useResponsesAPIFlag =
      typeof this.modelOptions?.useResponsesApi === 'boolean'
        ? this.modelOptions.useResponsesApi
        : process.env.USE_RESPONSES_API !== 'false';

    const useResponsesAPI =
      useResponsesAPIFlag && this.isChatCompletion && !this.useOpenRouter && !this.isOllama;

    if (useResponsesAPI) {
      logger.info('[OpenAIClient] Using Responses API for completion', {
        hasAttachments: !!(this.options.attachments && this.options.attachments.length > 0),
        attachmentCount: this.options.attachments?.length || 0,
        messageFileMapSize: this.message_file_map ? Object.keys(this.message_file_map).length : 0,
      });
      try {
        // Convert messages to Responses API input format
        // Pass attachments explicitly to ensure they're included
        const attachments = this.options.attachments || [];
        const { input, instructions } = await this.convertMessagesToResponsesInput(payload, attachments);

        logger.debug('[OpenAIClient] Converted to Responses API format:', {
          inputLength: input.length,
          hasInstructions: !!instructions,
          lastInputContent: input[input.length - 1]?.content,
          attachmentsProvided: attachments.length,
        });

        // Add instructions to model options if present
        if (instructions) {
          this.modelOptions.instructions = instructions;
        }

        reply = await this.responseCompletion({
          input,
          onProgress: opts.onProgress,
          abortController: opts.abortController,
          conversationId: this.conversationId,
        });

        return (reply ?? '').trim();
      } catch (error) {
        logger.error(
          '[OpenAIClient] Responses API error, falling back to Chat Completions:',
          error,
        );
        // Fall through to use Chat Completions as fallback
      }
    } else {
      logger.info('[OpenAIClient] Using Chat Completions API', {
        useResponsesAPI: process.env.USE_RESPONSES_API,
        isChatCompletion: this.isChatCompletion,
        useOpenRouter: this.useOpenRouter,
        isOllama: this.isOllama,
      });
    }

    // Fallback to old chat completions API for non-OpenAI endpoints
    if (typeof opts.onProgress === 'function' && useOldMethod) {
      const completionResult = await this.getCompletion(
        payload,
        (progressMessage) => {
          if (progressMessage === '[DONE]') {
            return;
          }

          if (progressMessage.choices) {
            streamResult = progressMessage;
          }

          let token = null;
          if (this.isChatCompletion) {
            token =
              progressMessage.choices?.[0]?.delta?.content ?? progressMessage.choices?.[0]?.text;
          } else {
            token = progressMessage.choices?.[0]?.text;
          }

          if (!token && this.useOpenRouter) {
            token = progressMessage.choices?.[0]?.message?.content;
          }
          // first event's delta content is always undefined
          if (!token) {
            return;
          }

          if (token === this.endToken) {
            return;
          }
          opts.onProgress(token);
          reply += token;
        },
        opts.onProgress,
        opts.abortController || new AbortController(),
      );

      if (completionResult && typeof completionResult === 'string') {
        reply = completionResult;
      } else if (
        completionResult &&
        typeof completionResult === 'object' &&
        Array.isArray(completionResult.choices)
      ) {
        reply = completionResult.choices[0]?.text?.replace(this.endToken, '');
      }
    } else if (typeof opts.onProgress === 'function' || this.options.useChatCompletion) {
      reply = await this.chatCompletion({
        payload,
        onProgress: opts.onProgress,
        abortController: opts.abortController,
      });
    } else {
      result = await this.getCompletion(
        payload,
        null,
        opts.onProgress,
        opts.abortController || new AbortController(),
      );

      if (result && typeof result === 'string') {
        return result.trim();
      }

      logger.debug('[OpenAIClient] sendCompletion: result', { ...result });

      if (this.isChatCompletion) {
        reply = result.choices[0].message.content;
      } else {
        reply = result.choices[0].text.replace(this.endToken, '');
      }
    }

    if (streamResult) {
      const { finish_reason } = streamResult.choices[0];
      this.metadata = { finish_reason };
    }
    return (reply ?? '').trim();
  }

  initializeLLM({
    model = openAISettings.model.default,
    modelName,
    temperature = 0.2,
    max_tokens,
    streaming,
    context,
    tokenBuffer,
    initialMessageCount,
    conversationId,
  }) {
    const modelOptions = {
      modelName: modelName ?? model,
      temperature,
      user: this.user,
    };

    if (max_tokens) {
      modelOptions.max_tokens = max_tokens;
    }

    const configOptions = {};

    if (this.langchainProxy) {
      configOptions.basePath = this.langchainProxy;
    }

    if (this.useOpenRouter) {
      configOptions.basePath = 'https://openrouter.ai/api/v1';
      configOptions.baseOptions = {
        headers: {
          'HTTP-Referer': 'https://librechat.ai',
          'X-Title': 'LibreChat',
        },
      };
    }

    const { headers } = this.options;
    if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
      configOptions.baseOptions = {
        headers: resolveHeaders({
          ...headers,
          ...configOptions?.baseOptions?.headers,
        }),
      };
    }

    if (this.options.proxy) {
      configOptions.httpAgent = new HttpsProxyAgent(this.options.proxy);
      configOptions.httpsAgent = new HttpsProxyAgent(this.options.proxy);
    }

    const { req, res, debug } = this.options;
    const runManager = new RunManager({ req, res, debug, abortController: this.abortController });
    this.runManager = runManager;

    const llm = createLLM({
      modelOptions,
      configOptions,
      openAIApiKey: this.apiKey,
      azure: this.azure,
      streaming,
      callbacks: runManager.createCallbacks({
        context,
        tokenBuffer,
        conversationId: this.conversationId ?? conversationId,
        initialMessageCount,
      }),
    });

    return llm;
  }

  /**
   * Generates a concise title for a conversation based on the user's input text and response.
   * Uses either specified method or starts with the OpenAI `functions` method (using LangChain).
   * If the `functions` method fails, it falls back to the `completion` method,
   * which involves sending a chat completion request with specific instructions for title generation.
   *
   * @param {Object} params - The parameters for the conversation title generation.
   * @param {string} params.text - The user's input.
   * @param {string} [params.conversationId] - The current conversationId, if not already defined on client initialization.
   * @param {string} [params.responseText=''] - The AI's immediate response to the user.
   *
   * @returns {Promise<string | 'New Chat'>} A promise that resolves to the generated conversation title.
   *                            In case of failure, it will return the default title, "New Chat".
   */
  async titleConvo({ text, conversationId, responseText = '' }) {
    this.conversationId = conversationId;

    if (this.options.attachments) {
      delete this.options.attachments;
    }

    let title = 'New Chat';
    const convo = `||>User:
"${truncateText(text)}"
||>Response:
"${JSON.stringify(truncateText(responseText))}"`;

    const { OPENAI_TITLE_MODEL } = process.env ?? {};

    let model = this.options.titleModel ?? OPENAI_TITLE_MODEL ?? openAISettings.model.default;
    if (model === Constants.CURRENT_MODEL) {
      model = this.modelOptions.model;
    }

    const maxTitleTokens = 16;
    let modelOptions = {
      // TODO: remove the gpt fallback and make it specific to endpoint
      model,
      temperature: 0.2,
      presence_penalty: 0,
      frequency_penalty: 0,
    };

    /** @type {TAzureConfig | undefined} */
    const azureConfig = this.options?.req?.app?.locals?.[EModelEndpoint.azureOpenAI];

    const resetTitleOptions = !!(
      (this.azure && azureConfig) ||
      (azureConfig && this.options.endpoint === EModelEndpoint.azureOpenAI)
    );

    if (resetTitleOptions) {
      const { modelGroupMap, groupMap } = azureConfig;
      const {
        azureOptions,
        baseURL,
        headers = {},
        serverless,
      } = mapModelToAzureConfig({
        modelName: modelOptions.model,
        modelGroupMap,
        groupMap,
      });

      this.options.headers = resolveHeaders(headers);
      this.options.reverseProxyUrl = baseURL ?? null;
      this.langchainProxy = extractBaseURL(this.options.reverseProxyUrl);
      this.apiKey = azureOptions.azureOpenAIApiKey;

      const groupName = modelGroupMap[modelOptions.model].group;
      this.options.addParams = azureConfig.groupMap[groupName].addParams;
      this.options.dropParams = azureConfig.groupMap[groupName].dropParams;
      this.options.forcePrompt = azureConfig.groupMap[groupName].forcePrompt;
      this.azure = !serverless && azureOptions;
      if (serverless === true) {
        this.options.defaultQuery = azureOptions.azureOpenAIApiVersion
          ? { 'api-version': azureOptions.azureOpenAIApiVersion }
          : undefined;
        this.options.headers['api-key'] = this.apiKey;
      }
    }

    const titleChatCompletion = async () => {
      try {
        modelOptions.model = model;

        if (this.azure) {
          modelOptions.model = process.env.AZURE_OPENAI_DEFAULT_MODEL ?? modelOptions.model;
          this.azureEndpoint = genAzureChatCompletion(this.azure, modelOptions.model, this);
        }

        const instructionsPayload = [
          {
            role: this.options.titleMessageRole ?? (this.isOllama ? 'user' : 'system'),
            content: `Please generate ${titleInstruction}

${convo}

||>Title:`,
          },
        ];

        const promptTokens = this.getTokenCountForMessage(instructionsPayload[0]);

        let useChatCompletion = true;

        if (this.options.reverseProxyUrl === CohereConstants.API_URL) {
          useChatCompletion = false;
        }

        const payloadOptions = {
          ...modelOptions,
          max_tokens: maxTitleTokens,
        };
        title = (
          await this.sendPayload(instructionsPayload, {
            modelOptions: payloadOptions,
            useChatCompletion,
            context: 'title',
          })
        ).replaceAll('"', '');

        const completionTokens = this.getTokenCount(title);

        await this.recordTokenUsage({ promptTokens, completionTokens, context: 'title' });
      } catch (e) {
        logger.error(
          '[OpenAIClient] There was an issue generating the title with the completion method',
          e,
        );
      }
    };

    if (this.options.titleMethod === 'completion') {
      await titleChatCompletion();
      logger.debug('[OpenAIClient] Convo Title: ' + title);
      return title;
    }

    try {
      this.abortController = new AbortController();
      const llm = this.initializeLLM({
        ...modelOptions,
        conversationId,
        context: 'title',
        tokenBuffer: 150,
      });

      title = await runTitleChain({ llm, text, convo, signal: this.abortController.signal });
    } catch (e) {
      if (e?.message?.toLowerCase()?.includes('abort')) {
        logger.debug('[OpenAIClient] Aborted title generation');
        return title;
      }
      logger.error(
        '[OpenAIClient] There was an issue generating title with LangChain, trying completion method...',
        e,
      );

      await titleChatCompletion();
    }

    logger.debug('[OpenAIClient] Convo Title: ' + title);
    return title;
  }

  /**
   * Get stream usage as returned by this client's API response.
   * @returns {OpenAIUsageMetadata} The stream usage object.
   */
  getStreamUsage() {
    if (
      this.usage &&
      typeof this.usage === 'object' &&
      'completion_tokens_details' in this.usage &&
      this.usage.completion_tokens_details &&
      typeof this.usage.completion_tokens_details === 'object' &&
      'reasoning_tokens' in this.usage.completion_tokens_details
    ) {
      const reasoningTokens = this.usage.completion_tokens_details.reasoning_tokens;
      const completionTokens = this.usage[this.outputTokensKey];
      const outputTokens = Math.abs(reasoningTokens - completionTokens);

      return {
        ...this.usage.completion_tokens_details,
        [this.inputTokensKey]: this.usage[this.inputTokensKey],
        [this.outputTokensKey]: outputTokens,
      };
    }

    return this.usage;
  }

  /**
   * Calculates the correct token count for the current user message based on the token count map and API usage.
   * Edge case: If the calculation results in a negative value, it returns the original estimate.
   * If revisiting a conversation with a chat history entirely composed of token estimates,
   * the cumulative token count going forward should become more accurate as the conversation progresses.
   * @param {Object} params - The parameters for the calculation.
   * @param {Record<string, number>} params.tokenCountMap - A map of message IDs to their token counts.
   * @param {string} params.currentMessageId - The ID of the current message to calculate.
   * @param {OpenAIUsageMetadata} params.usage - The usage object returned by the API.
   * @returns {number} The correct token count for the current user message.
   */
  calculateCurrentTokenCount({ tokenCountMap, currentMessageId, usage }) {
    const originalEstimate = tokenCountMap[currentMessageId] || 0;

    if (!usage || typeof usage[this.inputTokensKey] !== 'number') {
      return originalEstimate;
    }

    tokenCountMap[currentMessageId] = 0;
    const totalTokensFromMap = Object.values(tokenCountMap).reduce((sum, count) => {
      const numCount = Number(count);
      return sum + (isNaN(numCount) ? 0 : numCount);
    }, 0);
    const totalInputTokens = usage[this.inputTokensKey] ?? 0;

    const currentMessageTokens = totalInputTokens - totalTokensFromMap;
    return currentMessageTokens > 0 ? currentMessageTokens : originalEstimate;
  }

  async summarizeMessages({ messagesToRefine, remainingContextTokens }) {
    logger.debug('[OpenAIClient] Summarizing messages...');
    let context = messagesToRefine;
    let prompt;

    // TODO: remove the gpt fallback and make it specific to endpoint
    const { OPENAI_SUMMARY_MODEL = openAISettings.model.default } = process.env ?? {};
    let model = this.options.summaryModel ?? OPENAI_SUMMARY_MODEL;
    if (model === Constants.CURRENT_MODEL) {
      model = this.modelOptions.model;
    }

    const maxContextTokens =
      getModelMaxTokens(
        model,
        this.options.endpointType ?? this.options.endpoint,
        this.options.endpointTokenConfig,
      ) ?? 4095; // 1 less than maximum

    // 3 tokens for the assistant label, and 98 for the summarizer prompt (101)
    let promptBuffer = 101;

    /*
     * Note: token counting here is to block summarization if it exceeds the spend; complete
     * accuracy is not important. Actual spend will happen after successful summarization.
     */
    const excessTokenCount = context.reduce(
      (acc, message) => acc + message.tokenCount,
      promptBuffer,
    );

    if (excessTokenCount > maxContextTokens) {
      ({ context } = await this.getMessagesWithinTokenLimit({
        messages: context,
        maxContextTokens,
      }));
    }

    if (context.length === 0) {
      logger.debug(
        '[OpenAIClient] Summary context is empty, using latest message within token limit',
      );

      promptBuffer = 32;
      const { text, ...latestMessage } = messagesToRefine[messagesToRefine.length - 1];
      const splitText = await tokenSplit({
        text,
        chunkSize: Math.floor((maxContextTokens - promptBuffer) / 3),
      });

      const newText = `${splitText[0]}\n...[truncated]...\n${splitText[splitText.length - 1]}`;
      prompt = CUT_OFF_PROMPT;

      context = [
        formatMessage({
          message: {
            ...latestMessage,
            text: newText,
          },
          userName: this.options?.name,
          assistantName: this.options?.chatGptLabel,
        }),
      ];
    }
    // TODO: We can accurately count the tokens here before handleChatModelStart
    // by recreating the summary prompt (single message) to avoid LangChain handling

    const initialPromptTokens = this.maxContextTokens - remainingContextTokens;
    logger.debug('[OpenAIClient] initialPromptTokens', initialPromptTokens);

    const llm = this.initializeLLM({
      model,
      temperature: 0.2,
      context: 'summary',
      tokenBuffer: initialPromptTokens,
    });

    try {
      const summaryMessage = await summaryBuffer({
        llm,
        debug: this.options.debug,
        prompt,
        context,
        formatOptions: {
          userName: this.options?.name,
          assistantName: this.options?.chatGptLabel ?? this.options?.modelLabel,
        },
        previous_summary: this.previous_summary?.summary,
        signal: this.abortController.signal,
      });

      const summaryTokenCount = this.getTokenCountForMessage(summaryMessage);

      if (this.options.debug) {
        logger.debug('[OpenAIClient] summaryTokenCount', summaryTokenCount);
        logger.debug(
          `[OpenAIClient] Summarization complete: remainingContextTokens: ${remainingContextTokens}, after refining: ${
            remainingContextTokens - summaryTokenCount
          }`,
        );
      }

      return { summaryMessage, summaryTokenCount };
    } catch (e) {
      if (e?.message?.toLowerCase()?.includes('abort')) {
        logger.debug('[OpenAIClient] Aborted summarization');
        const { run, runId } = this.runManager.getRunByConversationId(this.conversationId);
        if (run && run.error) {
          const { error } = run;
          this.runManager.removeRun(runId);
          throw new Error(error);
        }
      }
      logger.error('[OpenAIClient] Error summarizing messages', e);
      return {};
    }
  }

  /**
   * @param {object} params
   * @param {number} params.promptTokens
   * @param {number} params.completionTokens
   * @param {OpenAIUsageMetadata} [params.usage]
   * @param {string} [params.model]
   * @param {string} [params.context='message']
   * @returns {Promise<void>}
   */
  async recordTokenUsage({ promptTokens, completionTokens, usage, context = 'message' }) {
    await spendTokens(
      {
        context,
        model: this.modelOptions.model,
        conversationId: this.conversationId,
        user: this.user ?? this.options.req.user?.id,
        endpoint: this.options.endpoint,
        valueKey: this.options.endpointType ?? this.options.endpoint,
        endpointTokenConfig: this.options.endpointTokenConfig,
      },
      { promptTokens, completionTokens },
    );

    // Note: Reasoning tokens are currently NOT charged (OpenAI policy)
    // If billing is needed, uncomment below:
    // if (usage?.reasoning_tokens) {
    //   await spendTokens({ context: 'reasoning', ... }, { completionTokens: usage.reasoning_tokens });
    // }
  }

  getTokenCountForResponse(response) {
    return this.getTokenCountForMessage({
      role: 'assistant',
      content: response.text,
    });
  }

  /**
   *
   * @param {string[]} [intermediateReply]
   * @returns {string}
   */
  getStreamText(intermediateReply) {
    if (!this.streamHandler) {
      return intermediateReply?.join('') ?? '';
    }

    let thinkMatch;
    let remainingText;
    let reasoningText = '';

    if (this.streamHandler.reasoningTokens.length > 0) {
      reasoningText = this.streamHandler.reasoningTokens.join('');
      thinkMatch = reasoningText.match(/<think>([\s\S]*?)<\/think>/)?.[1]?.trim();
      if (thinkMatch != null && thinkMatch) {
        const reasoningTokens = `:::thinking\n${thinkMatch}\n:::\n`;
        remainingText = reasoningText.split(/<\/think>/)?.[1]?.trim() || '';
        return `${reasoningTokens}${remainingText}${this.streamHandler.tokens.join('')}`;
      } else if (thinkMatch === '') {
        remainingText = reasoningText.split(/<\/think>/)?.[1]?.trim() || '';
        return `${remainingText}${this.streamHandler.tokens.join('')}`;
      }
    }

    const reasoningTokens =
      reasoningText.length > 0
        ? `:::thinking\n${reasoningText.replace('<think>', '').replace('</think>', '').trim()}\n:::\n`
        : '';

    return `${reasoningTokens}${this.streamHandler.tokens.join('')}`;
  }

  getMessageMapMethod() {
    /**
     * @param {TMessage} msg
     */
    return (msg) => {
      if (msg.text != null && msg.text && msg.text.startsWith(':::thinking')) {
        msg.text = msg.text.replace(/:::thinking.*?:::/gs, '').trim();
      } else if (msg.content != null) {
        msg.text = parseTextParts(msg.content, true);
        delete msg.content;
      }

      return msg;
    };
  }

  /**
   * Converts a file to Responses API content part format
   * Supports file_id, file_url, or base64-encoded file_data
   * @param {MongoFile} file - The file object
   * @returns {Promise<{type: string, file_id?: string, file_url?: string, filename?: string, file_data?: string}>}
   */
  async convertFileToContentPart(file) {
    const fs = require('fs').promises;
    const path = require('path');

    // Priority 1: If file has an OpenAI file_id (from metadata.fileIdentifier), use that
    if (file.metadata?.fileIdentifier) {
      return {
        type: 'input_file',
        file_id: file.metadata.fileIdentifier,
      };
    }

    // Priority 1.5: If file has a direct file_id property, use that
    if (file.file_id) {
      return {
        type: 'input_file',
        file_id: file.file_id,
      };
    }

    // Priority 2: If file has a publicly accessible URL, use that
    if (
      file.filepath &&
      (file.filepath.startsWith('http://') || file.filepath.startsWith('https://'))
    ) {
      return {
        type: 'input_file',
        file_url: file.filepath,
      };
    }

    // Priority 3: For local files, read and convert to base64
    if (file.filepath) {
      try {
        const fileBuffer = await fs.readFile(file.filepath);
        const base64Data = fileBuffer.toString('base64');
        const mimeType = file.type || 'application/octet-stream';

        return {
          type: 'input_file',
          filename: file.filename || path.basename(file.filepath),
          file_data: `data:${mimeType};base64,${base64Data}`,
        };
      } catch (error) {
        logger.error('[OpenAIClient] Error reading file for base64 conversion:', error);
        throw error;
      }
    }

    // If file is embedded (base64 data in filepath), use that
    if (file.embedded && file.filepath) {
      return {
        type: 'input_file',
        filename: file.filename,
        file_data: file.filepath.startsWith('data:')
          ? file.filepath
          : `data:${file.type};base64,${file.filepath}`,
      };
    }

    logger.warn('[OpenAIClient] File has no usable source for Responses API:', {
      filename: file.filename,
      type: file.type,
      hasFilepath: !!file.filepath,
      hasMetadata: !!file.metadata,
    });

    throw new Error(`File ${file.filename} has no usable source (file_id, URL, or filepath)`);
  }

  // OpenAI hosted file_search (vector stores) helpers
  // Creates one vector store per conversation (or user if no conversationId) and reuses it.
  async ensureVectorStore(client) {
    if (this.vectorStoreId) {
      return this.vectorStoreId;
    }
    const name =
      (this.conversationId && `conv_${this.conversationId}`) ||
      (this.user && `user_${this.user}`) ||
      'knowledge_base';
    try {
      const vs = await client.vectorStores.create({ name });
      this.vectorStoreId = vs?.id || vs?.data?.id || vs;
    } catch (e) {
      // If creation fails (e.g., reverse proxy not supporting vector stores), bubble up
      throw e;
    }
    return this.vectorStoreId;
  }

  // Ensures all non-image attachments are uploaded to OpenAI Files API and added to the vector store
  async addFilesToVectorStore(client, vectorStoreId, files = []) {
    const fs = require('fs');
    const debugLogs = this.options?.debug || isEnabled(process.env.DEBUG_OPENAI);
    for (const file of files) {
      if (!file) continue;
      // Skip images for vector store ingestion; they're handled as input_image parts
      if (file?.type?.startsWith('image/')) continue;

      try {
        logger.info('[OpenAIClient:file_search] Preparing attachment for vector store', {
          filename: file?.filename,
          file_id: file?.file_id,
          hasFilepath: !!file?.filepath,
          source: file?.source,
          hasMetadataId: !!file?.metadata?.fileIdentifier,
        });
      } catch (_) {
        /* ignore */
      }

      let fileId = file?.metadata?.fileIdentifier || file?.file_id || null;

      // Upload to OpenAI Files API if we don't already have a file id
      if (!fileId) {
        try {
          if (!file.filepath) {
            if (debugLogs) {
              try {
                logger.debug('[OpenAIClient] Skipping file upload; no filepath or existing id', {
                  filename: file?.filename,
                  file_id: file?.file_id,
                  source: file?.source,
                  hasMetadataId: !!file?.metadata?.fileIdentifier,
                });
              } catch (_) {
                /* ignore */
              }
            }
            continue;
          }
          const stream = fs.createReadStream(file.filepath);
          const uploaded = await client.files.create({
            file: stream,
            purpose: 'assistants',
          });
          fileId = uploaded?.id;

          if (debugLogs && fileId) {
            try {
              logger.debug('[OpenAIClient] Uploaded file to OpenAI Files', {
                filename: file?.filename,
                fileId,
              });
            } catch (_) {
              /* ignore */
            }
          }
        } catch (e) {
          logger.warn('[OpenAIClient] Failed uploading file to OpenAI Files for file_search:', {
            filename: file?.filename,
            error: e?.message,
          });
          continue;
        }
      }

      // Attach file to vector store
      try {
        await client.vectorStores.files.create(vectorStoreId, { file_id: fileId });
        if (debugLogs) {
          try {
            logger.debug('[OpenAIClient] Attached file to vector store', {
              vectorStoreId,
              fileId,
            });
          } catch (_) {
            /* ignore */
          }
        }
      } catch (e) {
        logger.warn('[OpenAIClient] Failed attaching file to vector store:', {
          vectorStoreId,
          fileId,
          error: e?.message,
        });
      }
    }
  }

  // Wait for vector store files to be processed (status === 'completed')
  async waitForVectorStoreReady(client, vectorStoreId, { timeoutMs = 120000, pollMs = 1500 } = {}) {
    const start = Date.now();
    const debugLogs = this.options?.debug || isEnabled(process.env.DEBUG_OPENAI);
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await client.vectorStores.files.list({ vector_store_id: vectorStoreId });
        const files = res?.data ?? res?.body?.data ?? [];
        if (files.length > 0 && files.every((f) => f?.status === 'completed')) {
          if (debugLogs) {
            try {
              logger.debug('[OpenAIClient] Vector store files ready', {
                vectorStoreId,
                fileCount: files.length,
              });
            } catch (_) {
              /* ignore */
            }
          }
          return true;
        }
      } catch (e) {
        logger.warn('[OpenAIClient] Error polling vector store status:', {
          vectorStoreId,
          error: e?.message,
        });
      }
      await sleep(pollMs);
    }
    logger.warn('[OpenAIClient] Timed out waiting for vector store files to be ready', {
      vectorStoreId,
      timeoutMs,
    });
    return false;
  }

  /**
   * Converts traditional messages format to Responses API input format
   * @param {Array} messages - Array of message objects
   * @param {MongoFile[]} files - Array of file attachments
   * @returns {Promise<{input: Array, instructions?: string}>}
   */
  async convertMessagesToResponsesInput(messages, files = []) {
    const input = [];
    let instructions = null;

    logger.debug('[OpenAIClient:convertMessagesToResponsesInput] Starting conversion', {
      messageCount: messages.length,
      filesProvided: files.length,
      hasOptionsAttachments: !!(this.options.attachments && this.options.attachments.length > 0),
      messageFileMapSize: this.message_file_map ? Object.keys(this.message_file_map).length : 0,
    });

    // Identify the last user message index to attach current-turn files when message ids are missing
    const lastUserIndex = (() => {
      let idx = -1;
      for (let i = 0; i < messages.length; i++) {
        if (messages[i]?.role === 'user') {
          idx = i;
        }
      }
      return idx;
    })();

    // Fallback attachments from function arg or this.options.attachments
    const fallbackAttachments =
      (Array.isArray(files) && files.length
        ? files
        : Array.isArray(this.options.attachments)
          ? this.options.attachments
          : []) || [];

    logger.debug('[OpenAIClient:convertMessagesToResponsesInput] Attachment sources', {
      lastUserIndex,
      fallbackAttachmentCount: fallbackAttachments.length,
      fallbackFileNames: fallbackAttachments.map(f => f?.filename || 'unknown'),
    });

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // Extract system message as instructions
      if (message.role === 'system') {
        instructions =
          typeof message.content === 'string' ? message.content : message.content?.text;
        continue;
      }

      // Handle user messages - these can have files
      if (message.role === 'user') {
        const contentParts = [];

        // Add text content
        const text = typeof message.content === 'string' ? message.content : message.content?.text;
        if (text) {
          contentParts.push({
            type: 'input_text',
            text: text,
          });
        }

        // Gather files: prefer message_file_map; fall back to current-turn attachments on last user msg
        let messageFiles = this.message_file_map?.[message.messageId] || [];
        if (
          (!messageFiles || messageFiles.length === 0) &&
          i === lastUserIndex &&
          fallbackAttachments.length > 0
        ) {
          messageFiles = fallbackAttachments;
          logger.debug('[OpenAIClient:convertMessagesToResponsesInput] Using fallback attachments for last user message', {
            messageIndex: i,
            fileCount: messageFiles.length,
            messageId: message.messageId,
          });
        }

        logger.debug('[OpenAIClient:convertMessagesToResponsesInput] Processing user message files', {
          messageIndex: i,
          messageId: message.messageId,
          fileCount: messageFiles.length,
          fileNames: messageFiles.map(f => f?.filename || 'unknown'),
        });

        // De-dup keys for files/images
        const seen = new Set();

        // Handle files attached to this message
        for (const file of messageFiles) {
          try {
            // For images with base64 data already embedded
            if (file?.type?.startsWith('image/') && file.embedded) {
              const url = file.filepath || file.preview;
              if (url && url.startsWith('data:')) {
                const key = `img:${url}`;
                if (!seen.has(key)) {
                  contentParts.push({
                    type: 'input_image',
                    image_url: url,
                  });
                  seen.add(key);
                }
              }
            }
            // For documents and other files, use file_id or file_url or base64
            else if (file.filepath || file.file_id || file.metadata?.fileIdentifier) {
              const filePart = await this.convertFileToContentPart(file);
              const key =
                (filePart.file_id && `file:${filePart.file_id}`) ||
                (filePart.file_url && `url:${filePart.file_url}`) ||
                (filePart.filename && `name:${filePart.filename}`) ||
                JSON.stringify(filePart);
              if (!seen.has(key)) {
                contentParts.push(filePart);
                seen.add(key);
              }
            }
          } catch (error) {
            logger.error('[OpenAIClient] Error converting file for Responses API:', error);
            // Skip this file but continue with others
          }
        }

        // Also handle legacy image_urls format
        if (message.image_urls && message.image_urls.length > 0) {
          for (const imageUrl of message.image_urls) {
            if (imageUrl.image_url?.url) {
              const url = imageUrl.image_url.url;
              const key = `img:${url}`;
              // Check if we haven't already added this
              const alreadyAdded = contentParts.some(
                (part) => part.type === 'input_image' && part.image_url === url,
              );
              if (!alreadyAdded && !seen.has(key)) {
                contentParts.push({
                  type: 'input_image',
                  image_url: url,
                });
                seen.add(key);
              }
            }
          }
        }

        input.push({
          role: 'user',
          content:
            contentParts.length === 1 && contentParts[0].type === 'input_text'
              ? contentParts[0].text // If only text, simplify to string
              : contentParts,
        });
      }
      // Handle assistant messages - these are always simple text
      else if (message.role === 'assistant') {
        input.push({
          role: 'assistant',
          content:
            typeof message.content === 'string' ? message.content : message.content?.text || '',
        });
      }
    }

    const result = { input };
    if (instructions) {
      result.instructions = instructions;
    }

    return result;
  }

  /**
   * Uses the new Responses API instead of Chat Completions.
   * Supports unified file handling and server-side state management.
   * @param {Object} params
   * @param {Array} params.input - Input array with user messages and files
   * @param {Function} params.onProgress - Progress callback
   * @param {AbortController} params.abortController - Abort controller
   * @param {string} params.conversationId - Optional conversation ID for stateful conversations
   * @returns {Promise<string>} The response text
   */
  async responseCompletion({ input, onProgress, abortController = null, conversationId = null }) {
    let error = null;
    let intermediateReply = [];
    const errorCallback = (err) => (error = err);
    try {
      if (!abortController) {
        abortController = new AbortController();
      }

      let modelOptions = { ...this.modelOptions };
      const debugLogs = this.options.debug || isEnabled(process.env.DEBUG_OPENAI);

      // Enhanced debugging for Responses API
      logger.info('[OpenAIClient:ResponsesAPI] Starting response completion', {
        hasAttachments: !!(this.options.attachments && this.options.attachments.length > 0),
        attachmentCount: this.options.attachments?.length || 0,
        hasMessageFileMap: !!this.message_file_map,
        messageFileMapKeys: this.message_file_map ? Object.keys(this.message_file_map) : [],
        inputLength: input.length,
        modelOptionsWebSearch: modelOptions?.web_search,
        modelOptionsFileSearch: modelOptions?.file_search,
      });

      if (typeof onProgress === 'function') {
        modelOptions.stream = true;
      }

      // Enable built-in OpenAI web_search tool when requested (Responses API)
      const shouldEnableWebSearch = this.modelOptions?.web_search === true ||
                                    this.modelOptions?.webSearch === true ||
                                    this.options?.webSearch === true;

      if (shouldEnableWebSearch) {
        try {
          modelOptions.tools = Array.isArray(modelOptions.tools) ? modelOptions.tools : [];
          // Avoid duplicates
          const hasWebSearch = modelOptions.tools.some((t) => t?.type === 'web_search');
          if (!hasWebSearch) {
            modelOptions.tools.push({ type: 'web_search' });
            logger.info('[OpenAIClient:ResponsesAPI] Enabled web_search tool', {
              toolCount: modelOptions.tools.length,
              tools: modelOptions.tools.map(t => ({ type: t?.type })),
            });
          }
          // Let the model decide when to use search
          if (modelOptions.tool_choice == null) {
            modelOptions.tool_choice = 'auto';
          }
        } catch (err) {
          logger.error('[OpenAIClient:ResponsesAPI] Error enabling web_search', err);
        }
      }

      // Enable built-in OpenAI file_search when requested or when docs are attached
      try {
        const hasDocs =
          Array.isArray(this.options.attachments) &&
          this.options.attachments.some((f) => !f?.type?.startsWith('image/'));
        const wantsFileSearch = this.modelOptions?.file_search === true ||
                               this.modelOptions?.fileSearch === true ||
                               this.options?.fileSearch === true;

        logger.info('[OpenAIClient:ResponsesAPI] File search check', {
          hasDocs,
          wantsFileSearch,
          attachmentCount: this.options.attachments?.length || 0,
          attachmentTypes: this.options.attachments?.map(f => f?.type) || [],
          useOpenRouter: this.useOpenRouter,
          azure: this.azure,
        });

        if ((wantsFileSearch || hasDocs) && !this.useOpenRouter && !this.azure) {
          // Create a separate client pointing at the v1 base (not /responses) for file/vector APIs
          const completionsBase = extractBaseURL(this.completionsUrl);
          const apiBase =
            (completionsBase && completionsBase.replace(/\/chat$/, '')) ||
            'https://api.openai.com/v1';
          /** @type {OpenAI} */
          const filesClient = new OpenAI({
            fetch: createFetch({
              directEndpoint: this.options.directEndpoint,
              reverseProxyUrl: this.options.reverseProxyUrl,
            }),
            apiKey: this.apiKey,
            baseURL: apiBase,
          });

          const vectorStoreId = await this.ensureVectorStore(filesClient);
          await this.addFilesToVectorStore(
            filesClient,
            vectorStoreId,
            this.options.attachments || [],
          );
          // Ensure vector store files are ready before invoking file_search
          await this.waitForVectorStoreReady(filesClient, vectorStoreId);

          modelOptions.tools = Array.isArray(modelOptions.tools) ? modelOptions.tools : [];
          const hasFileSearch = modelOptions.tools.some((t) => t?.type === 'file_search');
          if (!hasFileSearch) {
            modelOptions.tools.push({
              type: 'file_search',
              vector_store_ids: [vectorStoreId],
            });
          }

          if (modelOptions.tool_choice == null) {
            modelOptions.tool_choice = 'auto';
          }

          // Optionally include results for debugging and richer output annotations
          modelOptions.include = Array.isArray(modelOptions.include)
            ? Array.from(new Set([...modelOptions.include, 'file_search_call.results']))
            : ['file_search_call.results'];

          if (debugLogs) {
            const attachmentCount = Array.isArray(this.options.attachments)
              ? this.options.attachments.length
              : 0;
            try {
              logger.info('[OpenAIClient] file_search configured', {
                vectorStoreId,
                tool_choice: modelOptions.tool_choice,
                include: modelOptions.include,
                tools: modelOptions.tools?.map((t) =>
                  t?.type === 'file_search'
                    ? { type: t.type, vector_store_ids: t.vector_store_ids }
                    : t,
                ),
                attachmentCount,
              });
            } catch (_) {
              /* ignore logging serialization issues */
            }
          }
        }
      } catch (e) {
        logger.warn('[OpenAIClient] file_search setup skipped:', e?.message || e);
      }

      // Responses API uses 'input' instead of 'messages'
      modelOptions.input = input;

      if (debugLogs) {
        try {
          logger.info('[OpenAIClient] responses.create request (summary)', {
            tool_choice: modelOptions.tool_choice,
            tools: modelOptions.tools?.map((t) =>
              t?.type === 'file_search'
                ? { type: t.type, vector_store_ids: t.vector_store_ids }
                : t,
            ),
            include: modelOptions.include,
            inputCount: Array.isArray(input) ? input.length : -1,
          });
        } catch (_) {
          /* ignore logging serialization issues */
        }
      }

      // Add conversation_id for stateful conversations
      if (conversationId) {
        modelOptions.conversation_id = conversationId;
      }

      // Ensure proper Responses API endpoint
      let baseURL = extractBaseURL(this.completionsUrl);
      if (baseURL && baseURL.includes('/chat/completions')) {
        baseURL = baseURL.replace('/chat/completions', '/responses');
      } else if (baseURL && !baseURL.endsWith('/responses')) {
        baseURL = baseURL.replace(/\/+$/, '') + '/responses';
      }

      logger.info('[OpenAIClient] responseCompletion endpoint setup', {
        originalUrl: this.completionsUrl,
        baseURL,
        modelName: modelOptions.model,
        hasTools: !!(modelOptions.tools && modelOptions.tools.length > 0),
        toolTypes: modelOptions.tools?.map(t => t?.type) || [],
      });

      const opts = {
        baseURL,
        fetchOptions: {},
      };

      if (this.useOpenRouter) {
        opts.defaultHeaders = {
          'HTTP-Referer': 'https://librechat.ai',
          'X-Title': 'LibreChat',
        };
      }

      if (this.options.headers) {
        opts.defaultHeaders = { ...opts.defaultHeaders, ...this.options.headers };
      }

      if (this.options.defaultQuery) {
        opts.defaultQuery = this.options.defaultQuery;
      }

      if (this.options.proxy) {
        opts.fetchOptions.agent = new HttpsProxyAgent(this.options.proxy);
      }

      if (this.azure || this.options.azure) {
        /* Azure Bug, extremely short default `max_tokens` response */
        if (!modelOptions.max_tokens && modelOptions.model === 'gpt-4-vision-preview') {
          modelOptions.max_tokens = 4000;
        }

        /* Azure does not accept `model` in the body, so we need to remove it. */
        delete modelOptions.model;

        opts.baseURL = this.langchainProxy
          ? constructAzureURL({
              baseURL: this.langchainProxy,
              azureOptions: this.azure,
            })
          : this.azureEndpoint.split(/(?<!\/)\/(chat|completion)\//)[0];

        opts.defaultQuery = { 'api-version': this.azure.azureOpenAIApiVersion };
        opts.defaultHeaders = { ...opts.defaultHeaders, 'api-key': this.apiKey };
      }

      if (modelOptions.max_tokens != null) {
        modelOptions.max_completion_tokens = modelOptions.max_tokens;
        modelOptions.max_output_tokens = modelOptions.max_tokens;
        delete modelOptions.max_tokens;
      }
      if (this.isOmni === true && modelOptions.temperature != null) {
        delete modelOptions.temperature;
      }

      if (process.env.OPENAI_ORGANIZATION) {
        opts.organization = process.env.OPENAI_ORGANIZATION;
      }

      if (this.options.addParams && typeof this.options.addParams === 'object') {
        const addParams = { ...this.options.addParams };
        modelOptions = {
          ...modelOptions,
          ...addParams,
        };
        logger.debug('[OpenAIClient] responseCompletion: added params', {
          addParams: addParams,
          modelOptions,
        });
      }

      /** Note: OpenAI Web Search models do not support many parameters besides `max_tokens`.
       * Ensure we drop unsupported params when search is enabled or using a search model.
       */
      if (
        (modelOptions.model && /gpt-4o.*search/i.test(modelOptions.model)) ||
        modelOptions.web_search === true ||
        (Array.isArray(modelOptions.tools) &&
          modelOptions.tools.some((t) => t?.type === 'web_search' || t?.type === 'file_search'))
      ) {
        const searchExcludeParams = [
          'frequency_penalty',
          'presence_penalty',
          'temperature',
          'top_p',
          'top_k',
          'stop',
          'logit_bias',
          'seed',
          'response_format',
          'n',
          'logprobs',
          'user',
          'metadata',
        ];

        this.options.dropParams = this.options.dropParams || [];
        this.options.dropParams = [
          ...new Set([...this.options.dropParams, ...searchExcludeParams]),
        ];
      }

      if (this.options.dropParams && Array.isArray(this.options.dropParams)) {
        const dropParams = [...this.options.dropParams];
        dropParams.forEach((param) => {
          delete modelOptions[param];
        });
        logger.debug('[OpenAIClient] responseCompletion: dropped params', {
          dropParams: dropParams,
          modelOptions,
        });
      }

      let responseCompletion;
      /** @type {OpenAI} */
      const openai = new OpenAI({
        fetch: createFetch({
          directEndpoint: this.options.directEndpoint,
          reverseProxyUrl: this.options.reverseProxyUrl,
        }),
        apiKey: this.apiKey,
        ...opts,
      });

      const streamRate = this.options.streamRate ?? Constants.DEFAULT_STREAM_RATE;

      let UnexpectedRoleError = false;
      /** @type {Promise<void>} */
      let streamPromise;
      /** @type {(value: void | PromiseLike<void>) => void} */
      let streamResolve;

      const handlers = createStreamEventHandlers(this.options.res);
      this.streamHandler = new SplitStreamHandler({
        reasoningKey: this.useOpenRouter ? 'reasoning' : 'reasoning_content',
        accumulate: false,
        runId: this.responseMessageId,
        handlers,
      });

      intermediateReply = this.streamHandler.tokens;

      if (modelOptions.stream) {
        streamPromise = new Promise((resolve) => {
          streamResolve = resolve;
        });

        // Responses API uses responses.create instead of chat.completions.create
        const stream = await openai.responses
          .create({
            ...modelOptions,
            stream: true,
          })
          .on('abort', () => {
            /* Do nothing here */
          })
          .on('error', (err) => {
            handleOpenAIErrors(err, errorCallback, 'stream');
          })
          .on('finalResponse', async (finalResponse) => {
            const finalMessage = finalResponse?.choices?.[0]?.message;
            if (!finalMessage) {
              return;
            }
            await streamPromise;
            if (finalMessage?.role !== 'assistant') {
              finalResponse.choices[0].message.role = 'assistant';
            }

            if (typeof finalMessage.content !== 'string' || finalMessage.content.trim() === '') {
              finalResponse.choices[0].message.content = this.streamHandler.tokens.join('');
            }
          })
          .on('finalMessage', (message) => {
            if (message?.role !== 'assistant') {
              stream.messages.push({
                role: 'assistant',
                content: this.streamHandler.tokens.join(''),
              });
              UnexpectedRoleError = true;
            }
          });

        if (this.continued === true) {
          const latestText = addSpaceIfNeeded(
            this.currentMessages[this.currentMessages.length - 1]?.text ?? '',
          );
          this.streamHandler.handle({
            choices: [
              {
                delta: {
                  content: latestText,
                },
              },
            ],
          });
        }

        for await (const chunk of stream) {
          // Add finish_reason: null if missing in any choice
          if (chunk.choices) {
            chunk.choices.forEach((choice) => {
              if (!('finish_reason' in choice)) {
                choice.finish_reason = null;
              }
            });
          }
          this.streamHandler.handle(chunk);
          if (abortController.signal.aborted) {
            stream.controller.abort();
            break;
          }

          await sleep(streamRate);
        }

        streamResolve();

        if (!UnexpectedRoleError) {
          responseCompletion = await stream.finalResponse().catch((err) => {
            handleOpenAIErrors(err, errorCallback, 'finalResponse');
          });
        }
      }
      // regular completion
      else {
        responseCompletion = await openai.responses
          .create({
            ...modelOptions,
          })
          .catch((err) => {
            handleOpenAIErrors(err, errorCallback, 'create');
          });
      }

      if (openai.abortHandler && abortController.signal) {
        abortController.signal.removeEventListener('abort', openai.abortHandler);
        openai.abortHandler = undefined;
      }

      if (!responseCompletion && UnexpectedRoleError) {
        throw new Error(
          'OpenAI error: Invalid final message: OpenAI expects final message to include role=assistant',
        );
      } else if (!responseCompletion && error) {
        throw new Error(error);
      } else if (!responseCompletion) {
        throw new Error('Response completion failed');
      }

      // Handle Responses API output structure
      const { output, choices } = responseCompletion;
      this.usage = responseCompletion.usage;

      // Log full response structure for debugging
      logger.debug('[OpenAIClient] Full Responses API response structure', {
        hasOutput: !!output,
        outputLength: Array.isArray(output) ? output.length : 0,
        outputTypes: Array.isArray(output) ? output.map(o => o?.type) : [],
        hasChoices: !!choices,
        choicesLength: Array.isArray(choices) ? choices.length : 0,
        usage: this.usage,
      });

      // Responses API uses 'output' array instead of 'choices'
      if (Array.isArray(output) && output.length > 0) {
        // Find the message output
        const messageOutput = output.find(o => o?.type === 'message');
        if (messageOutput) {
          const textContent = messageOutput.content?.find(c => c?.type === 'output_text');
          if (textContent?.text) {
            logger.debug('[OpenAIClient] Found text in Responses API output', {
              textLength: textContent.text.length,
              preview: textContent.text.substring(0, 100),
            });
            return textContent.text;
          }
        }
        // Log other output types for debugging
        output.forEach(o => {
          if (o?.type === 'file_search_call') {
            logger.info('[OpenAIClient] File search was called', {
              id: o.id,
              status: o.status,
              queries: o.queries,
              hasResults: !!(o.search_results),
            });
          } else if (o?.type === 'web_search_call') {
            logger.info('[OpenAIClient] Web search was called', {
              id: o.id,
              status: o.status,
              queries: o.queries,
            });
          }
        });
      }

      // Fallback to legacy choices structure if no output
      if (!Array.isArray(choices) || choices.length === 0) {
        logger.warn('[OpenAIClient] Response completion has no choices or output');
        return this.streamHandler.tokens.join('');
      }

      const { message, finish_reason } = choices[0] ?? {};
      this.metadata = { finish_reason };

      logger.debug('[OpenAIClient] responseCompletion response (fallback to choices)', responseCompletion);

      if (!message) {
        logger.warn('[OpenAIClient] Message is undefined in responseCompletion');
        return this.streamHandler.tokens.join('');
      }

      if (typeof message.content !== 'string' || message.content.trim() === '') {
        const reply = this.streamHandler.tokens.join('');
        logger.debug(
          '[OpenAIClient] responseCompletion: using intermediateReply due to empty message.content',
          { intermediateReply: reply },
        );
        return reply;
      }

      if (
        this.streamHandler.reasoningTokens.length > 0 &&
        this.options.context !== 'title' &&
        !message.content.startsWith('<think>')
      ) {
        return this.getStreamText();
      } else if (
        this.streamHandler.reasoningTokens.length > 0 &&
        this.options.context !== 'title' &&
        message.content.startsWith('<think>')
      ) {
        return this.getStreamText();
      }

      return message.content;
    } catch (err) {
      if (
        err?.message?.includes('abort') ||
        (err instanceof OpenAI.APIError && err?.message?.includes('abort'))
      ) {
        return this.getStreamText(intermediateReply);
      }
      if (
        err?.message?.includes(
          'OpenAI error: Invalid final message: OpenAI expects final message to include role=assistant',
        ) ||
        err?.message?.includes('stream ended without producing a message with role=assistant') ||
        err?.message?.includes('The server had an error processing your request') ||
        err?.message?.includes('missing finish_reason') ||
        err?.message?.includes('missing role') ||
        (err instanceof OpenAI.OpenAIError && err?.message?.includes('missing finish_reason'))
      ) {
        logger.error('[OpenAIClient] Known OpenAI error:', err);
        if (this.streamHandler && this.streamHandler.reasoningTokens.length) {
          return this.getStreamText();
        } else if (intermediateReply.length > 0) {
          return this.getStreamText(intermediateReply);
        } else {
          throw err;
        }
      } else if (err instanceof OpenAI.APIError) {
        if (this.streamHandler && this.streamHandler.reasoningTokens.length) {
          return this.getStreamText();
        } else if (intermediateReply.length > 0) {
          return this.getStreamText(intermediateReply);
        } else {
          throw err;
        }
      } else {
        logger.error('[OpenAIClient.responseCompletion] Unhandled error type', err);
        throw err;
      }
    }
  }

  async chatCompletion({ payload, onProgress, abortController = null }) {
    let error = null;
    let intermediateReply = [];
    const errorCallback = (err) => (error = err);
    try {
      if (!abortController) {
        abortController = new AbortController();
      }

      let modelOptions = { ...this.modelOptions };

      if (typeof onProgress === 'function') {
        modelOptions.stream = true;
      }
      if (this.isChatCompletion) {
        modelOptions.messages = payload;
      } else {
        modelOptions.prompt = payload;
      }

      const baseURL = extractBaseURL(this.completionsUrl);
      logger.debug('[OpenAIClient] chatCompletion', { baseURL, modelOptions });
      const opts = {
        baseURL,
        fetchOptions: {},
      };

      if (this.useOpenRouter) {
        opts.defaultHeaders = {
          'HTTP-Referer': 'https://librechat.ai',
          'X-Title': 'LibreChat',
        };
      }

      if (this.options.headers) {
        opts.defaultHeaders = { ...opts.defaultHeaders, ...this.options.headers };
      }

      if (this.options.defaultQuery) {
        opts.defaultQuery = this.options.defaultQuery;
      }

      if (this.options.proxy) {
        opts.fetchOptions.agent = new HttpsProxyAgent(this.options.proxy);
      }

      /** @type {TAzureConfig | undefined} */
      const azureConfig = this.options?.req?.app?.locals?.[EModelEndpoint.azureOpenAI];

      if (
        (this.azure && this.isVisionModel && azureConfig) ||
        (azureConfig && this.isVisionModel && this.options.endpoint === EModelEndpoint.azureOpenAI)
      ) {
        const { modelGroupMap, groupMap } = azureConfig;
        const {
          azureOptions,
          baseURL,
          headers = {},
          serverless,
        } = mapModelToAzureConfig({
          modelName: modelOptions.model,
          modelGroupMap,
          groupMap,
        });
        opts.defaultHeaders = resolveHeaders(headers);
        this.langchainProxy = extractBaseURL(baseURL);
        this.apiKey = azureOptions.azureOpenAIApiKey;

        const groupName = modelGroupMap[modelOptions.model].group;
        this.options.addParams = azureConfig.groupMap[groupName].addParams;
        this.options.dropParams = azureConfig.groupMap[groupName].dropParams;
        // Note: `forcePrompt` not re-assigned as only chat models are vision models

        this.azure = !serverless && azureOptions;
        this.azureEndpoint =
          !serverless && genAzureChatCompletion(this.azure, modelOptions.model, this);
        if (serverless === true) {
          this.options.defaultQuery = azureOptions.azureOpenAIApiVersion
            ? { 'api-version': azureOptions.azureOpenAIApiVersion }
            : undefined;
          this.options.headers['api-key'] = this.apiKey;
        }
      }

      if (this.azure || this.options.azure) {
        /* Azure Bug, extremely short default `max_tokens` response */
        if (!modelOptions.max_tokens && modelOptions.model === 'gpt-4-vision-preview') {
          modelOptions.max_tokens = 4000;
        }

        /* Azure does not accept `model` in the body, so we need to remove it. */
        delete modelOptions.model;

        opts.baseURL = this.langchainProxy
          ? constructAzureURL({
              baseURL: this.langchainProxy,
              azureOptions: this.azure,
            })
          : this.azureEndpoint.split(/(?<!\/)\/(chat|completion)\//)[0];

        opts.defaultQuery = { 'api-version': this.azure.azureOpenAIApiVersion };
        opts.defaultHeaders = { ...opts.defaultHeaders, 'api-key': this.apiKey };
      }

      if (this.isOmni === true && modelOptions.max_tokens != null) {
        modelOptions.max_completion_tokens = modelOptions.max_tokens;
        delete modelOptions.max_tokens;
      }
      if (this.isOmni === true && modelOptions.temperature != null) {
        delete modelOptions.temperature;
      }

      if (process.env.OPENAI_ORGANIZATION) {
        opts.organization = process.env.OPENAI_ORGANIZATION;
      }

      let chatCompletion;
      /** @type {OpenAI} */
      const openai = new OpenAI({
        fetch: createFetch({
          directEndpoint: this.options.directEndpoint,
          reverseProxyUrl: this.options.reverseProxyUrl,
        }),
        apiKey: this.apiKey,
        ...opts,
      });

      /* Re-orders system message to the top of the messages payload, as not allowed anywhere else */
      if (modelOptions.messages && (opts.baseURL.includes('api.mistral.ai') || this.isOllama)) {
        const { messages } = modelOptions;

        const systemMessageIndex = messages.findIndex((msg) => msg.role === 'system');

        if (systemMessageIndex > 0) {
          const [systemMessage] = messages.splice(systemMessageIndex, 1);
          messages.unshift(systemMessage);
        }

        modelOptions.messages = messages;
      }

      /* If there is only one message and it's a system message, change the role to user */
      if (
        (opts.baseURL.includes('api.mistral.ai') || opts.baseURL.includes('api.perplexity.ai')) &&
        modelOptions.messages &&
        modelOptions.messages.length === 1 &&
        modelOptions.messages[0]?.role === 'system'
      ) {
        modelOptions.messages[0].role = 'user';
      }

      if (
        (this.options.endpoint === EModelEndpoint.openAI ||
          this.options.endpoint === EModelEndpoint.azureOpenAI) &&
        modelOptions.stream === true
      ) {
        modelOptions.stream_options = { include_usage: true };
      }

      if (this.options.addParams && typeof this.options.addParams === 'object') {
        const addParams = { ...this.options.addParams };
        modelOptions = {
          ...modelOptions,
          ...addParams,
        };
        logger.debug('[OpenAIClient] chatCompletion: added params', {
          addParams: addParams,
          modelOptions,
        });
      }

      /** Note: OpenAI Web Search models do not support any known parameters besdies `max_tokens` */
      if (modelOptions.model && /gpt-4o.*search/.test(modelOptions.model)) {
        const searchExcludeParams = [
          'frequency_penalty',
          'presence_penalty',
          'temperature',
          'top_p',
          'top_k',
          'stop',
          'logit_bias',
          'seed',
          'response_format',
          'n',
          'logprobs',
          'user',
        ];

        this.options.dropParams = this.options.dropParams || [];
        this.options.dropParams = [
          ...new Set([...this.options.dropParams, ...searchExcludeParams]),
        ];
      }

      if (this.options.dropParams && Array.isArray(this.options.dropParams)) {
        const dropParams = [...this.options.dropParams];
        dropParams.forEach((param) => {
          delete modelOptions[param];
        });
        logger.debug('[OpenAIClient] chatCompletion: dropped params', {
          dropParams: dropParams,
          modelOptions,
        });
      }

      const streamRate = this.options.streamRate ?? Constants.DEFAULT_STREAM_RATE;

      if (this.message_file_map && this.isOllama) {
        const ollamaClient = new OllamaClient({ baseURL, streamRate });
        return await ollamaClient.chatCompletion({
          payload: modelOptions,
          onProgress,
          abortController,
        });
      }

      let UnexpectedRoleError = false;
      /** @type {Promise<void>} */
      let streamPromise;
      /** @type {(value: void | PromiseLike<void>) => void} */
      let streamResolve;

      if (
        (!this.isOmni || /^o1-(mini|preview)/i.test(modelOptions.model)) &&
        modelOptions.reasoning_effort != null
      ) {
        delete modelOptions.reasoning_effort;
        delete modelOptions.temperature;
      }

      let reasoningKey = 'reasoning_content';
      if (this.useOpenRouter) {
        modelOptions.include_reasoning = true;
        reasoningKey = 'reasoning';
      }
      if (this.useOpenRouter && modelOptions.reasoning_effort != null) {
        modelOptions.reasoning = {
          effort: modelOptions.reasoning_effort,
        };
        delete modelOptions.reasoning_effort;
      }

      const handlers = createStreamEventHandlers(this.options.res);
      this.streamHandler = new SplitStreamHandler({
        reasoningKey,
        accumulate: false,
        runId: this.responseMessageId,
        handlers,
      });

      intermediateReply = this.streamHandler.tokens;

      if (modelOptions.stream) {
        streamPromise = new Promise((resolve) => {
          streamResolve = resolve;
        });
        /** @type {OpenAI.OpenAI.CompletionCreateParamsStreaming} */
        const params = {
          ...modelOptions,
          stream: true,
        };
        const stream = await openai.chat.completions
          .stream(params)
          .on('abort', () => {
            /* Do nothing here */
          })
          .on('error', (err) => {
            handleOpenAIErrors(err, errorCallback, 'stream');
          })
          .on('finalChatCompletion', async (finalChatCompletion) => {
            const finalMessage = finalChatCompletion?.choices?.[0]?.message;
            if (!finalMessage) {
              return;
            }
            await streamPromise;
            if (finalMessage?.role !== 'assistant') {
              finalChatCompletion.choices[0].message.role = 'assistant';
            }

            if (typeof finalMessage.content !== 'string' || finalMessage.content.trim() === '') {
              finalChatCompletion.choices[0].message.content = this.streamHandler.tokens.join('');
            }
          })
          .on('finalMessage', (message) => {
            if (message?.role !== 'assistant') {
              stream.messages.push({
                role: 'assistant',
                content: this.streamHandler.tokens.join(''),
              });
              UnexpectedRoleError = true;
            }
          });

        if (this.continued === true) {
          const latestText = addSpaceIfNeeded(
            this.currentMessages[this.currentMessages.length - 1]?.text ?? '',
          );
          this.streamHandler.handle({
            choices: [
              {
                delta: {
                  content: latestText,
                },
              },
            ],
          });
        }

        for await (const chunk of stream) {
          // Add finish_reason: null if missing in any choice
          if (chunk.choices) {
            chunk.choices.forEach((choice) => {
              if (!('finish_reason' in choice)) {
                choice.finish_reason = null;
              }
            });
          }
          this.streamHandler.handle(chunk);
          if (abortController.signal.aborted) {
            stream.controller.abort();
            break;
          }

          await sleep(streamRate);
        }

        streamResolve();

        if (!UnexpectedRoleError) {
          chatCompletion = await stream.finalChatCompletion().catch((err) => {
            handleOpenAIErrors(err, errorCallback, 'finalChatCompletion');
          });
        }
      }
      // regular completion
      else {
        chatCompletion = await openai.chat.completions
          .create({
            ...modelOptions,
          })
          .catch((err) => {
            handleOpenAIErrors(err, errorCallback, 'create');
          });
      }

      if (openai.abortHandler && abortController.signal) {
        abortController.signal.removeEventListener('abort', openai.abortHandler);
        openai.abortHandler = undefined;
      }

      if (!chatCompletion && UnexpectedRoleError) {
        throw new Error(
          'OpenAI error: Invalid final message: OpenAI expects final message to include role=assistant',
        );
      } else if (!chatCompletion && error) {
        throw new Error(error);
      } else if (!chatCompletion) {
        throw new Error('Chat completion failed');
      }

      const { choices } = chatCompletion;
      this.usage = chatCompletion.usage;

      if (!Array.isArray(choices) || choices.length === 0) {
        logger.warn('[OpenAIClient] Chat completion response has no choices');
        return this.streamHandler.tokens.join('');
      }

      const { message, finish_reason } = choices[0] ?? {};
      this.metadata = { finish_reason };

      logger.debug('[OpenAIClient] chatCompletion response', chatCompletion);

      if (!message) {
        logger.warn('[OpenAIClient] Message is undefined in chatCompletion response');
        return this.streamHandler.tokens.join('');
      }

      if (typeof message.content !== 'string' || message.content.trim() === '') {
        const reply = this.streamHandler.tokens.join('');
        logger.debug(
          '[OpenAIClient] chatCompletion: using intermediateReply due to empty message.content',
          { intermediateReply: reply },
        );
        return reply;
      }

      if (
        this.streamHandler.reasoningTokens.length > 0 &&
        this.options.context !== 'title' &&
        !message.content.startsWith('<think>')
      ) {
        return this.getStreamText();
      } else if (
        this.streamHandler.reasoningTokens.length > 0 &&
        this.options.context !== 'title' &&
        message.content.startsWith('<think>')
      ) {
        return this.getStreamText();
      }

      return message.content;
    } catch (err) {
      if (
        err?.message?.includes('abort') ||
        (err instanceof OpenAI.APIError && err?.message?.includes('abort'))
      ) {
        return this.getStreamText(intermediateReply);
      }
      if (
        err?.message?.includes(
          'OpenAI error: Invalid final message: OpenAI expects final message to include role=assistant',
        ) ||
        err?.message?.includes(
          'stream ended without producing a ChatCompletionMessage with role=assistant',
        ) ||
        err?.message?.includes('The server had an error processing your request') ||
        err?.message?.includes('missing finish_reason') ||
        err?.message?.includes('missing role') ||
        (err instanceof OpenAI.OpenAIError && err?.message?.includes('missing finish_reason'))
      ) {
        logger.error('[OpenAIClient] Known OpenAI error:', err);
        if (this.streamHandler && this.streamHandler.reasoningTokens.length) {
          return this.getStreamText();
        } else if (intermediateReply.length > 0) {
          return this.getStreamText(intermediateReply);
        } else {
          throw err;
        }
      } else if (err instanceof OpenAI.APIError) {
        if (this.streamHandler && this.streamHandler.reasoningTokens.length) {
          return this.getStreamText();
        } else if (intermediateReply.length > 0) {
          return this.getStreamText(intermediateReply);
        } else {
          throw err;
        }
      } else {
        logger.error('[OpenAIClient.chatCompletion] Unhandled error type', err);
        throw err;
      }
    }
  }
}

module.exports = OpenAIClient;
