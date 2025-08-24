const { jest } = require('@jest/globals');

// Mock dependencies
jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('@librechat/api', () => ({
  refreshAccessToken: jest.fn(),
  decryptV2: jest.fn(),
}));

jest.mock('~/models', () => ({
  findToken: jest.fn(),
  createToken: jest.fn(),
  updateToken: jest.fn(),
  deleteTokens: jest.fn(),
}));

// Mock fetch
global.fetch = jest.fn();

const { logger } = require('@librechat/data-schemas');
const { refreshAccessToken, decryptV2 } = require('@librechat/api');
const { findToken, createToken, updateToken, deleteTokens } = require('~/models');

// Import the module under test
const {
  getValidAresToken,
  callAresAPI,
  getAresUserProfile,
  cleanupTokens,
  hasValidAresTokens,
} = require('../utils/aresClient');

describe('ARES Client', () => {
  const mockUserId = '507f1f77bcf86cd799439011';
  
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch.mockClear();
  });

  describe('getValidAresToken', () => {
    it('should return decrypted token when token is valid', async () => {
      const mockToken = {
        token: 'encrypted_token',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
      };

      findToken.mockResolvedValue(mockToken);
      decryptV2.mockResolvedValue('decrypted_token');

      const result = await getValidAresToken(mockUserId);

      expect(result).toBe('decrypted_token');
      expect(findToken).toHaveBeenCalledWith({
        userId: mockUserId,
        type: 'oauth',
        identifier: 'ares',
      });
      expect(decryptV2).toHaveBeenCalledWith('encrypted_token');
    });

    it('should throw ARES_AUTH_REQUIRED when no token found', async () => {
      findToken.mockResolvedValue(null);

      await expect(getValidAresToken(mockUserId)).rejects.toThrow('ARES authentication required');
    });

    it('should refresh token when expired', async () => {
      const expiredToken = {
        token: 'expired_token',
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
      };

      const refreshToken = {
        token: 'refresh_token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      };

      findToken
        .mockResolvedValueOnce(expiredToken) // First call - expired token
        .mockResolvedValueOnce(refreshToken); // Second call - refresh token

      decryptV2.mockResolvedValue('refresh_token_value');
      refreshAccessToken.mockResolvedValue({
        access_token: 'new_access_token',
        expires_in: 1800,
      });

      const result = await getValidAresToken(mockUserId);

      expect(result).toBe('new_access_token');
      expect(refreshAccessToken).toHaveBeenCalled();
    });
  });

  describe('callAresAPI', () => {
    it('should make successful API call', async () => {
      const mockResponse = { user: { credits: 100 } };

      findToken.mockResolvedValue({
        token: 'valid_token',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      decryptV2.mockResolvedValue('decrypted_token');
      
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await callAresAPI(mockUserId, 'user');

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://oauth.joinares.com/v1/user',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer decrypted_token',
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'ChatEBT/1.0',
          }),
        })
      );
    });

    it('should handle 401 error with retry', async () => {
      findToken
        .mockResolvedValueOnce({
          token: 'token1',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        })
        .mockResolvedValueOnce({
          token: 'refresh_token',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });

      decryptV2
        .mockResolvedValueOnce('old_token')
        .mockResolvedValueOnce('refresh_token_value');

      refreshAccessToken.mockResolvedValue({
        access_token: 'new_token',
        expires_in: 1800,
      });

      global.fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: () => Promise.resolve('Unauthorized'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true }),
        });

      const result = await callAresAPI(mockUserId, 'user');

      expect(result).toEqual({ success: true });
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error for invalid user ID', async () => {
      await expect(callAresAPI('', 'user')).rejects.toThrow('User ID is required');
    });

    it('should throw error for missing endpoint', async () => {
      await expect(callAresAPI(mockUserId, '')).rejects.toThrow('Endpoint is required');
    });
  });

  describe('getAresUserProfile', () => {
    it('should call user endpoint', async () => {
      const mockProfile = { user: { id: '123', email: 'test@example.com' } };

      findToken.mockResolvedValue({
        token: 'valid_token',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      decryptV2.mockResolvedValue('decrypted_token');
      
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockProfile),
      });

      const result = await getAresUserProfile(mockUserId);

      expect(result).toEqual(mockProfile);
    });
  });

  describe('cleanupTokens', () => {
    it('should delete both access and refresh tokens', async () => {
      deleteTokens.mockResolvedValue(true);

      await cleanupTokens(mockUserId);

      expect(deleteTokens).toHaveBeenCalledTimes(2);
      expect(deleteTokens).toHaveBeenCalledWith({ userId: mockUserId, identifier: 'ares' });
      expect(deleteTokens).toHaveBeenCalledWith({ userId: mockUserId, identifier: 'ares:refresh' });
    });

    it('should handle deletion errors gracefully', async () => {
      deleteTokens.mockRejectedValue(new Error('Deletion failed'));

      // Should not throw
      await expect(cleanupTokens(mockUserId)).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('hasValidAresTokens', () => {
    it('should return true when user has valid tokens', async () => {
      findToken.mockResolvedValue({
        token: 'valid_token',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      decryptV2.mockResolvedValue('decrypted_token');

      const result = await hasValidAresTokens(mockUserId);

      expect(result).toBe(true);
    });

    it('should return false when user has no tokens', async () => {
      findToken.mockResolvedValue(null);

      const result = await hasValidAresTokens(mockUserId);

      expect(result).toBe(false);
    });

    it('should return false when token validation fails', async () => {
      findToken.mockRejectedValue(new Error('Database error'));

      const result = await hasValidAresTokens(mockUserId);

      expect(result).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      findToken.mockResolvedValue({
        token: 'valid_token',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      decryptV2.mockResolvedValue('decrypted_token');
      
      global.fetch.mockRejectedValue(new Error('Network error'));

      await expect(callAresAPI(mockUserId, 'user')).rejects.toThrow('Network error');
    });

    it('should handle API error responses', async () => {
      findToken.mockResolvedValue({
        token: 'valid_token',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      decryptV2.mockResolvedValue('decrypted_token');
      
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server error'),
      });

      await expect(callAresAPI(mockUserId, 'user'))
        .rejects.toThrow('ARES API call failed: 500 Internal Server Error');
    });
  });
});

module.exports = {};