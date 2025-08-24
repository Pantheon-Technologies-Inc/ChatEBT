import React from 'react';
import { useApiErrorBoundary } from '~/hooks/ApiErrorBoundaryContext';
import { useNavigate } from 'react-router-dom';

const ApiErrorWatcher = () => {
  const { error } = useApiErrorBoundary();
  const navigate = useNavigate();
  React.useEffect(() => {
    if (error?.response?.status === 401) {
      // Handle ARES authentication errors
      const errorData = error?.response?.data;
      if (errorData?.error === 'ARES_AUTH_REQUIRED' || errorData?.error === 'ARES_AUTH_EXPIRED') {
        console.log('ApiErrorWatcher: ARES auth error detected, clearing storage and redirecting');
        // Clear all auth-related storage to prevent redirect loops
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        sessionStorage.clear();
        
        if (errorData?.autoLogout) {
          // User was automatically logged out, go to login page
          window.location.href = '/login';
          return;
        } else if (errorData?.redirectUrl) {
          // Redirect to ARES OAuth for re-authentication
          console.log('ApiErrorWatcher: Redirecting to ARES OAuth:', errorData.redirectUrl);
          window.location.href = errorData.redirectUrl;
          return;
        }
      }
      navigate('/login');
    } else if (error?.response?.status === 500) {
      // do something with error
      // navigate('/login');
    }
  }, [error, navigate]);

  return null;
};

export default ApiErrorWatcher;
