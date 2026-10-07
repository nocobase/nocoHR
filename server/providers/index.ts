import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

import AIResourcesProvider from './ai-resources.js';
import HrProvider from './hr/index.js';
// 上线准备: the go-live checklist and bulk account activation, after the talent platform it reads.
import GoLiveProvider from './hr/go-live/provider.js';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  HrProvider,
  GoLiveProvider,
  AIResourcesProvider,
];

export default serviceProviders;

export {
  hrCoreServiceToken,
  organizationServiceToken,
  talentServiceToken,
} from './hr/index.js';
