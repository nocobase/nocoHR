import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

import AIResourcesProvider from './ai-resources.js';
import HrProvider from './hr/index.js';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  HrProvider,
  AIResourcesProvider,
];

export default serviceProviders;

export {
  hrCoreServiceToken,
  organizationServiceToken,
  talentServiceToken,
} from './hr/index.js';
