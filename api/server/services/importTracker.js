/**
 * In-memory import job tracker
 * Tracks progress of conversation imports so they can continue even if client disconnects
 */

const importJobs = new Map();

/**
 * Create a new import job
 * @param {string} userId - User ID
 * @param {number} totalConversations - Total number of conversations to import
 * @returns {string} - Job ID
 */
function createImportJob(userId, totalConversations) {
  const jobId = `${userId}_${Date.now()}`;

  importJobs.set(jobId, {
    userId,
    jobId,
    totalConversations,
    processedConversations: 0,
    status: 'processing', // 'processing', 'completed', 'failed'
    error: null,
    startedAt: new Date(),
    completedAt: null,
  });

  return jobId;
}

/**
 * Update job progress
 * @param {string} jobId - Job ID
 * @param {number} processedConversations - Number of conversations processed
 */
function updateProgress(jobId, processedConversations) {
  const job = importJobs.get(jobId);
  if (job) {
    job.processedConversations = processedConversations;
  }
}

/**
 * Mark job as completed
 * @param {string} jobId - Job ID
 */
function completeJob(jobId) {
  const job = importJobs.get(jobId);
  if (job) {
    job.status = 'completed';
    job.completedAt = new Date();
  }
}

/**
 * Mark job as failed
 * @param {string} jobId - Job ID
 * @param {Error} error - Error that caused failure
 */
function failJob(jobId, error) {
  const job = importJobs.get(jobId);
  if (job) {
    job.status = 'failed';
    job.error = error.message;
    job.completedAt = new Date();
  }
}

/**
 * Get job status
 * @param {string} jobId - Job ID
 * @returns {Object|null} - Job status or null if not found
 */
function getJobStatus(jobId) {
  return importJobs.get(jobId) || null;
}

/**
 * Clean up old jobs (older than 1 hour)
 */
function cleanupOldJobs() {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);

  for (const [jobId, job] of importJobs.entries()) {
    if (job.completedAt && new Date(job.completedAt).getTime() < oneHourAgo) {
      importJobs.delete(jobId);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupOldJobs, 10 * 60 * 1000);

module.exports = {
  createImportJob,
  updateProgress,
  completeJob,
  failJob,
  getJobStatus,
};
