// src/bdd/runner/CSBDDRunner.ts

import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';
import { BrowserManager } from '../../core/browser/BrowserManager';
import { BrowserPool } from '../../core/browser/BrowserPool';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { FeatureFileParser } from '../parser/FeatureFileParser';
import { TestScheduler } from './TestScheduler';
import { ExecutionMonitor } from './ExecutionMonitor';
import { ParallelExecutor } from './ParallelExecutor';
import { FeatureExecutor } from './FeatureExecutor';
import { ReportOrchestrator } from '../../reporting/core/ReportOrchestrator';
import { ReportConfig } from '../../reporting/core/ReportConfig';
import { StepDefinitionLoader } from '../base/StepDefinitionLoader';
import { HookExecutor } from '../hooks/HookExecutor';
import { ProxyManager } from '../../core/proxy/ProxyManager';
import { ADOIntegrationService } from '../../integrations/ado/ADOIntegrationService';
import { stepRegistry } from '../decorators/StepRegistry';
import { 
    RunOptions, 
    ExecutionPlan, 
    ExecutionResult, 
    Feature,
    ExecutionSummary,
    RunnerState,
    ExecutionStatus
} from '../types/bdd.types';

/**
 * Main BDD test runner that orchestrates the entire test execution lifecycle
 */
export class CSBDDRunner {
    private static instance: CSBDDRunner;
    private state: RunnerState = 'idle';
    private executionMonitor: ExecutionMonitor;
    private parallelExecutor: ParallelExecutor;
    private featureExecutor: FeatureExecutor;
    private hookExecutor: HookExecutor;
    private runOptions!: RunOptions;
    private abortController: AbortController;
    private reportOrchestrator: ReportOrchestrator;

    private constructor() {
        this.executionMonitor = ExecutionMonitor.getInstance();
        this.parallelExecutor = ParallelExecutor.getInstance();
        this.featureExecutor = new FeatureExecutor();
        this.hookExecutor = HookExecutor.getInstance();
        this.abortController = new AbortController();
        this.reportOrchestrator = new ReportOrchestrator();
    }

    public static getInstance(): CSBDDRunner {
        if (!CSBDDRunner.instance) {
            CSBDDRunner.instance = new CSBDDRunner();
        }
        return CSBDDRunner.instance;
    }

    /**
     * Main entry point for test execution
     */
    public static async run(options: RunOptions): Promise<void> {
        const runner = CSBDDRunner.getInstance();
        await runner.execute(options);
    }

    /**
     * Execute test run with given options
     */
    public async execute(options: RunOptions): Promise<void> {
        this.runOptions = options;
        const startTime = new Date();
        this.state = 'initializing';

        try {
            const logger = ActionLogger.getInstance();
            logger.info('CS BDD Runner - Starting test execution');
            logger.debug('Run Options: ' + JSON.stringify(options, null, 2));

            // Initialize framework
            await this.initialize(options);

            // Discover tests
            const executionPlan = await this.discover(options);

            if (executionPlan.totalScenarios === 0) {
                logger.warn('No scenarios found matching criteria');
                return;
            }

            // Execute tests
            this.state = 'running';
            const executionResult = await this.executeTests(executionPlan);

            // Update execution result with start time
            executionResult.startTime = startTime;

            // Generate reports
            this.state = 'running';
            await this.report(executionResult);

            // Upload to ADO if configured
            if (options['uploadToADO']) {
                await this.uploadToADO(executionResult);
            }

            // Final cleanup
            await this.cleanup();

            this.state = 'stopped';
            logger.info('CS BDD Runner - Test execution completed successfully');

            // Exit with appropriate code
            process.exit(executionResult.summary.failed > 0 ? 1 : 0);

        } catch (error) {
            this.state = 'error';
            const logger = ActionLogger.getInstance();
            logger.error('CS BDD Runner - Fatal error during execution: ' + (error as Error).message);
            await this.emergencyCleanup();
            process.exit(2);
        }
    }

