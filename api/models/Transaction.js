const { logger } = require('@librechat/data-schemas');
const { getBalanceConfig } = require('~/server/services/Config');
const { getMultiplier, getCacheMultiplier, getAresMultiplier } = require('./tx');
const { Transaction, Balance } = require('~/db/models');
const { callAresAPI } = require('~/utils/aresClient');

const cancelRate = 1.15;

/**
 * Deducts credits from ARES using their usage API
 * @param {Object} params - The deduction parameters
 * @param {string} params.userId - The user ID
 * @param {number} params.credits - Amount of credits to deduct
 * @param {string} params.usage - Usage reason/description
 * @param {string} [params.model] - Model name for context
 * @param {string} [params.conversationId] - Conversation ID for context
 * @returns {Promise<Object>} ARES API response
 */
async function deductAresCredits({ userId, credits, usage, model, conversationId }) {
  try {
    const usageDescription = usage || `AI conversation using ${model || 'unknown model'}`;

    // Use console.log for immediate debugging visibility
    console.log('\n🚀 ===== ARES API CALL DEBUG =====');
    console.log(`User ID: ${userId}`);
    console.log(`Credits to Deduct: ${credits}`);
    console.log(`USD Equivalent: $${(credits * 0.002).toFixed(4)}`);
    console.log(`Usage Description: ${usageDescription}`);
    console.log(`Model: ${model}`);
    console.log(`Conversation ID: ${conversationId}`);
    console.log(`API URL: https://oauth.joinares.com/v1/partner/usage`);
    console.log('Request Payload:', {
      client_id: 'ChatEBT',
      usage: usageDescription,
      credits: credits,
    });
    console.log('=====================================\n');

    const requestBody = {
      client_id: 'ChatEBT',
      usage: usageDescription,
      credits: credits,
    };

    logger.debug('[deductAresCredits] Request payload', requestBody);

    const aresResponse = await callAresAPI(userId, 'partner/usage', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });

    logger.info('[deductAresCredits] Successfully deducted ARES credits', {
      userId,
      credits,
      response: aresResponse,
    });

    return aresResponse;
  } catch (error) {
    logger.error('[deductAresCredits] ❌ ARES API CALL FAILED:', {
      userId,
      credits,
      usage,
      usdEquivalent: `$${(credits * 0.002).toFixed(4)}`,
      error: error.message,
      httpStatus: error.response?.status,
      responseData: error.response?.data,
      stack: error.stack,
      debugInfo: {
        requestedCredits: credits,
        wasAttemptingToCharge: credits > 0,
        apiEndpoint: 'https://oauth.joinares.com/v1/partner/usage',
      },
    });
    throw error;
  }
}

/**
 * Updates a user's token balance based on a transaction using optimistic concurrency control
 * without schema changes. Compatible with DocumentDB.
 * @async
 * @function
 * @param {Object} params - The function parameters.
 * @param {string|mongoose.Types.ObjectId} params.user - The user ID.
 * @param {number} params.incrementValue - The value to increment the balance by (can be negative).
 * @param {import('mongoose').UpdateQuery<import('@librechat/data-schemas').IBalance>['$set']} [params.setValues] - Optional additional fields to set.
 * @returns {Promise<Object>} Returns the updated balance document (lean).
 * @throws {Error} Throws an error if the update fails after multiple retries.
 */
