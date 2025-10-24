const { Providers } = require('@librechat/agents');
const {
  primeResources,
  extractLibreChatParams,
  optionalChainWithEmptyCheck,
} = require('@librechat/api');
const {
  ErrorTypes,
  EModelEndpoint,
  EToolResources,
  isAgentsEndpoint,
  replaceSpecialVars,
  providerEndpointMap,
  Tools,
} = require('librechat-data-provider');
const generateArtifactsPrompt = require('~/app/clients/prompts/artifacts');
const { getProviderConfig } = require('~/server/services/Endpoints');
const { processFiles } = require('~/server/services/Files/process');
const { getFiles, getToolFilesByIds } = require('~/models/File');
const { getConvoFiles } = require('~/models/Conversation');
const { getModelMaxTokens } = require('~/utils');
const { logger } = require('@librechat/data-schemas');

/**
 * @param {object} params
 * @param {ServerRequest} params.req
 * @param {ServerResponse} params.res
 * @param {Agent} params.agent
 * @param {string | null} [params.conversationId]
 * @param {Array<IMongoFile>} [params.requestFiles]
 * @param {typeof import('~/server/services/ToolService').loadAgentTools | undefined} [params.loadTools]
 * @param {TEndpointOption} [params.endpointOption]
 * @param {Set<string>} [params.allowedProviders]
 * @param {boolean} [params.isInitialAgent]
 * @returns {Promise<Agent & { tools: StructuredTool[], attachments: Array<MongoFile>, toolContextMap: Record<string, unknown>, maxContextTokens: number }>}
 */