    /**
     * Initialize framework components
     */
    private async initialize(options: RunOptions): Promise<void> {
        const logger = ActionLogger.getInstance();
        logger.info('Framework Initialization - Starting initialization');

        try {
            // 1. Load configuration
            await ConfigurationManager.loadConfiguration(options.environment || 'default');
            logger.info('Configuration loaded - Environment: ' + (options.environment || 'default'));

            // 2. Configure proxy if needed
            if (ConfigurationManager.getBoolean('PROXY_ENABLED', false)) {
                const proxyManager = ProxyManager.getInstance();
                await proxyManager.initialize({} as any);
                logger.info('Proxy configured');
            }

            // 3. Initialize action logger with options
            await logger.initialize({
                logLevel: options['logLevel'] || ConfigurationManager.get('LOG_LEVEL', 'info'),
                logToFile: ConfigurationManager.getBoolean('LOG_TO_FILE', true),
                logPath: ConfigurationManager.get('LOG_PATH', './logs')
            } as any);

            // 4. Load step definitions
            const loader = StepDefinitionLoader.getInstance();
            await loader.loadAll();
            const stats = stepRegistry.getStats();
            const stepCount = stats.totalSteps;
            logger.info('Step definitions loaded - Total steps: ' + stepCount);

            // 5. Initialize browser manager or pool
            if (options.parallel && options.workers && options.workers > 1) {
                await BrowserPool.getInstance().initialize(
                    options.workers,
                    {
                        browser: (options.browser || ConfigurationManager.get('DEFAULT_BROWSER', 'chromium')) as 'chromium' | 'firefox' | 'webkit',
                        headless: options.headless ?? ConfigurationManager.getBoolean('HEADLESS_MODE', false),
                        slowMo: ConfigurationManager.getInt('BROWSER_SLOWMO', 0),
                        timeout: ConfigurationManager.getInt('DEFAULT_TIMEOUT', 30000),
                        viewport: {
                            width: ConfigurationManager.getInt('VIEWPORT_WIDTH', 1920),
                            height: ConfigurationManager.getInt('VIEWPORT_HEIGHT', 1080)
                        },
                        downloadsPath: ConfigurationManager.get('DOWNLOADS_PATH', './downloads'),
                        ignoreHTTPSErrors: ConfigurationManager.getBoolean('IGNORE_HTTPS_ERRORS', false),
                        tracesDir: './traces',
                        videosDir: './videos'
                    }
                );
                logger.info('Browser pool initialized - Workers: ' + options.workers);
            } else {
                await BrowserManager.getInstance().initialize({
                    browser: (options.browser || ConfigurationManager.get('DEFAULT_BROWSER', 'chromium')) as 'chromium' | 'firefox' | 'webkit',
                    headless: options.headless ?? ConfigurationManager.getBoolean('HEADLESS_MODE', false),
                    slowMo: ConfigurationManager.getInt('BROWSER_SLOWMO', 0),
                    timeout: ConfigurationManager.getInt('DEFAULT_TIMEOUT', 30000),
                    viewport: {
                        width: ConfigurationManager.getInt('VIEWPORT_WIDTH', 1920),
                        height: ConfigurationManager.getInt('VIEWPORT_HEIGHT', 1080)
                    },
                    downloadsPath: ConfigurationManager.get('DOWNLOADS_PATH', './downloads'),
                    ignoreHTTPSErrors: ConfigurationManager.getBoolean('IGNORE_HTTPS_ERRORS', false),
                    tracesDir: './traces',
                    videosDir: './videos'
                });
                logger.info('Browser manager initialized');
            }

            // 6. Initialize report manager
            const reportConfig = new ReportConfig();
            await reportConfig.load({
                outputDir: options['reportPath'] || ConfigurationManager.get('REPORT_PATH', './reports'),
                reportTitle: options['reportName'] || `Test Report - ${new Date().toISOString()}`,
                includeFormats: options['reportFormats'] || ['html', 'json'],
                theme: {
                    primaryColor: ConfigurationManager.get('REPORT_THEME_PRIMARY_COLOR', '#93186C'),
                    secondaryColor: ConfigurationManager.get('REPORT_THEME_SECONDARY_COLOR', '#FFFFFF')
                }
            } as any);
            await this.reportOrchestrator.initialize(reportConfig);

            // 7. Initialize ADO client if needed
            if (options['uploadToADO'] || ConfigurationManager.getBoolean('ADO_UPLOAD_ENABLED', false)) {
                await ADOIntegrationService.getInstance().initialize();
                logger.info('ADO integration initialized');
            }

            // 8. Execute global before hooks
            await this.hookExecutor.executeBeforeHooks({} as any);

            logger.info('Framework Initialization - Initialization completed');

        } catch (error) {
            logger.error('Framework Initialization - Initialization failed: ' + (error as Error).message);
            throw new Error(`Framework initialization failed: ${(error as Error).message}`);
        }
    }