const updateBalance = async ({ user, incrementValue, setValues }) => {
  let maxRetries = 10; // Number of times to retry on conflict
  let delay = 50; // Initial retry delay in ms
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let currentBalanceDoc;
    try {
      // 1. Read the current document state
      currentBalanceDoc = await Balance.findOne({ user }).lean();
      const currentCredits = currentBalanceDoc ? currentBalanceDoc.tokenCredits : 0;

      // 2. Calculate the desired new state
      const potentialNewCredits = currentCredits + incrementValue;
      const newCredits = Math.max(0, potentialNewCredits); // Ensure balance doesn't go below zero

      // 3. Prepare the update payload
      const updatePayload = {
        $set: {
          tokenCredits: newCredits,
          ...(setValues || {}), // Merge other values to set
        },
      };

      // 4. Attempt the conditional update or upsert
      let updatedBalance = null;
      if (currentBalanceDoc) {
        // --- Document Exists: Perform Conditional Update ---
        // Try to update only if the tokenCredits match the value we read (currentCredits)
        updatedBalance = await Balance.findOneAndUpdate(
          {
            user: user,
            tokenCredits: currentCredits, // Optimistic lock: condition based on the read value
          },
          updatePayload,
          {
            new: true, // Return the modified document
            // lean: true, // .lean() is applied after query execution in Mongoose >= 6
          },
        ).lean(); // Use lean() for plain JS object

        if (updatedBalance) {
          // Success! The update was applied based on the expected current state.
          return updatedBalance;
        }
        // If updatedBalance is null, it means tokenCredits changed between read and write (conflict).
        lastError = new Error(`Concurrency conflict for user ${user} on attempt ${attempt}.`);
        // Proceed to retry logic below.
      } else {
        // --- Document Does Not Exist: Perform Conditional Upsert ---
        // Try to insert the document, but only if it still doesn't exist.
        // Using tokenCredits: {$exists: false} helps prevent race conditions where
        // another process creates the doc between our findOne and findOneAndUpdate.
        try {
          updatedBalance = await Balance.findOneAndUpdate(
            {
              user: user,
              // Attempt to match only if the document doesn't exist OR was just created
              // without tokenCredits (less likely but possible). A simple { user } filter
              // might also work, relying on the retry for conflicts.
              // Let's use a simpler filter and rely on retry for races.
              // tokenCredits: { $exists: false } // This condition might be too strict if doc exists with 0 credits
            },
            updatePayload,
            {
              upsert: true, // Create if doesn't exist
              new: true, // Return the created/updated document
              // setDefaultsOnInsert: true, // Ensure schema defaults are applied on insert
              // lean: true,
            },
          ).lean();

          if (updatedBalance) {
            // Upsert succeeded (likely created the document)
            return updatedBalance;
          }
          // If null, potentially a rare race condition during upsert. Retry should handle it.
          lastError = new Error(
            `Upsert race condition suspected for user ${user} on attempt ${attempt}.`,
          );
        } catch (error) {
          if (error.code === 11000) {
            // E11000 duplicate key error on index
            // This means another process created the document *just* before our upsert.
            // It's a concurrency conflict during creation. We should retry.
            lastError = error; // Store the error
            // Proceed to retry logic below.
          } else {
            // Different error, rethrow
            throw error;
          }
        }
      } // End if/else (document exists?)
    } catch (error) {
      // Catch errors from findOne or unexpected findOneAndUpdate errors
      logger.error(`[updateBalance] Error during attempt ${attempt} for user ${user}:`, error);
      lastError = error; // Store the error
      // Consider stopping retries for non-transient errors, but for now, we retry.
    }

    // If we reached here, it means the update failed (conflict or error), wait and retry
    if (attempt < maxRetries) {
      const jitter = Math.random() * delay * 0.5; // Add jitter to delay
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
      delay = Math.min(delay * 2, 2000); // Exponential backoff with cap
    }
  } // End for loop (retries)

  // If loop finishes without success, throw the last encountered error or a generic one
  logger.error(
    `[updateBalance] Failed to update balance for user ${user} after ${maxRetries} attempts.`,
  );
  throw (
    lastError ||
    new Error(
      `Failed to update balance for user ${user} after maximum retries due to persistent conflicts.`,
    )
  );
};

/** Method to calculate and set the tokenValue for a transaction using ARES rates */
function calculateAresTokenValue(txn) {
  if (!txn.valueKey || !txn.tokenType) {
    txn.tokenValue = txn.rawAmount;
    return;
  }
  const { valueKey, tokenType, model, endpointTokenConfig } = txn;

  // Get USD rate for the model (NOT ARES rates - ARES is just a wallet!)
  const usdRate = Math.abs(
    getMultiplier({
      valueKey,
      tokenType,
      model,
      endpoint: txn.endpoint,
      endpointTokenConfig,
      useAresRates: false, // ✅ Use original USD rates for models
    }),
  );

  // Calculate USD cost first
  const usdCost = (Math.abs(txn.rawAmount) * usdRate) / 1000000;

  // Convert USD to ARES credits (1 ARES credit = $0.002)
  const aresCredits = usdCost / 0.002;

  txn.rate = usdRate; // Store the original USD rate for logging
  txn.tokenValue = txn.rawAmount < 0 ? -aresCredits : aresCredits; // Store as ARES credits with correct sign
  if (txn.context && txn.tokenType === 'completion' && txn.context === 'incomplete') {
    txn.tokenValue = Math.ceil(txn.tokenValue * cancelRate);
    txn.rate *= cancelRate;
  }
}

