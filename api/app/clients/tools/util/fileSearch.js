const { z } = require('zod');
const axios = require('axios');
const { tool } = require('@langchain/core/tools');
const { logger } = require('@librechat/data-schemas');
const { Tools, EToolResources } = require('librechat-data-provider');
const { generateShortLivedToken } = require('~/server/services/AuthService');
const { getFiles } = require('~/models/File');
const OpenAI = require('openai');
const fs = require('fs');
const { resolveStoragePath } = require('~/server/services/Files/utils');

// Cache vector store metadata so we don't recreate/upload on every tool run
/** @type {Map<string, { vectorStoreId: string, uploadedFileIds: Set<string> }>} */
const hostedVectorStoreCache = new Map();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryDelay = (attempt) => Math.min(1000 * Math.pow(2, attempt - 1), 8000);

const ensureLocalFileReadable = async (absolutePath) => {
  try {
    await fs.promises.access(absolutePath, fs.constants.R_OK);
  } catch (error) {
    const err = new Error(`File not readable at path: ${absolutePath}`);
    err.cause = error;
    throw err;
  }
};

const createUploadStream = async (absoluteOrRemotePath) => {
  if (/^https?:\/\//i.test(absoluteOrRemotePath)) {
    const response = await axios({
      method: 'get',
      url: absoluteOrRemotePath,
      responseType: 'stream',
    });
    return response.data;
  }

  await ensureLocalFileReadable(absoluteOrRemotePath);
  return fs.createReadStream(absoluteOrRemotePath);
};

const uploadFileToHostedVectorStore = async ({
  openai,
  vectorStoreId,
  file,
  absoluteOrRemotePath,
  cacheUploaded,
  maxAttempts = 3,
}) => {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      const stream = await createUploadStream(absoluteOrRemotePath);
      const uploaded = await openai.files.create({
        file: stream,
        purpose: 'assistants',
      });
      const fileId = uploaded?.id;
      if (!fileId) {
        throw new Error('OpenAI file upload did not return an id');
      }

      await openai.vectorStores.files.createAndPoll(vectorStoreId, { file_id: fileId });

      if (file?.file_id) {
        cacheUploaded.add(file.file_id);
      }

      return;
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }

      const delay = getRetryDelay(attempt);
      try {
        logger.warn('[Agents:file_search] Retrying file upload for hosted search', {
          filename: file?.filename,
          attempt,
          delay,
          error: error?.message,
          status: error?.response?.status,
        });
      } catch (_) {
        /* ignore */
      }

      await wait(delay);
    }
  }
};

/**
 *
 * @param {Object} options
 * @param {ServerRequest} options.req
 * @param {Agent['tool_resources']} options.tool_resources
 * @param {string} [options.agentId] - The agent ID for file access control
 * @returns {Promise<{
 *   files: Array<{ file_id: string; filename: string }>,
 *   toolContext: string
 * }>}
 */
const primeFiles = async (options) => {
  const { tool_resources, req, agentId } = options;
  const file_ids = tool_resources?.[EToolResources.file_search]?.file_ids ?? [];
  const agentResourceIds = new Set(file_ids);
  const resourceFiles = tool_resources?.[EToolResources.file_search]?.files ?? [];
  const dbFiles = (
    (await getFiles(
      { file_id: { $in: file_ids } },
      null,
      { text: 0 },
      { userId: req?.user?.id, agentId },
    )) ?? []
  ).concat(resourceFiles);

  let toolContext = `- Note: Semantic search is available through the ${Tools.file_search} tool but no files are currently loaded. Request the user to upload documents to search through.`;

  const files = [];
  for (let i = 0; i < dbFiles.length; i++) {
    const file = dbFiles[i];
    if (!file) {
      continue;
    }
    if (i === 0) {
      toolContext = `- Note: Use the ${Tools.file_search} tool to find relevant information within:`;
    }
    toolContext += `\n\t- ${file.filename}${
      agentResourceIds.has(file.file_id) ? '' : ' (just attached by user)'
    }`;
    files.push({
      file_id: file.file_id,
      filename: file.filename,
    });
  }

  if (files.length) {
    toolContext +=
      '\n\n- Guidance: Compose one comprehensive query per user turn. Combine related sub-questions into the same call and avoid invoking the file_search tool repeatedly unless the user explicitly requests a follow-up search.';
  }

  return { files, toolContext };
};

/**
 *
 * @param {Object} options
 * @param {ServerRequest} options.req
 * @param {Array<{ file_id: string; filename: string }>} options.files
 * @param {string} [options.entity_id]
 * @returns
 */