    /**
     * Discover test scenarios based on options
     */
    private async discover(options: RunOptions): Promise<ExecutionPlan> {
        const logger = ActionLogger.getInstance();
        logger.info('Test Discovery - Starting test discovery');

        try {
            // Parse feature files
            const parser = FeatureFileParser.getInstance();
            const features = await parser.parseAll(options['features'] || '**/*.feature');
            logger.info('Features parsed - Total features: ' + features.length);

            // Apply filters
            const filteredFeatures = this.applyFilters(features, options);
            
            // Create execution plan
            const scheduler = new TestScheduler();
            const executionPlan = await scheduler.createExecutionPlan(filteredFeatures, options);

            logger.info('Execution plan created: ' +
                'totalFeatures=' + executionPlan.totalFeatures + 
                ', totalScenarios=' + executionPlan.totalScenarios +
                ', estimatedDuration=' + executionPlan.estimatedDuration + 'ms');

            // Log execution plan details
            if (options.dryRun) {
                this.logExecutionPlan(executionPlan);
            }

            return executionPlan;

        } catch (error) {
            logger.error('Test Discovery - Discovery failed: ' + (error as Error).message);
            throw new Error(`Test discovery failed: ${(error as Error).message}`);
        }
    }

    /**
     * Execute test plan
     */
    private async executeTests(plan: ExecutionPlan): Promise<ExecutionResult> {
        const logger = ActionLogger.getInstance();
        logger.info('Test Execution - Starting test execution');

        // Start execution monitoring
        this.executionMonitor.startMonitoring();

        try {
            let result: ExecutionResult;

            if (this.runOptions.parallel && this.runOptions.workers && this.runOptions.workers > 1) {
                // Parallel execution
                logger.info('Executing tests in parallel - Workers: ' + this.runOptions.workers);
                result = await this.parallelExecutor.execute(plan);
            } else {
                // Sequential execution
                logger.info('Executing tests sequentially');
                result = await this.executeSequential(plan);
            }

            // Stop monitoring
            this.executionMonitor.stopMonitoring();

            // Log execution summary
            this.logExecutionSummary(result.summary);

            return result;

        } catch (error) {
            this.executionMonitor.stopMonitoring();
            logger.error('Test Execution - Execution failed: ' + (error as Error).message);
            throw error;
        }
    }

    /**
     * Execute tests sequentially
     */
    private async executeSequential(plan: ExecutionPlan): Promise<ExecutionResult> {
        const results: ExecutionResult = {
            startTime: new Date(),
            endTime: new Date(),
            duration: 0,
            status: ExecutionStatus.PASSED,
            features: [],
            summary: {
                total: 0,
                totalFeatures: 0,
                totalScenarios: 0,
                passed: 0,
                failed: 0,
                skipped: 0,
                pending: 0,
                duration: 0
            },
            errors: [],
            environment: this.runOptions.environment || 'default',
            timestamp: new Date()
        };

        for (const feature of plan.features) {
            if (this.abortController.signal.aborted) {
                const logger = ActionLogger.getInstance();
                logger.warn('Execution aborted by user');
                break;
            }

            try {
                const featureResult = await this.featureExecutor.execute(feature);
                results.features.push(featureResult);

                // Update summary
                this.updateSummary(results.summary, featureResult);

                // Update execution monitor
                if (feature.scenarios && feature.scenarios.length > 0) {
                    // Update execution monitor - using event system
                    this.executionMonitor.emit('scenarioStart', feature.scenarios[0]);
                }

            } catch (error) {
                const logger = ActionLogger.getInstance();
                logger.error('Feature execution failed - ' + feature.name + ': ' + (error as Error).message);
                if (!results.errors) results.errors = [];
                results.errors.push(error as Error);
            }
        }

        results.endTime = new Date();
        results.duration = results.endTime.getTime() - results.startTime.getTime();
        results.status = results.summary.failed > 0 ? ExecutionStatus.FAILED : ExecutionStatus.PASSED;
        results.summary.duration = results.duration;

        return results;
    }

