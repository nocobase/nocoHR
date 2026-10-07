import type { AppConfigFactory } from '@nocobase/app-server/config';
import { apiKey } from '@nocobase/app-plugin-api-keys/server';
import {
  defineAuthConfig,
  type AuthConfig,
} from '@nocobase/app-plugin-authentication/server';
import { username } from 'better-auth/plugins';

const auth: AppConfigFactory<AuthConfig> = defineAuthConfig({
  defaults: {
    plugins: [username({ displayUsername: false }), apiKey()],
    // Self-registration is off: NocoHR accounts come from the initial administrator, the directory sync and HR's
    // 开通账号 (all server-side, through the Users service, which this does not affect). An open sign-up let anyone
    // create an account on a production installation. The login page hides its link and /register redirects to
    // /login while this is true; set `auth.emailAndPassword.disableSignUp: false` in config.yml to reopen it.
    emailAndPassword: { enabled: true, autoSignIn: false, disableSignUp: true },
    session: { storeSessionInDatabase: true },
  },
});

export default auth;
