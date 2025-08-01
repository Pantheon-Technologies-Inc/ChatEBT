import {
  GoogleIcon,
  FacebookIcon,
  OpenIDIcon,
  GithubIcon,
  DiscordIcon,
  AppleIcon,
  SamlIcon,
} from '@librechat/client';

// ARES Icon component
const AresIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2L2 7v10c0 5.55 3.84 9.74 9 11 5.16-1.26 9-5.45 9-11V7l-10-5z" />
  </svg>
);

import SocialButton from './SocialButton';

import { useLocalize } from '~/hooks';

import { TStartupConfig } from 'librechat-data-provider';

function SocialLoginRender({
  startupConfig,
}: {
  startupConfig: TStartupConfig | null | undefined;
}) {
  const localize = useLocalize();

  if (!startupConfig) {
    return null;
  }

  const providerComponents = {
    discord: startupConfig.discordLoginEnabled && (
      <SocialButton
        key="discord"
        enabled={startupConfig.discordLoginEnabled}
        serverDomain={startupConfig.serverDomain}
        oauthPath="discord"
        Icon={DiscordIcon}
        label={localize('com_auth_discord_login')}
        id="discord"
      />
    ),
    facebook: startupConfig.facebookLoginEnabled && (
      <SocialButton
        key="facebook"
        enabled={startupConfig.facebookLoginEnabled}
        serverDomain={startupConfig.serverDomain}
        oauthPath="facebook"
        Icon={FacebookIcon}
        label={localize('com_auth_facebook_login')}
        id="facebook"
      />
    ),
    github: startupConfig.githubLoginEnabled && (
      <SocialButton
        key="github"
        enabled={startupConfig.githubLoginEnabled}
        serverDomain={startupConfig.serverDomain}
        oauthPath="github"
        Icon={GithubIcon}
        label={localize('com_auth_github_login')}
        id="github"
      />
    ),
    google: startupConfig.googleLoginEnabled && (
      <SocialButton
        key="google"
        enabled={startupConfig.googleLoginEnabled}
        serverDomain={startupConfig.serverDomain}
        oauthPath="google"
        Icon={GoogleIcon}
        label={localize('com_auth_google_login')}
        id="google"
      />
    ),
    apple: startupConfig.appleLoginEnabled && (
      <SocialButton
        key="apple"
        enabled={startupConfig.appleLoginEnabled}
        serverDomain={startupConfig.serverDomain}
        oauthPath="apple"
        Icon={AppleIcon}
        label={localize('com_auth_apple_login')}
        id="apple"
      />
    ),
    openid: startupConfig.openidLoginEnabled && (
      <SocialButton
        key="openid"
        enabled={startupConfig.openidLoginEnabled}
        serverDomain={startupConfig.serverDomain}
        oauthPath="openid"
        Icon={() =>
          startupConfig.openidImageUrl ? (
            <img src={startupConfig.openidImageUrl} alt="OpenID Logo" className="h-5 w-5" />
          ) : (
            <OpenIDIcon />
          )
        }
        label={startupConfig.openidLabel}
        id="openid"
      />
    ),
    saml: startupConfig.samlLoginEnabled && (
      <SocialButton
        key="saml"
        enabled={startupConfig.samlLoginEnabled}
        serverDomain={startupConfig.serverDomain}
        oauthPath="saml"
        Icon={() =>
          startupConfig.samlImageUrl ? (
            <img src={startupConfig.samlImageUrl} alt="SAML Logo" className="h-5 w-5" />
          ) : (
            <SamlIcon />
          )
        }
        label={startupConfig.samlLabel ? startupConfig.samlLabel : localize('com_auth_saml_login')}
        id="saml"
      />
    ),
    ares: startupConfig.aresLoginEnabled && !startupConfig.aresAutoRedirect && (
      <SocialButton
        key="ares"
        enabled={startupConfig.aresLoginEnabled}
        serverDomain={startupConfig.serverDomain}
        oauthPath="ares"
        Icon={() =>
          startupConfig.aresImageUrl ? (
            <img src={startupConfig.aresImageUrl} alt="ARES Logo" className="h-5 w-5" />
          ) : (
            <img src="/assets/ares_icon.png" alt="ARES Logo" className="h-6 w-6 rounded-md" />
          )
        }
        label={startupConfig.aresLabel || 'Continue with ARES'}
        id="ares"
      />
    ),
  };

  return (
    startupConfig.socialLoginEnabled && (
      <>
        {startupConfig.emailLoginEnabled && (
          <>
            <div className="relative mt-6 flex w-full items-center justify-center border border-t border-gray-300 uppercase">
              <div className="absolute bg-white px-3 text-xs text-black">Or</div>
            </div>
            <div className="mt-8" />
          </>
        )}
        <div className="mt-2">
          {startupConfig.socialLogins?.map((provider) => providerComponents[provider] || null)}
        </div>
      </>
    )
  );
}

export default SocialLoginRender;