    /**
     * Generate test reports
     */
    private async report(result: ExecutionResult): Promise<void> {
        const logger = ActionLogger.getInstance();
        logger.info('Report Generation - Starting report generation');

        try {
            // Generate reports
            await this.reportOrchestrator.generateReports(result);

            // Log report locations
            const reportPaths = { html: './reports/index.html', json: './reports/report.json' };
            logger.info('Reports generated: ' + JSON.stringify(reportPaths));

            // Open HTML report if configured
            if (this.runOptions['openReport'] && reportPaths.html) {
                await this.openReport(reportPaths.html);
            }

        } catch (error) {
            logger.error('Report Generation - Report generation failed: ' + (error as Error).message);
            // Don't throw - reports are not critical
        }
    }

    /**
     * Upload results to ADO
     */
    private async uploadToADO(result: ExecutionResult): Promise<void> {
        const logger = ActionLogger.getInstance();
        logger.info('ADO Upload - Starting ADO upload');

        try {
            const adoService = ADOIntegrationService.getInstance();
            
            const uploadResult = await adoService.uploadTestResults({
                executionResult: result,
                testPlanId: this.runOptions['testPlanId'],
                testSuiteId: this.runOptions['testSuiteId'],
                buildId: this.runOptions['buildId'] || process.env['BUILD_ID'],
                releaseId: this.runOptions['releaseId'] || process.env['RELEASE_ID']
            });

            logger.info('ADO Upload - Upload completed: ' + JSON.stringify(uploadResult));

        } catch (error) {
            logger.error('ADO Upload - Upload failed: ' + (error as Error).message);
            // Don't throw - ADO upload is not critical
        }
    }

    /**
     * Cleanup framework resources
     */
    private async cleanup(): Promise<void> {
        const logger = ActionLogger.getInstance();
        logger.info('Cleanup - Starting cleanup');

        try {
            // Execute global after hooks
            await this.hookExecutor.executeAfterHooks({} as any);

            // Close browsers
            if (this.runOptions.parallel && this.runOptions.workers && this.runOptions.workers > 1) {
                await BrowserPool.getInstance().drainPool();
            } else {
                await BrowserManager.getInstance().closeBrowser();
            }

            // Cleanup temporary files
            await this.cleanupTempFiles();

            // Finalize reports
            // Report finalization handled in generateReports

            logger.info('Cleanup - Cleanup completed');

        } catch (error) {
            logger.error('Cleanup - Cleanup failed: ' + (error as Error).message);
        }
    }

    /**
     * Emergency cleanup on fatal errors
     */
    private async emergencyCleanup(): Promise<void> {
        try {
            // Force close all browsers
            if (BrowserPool.getInstance()) {
                await BrowserPool.getInstance().drainPool();
            }
            if (BrowserManager.getInstance()) {
                await BrowserManager.getInstance().closeBrowser();
            }

            // Save any pending logs
            const logger = ActionLogger.getInstance();
            logger.info('Emergency cleanup completed');

        } catch (error) {
            console.error('Emergency cleanup failed:', error);
        }
    }

    /**
     * Apply filters to features
     */
    private applyFilters(features: Feature[], options: RunOptions): Feature[] {
        let filtered = [...features];

        // Filter by feature names/patterns
        if (options['features'] && options['features'].length > 0) {
            filtered = filtered.filter(feature => 
                options['features']!.some((pattern: string) => 
                    feature.name.includes(pattern) || 
                    (feature.uri && feature.uri.includes(pattern))
                )
            );
        }

        // Filter by tags
        if (options.tags) {
            const tagFilter = new TagFilter(options.tags);
            filtered = filtered.map(feature => ({
                ...feature,
                scenarios: feature.scenarios.filter(scenario => 
                    tagFilter.matches([...feature.tags, ...scenario.tags])
                )
            })).filter(feature => feature.scenarios.length > 0);
        }

        // Filter by scenario names
        if (options['scenarios'] && options['scenarios'].length > 0) {
            filtered = filtered.map(feature => ({
                ...feature,
                scenarios: feature.scenarios.filter(scenario =>
                    options['scenarios']!.some((pattern: string) => 
                        scenario.name.includes(pattern)
                    )
                )
            })).filter(feature => feature.scenarios.length > 0);
        }

        return filtered;
    }

