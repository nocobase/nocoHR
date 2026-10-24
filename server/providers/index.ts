import type { ApplicationServiceProviderConstructor } from '@nocobase/app-server/application';

import NativeKnowledgeProvider from './native-knowledge/provider.js';
import NativeAIProvider from './native-ai/provider.js';
import ProcessesProvider from './processes/provider.js';
import AssistantProvider from './assistant/provider.js';
import HrProvider from './hr/index.js';
// 上线准备: the go-live checklist and bulk account activation, after the talent platform it reads.
import GoLiveProvider from './hr/go-live/provider.js';

const serviceProviders: readonly ApplicationServiceProviderConstructor[] = [
  HrProvider,
  NativeAIProvider,
  NativeKnowledgeProvider,
  GoLiveProvider,
  AssistantProvider,
  ProcessesProvider,
];

export default serviceProviders;

export {
  hrCoreServiceToken,
  organizationServiceToken,
  talentServiceToken,
} from './hr/index.js';
