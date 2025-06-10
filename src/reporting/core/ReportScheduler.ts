import { 
    ReportTask,
    ScheduleOptions,
    ScheduleResult 
} from '../types/reporting.types';
import { Logger } from '../../core/utils/Logger';

/**
 * Schedules and manages report generation tasks
 */
export class ReportScheduler {
    private logger: Logger;
    private tasks: Map<string, ReportTask> = new Map();
    private intervals: Map<string, NodeJS.Timer> = new Map();
    private isRunning: boolean = false;

    constructor() {
        this.logger = Logger.getInstance('ReportScheduler');
    }

    /**
     * Initialize the scheduler
     */
    public async initialize(): Promise<void> {
        this.isRunning = true;
        this.logger.info('Report scheduler initialized');
    }

    /**
     * Schedule a report generation task
     */
    public async scheduleTask(task: ReportTask, options: ScheduleOptions): Promise<ScheduleResult> {
        try {
            if (this.tasks.has(task.taskId)) {
                return {
                    taskId: task.taskId,
                    scheduled: false,
                    error: 'Task already scheduled'
                };
            }

            // Parse cron expression to determine interval
            const interval = this.parseCronExpression(options.cronExpression);
            
            if (interval <= 0) {
                return {
                    taskId: task.taskId,
                    scheduled: false,
                    error: 'Invalid cron expression'
                };
            }

            // Schedule the task
            const timer = setInterval(() => {
                this.executeTask(task);
            }, interval);

            this.tasks.set(task.taskId, task);
            this.intervals.set(task.taskId, timer);

            // Calculate next run
            const nextRun = new Date(Date.now() + interval);

            this.logger.info(`Scheduled task ${task.taskId} with interval ${interval}ms`);

            return {
                taskId: task.taskId,
                scheduled: true,
                nextRun
            };

        } catch (error: any) {
            this.logger.error(`Failed to schedule task ${task.taskId}`, error);
            return {
                taskId: task.taskId,
                scheduled: false,
                error: error.message
            };
        }
    }

    /**
     * Cancel a scheduled task
     */
    public async cancelTask(taskId: string): Promise<void> {
        const interval = this.intervals.get(taskId);
        if (interval) {
            clearInterval(interval as any);
            this.intervals.delete(taskId);
        }

        this.tasks.delete(taskId);
        this.logger.info(`Cancelled task ${taskId}`);
    }

    /**
     * Get all scheduled tasks
     */
    public getTasks(): ReportTask[] {
        return Array.from(this.tasks.values());
    }

    /**
     * Get task by ID
     */
    public getTask(taskId: string): ReportTask | undefined {
        return this.tasks.get(taskId);
    }

    /**
     * Update task
     */
    public async updateTask(taskId: string, updates: Partial<ReportTask>): Promise<void> {
        const task = this.tasks.get(taskId);
        if (task) {
            const updatedTask = { ...task, ...updates };
            this.tasks.set(taskId, updatedTask);
            this.logger.info(`Updated task ${taskId}`);
        }
    }

    /**
     * Execute a task immediately
     */
    public async executeTaskNow(taskId: string): Promise<void> {
        const task = this.tasks.get(taskId);
        if (task) {
            await this.executeTask(task);
        }
    }

    /**
     * Pause scheduler
     */
    public pause(): void {
        this.isRunning = false;
        this.logger.info('Scheduler paused');
    }

    /**
     * Resume scheduler
     */
    public resume(): void {
        this.isRunning = true;
        this.logger.info('Scheduler resumed');
    }

    /**
     * Shutdown scheduler
     */
    public async shutdown(): Promise<void> {
        this.isRunning = false;

        // Cancel all intervals
        for (const interval of this.intervals.values()) {
            clearInterval(interval as any);
        }

        this.intervals.clear();
        this.tasks.clear();

        this.logger.info('Scheduler shutdown complete');
    }

    /**
     * Execute a scheduled task
     */
    private async executeTask(task: ReportTask): Promise<void> {
        if (!this.isRunning || !task.enabled) {
            return;
        }

        try {
            this.logger.info(`Executing scheduled task: ${task.taskId} - ${task.name}`);
            
            // Update task status
            task.status = 'running';
            task.lastRun = new Date();

            // TODO: Implement actual report generation logic
            // This would typically:
            // 1. Fetch execution results
            // 2. Generate reports using CSReporter
            // 3. Handle post-generation actions

            // Update task status
            task.status = 'completed';
            
            // Calculate next run
            const interval = this.intervals.get(task.taskId);
            if (interval) {
                const cronInterval = this.parseCronExpression(task.schedule);
                task.nextRun = new Date(Date.now() + cronInterval);
            }

            this.logger.info(`Task ${task.taskId} completed successfully`);

        } catch (error: any) {
            this.logger.error(`Task ${task.taskId} failed`, error);
            task.status = 'failed';
        }
    }

    /**
     * Parse cron expression to milliseconds
     * Simplified implementation - only supports basic intervals
     */
    private parseCronExpression(cronExpression: string): number {
        // Simple implementation for common patterns
        const patterns: { [key: string]: number } = {
            '* * * * *': 60 * 1000,                    // Every minute
            '*/5 * * * *': 5 * 60 * 1000,              // Every 5 minutes
            '*/15 * * * *': 15 * 60 * 1000,            // Every 15 minutes
            '*/30 * * * *': 30 * 60 * 1000,            // Every 30 minutes
            '0 * * * *': 60 * 60 * 1000,               // Every hour
            '0 */2 * * *': 2 * 60 * 60 * 1000,         // Every 2 hours
            '0 */6 * * *': 6 * 60 * 60 * 1000,         // Every 6 hours
            '0 0 * * *': 24 * 60 * 60 * 1000,          // Daily
            '0 0 * * 0': 7 * 24 * 60 * 60 * 1000,      // Weekly
        };

        return patterns[cronExpression] || 60 * 60 * 1000; // Default to hourly
    }

    /**
     * Get scheduler statistics
     */
    public getStatistics(): {
        totalTasks: number;
        activeTasks: number;
        completedTasks: number;
        failedTasks: number;
        runningTasks: number;
    } {
        const tasks = Array.from(this.tasks.values());
        
        return {
            totalTasks: tasks.length,
            activeTasks: tasks.filter(t => t.enabled).length,
            completedTasks: tasks.filter(t => t.status === 'completed').length,
            failedTasks: tasks.filter(t => t.status === 'failed').length,
            runningTasks: tasks.filter(t => t.status === 'running').length
        };
    }
}