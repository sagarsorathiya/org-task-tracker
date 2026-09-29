import { logger } from './logger';
import { initScheduler } from './scheduler';

const globalSchedulerState = globalThis as unknown as {
  __orgTaskSchedulerInitialized?: boolean;
};

export function ensureSchedulerInitialized(): void {
  if (process.env.REMINDER_SCHEDULER_ENABLED !== 'true') {
    return;
  }

  if (globalSchedulerState.__orgTaskSchedulerInitialized) {
    return;
  }

  initScheduler();
  globalSchedulerState.__orgTaskSchedulerInitialized = true;
  logger.info('Reminder scheduler bootstrap completed');
}
