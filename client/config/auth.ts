import { defineAppConfig, type AppConfigFactory } from '@nocobase/app-client';
import { apiKeyClient } from '@nocobase/app-plugin-api-keys/client';
import type { AuthConfig } from '@nocobase/app-plugin-authentication/client';
import { DEVICE_AUTHORIZATION_ENABLED } from '../../shared/device-authorization.js';
import {
  deviceAuthorizationClient,
  usernameClient,
} from 'better-auth/client/plugins';

const auth: AppConfigFactory<AuthConfig> = defineAppConfig((_runtime) => ({
  plugins: [
    usernameClient({ displayUsername: false }),
    apiKeyClient(),
    ...(DEVICE_AUTHORIZATION_ENABLED ? [deviceAuthorizationClient()] : []),
  ],
}));

export default auth;
