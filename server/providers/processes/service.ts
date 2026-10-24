import type { DatabaseConnection } from '@nocobase/db';
import type { JobExecutor, JobExecutionContext } from '@nocobase/jobs';
import type { SchedulerService } from '@nocobase/app-plugin-scheduler/server/tokens';
import type {
  ScheduleTargetHandle,
  ScheduleTargetObservation,
} from '@nocobase/app-plugin-scheduler/server';
import { z } from 'zod';
import { capabilityRecordDigest } from '../upgrade/digest.js';
import {
  ProcessEngine,
  type ProcessHandler,
  type ProcessRun,
} from './engine.js';
import { DatabaseProcessStore } from './database-store.js';
import { ProcessCatalog } from './catalog.js';

export const processRequest = z.strictObject({
  key: z.string().min(1).max(128),
  hash: z.string().regex(/^[a-f0-9]{64}$/u),
  eventKey: z.string().min(1).max(256),
  input: z.json(),
});
export const scheduleProcessRequest = processRequest.omit({ eventKey: true });
export type ProcessAuthorize = (userId: string) => Promise<void>;

export class ProcessService {
  public readonly store: DatabaseProcessStore;
  public constructor(
    private readonly db: DatabaseConnection,
    public readonly catalog: ProcessCatalog,
    private readonly handlers: ReadonlyMap<string, ProcessHandler>,
    public readonly authorize: ProcessAuthorize,
    private readonly enqueue: (
      eventKey: string,
      occurrenceId?: string,
    ) => Promise<void>,
  ) {
    this.store = new DatabaseProcessStore(db, async (key, hash) =>
      catalog.resolve(key, hash),
    );
  }
  public async definitions(userId: string) {
    await this.authorize(userId);
    return this.catalog.list();
  }
  public async read(userId: string, eventKey: string) {
    await this.authorize(userId);
    const run = await this.store.find(eventKey);
    if (!run) throw new Error('PROCESS_RUN_NOT_FOUND');
    return this.view(run);
  }
  public view(run: ProcessRun) {
    return {
      eventKey: run.eventKey,
      key: run.definition.key,
      hash: run.definition.hash,
      status: run.status,
      output: run.output,
    };
  }
  public async submit(userId: string, body: unknown, occurrenceId?: string) {
    const request = processRequest.parse(body);
    await this.authorize(userId);
    const definition = this.catalog.resolve(request.key, request.hash);
    const eventKey = capabilityRecordDigest([
      request.key,
      userId,
      request.eventKey,
    ]);
    const previous = await this.store.find(eventKey);
    const engine = new ProcessEngine(this.store, this.handlers, async () =>
      this.authorize(userId),
    );
    const run = await engine.trigger(
      definition,
      request.input,
      eventKey,
      userId,
    );
    // A racing first acceptance may enqueue twice; atomic node claims still execute each node once.
    if (!previous) await this.enqueue(eventKey, occurrenceId);
    return this.view(run);
  }
  public async execute(eventKey: string, signal: AbortSignal) {
    let run = await this.store.find(eventKey);
    if (!run?.actorUserId) throw new Error('PROCESS_ACTOR_REQUIRED');
    const actor = run.actorUserId;
    const engine = new ProcessEngine(this.store, this.handlers, async () =>
      this.authorize(actor),
    );
    for (let steps = 0; steps <= run.definition.nodes.length; steps++) {
      if (run.status !== 'accepted') return run;
      try {
        // Recheck native permission for every unclaimed node; never trust queued role snapshots.
        await this.authorize(actor);
        if (signal.aborted) {
          await this.stopAccepted(eventKey, 'uncertain');
          return (await this.store.find(eventKey))!;
        }
      } catch (error) {
        await this.stopAccepted(eventKey, 'failed');
        throw error;
      }
      await engine.step(eventKey);
      run = (await this.store.find(eventKey))!;
    }
    throw new Error('PROCESS_STEP_BOUND_EXCEEDED');
  }
  private async stopAccepted(eventKey: string, status: 'failed' | 'uncertain') {
    // A duplicate job losing authorization/cancellation cannot end another worker's claimed node.
    await this.db.repository('processRuns').updateMany({
      filter: { eventKey, status: 'accepted' },
      values: { status, updatedAt: new Date() },
    });
  }
  public async inspect(eventKey: string): Promise<ScheduleTargetObservation> {
    const run = await this.store.find(eventKey);
    if (!run) return { state: 'unknown', reason: 'PROCESS_RUN_NOT_FOUND' };
    if (run.status === 'accepted' || run.status === 'running')
      return { state: run.status === 'accepted' ? 'pending' : 'running' };
    return {
      state: 'completed',
      completion: {
        status: run.status === 'success' ? 'succeeded' : 'failed',
        reason: run.status === 'uncertain' ? 'PROCESS_UNCERTAIN' : undefined,
        result: { eventKey, status: run.status },
      },
    };
  }
}

interface ProcessJobPayload {
  eventKey: string;
  occurrenceId?: string;
}
/** Native Jobs owns dispatch/retry; retries inspect durable state and never replay a claimed node. */
export async function bindProcessJobs(
  service: ProcessService,
  executor: JobExecutor,
  scheduler: SchedulerService,
  scheduleActor: (scheduleId: string) => string | undefined,
) {
  // Load the new Jobs API only for the explicitly enabled runtime.
  const { Job } = await import('@nocobase/jobs');
  class ExecuteProcess extends Job<ProcessJobPayload> {
    static readonly jobName = 'app.processes.execute';
    public async execute({ signal }: JobExecutionContext) {
      try {
        await service.execute(this.payload.eventKey, signal);
      } finally {
        if (this.payload.occurrenceId) {
          const state = await service.inspect(this.payload.eventKey);
          if (state.state === 'completed')
            await target.reportCompletion(
              this.payload.occurrenceId,
              { type: 'app.process', id: this.payload.eventKey },
              state.completion,
            );
        }
      }
    }
  }
  executor.registerJob(ExecuteProcess);
  const target: ScheduleTargetHandle = scheduler.registerTarget({
    type: 'app.process',
    title: 'Application process',
    validate: (config) => ({
      valid: scheduleProcessRequest.safeParse(config).success,
    }),
    start: async (config, context) => {
      const request = scheduleProcessRequest.parse(config);
      const actorUserId = scheduleActor(context.scheduleId);
      if (!actorUserId) throw new Error('PROCESS_SCHEDULE_NOT_AUTHORIZED');
      // submit validates and persists before the native asynchronous target is accepted.
      const result = await service.submit(
        actorUserId,
        {
          key: request.key,
          hash: request.hash,
          input: request.input,
          eventKey: context.occurrenceId,
        },
        context.occurrenceId,
      );
      return {
        state: 'accepted',
        reference: { type: 'app.process', id: result.eventKey },
      };
    },
    inspect: (reference) =>
      reference.type === 'app.process'
        ? service.inspect(reference.id)
        : Promise.resolve({ state: 'unknown', reason: 'REFERENCE_MISMATCH' }),
  });
  return {
    enqueue: async (eventKey: string, occurrenceId?: string) => {
      await executor.addJob(
        new ExecuteProcess({
          eventKey,
          ...(occurrenceId ? { occurrenceId } : {}),
        }),
      );
    },
  };
}