const initializeAgent = async ({
  req,
  res,
  agent,
  loadTools,
  requestFiles,
  conversationId,
  endpointOption,
  allowedProviders,
  isInitialAgent = false,
}) => {
  if (
    isAgentsEndpoint(endpointOption?.endpoint) &&
    allowedProviders.size > 0 &&
    !allowedProviders.has(agent.provider)
  ) {
    throw new Error(
      `{ "type": "${ErrorTypes.INVALID_AGENT_PROVIDER}", "info": "${agent.provider}" }`,
    );
  }
  let currentFiles;

  const _modelOptions = structuredClone(
    Object.assign(
      { model: agent.model },
      agent.model_parameters ?? { model: agent.model },
      isInitialAgent === true ? endpointOption?.model_parameters : {},
    ),
  );

  const { resendFiles, maxContextTokens, modelOptions } = extractLibreChatParams(_modelOptions);

  if (isInitialAgent && conversationId != null && resendFiles) {
    const fileIds = (await getConvoFiles(conversationId)) ?? [];
    /** @type {Set<EToolResources>} */
    const toolResourceSet = new Set();
    for (const tool of agent.tools) {
      if (EToolResources[tool]) {
        toolResourceSet.add(EToolResources[tool]);
      }
    }
    const toolFiles = await getToolFilesByIds(fileIds, toolResourceSet);
    if (requestFiles.length || toolFiles.length) {
      currentFiles = await processFiles(requestFiles.concat(toolFiles));
    }
  } else if (isInitialAgent && requestFiles.length) {
    currentFiles = await processFiles(requestFiles);
  }

  const { attachments, tool_resources } = await primeResources({
    req,
    getFiles,
    attachments: currentFiles,
    tool_resources: agent.tool_resources,
    requestFileSet: new Set(requestFiles?.map((file) => file.file_id)),
    agentId: agent.id,
  });

  // If RAG is disabled and provider is OpenAI, ensure file_search tool is enabled
  // and seed its tool_resources with any newly attached file_ids so the tool can search them.
  try {
    const ragDisabled = !process.env.RAG_API_URL;
    if (ragDisabled && agent.provider === Providers.OPENAI) {
      if (!Array.isArray(agent.tools)) {
        agent.tools = [];
      }
      if (!agent.tools.includes(Tools.file_search)) {
        agent.tools.push(Tools.file_search);
      }
      // Seed tool_resources.file_search.file_ids with current attachments (non-images)
      const nonImageAttachments = Array.isArray(attachments)
        ? attachments.filter((f) => !(f?.type || '').startsWith('image/'))
        : [];
      if (nonImageAttachments.length > 0) {
        tool_resources[EToolResources.file_search] =
          tool_resources[EToolResources.file_search] || {};
        const existing = tool_resources[EToolResources.file_search].file_ids || [];
        const merged = new Set(existing);
        for (const f of nonImageAttachments) {
          if (f?.file_id) {
            merged.add(f.file_id);
          }
        }
        tool_resources[EToolResources.file_search].file_ids = Array.from(merged);
      }
      logger.info('[Agents:init] Injected file_search tool for OpenAI with RAG disabled', {
        toolAdded: true,
        fileIdsCount: tool_resources[EToolResources.file_search]?.file_ids?.length || 0,
      });
    }
  } catch (e) {
    logger.warn('[Agents:init] file_search injection failed', { error: e?.message });
  }

  const provider = agent.provider;
  const { tools: structuredTools, toolContextMap } =
    (await loadTools?.({
      req,
      res,
      provider,
      agentId: agent.id,
      tools: agent.tools,
      model: agent.model,
      tool_resources,
    })) ?? {};

  agent.endpoint = provider;
  const { getOptions, overrideProvider } = await getProviderConfig(provider);
  if (overrideProvider !== agent.provider) {
    agent.provider = overrideProvider;
  }

  const _endpointOption =
    isInitialAgent === true
      ? Object.assign({}, endpointOption, { model_parameters: modelOptions })
      : { model_parameters: modelOptions };

  const options = await getOptions({
    req,
    res,
    optionsOnly: true,
    overrideEndpoint: provider,
    overrideModel: agent.model,
    endpointOption: _endpointOption,
  });

  const tokensModel =
    agent.provider === EModelEndpoint.azureOpenAI ? agent.model : modelOptions.model;
  const maxTokens = optionalChainWithEmptyCheck(
    modelOptions.maxOutputTokens,
    modelOptions.maxTokens,
    0,
  );
  const agentMaxContextTokens = optionalChainWithEmptyCheck(
    maxContextTokens,
    getModelMaxTokens(tokensModel, providerEndpointMap[provider], options.endpointTokenConfig),
    4096,
  );

  if (
    agent.endpoint === EModelEndpoint.azureOpenAI &&
    options.llmConfig?.azureOpenAIApiInstanceName == null
  ) {
    agent.provider = Providers.OPENAI;
  }

  if (options.provider != null) {
    agent.provider = options.provider;
  }

  /** @type {import('@librechat/agents').GenericTool[]} */
  let tools = options.tools?.length ? options.tools : structuredTools;
  if (
    (agent.provider === Providers.GOOGLE || agent.provider === Providers.VERTEXAI) &&
    options.tools?.length &&
    structuredTools?.length
  ) {
    throw new Error(`{ "type": "${ErrorTypes.GOOGLE_TOOL_CONFLICT}"}`);
  } else if (
    (agent.provider === Providers.OPENAI ||
      agent.provider === Providers.AZURE ||
      agent.provider === Providers.ANTHROPIC) &&
    options.tools?.length &&
    structuredTools?.length
  ) {
    tools = structuredTools.concat(options.tools);
  }

  /** @type {import('@librechat/agents').ClientOptions} */
  agent.model_parameters = { ...options.llmConfig };
  if (options.configOptions) {
    agent.model_parameters.configuration = options.configOptions;
  }

  if (agent.instructions && agent.instructions !== '') {
    agent.instructions = replaceSpecialVars({
      text: agent.instructions,
      user: req.user,
    });
  }

  if (typeof agent.artifacts === 'string' && agent.artifacts !== '') {
    agent.additional_instructions = generateArtifactsPrompt({
      endpoint: agent.provider,
      artifacts: agent.artifacts,
    });
  }

  // Debug: summarize Agents init state for file search issues
  try {
    logger.debug('[Agents:init]', {
      provider: agent.provider,
      ragEnabled: !!process.env.RAG_API_URL,
      toolNames: Array.isArray(tools) ? tools.map((t) => t && t.name).filter(Boolean) : [],
      attachmentsCount: Array.isArray(attachments) ? attachments.length : 0,
    });
  } catch (_) {
    /* ignore logging errors */
  }

  return {
    ...agent,
    tools,
    attachments,
    resendFiles,
    toolContextMap,
    useLegacyContent: !!options.useLegacyContent,
    maxContextTokens: Math.round((agentMaxContextTokens - maxTokens) * 0.9),
  };
};

module.exports = { initializeAgent };
