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

interface FreeCounterProps {
  generationsUsed?: number;
  isPro?: boolean;
}

const CreditsCounter = ({}: FreeCounterProps) => {
  const { user, isAuthenticated, token } = useAuthContext();
  const [credits, setCredits] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract fetch credits into a reusable function
  const fetchCredits = useCallback(async () => {
    if (!user?.id || !isAuthenticated || !token) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/balance/ares', {
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
        if (errorData.error === 'ARES_AUTH_REQUIRED' && errorData.autoLogout) {
          // The server has initiated auto-logout, redirect to login
          window.location.href = '/login';
          return;
        }

        throw new Error(errorData.message || 'Failed to fetch credits');
      }

      const data = await response.json();
      console.log('ARES API Response:', data); // Debug log

      if (data.credits !== undefined) {
        setCredits(data.credits || 0);
      } else {
        console.error('No credits field in response:', data);
        setError('Invalid response format');
      }
    } catch (error) {
      console.error('Error fetching credits:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, isAuthenticated, token]);

  useEffect(() => {
    // Initial fetch when component mounts
    if (isAuthenticated && user && token) {
      fetchCredits();
    } else if (isAuthenticated === false) {
      setIsLoading(false);
    }

    // Set up event listener for credit updates
    const handleCreditsUpdated = () => {
      fetchCredits();
    };

    window.addEventListener(CREDITS_UPDATED_EVENT, handleCreditsUpdated);

    // Set up periodic refresh every 60 seconds as a fallback
    const intervalId = setInterval(() => {
      if (user?.id && isAuthenticated && token) {
        fetchCredits();
      }
    }, 60000);

    // Clean up
    return () => {
      window.removeEventListener(CREDITS_UPDATED_EVENT, handleCreditsUpdated);
      clearInterval(intervalId);
    };
  }, [user?.id, isAuthenticated, token, fetchCredits]);

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
          <div className="mb- font-rajdhani space-y-1 text-right text-sm font-normal tracking-wider text-[#ffc772] sm:text-base">
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
