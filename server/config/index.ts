import {
  defaultAppConfigs,
  type AppConfigFactory,
} from '@nocobase/app-server/config';
import auth from './auth.js';
import authorization from './authorization.js';
import notification from './notification.js';
import session from './session.js';
import server from './server.js';
import spa from './spa.js';
import logging from './logging.js';
import drive from './drive.js';
import queue from './queue.js';
import jobs from './jobs.js';
import scheduler from './scheduler.js';
import caching from './caching.js';
import i18n from './i18n.js';
import app from './app.js';
import database from './database.js';
import snowflake from './snowflake.js';
import ai from './ai.js';
import workflow from './workflow.js';
import talent from './talent.js';
// V3-11
import talentProfile from './talent-profile.js';
// Feishu self-built app (organization sync, bot)
import feishu from './feishu.js';
// V2-06: business mailboxes (邮件往来).
import mail from './mail.js';

const defaultConfigs: AppConfigFactory<{
  auth: ReturnType<typeof auth>;
  authorization: ReturnType<typeof authorization>;
  notification: ReturnType<typeof notification>;
  session: ReturnType<typeof session>;
  server: ReturnType<typeof server>;
  spa: ReturnType<typeof spa>;
  logging: ReturnType<typeof logging>;
  drive: ReturnType<typeof drive>;
  queue: ReturnType<typeof queue>;
  jobs: ReturnType<typeof jobs>;
  scheduler: ReturnType<typeof scheduler>;
  caching: ReturnType<typeof caching>;
  i18n: ReturnType<typeof i18n>;
  app: ReturnType<typeof app>;
  database: ReturnType<typeof database>;
  snowflake: ReturnType<typeof snowflake>;
  ai: ReturnType<typeof ai>;
  workflow: ReturnType<typeof workflow>;
  talent: ReturnType<typeof talent>;
  talentProfile: ReturnType<typeof talentProfile>;
  feishu: ReturnType<typeof feishu>;
  mail: ReturnType<typeof mail>;
}> = defaultAppConfigs({
  auth,
  authorization,
  notification,
  session,
  server,
  spa,
  logging,
  drive,
  queue,
  jobs,
  scheduler,
  caching,
  i18n,
  app,
  database,
  snowflake,
  ai,
  workflow,
  talent,
  talentProfile,
  feishu,
  mail,
});

export default defaultConfigs;