/** Method to calculate and set the tokenValue for a transaction using legacy USD rates */
function calculateTokenValue(txn) {
  if (!txn.valueKey || !txn.tokenType) {
    txn.tokenValue = txn.rawAmount;
  }
  const { valueKey, tokenType, model, endpointTokenConfig } = txn;
  const multiplier = Math.abs(getMultiplier({ valueKey, tokenType, model, endpointTokenConfig }));
  txn.rate = multiplier;
  txn.tokenValue = txn.rawAmount * multiplier;
  if (txn.context && txn.tokenType === 'completion' && txn.context === 'incomplete') {
    txn.tokenValue = Math.ceil(txn.tokenValue * cancelRate);
    txn.rate *= cancelRate;
  }
}

/**
 * New static method to create an auto-refill transaction that does NOT trigger a balance update.
 * @param {object} txData - Transaction data.
 * @param {string} txData.user - The user ID.
 * @param {string} txData.tokenType - The type of token.
 * @param {string} txData.context - The context of the transaction.
 * @param {number} txData.rawAmount - The raw amount of tokens.
 * @returns {Promise<object>} - The created transaction.
 */
async function createAutoRefillTransaction(txData) {
  if (txData.rawAmount != null && isNaN(txData.rawAmount)) {
    return;
  }
  const transaction = new Transaction(txData);
  transaction.endpointTokenConfig = txData.endpointTokenConfig;
  calculateTokenValue(transaction);
  await transaction.save();

  const balanceResponse = await updateBalance({
    user: transaction.user,
    incrementValue: txData.rawAmount,
    setValues: { lastRefill: new Date() },
  });
  const result = {
    rate: transaction.rate,
    user: transaction.user.toString(),
    balance: balanceResponse.tokenCredits,
  };
  logger.debug('[Balance.check] Auto-refill performed', result);
  result.transaction = transaction;
  return result;
}

/**
 * ARES-based transaction creation that deducts from ARES instead of internal balance
 * @param {txData} txData - Transaction data.
 */