    /**
     * Update execution summary
     */
    private updateSummary(summary: ExecutionSummary, featureResult: any): void {
        for (const scenarioResult of featureResult.scenarios) {
            summary.total++;
            summary.totalScenarios++;
            switch (scenarioResult.status) {
                case 'passed':
                    summary.passed++;
                    break;
                case 'failed':
                    summary.failed++;
                    break;
                case 'skipped':
                    summary.skipped++;
                    break;
                case 'pending':
                    summary.pending++;
                    break;
            }
        }
        summary.totalFeatures = 1; // Increment per feature
    }

    /**
     * Log execution plan details
     */
    private logExecutionPlan(plan: ExecutionPlan): void {
        console.log('\n=== Execution Plan ===');
        console.log(`Total Features: ${plan.totalFeatures}`);
        console.log(`Total Scenarios: ${plan.totalScenarios}`);
        console.log(`Estimated Duration: ${plan.estimatedDuration}ms`);
        console.log('\nFeatures to execute:');
        
        for (const feature of plan.features) {
            console.log(`\n  ${feature.name}`);
            for (const scenario of feature.scenarios) {
                console.log(`    - ${scenario.name}`);
            }
        }
        console.log('\n');
    }

    /**
     * Log execution summary
     */
    private logExecutionSummary(summary: ExecutionSummary): void {
        console.log('\n=== Execution Summary ===');
        console.log(`Total Scenarios: ${summary.total}`);
        console.log(`Passed: ${summary.passed} (${(summary.passed / summary.total * 100).toFixed(1)}%)`);
        console.log(`Failed: ${summary.failed} (${(summary.failed / summary.total * 100).toFixed(1)}%)`);
        console.log(`Skipped: ${summary.skipped}`);
        console.log(`Pending: ${summary.pending}`);
        console.log('\n');
    }

    /**
     * Open HTML report in browser
     */
    private async openReport(reportPath: string): Promise<void> {
        const open = await import('open');
        await open.default(reportPath);
    }

    /**
     * Clean up temporary files
     */
    private async cleanupTempFiles(): Promise<void> {
        // Implementation for cleaning temp files
        const fs = await import('fs/promises');

        const tempDirs = [
            './temp',
            './downloads',
            './screenshots/temp'
        ];

        for (const dir of tempDirs) {
            try {
                await fs.rmdir(dir, { recursive: true });
            } catch (error) {
                // Ignore errors
            }
        }
    }

    /**
     * Abort current execution
     */
    public abort(): void {
        const logger = ActionLogger.getInstance();
        logger.warn('Aborting test execution');
        this.abortController.abort();
        this.state = 'stopped';
    }

    /**
     * Get current runner state
     */
    public getState(): RunnerState {
        return this.state;
    }

    /**
     * Get execution progress
     */
    public getProgress(): any {
        return this.executionMonitor.getExecutionSnapshot();
    }
}

/**
 * Tag filter implementation
 */
class TagFilter {
    private expression: string;

    constructor(expression: string) {
        this.expression = expression;
    }

    public matches(tags: string[]): boolean {
        // Parse and evaluate tag expression
        // Supports: @tag1 and @tag2, @tag1 or @tag2, not @tag3
        const normalizedTags = tags.map(t => t.toLowerCase());
        const normalizedExpression = this.expression.toLowerCase();

        // Simple implementation - can be enhanced
        if (normalizedExpression.includes(' and ')) {
            const parts = normalizedExpression.split(' and ').map(p => p.trim());
            return parts.every(part => this.evaluatePart(part, normalizedTags));
        } else if (normalizedExpression.includes(' or ')) {
            const parts = normalizedExpression.split(' or ').map(p => p.trim());
            return parts.some(part => this.evaluatePart(part, normalizedTags));
        } else {
            return this.evaluatePart(normalizedExpression, normalizedTags);
        }
    }

    private evaluatePart(part: string, tags: string[]): boolean {
        if (part.startsWith('not ')) {
            const tag = part.substring(4).trim();
            return !tags.includes(tag);
        } else {
            return tags.includes(part);
        }
    }
}