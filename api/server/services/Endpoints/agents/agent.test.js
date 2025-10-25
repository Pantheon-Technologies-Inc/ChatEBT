jest.mock('@librechat/agents', () => ({
  Providers: {
    OPENAI: 'openai',
  },
}));

jest.mock('@librechat/api', () => ({
  primeResources: jest.fn().mockResolvedValue({
    attachments: [],
    tool_resources: {},
  }),
  extractLibreChatParams: jest.fn(() => ({
    resendFiles: false,
    maxContextTokens: undefined,
    modelOptions: { model: 'gpt-4' },
  })),
  optionalChainWithEmptyCheck: jest.fn((a, b, fallback) => a ?? b ?? fallback),
}));

const mockReplaceSpecialVars = jest.fn(({ text }) => `${text} [personalized]`);

jest.mock('librechat-data-provider', () => ({
  Constants: { EPHEMERAL_AGENT_ID: 'ephemeral', mcp_delimiter: ':' },
  FileSources: { local: 'local' },
  ErrorTypes: { GOOGLE_TOOL_CONFLICT: 'GOOGLE_TOOL_CONFLICT' },
  EModelEndpoint: { agents: 'agents', openAI: 'openai', azureOpenAI: 'azureOpenAI' },
  EToolResources: { file_search: 'file_search' },
  isAgentsEndpoint: jest.fn(() => false),
  PermissionTypes: {
    BOOKMARKS: 'BOOKMARKS',
    PROMPTS: 'PROMPTS',
    MEMORIES: 'MEMORIES',
    AGENTS: 'AGENTS',
    MULTI_CONVO: 'MULTI_CONVO',
    TEMPORARY_CHAT: 'TEMPORARY_CHAT',
    RUN_CODE: 'RUN_CODE',
    WEB_SEARCH: 'WEB_SEARCH',
    FILE_SEARCH: 'FILE_SEARCH',
  },
  Permissions: {
    USE: 'USE',
    CREATE: 'CREATE',
    READ: 'READ',
    UPDATE: 'UPDATE',
    OPT_OUT: 'OPT_OUT',
    SHARED_GLOBAL: 'SHARED_GLOBAL',
  },
  SystemRoles: {
    USER: 'USER',
  },
  replaceSpecialVars: (...args) => mockReplaceSpecialVars(...args),
  providerEndpointMap: { openai: 'openai' },
  Tools: { file_search: 'file_search' },
}));

jest.mock('~/server/services/Endpoints', () => ({
  getProviderConfig: jest.fn().mockResolvedValue({
    overrideProvider: 'openai',
    getOptions: jest.fn().mockResolvedValue({
      llmConfig: { model: 'gpt-4' },
      tools: [],
    }),
  }),
}));

jest.mock('~/server/services/ToolService', () => ({
  loadAgentTools: jest.fn().mockResolvedValue({ tools: [], toolContextMap: {} }),
}));

jest.mock('~/server/services/Files/process', () => ({
  processFiles: jest.fn(),
}));

jest.mock('~/models/File', () => ({
  getFiles: jest.fn(),
  getToolFilesByIds: jest.fn(),
}));

jest.mock('~/models/Conversation', () => ({
  getConvoFiles: jest.fn().mockResolvedValue([]),
}));

jest.mock('~/utils', () => ({
  getModelMaxTokens: jest.fn(() => 8000),
}));

const { initializeAgent } = require('./agent');

describe('initializeAgent', () => {
  it("merges the user's system prompt into agent instructions", async () => {
    const req = {
      user: {
        id: 'user-1',
        personalization: {
          systemPrompt: 'Stay concise.',
        },
      },
      app: {
        locals: {
          agents: {},
        },
      },
    };

    const res = {};

    const agent = {
      id: 'agent-123',
      provider: 'openai',
      model: 'gpt-4',
      instructions: 'Original instructions.',
      tools: [],
    };

    const result = await initializeAgent({
      req,
      res,
      agent,
      loadTools: jest.fn(),
      requestFiles: [],
      conversationId: null,
      endpointOption: {
        endpoint: 'agents',
        model_parameters: { model: 'gpt-4' },
      },
    });

    expect(result.instructions).toContain('Stay concise.');
    expect(result.instructions).toContain('Original instructions.');
    expect(mockReplaceSpecialVars).toHaveBeenCalledWith({
      text: 'Original instructions.',
      user: req.user,
    });
  });
});