async function createAresTransaction(txData) {
  if (txData.rawAmount != null && isNaN(txData.rawAmount)) {
    return;
  }

  const transaction = new Transaction(txData);
  transaction.endpointTokenConfig = txData.endpointTokenConfig;
  calculateAresTokenValue(transaction);

  // Save transaction for audit purposes
  await transaction.save();

  const balance = await getBalanceConfig();
  if (!balance?.enabled) {
    logger.warn('[createAresTransaction] Balance not enabled in config', {
      user: transaction.user,
      balanceConfig: balance,
    });
    return;
  }

  // Convert token cost to ARES credits (using absolute value since we're deducting)
  const exactCredits = Math.abs(transaction.tokenValue);

  // Handle fractional credits properly
  let aresCreditsToDeduct;
  if (exactCredits < 0.01) {
    // For very small amounts (less than $0.0002 worth), don't charge
    aresCreditsToDeduct = 0;
    logger.debug('[createAresTransaction] Amount too small to charge', {
      user: transaction.user,
      exactCredits,
      tokenType: transaction.tokenType,
    });
  } else if (exactCredits < 1) {
    // For fractional credits, round to 2 decimal places and set minimum of 0.01 credits
    aresCreditsToDeduct = Math.max(0.01, Math.round(exactCredits * 100) / 100);
    logger.debug('[createAresTransaction] Fractional credit handling', {
      user: transaction.user,
      exactCredits,
      aresCreditsToDeduct,
      minimumApplied: exactCredits < 0.01,
    });
  } else {
    // For amounts >= 1 credit, round to 2 decimal places
    aresCreditsToDeduct = Math.round(exactCredits * 100) / 100;
  }

  // The transaction.tokenValue is already in ARES credits
  // transaction.rate is the USD rate per 1M tokens

  // Use console.log for immediate debugging visibility
  console.log('\n🔥 ===== ARES CREDIT CALCULATION DEBUG =====');
  console.log(`User: ${transaction.user}`);
  console.log(`Token Type: ${transaction.tokenType}`);
  console.log(`Model: ${transaction.model}`);
  console.log(`Context: ${transaction.context}`);
  console.log(`Raw Token Amount: ${transaction.rawAmount}`);
  console.log(`Absolute Tokens: ${Math.abs(transaction.rawAmount)}`);
  console.log(`USD Rate: $${transaction.rate} per 1M tokens`);
  console.log(`Token Value (ARES Credits): ${transaction.tokenValue}`);
  console.log(`Exact Credits: ${exactCredits}`);
  console.log(`Credits to Deduct: ${aresCreditsToDeduct}`);
  console.log(`USD Equivalent: $${(aresCreditsToDeduct * 0.002).toFixed(6)}`);
  console.log(`Will Charge: ${aresCreditsToDeduct > 0}`);
  console.log('\n📊 Step-by-Step Calculation:');
  console.log(
    `1. ${Math.abs(transaction.rawAmount)} tokens × $${transaction.rate} USD rate = $${((Math.abs(transaction.rawAmount) * transaction.rate) / 1000000).toFixed(6)}`,
  );
  console.log(
    `2. $${((Math.abs(transaction.rawAmount) * transaction.rate) / 1000000).toFixed(6)} ÷ $0.002 = ${exactCredits} ARES credits`,
  );
  console.log(
    `3. ${exactCredits} exact credits → ${aresCreditsToDeduct} final credits (after fractional logic)`,
  );
  console.log(
    `4. ${aresCreditsToDeduct} credits × $0.002 = $${(aresCreditsToDeduct * 0.002).toFixed(6)} USD equivalent`,
  );
  console.log('===============================================\n');

  // Only deduct if there are actual credits to deduct
  if (aresCreditsToDeduct > 0) {
    try {
      const usageDescription = `${transaction.tokenType} tokens for ${transaction.model || 'AI conversation'}`;

      await deductAresCredits({
        userId: transaction.user,
        credits: aresCreditsToDeduct,
        usage: usageDescription,
        model: transaction.model,
        conversationId: transaction.conversationId,
      });

      logger.debug('[createAresTransaction] ARES credits deducted successfully', {
        user: transaction.user,
        creditsDeducted: aresCreditsToDeduct,
        tokenType: transaction.tokenType,
        model: transaction.model,
      });

      // Get updated balance from ARES for return value
      const aresProfile = await callAresAPI(transaction.user, 'user');
      const updatedBalance = aresProfile?.user?.credits || 0;

      return {
        rate: transaction.rate,
        user: transaction.user.toString(),
        balance: updatedBalance,
        [transaction.tokenType]: -aresCreditsToDeduct, // Negative to show deduction
        aresResponse: true, // Flag to indicate this came from ARES
      };
    } catch (error) {
      logger.error('[createAresTransaction] Failed to deduct ARES credits:', {
        user: transaction.user,
        creditsToDeduct: aresCreditsToDeduct,
        error: error.message,
      });

      // Re-throw the error to fail the transaction
      throw error;
    }
  }

  // If no credits to deduct, just return the transaction info
  return {
    rate: transaction.rate,
    user: transaction.user.toString(),
    balance: 0, // We don't track internal balance anymore
    [transaction.tokenType]: 0,
    aresResponse: true,
  };
}

/**
 * Legacy MongoDB-based transaction creation (kept for backwards compatibility)
 * @param {txData} txData - Transaction data.
 */
async function createTransaction(txData) {
  if (txData.rawAmount != null && isNaN(txData.rawAmount)) {
    return;
  }

  const transaction = new Transaction(txData);
  transaction.endpointTokenConfig = txData.endpointTokenConfig;
  calculateTokenValue(transaction);

  await transaction.save();

  const balance = await getBalanceConfig();
  if (!balance?.enabled) {
    return;
  }

  let incrementValue = transaction.tokenValue;
  const balanceResponse = await updateBalance({
    user: transaction.user,
    incrementValue,
  });

  return {
    rate: transaction.rate,
    user: transaction.user.toString(),
    balance: balanceResponse.tokenCredits,
    [transaction.tokenType]: incrementValue,
  };
}

