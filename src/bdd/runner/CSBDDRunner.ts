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
import { 
    ReportData, 
    FeatureReport, 
    ScenarioReport,
    ExportFormat,
    ChartType,
    TestStatus,
    ReportTheme,
    EvidenceConfig,
    ChartConfig,
    CustomizationConfig,
    ExecutionMetrics,
    BrowserMetrics,
    NetworkMetrics,
    SystemMetrics
} from '../../reporting/types/reporting.types';
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
    ExecutionStatus,
    ScenarioStatus,
    StepStatus,
    FeatureStatus
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
            // Convert ExecutionResult to ReportData
            const reportData = this.convertToReportData(result);
            
            // Generate reports
            await this.reportOrchestrator.generateReports(reportData);

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
            
            const uploadResult = await adoService.uploadTestResults(result);

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
     * Convert ExecutionResult to ReportData
     */
    private convertToReportData(result: ExecutionResult): ReportData {
        const now = new Date();
        
        return {
            metadata: {
                reportId: `report-${Date.now()}`,
                reportName: this.runOptions['reportName'] || 'Test Execution Report',
                executionId: `exec-${Date.now()}`,
                environment: result.environment || ConfigurationManager.getEnvironmentName(),
                executionDate: now,
                startTime: result.startTime || now,
                endTime: result.endTime || now,
                duration: result.duration || 0,
                reportGeneratedAt: now,
                frameworkVersion: '1.0.0',
                reportVersion: '1.0',
                machineInfo: {
                    hostname: 'localhost',
                    platform: process.platform,
                    arch: process.arch,
                    cpuCores: 1,
                    totalMemory: 0,
                    nodeVersion: process.version,
                    osRelease: ''
                },
                userInfo: {
                    username: process.env['USER'] || 'unknown',
                    domain: 'local',
                    executedBy: process.env['USER'] || 'unknown'
                },
                tags: [],
                executionOptions: {
                    env: ConfigurationManager.getEnvironmentName()
                }
            },
            configuration: {
                theme: {
                    primaryColor: '#93186C',
                    secondaryColor: '#FFFFFF',
                    successColor: '#4CAF50',
                    failureColor: '#F44336',
                    warningColor: '#FF9800',
                    infoColor: '#2196F3',
                    backgroundColor: '#F5F5F5',
                    fontFamily: 'Arial, sans-serif'
                } as ReportTheme,
                exportFormats: ['html' as ExportFormat, 'json' as ExportFormat],
                includeEvidence: {
                    includeScreenshots: true,
                    includeVideos: false,
                    includeTraces: false,
                    includeNetworkLogs: true,
                    includeConsoleLogs: true,
                    maxScreenshotsPerScenario: 10,
                    compressImages: false,
                    embedInReport: true
                } as EvidenceConfig,
                charts: {
                    enableCharts: true,
                    chartTypes: ['pie' as ChartType, 'bar' as ChartType, 'line' as ChartType],
                    interactive: true,
                    exportable: true,
                    customCharts: []
                } as ChartConfig,
                sections: [],
                customizations: {
                    companyLogo: '',
                    companyName: 'Test Company',
                    projectName: 'Test Project',
                    customCSS: '',
                    customFooter: '',
                    headerTemplate: '',
                    reportTitle: 'Test Execution Report'
                } as CustomizationConfig
            },
            summary: {
                totalFeatures: result.summary.totalFeatures || 0,
                passedFeatures: result.features.filter(f => f.status === 'passed').length,
                failedFeatures: result.features.filter(f => f.status === 'failed').length,
                skippedFeatures: result.features.filter(f => f.status === 'skipped').length,
                totalScenarios: result.summary.totalScenarios || 0,
                passedScenarios: result.features.reduce((acc, f) => 
                    acc + (f.scenarios || []).filter(s => s.status === 'passed').length, 0),
                failedScenarios: result.features.reduce((acc, f) => 
                    acc + (f.scenarios || []).filter(s => s.status === 'failed').length, 0),
                skippedScenarios: result.features.reduce((acc, f) => 
                    acc + (f.scenarios || []).filter(s => s.status === 'skipped').length, 0),
                totalSteps: result.features.reduce((acc, f) => 
                    acc + (f.scenarios || []).reduce((sacc, s) => 
                        sacc + (s.steps || []).length, 0), 0),
                passedSteps: result.features.reduce((acc, f) => 
                    acc + (f.scenarios || []).reduce((sacc, s) => 
                        sacc + (s.steps || []).filter(st => st.status === 'passed').length, 0), 0),
                failedSteps: result.features.reduce((acc, f) => 
                    acc + (f.scenarios || []).reduce((sacc, s) => 
                        sacc + (s.steps || []).filter(st => st.status === 'failed').length, 0), 0),
                skippedSteps: result.features.reduce((acc, f) => 
                    acc + (f.scenarios || []).reduce((sacc, s) => 
                        sacc + (s.steps || []).filter(st => st.status === 'skipped').length, 0), 0),
                pendingSteps: result.summary.pending || 0,
                executionTime: result.duration || 0,
                parallelWorkers: this.runOptions.parallel ? (this.runOptions.workers || 1) : 1,
                retryCount: 0,
                passRate: result.summary.total > 0 ? (result.summary.passed / result.summary.total) * 100 : 0,
                failureRate: result.summary.total > 0 ? (result.summary.failed / result.summary.total) * 100 : 0,
                status: result.status,
                trends: {
                    passRateTrend: 0,
                    executionTimeTrend: 0,
                    failureRateTrend: 0,
                    lastExecutions: []
                },
                statistics: {
                    avgScenarioDuration: result.summary.totalScenarios > 0 ? 
                        (result.duration || 0) / result.summary.totalScenarios : 0,
                    avgStepDuration: 0,
                    fastestScenario: { scenarioId: '', name: '', duration: 0, feature: '' },
                    slowestScenario: { scenarioId: '', name: '', duration: 0, feature: '' },
                    mostFailedFeature: '',
                    mostStableFeature: '',
                    flakyTests: []
                },
                scenarios: result.features.flatMap(f => 
                    (f.scenarios || []).map(s => ({
                        scenarioId: s.id || '',
                        name: s.scenario || '',
                        status: this.mapScenarioStatusToTestStatus(s.status || 'failed'),
                        duration: s.duration || 0,
                        retryCount: 0,
                        description: s.scenarioRef?.description || '',
                        tags: s.tags || [],
                        line: s.scenarioRef?.line || 0,
                        keyword: 'Scenario',
                        startTime: s.startTime || now,
                        endTime: s.endTime || now,
                        error: s.error ? (typeof s.error === 'string' ? s.error : s.error.message || '') : '',
                        errorStack: s.error && typeof s.error === 'object' ? (s.error.stack || '') : '',
                        steps: (s.steps || []).map(st => ({
                            keyword: st.keyword || 'Given',
                            text: st.text || '',
                            status: this.mapStepStatusToTestStatus(st.status || 'failed'),
                            duration: st.duration || 0,
                            line: st.line || 0,
                            error: st.error ? (typeof st.error === 'string' ? st.error : st.error.message || '') : '',
                            errorStack: st.error && typeof st.error === 'object' ? (st.error.stack || '') : ''
                        }))
                    }))
                ),
                features: result.features.map(f => ({
                    featureId: f.id || '',
                    feature: f.feature?.name || f.name || '',
                    name: f.feature?.name || f.name || '',
                    description: f.feature?.description || f.description || '',
                    uri: f.feature?.uri || f.uri || '',
                    line: f.feature?.line || 0,
                    keyword: 'Feature',
                    tags: f.feature?.tags || f.tags || [],
                    scenarios: (f.scenarios || []).map(s => ({
                        scenarioId: s.id || '',
                        name: s.scenario || '',
                        status: this.mapScenarioStatusToTestStatus(s.status || 'failed'),
                        duration: s.duration || 0,
                        retryCount: 0,
                        description: s.scenarioRef?.description || '',
                        tags: s.tags || [],
                        line: s.scenarioRef?.line || 0,
                        keyword: 'Scenario',
                        startTime: s.startTime || now,
                        endTime: s.endTime || now,
                        error: s.error ? (typeof s.error === 'string' ? s.error : s.error.message || '') : '',
                        errorStack: s.error && typeof s.error === 'object' ? (s.error.stack || '') : '',
                        steps: (s.steps || []).map(st => ({
                            keyword: st.keyword || 'Given',
                            text: st.text || '',
                            status: this.mapStepStatusToTestStatus(st.status || 'failed'),
                            duration: st.duration || 0,
                            line: st.line || 0,
                            error: st.error ? (typeof st.error === 'string' ? st.error : st.error.message || '') : '',
                            errorStack: st.error && typeof st.error === 'object' ? (st.error.stack || '') : ''
                        }))
                    })),
                    status: this.mapFeatureStatusToTestStatus(f.status || 'failed'),
                    startTime: f.startTime || now,
                    endTime: f.endTime || now,
                    duration: f.duration || 0,
                    statistics: {
                        totalScenarios: f.scenarios?.length || 0,
                        passedScenarios: (f.scenarios || []).filter(s => s.status === 'passed').length,
                        failedScenarios: (f.scenarios || []).filter(s => s.status === 'failed').length,
                        skippedScenarios: (f.scenarios || []).filter(s => s.status === 'skipped').length,
                        totalSteps: (f.scenarios || []).reduce((acc, s) => acc + (s.steps || []).length, 0),
                        passedSteps: (f.scenarios || []).reduce((acc, s) => acc + (s.steps || []).filter(st => st.status === 'passed').length, 0),
                        failedSteps: (f.scenarios || []).reduce((acc, s) => acc + (s.steps || []).filter(st => st.status === 'failed').length, 0),
                        skippedSteps: (f.scenarios || []).reduce((acc, s) => acc + (s.steps || []).filter(st => st.status === 'skipped').length, 0),
                        avgScenarioDuration: f.scenarios?.length > 0 ? (f.scenarios.reduce((acc, s) => acc + (s.duration || 0), 0) / f.scenarios.length) : 0,
                        maxScenarioDuration: Math.max(...(f.scenarios || []).map(s => s.duration || 0), 0),
                        minScenarioDuration: f.scenarios?.length > 0 ? Math.min(...f.scenarios.map(s => s.duration || 0)) : 0,
                        passRate: f.scenarios?.length > 0 ? ((f.scenarios.filter(s => s.status === 'passed').length / f.scenarios.length) * 100) : 0
                    },
                    metadata: f.metadata || {}
                })),
                environment: result.environment || 'default'
            },
            features: result.features.map(f => {
                const feature = f.feature || f;
                const scenarios = f.scenarios || [];
                const scenarioSummaries = scenarios.map(s => ({
                    scenarioId: s.id || '',
                    name: s.scenario || '',
                    status: this.mapScenarioStatusToTestStatus(s.status || 'failed'),
                    duration: s.duration || 0,
                    retryCount: 0,
                    description: s.scenarioRef?.description || '',
                    tags: s.tags || [],
                    line: s.scenarioRef?.line || 0,
                    keyword: 'Scenario',
                    startTime: s.startTime || now,
                    endTime: s.endTime || now,
                    error: s.error ? (typeof s.error === 'string' ? s.error : s.error.message || '') : '',
                    errorStack: s.error && typeof s.error === 'object' ? (s.error.stack || '') : '',
                    steps: (s.steps || []).map(st => ({
                        keyword: st.keyword || 'Given',
                        text: st.text || '',
                        status: this.mapStepStatusToTestStatus(st.status || 'failed'),
                        duration: st.duration || 0,
                        line: st.line || 0,
                        error: st.error ? (typeof st.error === 'string' ? st.error : st.error.message || '') : '',
                        errorStack: st.error && typeof st.error === 'object' ? (st.error.stack || '') : ''
                    }))
                }));
                
                return {
                    featureId: f.id || '',
                    feature: f.feature?.name || f.name || '',
                    name: feature.name || f.name || '',
                    description: feature.description || f.description || '',
                    uri: feature.uri || f.uri || '',
                    line: feature.line || 0,
                    keyword: 'Feature',
                    tags: feature.tags || f.tags || [],
                    scenarios: scenarioSummaries,
                    status: this.mapFeatureStatusToTestStatus(f.status || 'failed'),
                    startTime: f.startTime || now,
                    endTime: f.endTime || now,
                    duration: f.duration || 0,
                    statistics: {
                        totalScenarios: scenarios.length,
                        passedScenarios: scenarios.filter(s => s.status === 'passed').length,
                        failedScenarios: scenarios.filter(s => s.status === 'failed').length,
                        skippedScenarios: scenarios.filter(s => s.status === 'skipped').length,
                        totalSteps: scenarios.reduce((acc, s) => acc + (s.steps || []).length, 0),
                        passedSteps: scenarios.reduce((acc, s) => acc + (s.steps || []).filter(st => st.status === 'passed').length, 0),
                        failedSteps: scenarios.reduce((acc, s) => acc + (s.steps || []).filter(st => st.status === 'failed').length, 0),
                        skippedSteps: scenarios.reduce((acc, s) => acc + (s.steps || []).filter(st => st.status === 'skipped').length, 0),
                        avgScenarioDuration: scenarios.length > 0 ? scenarios.reduce((acc, s) => acc + (s.duration || 0), 0) / scenarios.length : 0,
                        maxScenarioDuration: Math.max(...scenarios.map(s => s.duration || 0), 0),
                        minScenarioDuration: scenarios.length > 0 ? Math.min(...scenarios.map(s => s.duration || 0)) : 0,
                        passRate: scenarios.length > 0 ? (scenarios.filter(s => s.status === 'passed').length / scenarios.length) * 100 : 0
                    },
                    metadata: {}
                } as FeatureReport;
            }),
            scenarios: result.features.flatMap(f => 
                (f.scenarios || []).map(s => ({
                    scenarioId: s.id || '',
                    scenario: s.scenario || '',
                    name: s.scenario || '',
                    description: s.scenarioRef?.description || '',
                    feature: f.feature?.name || f.name || '',
                    featureId: f.id || '',
                    uri: f.uri || '',
                    line: s.scenarioRef?.line || 0,
                    keyword: 'Scenario',
                    tags: s.tags || [],
                    steps: (s.steps || []).map(st => ({
                        stepId: st.id || '',
                        keyword: st.keyword || 'Given',
                        text: st.text || '',
                        line: st.line || 0,
                        status: this.mapStepStatusToTestStatus(st.status || 'failed'),
                        startTime: st.startTime || now,
                        endTime: st.endTime || now,
                        duration: st.duration || 0,
                        result: {
                            status: this.mapStepStatusToTestStatus(st.status || 'failed'),
                            duration: st.duration || 0,
                            error: st.error ? {
                                id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                                timestamp: now,
                                type: 'assertion' as any,
                                message: typeof st.error === 'string' ? st.error : (st.error.message || ''),
                                stack: typeof st.error === 'object' ? (st.error.stack || '') : '',
                                location: {
                                    feature: f.feature?.name || f.name || '',
                                    scenario: s.scenario || '',
                                    step: st.text || '',
                                    line: st.line || 0,
                                    file: f.uri || ''
                                },
                                context: {
                                    browser: this.runOptions.browser || 'chromium',
                                    viewport: `${ConfigurationManager.getInt('VIEWPORT_WIDTH', 1920)}x${ConfigurationManager.getInt('VIEWPORT_HEIGHT', 1080)}`,
                                    url: '',
                                    additionalInfo: {}
                                },
                                similar: [],
                                severity: 'high' as any
                            } : undefined
                        },
                        embeddings: [],
                        actions: []
                    })),
                    status: this.mapScenarioStatusToTestStatus(s.status || 'failed'),
                    startTime: s.startTime || now,
                    endTime: s.endTime || now,
                    duration: s.duration || 0,
                    retryCount: 0,
                    hooks: [],
                    evidence: {
                        screenshots: [],
                        video: '',
                        trace: '',
                        networkHAR: '',
                        consoleLogs: []
                    },
                    error: s.error ? {
                        id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        timestamp: now,
                        type: 'assertion' as any,
                        message: typeof s.error === 'string' ? s.error : (s.error.message || ''),
                        stack: typeof s.error === 'object' ? (s.error.stack || '') : '',
                        location: {
                            feature: f.feature?.name || f.name || '',
                            scenario: s.scenario || '',
                            step: '',
                            line: s.scenarioRef?.line || 0,
                            file: f.uri || ''
                        },
                        context: {
                            browser: this.runOptions.browser || 'chromium',
                            viewport: `${ConfigurationManager.getInt('VIEWPORT_WIDTH', 1920)}x${ConfigurationManager.getInt('VIEWPORT_HEIGHT', 1080)}`,
                            url: '',
                            additionalInfo: {}
                        },
                        similar: [],
                        severity: 'high' as any
                    } : undefined,
                    context: {
                        browser: this.runOptions.browser || 'chromium',
                        viewport: {
                            width: ConfigurationManager.getInt('VIEWPORT_WIDTH', 1920),
                            height: ConfigurationManager.getInt('VIEWPORT_HEIGHT', 1080)
                        },
                        userAgent: ''
                    }
                }) as ScenarioReport)
            ),
            evidence: {
                screenshots: [],
                videos: [],
                traces: [],
                networkLogs: [],
                consoleLogs: [],
                performanceLogs: [],
                downloads: [],
                uploads: []
            },
            metrics: {
                execution: {
                    totalDuration: result.duration || 0,
                    setupDuration: 0,
                    testDuration: result.duration || 0,
                    teardownDuration: 0,
                    avgScenarioDuration: result.summary.totalScenarios > 0 ? 
                        (result.duration || 0) / result.summary.totalScenarios : 0,
                    avgStepDuration: 0,
                    parallelEfficiency: this.runOptions.parallel ? 
                        (this.runOptions.workers || 1) * 0.8 : 1,
                    queueTime: 0,
                    retryRate: 0
                } as ExecutionMetrics,
                browser: {
                    pageLoadTime: 0,
                    domContentLoaded: 0,
                    firstPaint: 0,
                    firstContentfulPaint: 0,
                    largestContentfulPaint: 0,
                    firstInputDelay: 0,
                    timeToInteractive: 0,
                    totalBlockingTime: 0,
                    cumulativeLayoutShift: 0,
                    memoryUsage: {
                        usedJSHeapSize: 0,
                        totalJSHeapSize: 0,
                        jsHeapSizeLimit: 0
                    },
                    consoleErrors: 0,
                    consoleWarnings: 0
                } as BrowserMetrics,
                network: {
                    totalRequests: 0,
                    failedRequests: 0,
                    cachedRequests: 0,
                    avgResponseTime: 0,
                    totalDataTransferred: 0,
                    totalDataSent: 0,
                    totalDataReceived: 0,
                    slowestRequest: {
                        requestId: '',
                        url: '',
                        method: '',
                        status: 0,
                        responseTime: 0,
                        size: 0,
                        type: '',
                        startTime: now,
                        endTime: now,
                        headers: {},
                        timing: {
                            dns: 0,
                            connect: 0,
                            ssl: 0,
                            send: 0,
                            wait: 0,
                            receive: 0,
                            total: 0
                        }
                    },
                    cacheHitRate: 0,
                    requestsByType: {},
                    requestsByDomain: {},
                    successfulRequests: 0,
                    totalBytesTransferred: 0,
                    totalTime: 0,
                    averageResponseTime: 0,
                    successRate: 0,
                    errorRate: 0,
                    thirdPartyRequests: 0,
                    blockedRequests: 0,
                    resourceBreakdown: {},
                    statusCodes: {},
                    domains: {},
                    resourceTypes: {},
                    protocols: {},
                    thirdPartyCategories: {},
                    pageUrl: ''
                } as NetworkMetrics,
                system: {
                    cpuUsage: 0,
                    memoryUsage: 0,
                    processCount: 1
                } as SystemMetrics
            }
        };
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

    /**
     * Map scenario status to test status
     */
    private mapScenarioStatusToTestStatus(status: ScenarioStatus | string): TestStatus {
        switch (status) {
            case 'passed':
                return TestStatus.PASSED;
            case 'failed':
                return TestStatus.FAILED;
            case 'skipped':
            case 'pending':
                return TestStatus.SKIPPED;
            default:
                return TestStatus.FAILED;
        }
    }

    /**
     * Map step status to test status
     */
    private mapStepStatusToTestStatus(status: StepStatus | string): TestStatus {
        switch (status) {
            case 'passed':
                return TestStatus.PASSED;
            case 'failed':
                return TestStatus.FAILED;
            case 'skipped':
            case 'pending':
            case 'undefined':
            case 'ambiguous':
                return TestStatus.SKIPPED;
            default:
                return TestStatus.FAILED;
        }
    }

    /**
     * Map feature status to test status
     */
    private mapFeatureStatusToTestStatus(status: FeatureStatus | string): TestStatus {
        switch (status) {
            case 'passed':
                return TestStatus.PASSED;
            case 'failed':
                return TestStatus.FAILED;
            case 'skipped':
            case 'pending':
                return TestStatus.SKIPPED;
            default:
                return TestStatus.FAILED;
        }
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