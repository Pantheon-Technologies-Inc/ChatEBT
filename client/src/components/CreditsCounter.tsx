import { Skeleton } from '@librechat/client';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { cn } from '~/utils';
import { useAuthContext, useLocalize } from '~/hooks';

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

interface CreditsCounterProps {
  className?: string;
}

const CreditsCounter = ({ className }: CreditsCounterProps) => {
  const localize = useLocalize();
  const { user, isAuthenticated, token } = useAuthContext();
  const initialCachedCredits =
    user?.id != null ? getCachedCreditsForUser(user.id) : undefined;
  const [credits, setCredits] = useState<number | null>(() =>
    initialCachedCredits === undefined ? null : initialCachedCredits,
  );
  const creditsRef = useRef<number | null>(
    initialCachedCredits === undefined ? null : initialCachedCredits,
  );
  const [isLoading, setIsLoading] = useState(
    () => Boolean(user?.id) && initialCachedCredits === undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<boolean>(false);
  const [lastAuthErrorTime, setLastAuthErrorTime] = useState<number>(0);

  useEffect(() => {
    if (!user?.id) {
      setCredits(null);
      setIsLoading(false);
      return;
    }

    const cached = getCachedCreditsForUser(user.id);

    if (cached !== undefined) {
      setCredits(cached);
      setIsLoading(false);
    } else {
      setCredits(null);
      setIsLoading(true);
    }
  }, [user?.id]);

  useEffect(() => {
    creditsRef.current = credits;
  }, [credits]);

  // Extract fetch credits into a reusable function
  const fetchCredits = useCallback(
    async (showLoading = false) => {
      if (!user?.id || !isAuthenticated || !token || authError) {
        return;
      }

      const hasExistingCredits = creditsRef.current !== null;
      const shouldShowLoading =
        creditsRef.current === null || (showLoading && !hasExistingCredits);
      if (shouldShowLoading) {
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
          setAuthError(false); // Reset auth error on successful fetch
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
        if (shouldShowLoading) {
          setIsLoading(false);
        }
      }
    },
    [user?.id, isAuthenticated, token, authError, lastAuthErrorTime],
  );

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
        const shouldShowSkeleton = creditsRef.current === null;
        fetchCredits(shouldShowSkeleton); // Only show loading if we have nothing cached
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
  }, [user?.id, isAuthenticated, token, authError, fetchCredits]);

  const safeCredits = Math.max(0, credits ?? 0);
  const baseStackClass = cn('flex flex-col gap-2 text-[#ffc772]', className);

  // If not authenticated, no user, or no token, don't render anything
  if (!isAuthenticated || !user || !token) {
    return null;
  }

  // Show error state if there's an error
  if (error && !isLoading) {
    return (
      <div className={baseStackClass}>
        <div className="text-sm text-red-500">{localize('com_nav_credits_error')}</div>
      </div>
    );
  }

  if (isLoading || credits === null) {
    return (
      <div className={baseStackClass}>
        <Skeleton className="h-4 w-24 rounded-lg bg-[#ffc772]/20" />
        <Skeleton className="h-2 w-full rounded-full bg-[#ffc772]/10" />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2.5 text-left text-[#ffc772]', className)}>
      <div className="flex flex-col gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em]">
          {localize('com_nav_credits_available_label')}
        </p>
        <p className="text-3xl font-semibold tracking-tight leading-tight sm:text-4xl">
          {new Intl.NumberFormat().format(Math.round(safeCredits))}
        </p>
      </div>
      <p className="text-[11px] leading-relaxed text-[#ffc772]/80">
        {localize('com_nav_credits_refresh_note')}
      </p>
    </div>
  );
};

export default CreditsCounter;