/**
 * Static method to create a structured transaction and update the balance
 * @param {txData} txData - Transaction data.
 */
async function createStructuredTransaction(txData) {
  const transaction = new Transaction({
    ...txData,
    endpointTokenConfig: txData.endpointTokenConfig,
  });

  calculateStructuredTokenValue(transaction);

  await transaction.save();

  const balance = await getBalanceConfig();
  if (!balance?.enabled) {
    return;
  }

  let incrementValue = transaction.tokenValue;

  const balanceResponse = await updateBalance({
    user: transaction.user,
    incrementValue,
  });

  return {
    rate: transaction.rate,
    user: transaction.user.toString(),
    balance: balanceResponse.tokenCredits,
    [transaction.tokenType]: incrementValue,
  };
}

/** Method to calculate token value for structured tokens */
function calculateStructuredTokenValue(txn) {
  if (!txn.tokenType) {
    txn.tokenValue = txn.rawAmount;
    return;
  }

  const { model, endpointTokenConfig } = txn;

  if (txn.tokenType === 'prompt') {
    const inputMultiplier = getMultiplier({ tokenType: 'prompt', model, endpointTokenConfig });
    const writeMultiplier =
      getCacheMultiplier({ cacheType: 'write', model, endpointTokenConfig }) ?? inputMultiplier;
    const readMultiplier =
      getCacheMultiplier({ cacheType: 'read', model, endpointTokenConfig }) ?? inputMultiplier;

    txn.rateDetail = {
      input: inputMultiplier,
      write: writeMultiplier,
      read: readMultiplier,
    };

    const totalPromptTokens =
      Math.abs(txn.inputTokens || 0) +
      Math.abs(txn.writeTokens || 0) +
      Math.abs(txn.readTokens || 0);

    if (totalPromptTokens > 0) {
      txn.rate =
        (Math.abs(inputMultiplier * (txn.inputTokens || 0)) +
          Math.abs(writeMultiplier * (txn.writeTokens || 0)) +
          Math.abs(readMultiplier * (txn.readTokens || 0))) /
        totalPromptTokens;
    } else {
      txn.rate = Math.abs(inputMultiplier); // Default to input rate if no tokens
    }

    txn.tokenValue = -(
      Math.abs(txn.inputTokens || 0) * inputMultiplier +
      Math.abs(txn.writeTokens || 0) * writeMultiplier +
      Math.abs(txn.readTokens || 0) * readMultiplier
    );

    txn.rawAmount = -totalPromptTokens;
  } else if (txn.tokenType === 'completion') {
    const multiplier = getMultiplier({ tokenType: txn.tokenType, model, endpointTokenConfig });
    txn.rate = Math.abs(multiplier);
    txn.tokenValue = -Math.abs(txn.rawAmount) * multiplier;
    txn.rawAmount = -Math.abs(txn.rawAmount);
  }

  if (txn.context && txn.tokenType === 'completion' && txn.context === 'incomplete') {
    txn.tokenValue = Math.ceil(txn.tokenValue * cancelRate);
    txn.rate *= cancelRate;
    if (txn.rateDetail) {
      txn.rateDetail = Object.fromEntries(
        Object.entries(txn.rateDetail).map(([k, v]) => [k, v * cancelRate]),
      );
    }
  }
}

/**
 * Queries and retrieves transactions based on a given filter.
 * @async
 * @function getTransactions
 * @param {Object} filter - MongoDB filter object to apply when querying transactions.
 * @returns {Promise<Array>} A promise that resolves to an array of matched transactions.
 * @throws {Error} Throws an error if querying the database fails.
 */
async function getTransactions(filter) {
  try {
    return await Transaction.find(filter).lean();
  } catch (error) {
    logger.error('Error querying transactions:', error);
    throw error;
  }
}

module.exports = {
  getTransactions,
  createTransaction,
  createAresTransaction,
  createAutoRefillTransaction,
  createStructuredTransaction,
  deductAresCredits,
};