const createFileSearchTool = async ({ req, files, entity_id }) => {
  const hostedFileSearch = !process.env.RAG_API_URL;
  const noFilesMessage = 'No files to search. Instruct the user to add files for the search.';

  /** @type {{ openai: OpenAI, prepPromise: Promise<void>, getVectorStoreId: () => string | null, getPrepError: () => unknown } | null} */
  let hostedState = null;

  if (hostedFileSearch) {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      // baseURL can be customized via OPENAI_REVERSE_PROXY if needed
    });

    const vsName =
      (entity_id && `agent_${entity_id}`) ||
      (req?.user?.id && `user_${req.user.id}`) ||
      'knowledge_base';
    let vectorStoreId = null;
    let prepError = null;

    if (!process.env.OPENAI_API_KEY) {
      prepError = 'Hosted file search requires a valid OpenAI API key.';
      hostedState = {
        openai,
        prepPromise: Promise.resolve(),
        getVectorStoreId: () => null,
        getPrepError: () => prepError,
      };
    } else {
      const prepPromise = (async () => {
        try {
          logger.info('[Agents:file_search] Using hosted file_search (OpenAI vector stores)', {
            filesCount: files.length,
          });
        } catch (_) {
          /* ignore */
        }

      try {
        const fileIds = files.map((f) => f.file_id);
        const dbFiles =
          (await getFiles(
            { file_id: { $in: fileIds } },
            null,
            { text: 0 },
            { userId: req?.user?.id, agentId: entity_id },
          )) ?? [];

        try {
          logger.debug('[Agents:file_search] Retrieved database files', {
            count: dbFiles.length,
            descriptors: dbFiles.map((file) => ({
              file_id: file?.file_id,
              hasFilepath: !!file?.filepath,
              source: file?.source,
              hasMetadata: !!file?.metadata,
            })),
          });
        } catch (_) {
          /* ignore */
        }

        if (dbFiles.length === 0) {
          prepError = noFilesMessage;
          return;
        }

        const nonImageFiles = dbFiles.filter((f) => !(f?.type || '').startsWith('image/'));
        logger.info('[Agents:file_search] Prepared files for hosted search', {
          totalDbFiles: dbFiles.length,
          nonImageCount: nonImageFiles.length,
          filenames: nonImageFiles.map((f) => f?.filename),
        });
        if (nonImageFiles.length === 0) {
          prepError =
            'Only image files are attached. Upload text-based documents to enable semantic search.';
          return;
        }

        const cacheEntry = hostedVectorStoreCache.get(vsName);
        if (cacheEntry?.vectorStoreId) {
          vectorStoreId = cacheEntry.vectorStoreId;
        } else {
          const vectorStore = await openai.vectorStores.create({ name: vsName });
          vectorStoreId = vectorStore?.id || vectorStore?.data?.id || null;
          if (vectorStoreId) {
            hostedVectorStoreCache.set(vsName, {
              vectorStoreId,
              uploadedFileIds: new Set(),
            });
          }
        }

        try {
          logger.info('[Agents:file_search] Created/using vector store', {
            vectorStoreId,
            vsName,
            uploadCount: nonImageFiles.length,
          });
        } catch (_) {
          /* ignore */
        }

        if (!vectorStoreId) {
          prepError = 'Unable to create a vector store for hosted file search.';
          return;
        }

        const cacheUploaded =
          hostedVectorStoreCache.get(vsName)?.uploadedFileIds ?? new Set();

        for (const file of nonImageFiles) {
          try {
            if (!file?.filepath) {
              logger.warn('[Agents:file_search] Skipped file without filepath during upload', {
                filename: file?.filename,
              });
              continue;
            }

            if (file?.file_id && cacheUploaded.has(file.file_id)) {
              logger.debug('[Agents:file_search] Skipping already uploaded file', {
                filename: file?.filename,
                fileId: file?.file_id,
              });
              continue;
            }

            const absoluteOrRemotePath = resolveStoragePath({
              req,
              filepath: file?.filepath,
            });

            if (!absoluteOrRemotePath) {
              logger.warn(
                '[Agents:file_search] Unable to resolve hosted file path for upload',
                {
                  filename: file?.filename,
                  filepath: file?.filepath,
                  source: file?.source,
                },
              );
              continue;
            }

            await uploadFileToHostedVectorStore({
              openai,
              vectorStoreId,
              file,
              absoluteOrRemotePath,
              cacheUploaded,
            });
          } catch (e) {
            logger.warn('[Agents:file_search] Skipped file during upload/attach', {
              filename: file?.filename,
              error: e?.message,
              status: e?.response?.status,
            });
          }
        }

        hostedVectorStoreCache.set(vsName, {
          vectorStoreId,
          uploadedFileIds: cacheUploaded,
        });
      } catch (err) {
        prepError = err;
        logger.error('[Agents:file_search] Hosted file search setup failed', err);
      }
    })();

      hostedState = {
        openai,
        prepPromise,
        getVectorStoreId: () => vectorStoreId,
        getPrepError: () => prepError,
      };
    }
  }

  return tool(
    async ({ query }) => {
      if (files.length === 0) {
        return noFilesMessage;
      }

      // Hosted (Responses API) workflow
      if (hostedFileSearch && hostedState) {
        await hostedState.prepPromise;
        const prepError = hostedState.getPrepError();
        if (prepError) {
          return typeof prepError === 'string'
            ? prepError
            : 'Hosted File Search failed: ' + (prepError?.message || 'Unknown error');
        }

        const vectorStoreId = hostedState.getVectorStoreId();
        if (!vectorStoreId) {
          return noFilesMessage;
        }

        const retrievalModel = process.env.OPENAI_RETRIEVAL_MODEL || 'gpt-4o';
        try {
          logger.info('[Agents:file_search] Calling Responses API for file search', {
            model: retrievalModel,
            query,
            vectorStoreId,
          });

          const response = await hostedState.openai.responses.create({
            model: retrievalModel,
            input: query,
            tools: [
              {
                type: 'file_search',
                vector_store_ids: [vectorStoreId],
              },
            ],
            include: ['file_search_call.results'],
          });

        try {
          logger.info('[Agents:file_search] responses.create (hosted) completed', {
            vectorStoreId,
            hasOutput: Array.isArray(response?.output),
            outputLength: Array.isArray(response?.output) ? response.output.length : 0,
            outputTypes: Array.isArray(response?.output)
              ? response.output.map((x) => x?.type)
              : null,
            responseKeys: Object.keys(response || {}),
            hasOutputText: typeof response?.output_text === 'string',
          });
        } catch (_) {
          /* ignore */
        }

        if (response?.output_text) {
            logger.info('[Agents:file_search] Found text output from file search', {
              textLength: response.output_text.length,
              preview: response.output_text.substring(0, 200),
            });
            return response.output_text;
          }

          const out = response?.output || [];
          out.forEach((item, index) => {
            logger.debug(`[Agents:file_search] Output item ${index}`, {
              type: item?.type,
              hasContent: !!item?.content,
              contentLength: Array.isArray(item?.content) ? item.content.length : 0,
              contentTypes: Array.isArray(item?.content)
                ? item.content.map((c) => c?.type)
                : null,
            });
          });

          const messageItem = out.find((x) => x?.type === 'message');
          if (messageItem?.content?.length) {
            const textPart = messageItem.content.find(
              (part) => part?.type === 'output_text' || part?.type === 'text',
            );
            if (textPart?.text) {
              logger.info('[Agents:file_search] Found text output from file search', {
                textLength: textPart.text.length,
                preview: textPart.text.substring(0, 200),
              });
              return textPart.text;
            }
          }

          logger.warn('[Agents:file_search] No textual output found in Responses payload', {
            vectorStoreId,
            outputTypes: out.map((item) => item?.type),
          });
          return JSON.stringify(response, null, 2);
        } catch (err) {
          logger.error('[Agents:file_search] Hosted File Search failed', err);
          return 'Hosted File Search failed: ' + (err?.message || 'Unknown error');
        }
      }

      // Local RAG workflow
      try {
        logger.info('[Agents:file_search] Using local RAG API', {
          ragUrl: process.env.RAG_API_URL,
          filesCount: files.length,
        });
      } catch (_) {
        /* ignore */
      }
      const jwtToken = generateShortLivedToken(req.user.id);
      if (!jwtToken) {
        return 'There was an error authenticating the file search request.';
      }

      /**
       *
       * @param {import('librechat-data-provider').TFile} file
       * @returns {{ file_id: string, query: string, k: number, entity_id?: string }}
       */
      const createQueryBody = (file) => {
        const body = {
          file_id: file.file_id,
          query,
          k: 5,
        };
        if (!entity_id) {
          return body;
        }
        body.entity_id = entity_id;
        logger.debug(`[${Tools.file_search}] RAG API /query body`, body);
        return body;
      };

      const queryPromises = files.map((file) =>
        axios
          .post(`${process.env.RAG_API_URL}/query`, createQueryBody(file), {
            headers: {
              Authorization: `Bearer ${jwtToken}`,
              'Content-Type': 'application/json',
            },
          })
          .catch((error) => {
            logger.error('Error encountered in `file_search` while querying file:', error);
            return null;
          }),
      );

      const results = await Promise.all(queryPromises);
      const validResults = results.filter((result) => result !== null);

      if (validResults.length === 0) {
        return 'No results found or errors occurred while searching the files.';
      }

      const formattedResults = validResults
        .flatMap((result) =>
          result.data.map(([docInfo, distance]) => ({
            filename: docInfo.metadata.source.split('/').pop(),
            content: docInfo.page_content,
            distance,
          })),
        )
        // TODO: results should be sorted by relevance, not distance
        .sort((a, b) => a.distance - b.distance)
        // TODO: make this configurable
        .slice(0, 10);

      const formattedString = formattedResults
        .map(
          (result) =>
            `File: ${result.filename}\nRelevance: ${1.0 - result.distance.toFixed(4)}\nContent: ${
              result.content
            }\n`,
        )
        .join('\n---\n');

      return formattedString;
    },
    {
      name: Tools.file_search,
      description: `Performs semantic search across attached "${Tools.file_search}" documents using natural language queries. This tool analyzes the content of uploaded files to find relevant information, quotes, and passages that best match your query. Use this to extract specific information or find relevant sections within the available documents.`,
      schema: z.object({
        query: z
          .string()
          .describe(
            "A natural language query to search for relevant information in the files. Be specific and use keywords related to the information you're looking for. The query will be used for semantic similarity matching against the file contents.",
          ),
      }),
    },
  );
};

module.exports = { createFileSearchTool, primeFiles };
