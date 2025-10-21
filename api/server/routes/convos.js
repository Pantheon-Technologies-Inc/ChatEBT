const multer = require('multer');
const express = require('express');
const { sleep } = require('@librechat/agents');
const { isEnabled } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { CacheKeys, EModelEndpoint } = require('librechat-data-provider');
const { getConvosByCursor, deleteConvos, getConvo, saveConvo } = require('~/models/Conversation');
const { forkConversation, duplicateConversation } = require('~/server/utils/import/fork');
const { createImportLimiters, createForkLimiters } = require('~/server/middleware');
const { storage, importFileFilter } = require('~/server/routes/files/multer');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { importConversations } = require('~/server/utils/import');
const { deleteToolCalls } = require('~/models/ToolCall');
const getLogStores = require('~/cache/getLogStores');
const importTracker = require('~/server/services/importTracker');

const assistantClients = {
  [EModelEndpoint.azureAssistants]: require('~/server/services/Endpoints/azureAssistants'),
  [EModelEndpoint.assistants]: require('~/server/services/Endpoints/assistants'),
};

const router = express.Router();
router.use(requireJwtAuth);

router.get('/', async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 25;
  const cursor = req.query.cursor;
  const isArchived = isEnabled(req.query.isArchived);
  const search = req.query.search ? decodeURIComponent(req.query.search) : undefined;
  const order = req.query.order || 'desc';

  let tags;
  if (req.query.tags) {
    tags = Array.isArray(req.query.tags) ? req.query.tags : [req.query.tags];
  }

  try {
    const result = await getConvosByCursor(req.user.id, {
      cursor,
      limit,
      isArchived,
      tags,
      search,
      order,
    });
    res.status(200).json(result);
  } catch (error) {
    logger.error('Error fetching conversations', error);
    res.status(500).json({ error: 'Error fetching conversations' });
  }
});

router.get('/:conversationId', async (req, res) => {
  const { conversationId } = req.params;
  const convo = await getConvo(req.user.id, conversationId);

  if (convo) {
    res.status(200).json(convo);
  } else {
    res.status(404).end();
  }
});

router.post('/gen_title', async (req, res) => {
  const { conversationId } = req.body;
  const titleCache = getLogStores(CacheKeys.GEN_TITLE);
  const key = `${req.user.id}-${conversationId}`;
  let title = await titleCache.get(key);

  if (!title) {
    // Retry every 1s for up to 20s
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      title = await titleCache.get(key);
      if (title) {
        break;
      }
    }
  }

  if (title) {
    await titleCache.delete(key);
    res.status(200).json({ title });
  } else {
    res.status(404).json({
      message: "Title not found or method not implemented for the conversation's endpoint",
    });
  }
});

router.delete('/', async (req, res) => {
  let filter = {};
  const { conversationId, source, thread_id, endpoint } = req.body.arg;

  // Prevent deletion of all conversations
  if (!conversationId && !source && !thread_id && !endpoint) {
    return res.status(400).json({
      error: 'no parameters provided',
    });
  }

  if (conversationId) {
    filter = { conversationId };
  } else if (source === 'button') {
    return res.status(200).send('No conversationId provided');
  }

  if (
    typeof endpoint !== 'undefined' &&
    Object.prototype.propertyIsEnumerable.call(assistantClients, endpoint)
  ) {
    /** @type {{ openai: OpenAI }} */
    const { openai } = await assistantClients[endpoint].initializeClient({ req, res });
    try {
      const response = await openai.beta.threads.del(thread_id);
      logger.debug('Deleted OpenAI thread:', response);
    } catch (error) {
      logger.error('Error deleting OpenAI thread:', error);
    }
  }

  try {
    const dbResponse = await deleteConvos(req.user.id, filter);
    await deleteToolCalls(req.user.id, filter.conversationId);
    res.status(201).json(dbResponse);
  } catch (error) {
    logger.error('Error clearing conversations', error);
    res.status(500).send('Error clearing conversations');
  }
});

router.delete('/all', async (req, res) => {
  try {
    const dbResponse = await deleteConvos(req.user.id, {});
    await deleteToolCalls(req.user.id);
    res.status(201).json(dbResponse);
  } catch (error) {
    logger.error('Error clearing conversations', error);
    res.status(500).send('Error clearing conversations');
  }
});

router.post('/update', async (req, res) => {
  const update = req.body.arg;

  if (!update.conversationId) {
    return res.status(400).json({ error: 'conversationId is required' });
  }

  try {
    const dbResponse = await saveConvo(req, update, {
      context: `POST /api/convos/update ${update.conversationId}`,
    });
    res.status(201).json(dbResponse);
  } catch (error) {
    logger.error('Error updating conversation', error);
    res.status(500).send('Error updating conversation');
  }
});

const { importIpLimiter, importUserLimiter } = createImportLimiters();
const { forkIpLimiter, forkUserLimiter } = createForkLimiters();
const upload = multer({
  storage: storage,
  fileFilter: importFileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for conversation imports
  },
});

