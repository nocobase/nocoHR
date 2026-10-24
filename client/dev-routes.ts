import { RadioTower } from 'lucide-react';
import {
  defineAppRoutes,
  type AppClientRouteContribution,
} from '@nocobase/app-client/plugins';

// Client 3 no longer provides defineDevRoutes. The lazy import stays inside this build boundary.
const devRoutes: AppClientRouteContribution = defineAppRoutes(
  import.meta.env.DEV
    ? [
        {
          name: 'nocohr-dev',
          path: '/dev',
          navigation: { title: 'dev.title' },
          children: [
            {
              // 模拟渠道（仅开发环境）(V1-04): send office-suite bot messages as a directory member, without a real bot.
              name: 'talent-im-mock',
              path: '/im-mock',
              authz: 'skip',
              navigation: { title: 'navigation.imMock', icon: RadioTower },
              componentLoader: () => import('./pages/dev/im-mock.js'),
            },
          ],
        },
      ]
    : [],
);

export default devRoutes;
