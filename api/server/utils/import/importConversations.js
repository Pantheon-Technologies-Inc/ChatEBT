const fs = require('fs').promises;
const { getImporter } = require('./importers');
const { logger } = require('~/config');
const importTracker = require('~/server/services/importTracker');

/**
 * Job definition for importing a conversation.
 * @param {{ filepath, requestUserId, jobId }} job - The job object.
 */
const importConversations = async (job) => {
  const { filepath, requestUserId, jobId } = job;

  try {
    logger.info(`user: ${requestUserId} | Starting import from file: ${filepath}`);

    // Read file
    const fileData = await fs.readFile(filepath, 'utf8');
    const fileSizeMB = (fileData.length / (1024 * 1024)).toFixed(2);
    logger.info(`user: ${requestUserId} | File loaded: ${fileSizeMB}MB`);

    // Parse JSON
    logger.info(`user: ${requestUserId} | Parsing JSON...`);
    const jsonData = JSON.parse(fileData);
    logger.info(`user: ${requestUserId} | JSON parsed successfully`);

    // Get appropriate importer
    const importer = getImporter(jsonData);

    // Import with progress tracking
    logger.info(`user: ${requestUserId} | Starting conversation import...`);

    // Progress callback to update job tracker
    const progressCallback = jobId
      ? (processed, total) => {
          importTracker.updateProgress(jobId, processed);
        }
      : null;

    await importer(jsonData, requestUserId, undefined, progressCallback);

    if (jobId) {
      importTracker.completeJob(jobId);
    }
    logger.info(`user: ${requestUserId} | Import completed successfully`);
  } catch (error) {
    logger.error(`user: ${requestUserId} | Import failed:`, error.message);
    if (error.stack) {
      logger.error(`user: ${requestUserId} | Stack:`, error.stack);
    }
    if (jobId) {
      importTracker.failJob(jobId, error);
    }
    throw error;
  } finally {
    try {
      await fs.unlink(filepath);
      logger.info(`user: ${requestUserId} | Temp file deleted`);
    } catch (unlinkError) {
      logger.error(`user: ${requestUserId} | Failed to delete temp file:`, unlinkError.message);
    }
  }
};

module.exports = importConversations;
