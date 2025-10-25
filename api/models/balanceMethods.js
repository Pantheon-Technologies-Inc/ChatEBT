const { logger } = require('@librechat/data-schemas');
const { ViolationTypes } = require('librechat-data-provider');
const { createAutoRefillTransaction } = require('./Transaction');
const { logViolation } = require('~/cache');
const { getMultiplier } = require('./tx');
const { Balance } = require('~/db/models');
const { callAresAPI } = require('~/utils/aresClient');

const toMs = (value, fallback) => {
  if (value == null) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const CACHE_TTL = toMs(process.env.ARES_BALANCE_CACHE_MS, 10_000);
const PENDING_TTL = toMs(process.env.ARES_BALANCE_PENDING_MS, CACHE_TTL);

/** @type {Map<string, { credits: number, timestamp: number, pending: number }>} */
const balanceCache = new Map();

const releasePending = (userId, pending) => {
  const entry = balanceCache.get(userId);
  if (!entry) {
    return;
  }

  entry.pending = Math.max(0, entry.pending - pending);

  if (entry.pending === 0 && Date.now() - entry.timestamp > CACHE_TTL) {
    balanceCache.delete(userId);
    return;
  }

  balanceCache.set(userId, entry);
};

const cachePending = (userId, credits) => {
  if (PENDING_TTL <= 0 || credits <= 0) {
    return;
  }
  const timeout = setTimeout(() => releasePending(userId, credits), PENDING_TTL);
  if (typeof timeout.unref === 'function') {
    timeout.unref();
  }
};

function isInvalidDate(date) {
  return isNaN(date);
}

/**
 * Simple check method that calculates token cost and returns balance info.
 * The auto-refill logic has been moved to balanceMethods.js to prevent circular dependencies.
 */
const checkBalanceRecord = async function ({
  user,
  model,
  endpoint,
  valueKey,
  tokenType,
  amount,
  endpointTokenConfig,
}) {
  const multiplier = getMultiplier({ valueKey, tokenType, model, endpoint, endpointTokenConfig });
  const tokenCost = amount * multiplier;

  // Retrieve the balance record
  let record = await Balance.findOne({ user }).lean();
  if (!record) {
    logger.debug('[Balance.check] No balance record found for user', { user });
    return {
      canSpend: false,
      balance: 0,
      tokenCost,
    };
  }
  let balance = record.tokenCredits;

  logger.debug('[Balance.check] Initial state', {
    user,
    model,
    endpoint,
    valueKey,
    tokenType,
    amount,
    balance,
    multiplier,
    endpointTokenConfig: !!endpointTokenConfig,
  });

  // Only perform auto-refill if spending would bring the balance to 0 or below
  if (balance - tokenCost <= 0 && record.autoRefillEnabled && record.refillAmount > 0) {
    const lastRefillDate = new Date(record.lastRefill);
    const now = new Date();
    if (
      isInvalidDate(lastRefillDate) ||
      now >=
        addIntervalToDate(lastRefillDate, record.refillIntervalValue, record.refillIntervalUnit)
    ) {
      try {
        /** @type {{ rate: number, user: string, balance: number, transaction: import('@librechat/data-schemas').ITransaction}} */
        const result = await createAutoRefillTransaction({
          user: user,
          tokenType: 'credits',
          context: 'autoRefill',
          rawAmount: record.refillAmount,
        });
        balance = result.balance;
      } catch (error) {
        logger.error('[Balance.check] Failed to record transaction for auto-refill', error);
      }
    }
  }

  logger.debug('[Balance.check] Token cost', { tokenCost });
  return { canSpend: balance >= tokenCost, balance, tokenCost };
};

/**
 * Adds a time interval to a given date.
 * @param {Date} date - The starting date.
 * @param {number} value - The numeric value of the interval.
 * @param {'seconds'|'minutes'|'hours'|'days'|'weeks'|'months'} unit - The unit of time.
 * @returns {Date} A new Date representing the starting date plus the interval.
 */
const addIntervalToDate = (date, value, unit) => {
  const result = new Date(date);
  switch (unit) {
    case 'seconds':
      result.setSeconds(result.getSeconds() + value);
      break;
    case 'minutes':
      result.setMinutes(result.getMinutes() + value);
      break;
    case 'hours':
      result.setHours(result.getHours() + value);
      break;
    case 'days':
      result.setDate(result.getDate() + value);
      break;
    case 'weeks':
      result.setDate(result.getDate() + value * 7);
      break;
    case 'months':
      result.setMonth(result.getMonth() + value);
      break;
    default:
      break;
  }
  return result;
};

/**
 * ARES-based balance check that uses ARES API instead of internal MongoDB balance.
 *
 * @async
 * @function
 * @param {Object} params - The function parameters.
 * @param {Express.Request} params.req - The Express request object.
 * @param {Express.Response} params.res - The Express response object.
 * @param {Object} params.txData - The transaction data.
 * @param {string} params.txData.user - The user ID or identifier.
 * @param {('prompt' | 'completion')} params.txData.tokenType - The type of token.
 * @param {number} params.txData.amount - The amount of tokens.
 * @param {string} params.txData.model - The model name or identifier.
 * @param {string} [params.txData.endpointTokenConfig] - The token configuration for the endpoint.
 * @returns {Promise<boolean>} Returns true if user has sufficient balance.
 * @throws {Error} Throws an error if there's an issue with the balance check.
 */
const checkAresBalance = async ({ req, res, txData }) => {
  const userId = txData.user;
  let aresCreditsRequired = 0;

  try {

    logger.info('[checkAresBalance] Starting balance check', {
      userId,
      tokenType: txData.tokenType,
      amount: txData.amount,
      model: txData.model,
      endpoint: txData.endpoint,
    });

    // Calculate the USD cost using original model rates, then convert to ARES credits
    const usdRate = getMultiplier({
      valueKey: txData.valueKey,
      tokenType: txData.tokenType,
      model: txData.model,
      endpoint: txData.endpoint,
      endpointTokenConfig: txData.endpointTokenConfig,
      useAresRates: false, // ✅ Use original USD rates for models (ARES is just a wallet!)
    });

    // Calculate USD cost first, then convert to ARES credits
    const usdCost = (txData.amount * usdRate) / 1000000;
    const exactCredits = usdCost / 0.002; // Convert USD to ARES credits (1 credit = $0.002)

    // Always round up for simpler billing (except for very tiny amounts)
    if (exactCredits < 0.001) {
      aresCreditsRequired = 0; // Too small to charge (less than 0.001 credits)
    } else {
      aresCreditsRequired = Math.ceil(exactCredits); // Always round UP to nearest integer
    }

    const cached = balanceCache.get(userId);
    const now = Date.now();
    if (cached && now - cached.timestamp < CACHE_TTL) {
      const availableCredits = cached.credits - cached.pending;
      if (availableCredits >= aresCreditsRequired) {
        cached.pending += aresCreditsRequired;
        cached.timestamp = now;
        balanceCache.set(userId, cached);
        cachePending(userId, aresCreditsRequired);
        logger.debug('[checkAresBalance] Using cached ARES balance', {
          userId,
          cachedCredits: cached.credits,
          requiredCredits: aresCreditsRequired,
        });
        return true;
      }
    }

    logger.debug('[checkAresBalance] Calling ARES user API for balance', { userId });

    // Get user's current ARES balance
    const aresProfile = await callAresAPI(userId, 'user', {
      timeoutMs: PENDING_TTL,
    });
    const currentCredits = aresProfile?.user?.credits || 0;
    const cacheEntry = {
      credits: currentCredits,
      timestamp: now,
      pending: 0,
    };

    // Minimal ARES balance check logging
    const balanceStatus = currentCredits >= aresCreditsRequired ? 'PASS ✅' : 'FAIL ❌';
    logger.debug(`[ARES] Balance check: ${aresCreditsRequired} credits needed, ${currentCredits} available - ${balanceStatus}`);

    if (currentCredits >= aresCreditsRequired) {
      cacheEntry.pending = aresCreditsRequired;
      balanceCache.set(userId, cacheEntry);
      cachePending(userId, aresCreditsRequired);
      return true;
    }
    balanceCache.set(userId, cacheEntry);

    // Insufficient balance - log violation and throw error
    const type = ViolationTypes.TOKEN_BALANCE;
    const errorMessage = {
      type,
      balance: currentCredits,
      tokenCost: aresCreditsRequired,
      promptTokens: txData.amount,
    };

    if (txData.generations && txData.generations.length > 0) {
      errorMessage.generations = txData.generations;
    }

    logger.warn('[checkAresBalance] Insufficient ARES credits', errorMessage);
    await logViolation(req, res, type, errorMessage, 0);
    throw new Error(JSON.stringify(errorMessage));
  } catch (error) {
    if (error.code === 'ARES_AUTH_REQUIRED') {
      logger.warn('[checkAresBalance] ARES authentication required', {
        userId,
      });

      // Throw a cleaner error that indicates auth is required (no auto-logout)
      throw new Error(
        JSON.stringify({
          type: 'ARES_AUTH_ERROR',
          message: 'ARES authentication required',
          code: 'ARES_AUTH_REQUIRED',
        }),
      );
    }

    if (error.code === 'ARES_TIMEOUT' && aresCreditsRequired >= 0) {
      const cached = balanceCache.get(userId);
      const now = Date.now();
      if (cached && now - cached.timestamp < CACHE_TTL) {
        const availableCredits = cached.credits - cached.pending;
        if (availableCredits >= aresCreditsRequired) {
          cached.pending += aresCreditsRequired;
          cached.timestamp = now;
          balanceCache.set(userId, cached);
          cachePending(userId, aresCreditsRequired);
          logger.warn('[checkAresBalance] Falling back to cached balance after timeout', {
            userId,
            cachedCredits: cached.credits,
            requiredCredits: aresCreditsRequired,
          });
          return true;
        }
      }
    }

    logger.error('[checkAresBalance] Error checking ARES balance:', error);
    throw error;
  }
};

/**
 * Legacy MongoDB-based balance check (kept for backwards compatibility).
 *
 * @async
 * @function
 * @param {Object} params - The function parameters.
 * @param {Express.Request} params.req - The Express request object.
 * @param {Express.Response} params.res - The Express response object.
 * @param {Object} params.txData - The transaction data.
 * @param {string} params.txData.user - The user ID or identifier.
 * @param {('prompt' | 'completion')} params.txData.tokenType - The type of token.
 * @param {number} params.txData.amount - The amount of tokens.
 * @param {string} params.txData.model - The model name or identifier.
 * @param {string} [params.txData.endpointTokenConfig] - The token configuration for the endpoint.
 * @returns {Promise<boolean>} Throws error if the user cannot spend the amount.
 * @throws {Error} Throws an error if there's an issue with the balance check.
 */
const checkBalance = async ({ req, res, txData }) => {
  const { canSpend, balance, tokenCost } = await checkBalanceRecord(txData);
  if (canSpend) {
    return true;
  }

  const type = ViolationTypes.TOKEN_BALANCE;
  const errorMessage = {
    type,
    balance,
    tokenCost,
    promptTokens: txData.amount,
  };

  if (txData.generations && txData.generations.length > 0) {
    errorMessage.generations = txData.generations;
  }

  await logViolation(req, res, type, errorMessage, 0);
  throw new Error(JSON.stringify(errorMessage));
};

module.exports = {
  checkBalance,
  checkAresBalance,
};
