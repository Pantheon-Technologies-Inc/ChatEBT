const { logger } = require('~/config');
const { createAresTransaction, createStructuredTransaction } = require('./Transaction');
/**
 * Creates up to two transactions to record the spending of tokens.
 *
 * @function
 * @async
 * @param {Object} txData - Transaction data.
 * @param {mongoose.Schema.Types.ObjectId} txData.user - The user ID.
 * @param {String} txData.conversationId - The ID of the conversation.
 * @param {String} txData.model - The model name.
 * @param {String} txData.context - The context in which the transaction is made.
 * @param {EndpointTokenConfig} [txData.endpointTokenConfig] - The current endpoint token config.
 * @param {String} [txData.valueKey] - The value key (optional).
 * @param {Object} tokenUsage - The number of tokens used.
 * @param {Number} tokenUsage.promptTokens - The number of prompt tokens used.
 * @param {Number} tokenUsage.completionTokens - The number of completion tokens used.
 * @returns {Promise<void>} - Returns nothing.
 * @throws {Error} - Throws an error if there's an issue creating the transactions.
 */
const spendTokens = async (txData, tokenUsage) => {
  if (!tokenUsage) {
    logger.error('[spendTokens] tokenUsage is undefined!', { txData });
    return;
  }

  const { promptTokens, completionTokens } = tokenUsage;

  // Skip charging for title generation to avoid multiple deductions
  if (txData.context === 'title') {
    logger.info(
      `[spendTokens] Skipping charge for title generation - conversationId: ${txData.conversationId}`,
    );
    return;
  }

  logger.info(
    `[spendTokens] ARES transaction starting - conversationId: ${txData.conversationId}${
      txData?.context ? ` | Context: ${txData?.context}` : ''
    } | Token usage: `,
    {
      promptTokens,
      completionTokens,
      user: txData.user,
      model: txData.model,
      tokenUsageType: typeof tokenUsage,
      tokenUsageKeys: tokenUsage ? Object.keys(tokenUsage) : 'N/A'
    },
  );
  let prompt, completion;
  try {
    if (promptTokens !== undefined) {
      prompt = await createAresTransaction({
        ...txData,
        tokenType: 'prompt',
        rawAmount: promptTokens === 0 ? 0 : -Math.max(promptTokens, 0),
      });
    }

    if (completionTokens !== undefined) {
      completion = await createAresTransaction({
        ...txData,
        tokenType: 'completion',
        rawAmount: completionTokens === 0 ? 0 : -Math.max(completionTokens, 0),
      });
    }

    if (prompt || completion) {
      logger.debug('[spendTokens] Transaction data record against balance:', {
        user: txData.user,
        promptResult: prompt,
        promptRate: prompt?.rate,
        completionResult: completion,
        completionRate: completion?.rate,
        balance: completion?.balance ?? prompt?.balance,
      });
    } else {
      logger.debug('[spendTokens] No transactions incurred against balance');
    }
  } catch (err) {
    logger.error('[spendTokens]', err);
  }
};

/**
 * Creates transactions to record the spending of structured tokens.
 *
 * @function
 * @async
 * @param {Object} txData - Transaction data.
 * @param {mongoose.Schema.Types.ObjectId} txData.user - The user ID.
 * @param {String} txData.conversationId - The ID of the conversation.
 * @param {String} txData.model - The model name.
 * @param {String} txData.context - The context in which the transaction is made.
 * @param {EndpointTokenConfig} [txData.endpointTokenConfig] - The current endpoint token config.
 * @param {String} [txData.valueKey] - The value key (optional).
 * @param {Object} tokenUsage - The number of tokens used.
 * @param {Object} tokenUsage.promptTokens - The number of prompt tokens used.
 * @param {Number} tokenUsage.promptTokens.input - The number of input tokens.
 * @param {Number} tokenUsage.promptTokens.write - The number of write tokens.
 * @param {Number} tokenUsage.promptTokens.read - The number of read tokens.
 * @param {Number} tokenUsage.completionTokens - The number of completion tokens used.
 * @returns {Promise<void>} - Returns nothing.
 * @throws {Error} - Throws an error if there's an issue creating the transactions.
 */
const spendStructuredTokens = async (txData, tokenUsage) => {
  // Debug logging to catch undefined tokenUsage
  if (!tokenUsage) {
    logger.error('[spendStructuredTokens] tokenUsage is undefined!', { txData });
    return;
  }
  
  const { promptTokens, completionTokens } = tokenUsage;

  // Skip charging for title generation to avoid multiple deductions
  if (txData.context === 'title') {
    logger.info(
      `[spendStructuredTokens] Skipping charge for title generation - conversationId: ${txData.conversationId}`,
    );
    return;
  }

  logger.debug(
    `[spendStructuredTokens] conversationId: ${txData.conversationId}${
      txData?.context ? ` | Context: ${txData?.context}` : ''
    } | Token usage: `,
    {
      promptTokens,
      completionTokens,
    },
  );
  let prompt, completion;
  try {
    if (promptTokens) {
      // Safety check for promptTokens structure
      if (typeof promptTokens !== 'object') {
        logger.error('[spendStructuredTokens] promptTokens is not an object!', { promptTokens, typeof: typeof promptTokens });
        return;
      }
      const { input = 0, write = 0, read = 0 } = promptTokens;
      const totalPromptTokens = input + write + read;

      // Pass individual token counts so different rates can be applied
      prompt = await createAresTransaction({
        ...txData,
        tokenType: 'prompt',
        rawAmount: -totalPromptTokens,
        inputTokens: input,
        writeTokens: write,
        readTokens: read,
      });
    }

    if (completionTokens) {
      try {
        completion = await createAresTransaction({
          ...txData,
          tokenType: 'completion',
          rawAmount: -completionTokens,
        });
        console.log(`💰 Completion: ${completionTokens} tokens = ${completion?.rate ? ((completionTokens * completion.rate) / 1000000).toFixed(6) : 'N/A'} USD = ${Math.abs(completion?.completion || 0)} credits`);
      } catch (completionError) {
        logger.error('[spendStructuredTokens] Completion error:', completionError);
        completion = null;
      }
    }

    if (prompt || completion) {
      logger.debug('[spendStructuredTokens] Transaction data record against balance:', {
        user: txData.user,
        promptResult: prompt,
        promptRate: prompt?.rate,
        completionResult: completion,
        completionRate: completion?.rate,
        balance: completion?.balance ?? prompt?.balance,
      });
    } else {
      logger.debug('[spendStructuredTokens] No transactions incurred against balance');
    }
  } catch (err) {
    logger.error('[spendStructuredTokens]', err);
  }

  return { prompt, completion };
};

module.exports = { spendTokens, spendStructuredTokens };