/**
 * Imports a conversation from a JSON file and saves it to the database.
 * @route POST /import
 * @param {Express.Multer.File} req.file - The JSON file to import.
 * @returns {object} 201 - success response - application/json
 */
router.post(
  '/import',
  (req, res, next) => {
    logger.info(`[IMPORT] Request received from user: ${req.user?.id || 'unknown'}`);
    next();
  },
  importIpLimiter,
  importUserLimiter,
  (req, res, next) => {
    logger.info(`[IMPORT] Rate limits passed, starting file upload...`);
    next();
  },
  upload.single('file'),
  async (req, res) => {
    logger.info(`[IMPORT] File upload complete`);

    try {
      if (!req.file) {
        logger.warn(`[IMPORT] No file uploaded`);
        return res.status(400).json({ message: 'No file uploaded' });
      }

      const fileSizeMB = (req.file.size / (1024 * 1024)).toFixed(2);
      logger.info(
        `[IMPORT] user: ${req.user.id} | File received: ${req.file.originalname} (${fileSizeMB}MB)`,
      );

      // Parse JSON to count conversations
      const fs = require('fs');
      const fileData = fs.readFileSync(req.file.path, 'utf8');
      const jsonData = JSON.parse(fileData);
      const totalConversations = Array.isArray(jsonData) ? jsonData.length : 1;

      // Create import job
      const jobId = importTracker.createImportJob(req.user.id, totalConversations);

      // Start import in background (don't await)
      importConversations({
        filepath: req.file.path,
        requestUserId: req.user.id,
        jobId,
      }).catch((error) => {
        logger.error(`[IMPORT] Background import failed for job ${jobId}:`, error);
      });

      // Return immediately with job ID
      logger.info(`[IMPORT] user: ${req.user.id} | Started background import job: ${jobId}`);
      res.status(202).json({
        message: 'Import started',
        jobId,
        totalConversations,
      });
    } catch (error) {
      logger.error(`[IMPORT] user: ${req.user.id} | Error:`, error);

      let errorMessage = 'Error processing file. ';
      let statusCode = 500;

      if (error.message === 'Unsupported import type') {
        errorMessage = 'Unsupported import type. Please upload a valid ChatGPT export file.';
        statusCode = 400;
      } else if (error.name === 'SyntaxError') {
        errorMessage = 'Invalid JSON file. Please make sure the file is a valid ChatGPT export.';
        statusCode = 400;
      } else if (error.message?.includes('out of memory') || error.code === 'ERR_OUT_OF_MEMORY') {
        errorMessage =
          'File is too large to process. Please try exporting a smaller date range from ChatGPT.';
        statusCode = 413;
      } else if (error.message?.includes('too large')) {
        errorMessage = 'File exceeds maximum size limit (100MB).';
        statusCode = 413;
      } else if (error.message) {
        errorMessage += error.message;
      } else {
        errorMessage += 'Please try again or contact support.';
      }

      res.status(statusCode).json({ message: errorMessage, error: error.message });
    }
  },
);

/**
 * Get import job progress
 * @route GET /import/progress/:jobId
 */
router.get('/import/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const jobStatus = importTracker.getJobStatus(jobId);

  if (!jobStatus) {
    return res.status(404).json({ message: 'Job not found' });
  }

  // Only return if it's the user's job
  if (jobStatus.userId !== req.user.id) {
    return res.status(403).json({ message: 'Unauthorized' });
  }

  res.json(jobStatus);
});

/**
 * POST /fork
 * This route handles forking a conversation based on the TForkConvoRequest and responds with TForkConvoResponse.
 * @route POST /fork
 * @param {express.Request<{}, TForkConvoResponse, TForkConvoRequest>} req - Express request object.
 * @param {express.Response<TForkConvoResponse>} res - Express response object.
 * @returns {Promise<void>} - The response after forking the conversation.
 */
router.post('/fork', forkIpLimiter, forkUserLimiter, async (req, res) => {
  try {
    /** @type {TForkConvoRequest} */
    const { conversationId, messageId, option, splitAtTarget, latestMessageId } = req.body;
    const result = await forkConversation({
      requestUserId: req.user.id,
      originalConvoId: conversationId,
      targetMessageId: messageId,
      latestMessageId,
      records: true,
      splitAtTarget,
      option,
    });

    res.json(result);
  } catch (error) {
    logger.error('Error forking conversation:', error);
    res.status(500).send('Error forking conversation');
  }
});

router.post('/duplicate', async (req, res) => {
  const { conversationId, title } = req.body;

  try {
    const result = await duplicateConversation({
      userId: req.user.id,
      conversationId,
      title,
    });
    res.status(201).json(result);
  } catch (error) {
    logger.error('Error duplicating conversation:', error);
    res.status(500).send('Error duplicating conversation');
  }
});

module.exports = router;
