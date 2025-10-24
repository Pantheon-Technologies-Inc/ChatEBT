import { Progress } from '@librechat/client';
import React, { useEffect, useState, useCallback } from 'react';
import { cn } from '~/utils';
import { useAuthContext } from '~/hooks';

// Create a custom event name for credit updates
export const CREDITS_UPDATED_EVENT = 'credits-updated';

// Function to trigger credit refresh from anywhere in the app
export const triggerCreditsRefresh = () => {
  const event = new CustomEvent(CREDITS_UPDATED_EVENT);
  window.dispatchEvent(event);
};

const getCachedCreditsForUser = (userId: string | number | undefined | null) => {
  if (typeof window === 'undefined' || !userId) {
    return undefined;
  }

  try {
    const cached = localStorage.getItem(`credits:${userId}`);
    if (cached === null) {
      return undefined;
    }
    const parsed = Number(cached);
    return Number.isNaN(parsed) ? undefined : parsed;
  } catch (storageError) {
    console.warn('Unable to access cached credits value', storageError);
    return undefined;
  }
};

interface FreeCounterProps {
  generationsUsed?: number;
  isPro?: boolean;
}

const CreditsCounter = ({}: FreeCounterProps) => {
  const { user, isAuthenticated, token } = useAuthContext();
  const [credits, setCredits] = useState<number>(() => {
    const cached = getCachedCreditsForUser(user?.id);
    return cached ?? 0;
  });
  const [isLoading, setIsLoading] = useState(() => getCachedCreditsForUser(user?.id) === undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<boolean>(false);
  const [lastAuthErrorTime, setLastAuthErrorTime] = useState<number>(0);
  const [isInitialLoad, setIsInitialLoad] = useState(() => getCachedCreditsForUser(user?.id) === undefined);
  const [hasCachedCredits, setHasCachedCredits] = useState(() => getCachedCreditsForUser(user?.id) !== undefined);

  useEffect(() => {
    if (!user?.id) {
      setHasCachedCredits(false);
      setCredits(0);
      setIsLoading(false);
      setIsInitialLoad(false);
      return;
    }

    const cached = getCachedCreditsForUser(user.id);

    if (cached !== undefined) {
      setCredits(cached);
      setIsLoading(false);
      setIsInitialLoad(false);
      setHasCachedCredits(true);
    } else {
      setHasCachedCredits(false);
      setIsLoading(true);
      setIsInitialLoad(true);
    }
  }, [user?.id]);

  // Extract fetch credits into a reusable function
  const fetchCredits = useCallback(async (showLoading = false) => {
    if (!user?.id || !isAuthenticated || !token || authError) return;

    if (showLoading) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const response = await fetch('/api/balance', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();

        // Handle ARES authentication errors
        if (errorData.error === 'ARES_AUTH_REQUIRED' || errorData.error === 'ARES_AUTH_EXPIRED') {
          const now = Date.now();

          // Prevent rapid successive auth errors (rate limiting)
          if (now - lastAuthErrorTime < 10000) {
            console.log('ARES authentication error throttled - too recent');
            return;
          }

          console.log('ARES authentication error detected, stopping credit fetching');
          setAuthError(true);
          setError('Authentication required');
          setLastAuthErrorTime(now);

          if (errorData.autoLogout) {
            // The server has initiated auto-logout, redirect to login
            console.log('Auto-logout triggered, redirecting to login');
            // Clear all auth-related storage to prevent redirect loops
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            localStorage.removeItem('refreshToken');
            sessionStorage.clear();
            // Use setTimeout to prevent rapid redirects
            setTimeout(() => {
              window.location.href = '/login';
            }, 1000);
            return;
          } else {
            // Manual redirect to ARES OAuth without auto-logout
            console.log('ARES auth required, redirecting to OAuth');
            setTimeout(() => {
              window.location.href = '/oauth/ares';
            }, 1000);
            return;
          }
        }

        throw new Error(errorData.message || 'Failed to fetch credits');
      }

      const data = await response.json();
      console.log('ARES API Response:', data); // Debug log

      if (data.credits !== undefined) {
        const nextCredits = data.credits || 0;
        setCredits((prev) => (prev === nextCredits ? prev : nextCredits));
        if (user?.id) {
          try {
            localStorage.setItem(`credits:${user.id}`, String(nextCredits));
          } catch (storageError) {
            console.warn('Unable to cache credits value', storageError);
          }
        }
        setHasCachedCredits(true);
        setAuthError(false); // Reset auth error on successful fetch
        if (isInitialLoad) {
          setIsInitialLoad(false);
        }
      } else {
        console.error('No credits field in response:', data);
        setError('Invalid response format');
      }
    } catch (error) {
      console.error('Error fetching credits:', error);
      // Don't set error for auth-related issues to prevent loops
      if (!error.message?.includes('Authentication') && !error.message?.includes('ARES')) {
        setError(error instanceof Error ? error.message : 'Unknown error');
      }
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, [user?.id, isAuthenticated, token, authError, lastAuthErrorTime, isInitialLoad]);

  useEffect(() => {
    // Set up event listener for credit updates
    const handleCreditsUpdated = () => {
      if (!authError) {
        fetchCredits();
      }
    };

    window.addEventListener(CREDITS_UPDATED_EVENT, handleCreditsUpdated);

    // Initial fetch when component mounts
    let timer: NodeJS.Timeout | null = null;
    if (isAuthenticated && user && token && !authError) {
      // Add a small delay to prevent race conditions on component mount
      timer = setTimeout(() => {
        fetchCredits(!hasCachedCredits); // Only show loading if we have nothing cached
      }, 1000);
    } else if (isAuthenticated === false) {
      setIsLoading(false);
    }

    // Set up periodic refresh every 5 minutes as a fallback
    // But only if we don't have an auth error
    const intervalId = setInterval(() => {
      if (user?.id && isAuthenticated && token && !authError) {
        fetchCredits();
      }
    }, 300000); // 5 minutes instead of 1 minute

    // Clean up
    return () => {
      window.removeEventListener(CREDITS_UPDATED_EVENT, handleCreditsUpdated);
      clearInterval(intervalId);
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [user?.id, isAuthenticated, token, authError, fetchCredits, hasCachedCredits]);

  const redirectToCustomerPortal = async () => {
    setLoading(true);
    try {
      window.open('https://joinares.com/pricing', '_blank');
    } catch (error) {
      if (error) {
        console.error('Error redirecting to customer portal:', error);
      }
    }
    setLoading(false);
  };

  let maxGens = 25;

  // If not authenticated, no user, or no token, don't render anything
  if (!isAuthenticated || !user || !token) {
    return null;
  }

  // Show error state if there's an error
  if (error && !isLoading) {
    return (
      <div className="flex flex-col px-3">
        <div className="mb-1 text-right text-sm text-red-500">Error loading credits</div>
        <Progress value={0} className="opacity-50" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col px-3">
        <div className="bg-mid-yellow/30 my-1 ml-auto h-3 w-[30%] animate-pulse rounded-lg" />
        <Progress value={(0 / maxGens) * 100} className="animate-pulse opacity-50" />
      </div>
    );
  }

  return (
    <div className={cn('px-3', credits > 25 && '')}>
      <div className="shadow-inner">
        <div className="py-">
          <div className="mb- space-y-1 text-right font-rajdhani text-sm font-normal tracking-wider text-[#ffc772] sm:text-base">
            <div className="flex items-center justify-end">
              <p className="font-rajdhani font-medium">{credits} Credits Left</p>
              <button
                className="ml-2 flex h-4 w-4 items-center justify-center rounded-full border border-[#ffc772] text-base transition-all sm:h-5 sm:w-5 sm:text-lg"
                disabled={loading}
                onClick={redirectToCustomerPortal}
                aria-label="Add more credits"
              >
                <span className="inline-flex h-full items-center justify-center">+</span>
              </button>
            </div>

            <Progress value={(credits / maxGens) * 100} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreditsCounter;
