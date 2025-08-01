import { useOutletContext, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { OpenIDIcon } from '@librechat/client';
import type { TLoginLayoutContext } from '~/common';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import SocialButton from '~/components/Auth/SocialButton';
import { useAuthContext } from '~/hooks/AuthContext';
import { getLoginError } from '~/utils';
import { useLocalize } from '~/hooks';
import LoginForm from './LoginForm';

function Login() {
  const localize = useLocalize();
  const { error, setError, login } = useAuthContext();
  const { startupConfig } = useOutletContext<TLoginLayoutContext>();

  const [searchParams, setSearchParams] = useSearchParams();
  // Determine if auto-redirect should be disabled based on the URL parameter
  const disableAutoRedirect = searchParams.get('redirect') === 'false';

  // Persist the disable flag locally so that once detected, auto-redirect stays disabled.
  const [isAutoRedirectDisabled, setIsAutoRedirectDisabled] = useState(disableAutoRedirect);

  // Once the disable flag is detected, update local state and remove the parameter from the URL.
  useEffect(() => {
    if (disableAutoRedirect) {
      setIsAutoRedirectDisabled(true);
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('redirect');
      setSearchParams(newParams, { replace: true });
    }
  }, [disableAutoRedirect, searchParams, setSearchParams]);

  // Determine whether we should auto-redirect to OpenID or ARES.
  const shouldAutoRedirectOpenID =
    startupConfig?.openidLoginEnabled &&
    startupConfig?.openidAutoRedirect &&
    startupConfig?.serverDomain &&
    !isAutoRedirectDisabled;

  const shouldAutoRedirectARES =
    startupConfig?.aresLoginEnabled &&
    startupConfig?.aresAutoRedirect &&
    startupConfig?.serverDomain &&
    !isAutoRedirectDisabled;

  const shouldAutoRedirect = shouldAutoRedirectOpenID || shouldAutoRedirectARES;

  useEffect(() => {
    if (shouldAutoRedirectOpenID) {
      console.log('Auto-redirecting to OpenID provider...');
      window.location.href = `${startupConfig.serverDomain}/oauth/openid`;
    } else if (shouldAutoRedirectARES) {
      console.log('Auto-redirecting to ARES provider...');
      window.location.href = `${startupConfig.serverDomain}/oauth/ares`;
    }
  }, [shouldAutoRedirectOpenID, shouldAutoRedirectARES, startupConfig]);

  // Render fallback UI if auto-redirect is active.
  if (shouldAutoRedirect) {
    const redirectConfig = shouldAutoRedirectARES
      ? {
          label: startupConfig.aresLabel,
          imageUrl: startupConfig.aresImageUrl,
          path: 'ares',
          id: 'ares',
          enabled: startupConfig.aresLoginEnabled,
          Icon: () =>
            startupConfig.aresImageUrl ? (
              <img src={startupConfig.aresImageUrl} alt="ARES Logo" className="h-5 w-5" />
            ) : (
              <img src="/assets/ares_icon.png" alt="ARES Logo" className="h-5 w-5" />
            ),
        }
      : {
          label: startupConfig.openidLabel,
          imageUrl: startupConfig.openidImageUrl,
          path: 'openid',
          id: 'openid',
          enabled: startupConfig.openidLoginEnabled,
          Icon: () =>
            startupConfig.openidImageUrl ? (
              <img src={startupConfig.openidImageUrl} alt="OpenID Logo" className="h-5 w-5" />
            ) : (
              <OpenIDIcon />
            ),
        };

    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <p className="text-lg font-semibold">
          {localize('com_ui_redirecting_to_provider', { 0: redirectConfig.label })}
        </p>
        <div className="mt-4">
          <SocialButton
            key={redirectConfig.id}
            enabled={redirectConfig.enabled}
            serverDomain={startupConfig.serverDomain}
            oauthPath={redirectConfig.path}
            Icon={redirectConfig.Icon}
            label={redirectConfig.label}
            id={redirectConfig.id}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      {error != null && <ErrorMessage>{localize(getLoginError(error))}</ErrorMessage>}
      {startupConfig?.emailLoginEnabled === true && (
        <LoginForm
          onSubmit={login}
          startupConfig={startupConfig}
          error={error}
          setError={setError}
        />
      )}
      {startupConfig?.registrationEnabled === true && (
        <p className="my-4 text-center text-sm font-light text-black">
          {' '}
          {localize('com_auth_no_account')}{' '}
          <a
            href="/register"
            className="inline-flex p-1 text-sm font-medium text-green-600 transition-colors hover:text-green-700"
          >
            {localize('com_auth_sign_up')}
          </a>
        </p>
      )}
    </>
  );
}

export default Login;
