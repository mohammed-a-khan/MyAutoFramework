import { 
    ExecutionResult, 
    EvidenceCollection, 
    AggregatedData, 
    ExecutionSummary,
    ReportMetrics,
    TrendData,
    ExecutionStatistics,
    TestStatus
} from '../types/reporting.types';
import { Logger } from '../../core/utils/Logger';

/**
 * Aggregates test execution results for reporting
 */
export class ReportAggregator {
    private logger: Logger;
    private aggregationCache: Map<string, any> = new Map();

    constructor() {
        this.logger = Logger.getInstance('ReportAggregator');
    }

    /**
     * Initialize the aggregator
     */
    public async initialize(): Promise<void> {
        this.aggregationCache.clear();
        this.logger.info('Report aggregator initialized');
    }

    /**
     * Aggregate execution results and evidence
     */
    public async aggregate(executionResult: ExecutionResult, evidence: EvidenceCollection): Promise<AggregatedData> {
        try {
            this.logger.info('Starting result aggregation');
            const startTime = Date.now();

            // Create execution summary
            const executionSummary = await this.createExecutionSummary(executionResult);
            
            // Create report metrics
            const reportMetrics = await this.createReportMetrics(executionResult, evidence);

            // Calculate trends if historical data available
            const trends = await this.calculateTrends(executionResult);

            // Build aggregated data according to the interface
            const aggregatedData: AggregatedData = {
                executionResult,
                evidence,
                summary: executionSummary,
                metrics: reportMetrics,
                ...(trends && { trends }),
                metadata: {
                    aggregationDuration: Date.now() - startTime,
                    aggregationTimestamp: new Date().toISOString()
                }
            };

            // Cache the aggregated data
            this.aggregationCache.set(executionResult.executionId, aggregatedData);

            this.logger.info(`Aggregation completed in ${Date.now() - startTime}ms`);
            return aggregatedData;

        } catch (error: any) {
            this.logger.error('Aggregation failed', error);
            throw error;
        }
    }

    /**
     * Create execution summary
     */
    private async createExecutionSummary(executionResult: ExecutionResult): Promise<ExecutionSummary> {
        // Count scenarios from the executionResult directly
        const totalScenarios = executionResult.totalScenarios;
        const passedScenarios = executionResult.passedScenarios;
        const failedScenarios = executionResult.failedScenarios;
        const skippedScenarios = executionResult.skippedScenarios;
        const totalSteps = executionResult.totalSteps;
        const passedSteps = executionResult.passedSteps;
        const failedSteps = executionResult.failedSteps;
        const skippedSteps = executionResult.skippedSteps;
        const totalDuration = executionResult.duration;
        
        // Calculate some metrics from scenarios
        let pendingSteps = 0;
        for (const scenario of executionResult.scenarios) {
            for (const step of scenario.steps) {
                if (step.status === TestStatus.PENDING) pendingSteps++;
            }
        }

        const passRate = totalScenarios > 0 ? (passedScenarios / totalScenarios) * 100 : 0;
        const failureRate = totalScenarios > 0 ? (failedScenarios / totalScenarios) * 100 : 0;

        // Create execution statistics
        const statistics: ExecutionStatistics = {
            avgScenarioDuration: totalScenarios > 0 ? totalDuration / totalScenarios : 0,
            avgStepDuration: totalSteps > 0 ? totalDuration / totalSteps : 0,
            fastestScenario: { scenarioId: '', name: '', duration: 0, feature: '' },
            slowestScenario: { scenarioId: '', name: '', duration: 0, feature: '' },
            mostFailedFeature: '',
            mostStableFeature: '',
            flakyTests: []
        };

        // Find fastest and slowest scenarios
        let fastestDuration = Infinity;
        let slowestDuration = 0;
        for (const scenario of executionResult.scenarios) {
            if (scenario.duration < fastestDuration) {
                fastestDuration = scenario.duration;
                statistics.fastestScenario = {
                    scenarioId: scenario.scenarioId,
                    name: scenario.scenario,
                    duration: scenario.duration,
                    feature: scenario.feature
                };
            }
            if (scenario.duration > slowestDuration) {
                slowestDuration = scenario.duration;
                statistics.slowestScenario = {
                    scenarioId: scenario.scenarioId,
                    name: scenario.scenario,
                    duration: scenario.duration,
                    feature: scenario.feature
                };
            }
        }

        // Find most failed and most stable features
        const featureStats = new Map<string, { passed: number; failed: number; total: number }>();
        for (const scenario of executionResult.scenarios) {
            const stats = featureStats.get(scenario.feature) || { passed: 0, failed: 0, total: 0 };
            stats.total++;
            if (scenario.status === TestStatus.PASSED) stats.passed++;
            else if (scenario.status === TestStatus.FAILED) stats.failed++;
            featureStats.set(scenario.feature, stats);
        }

        let mostFailures = 0;
        let mostStable = 100;
        featureStats.forEach((stats, feature) => {
            const failureRate = (stats.failed / stats.total) * 100;
            if (stats.failed > mostFailures) {
                mostFailures = stats.failed;
                statistics.mostFailedFeature = feature;
            }
            if (failureRate < mostStable && stats.total > 1) {
                mostStable = failureRate;
                statistics.mostStableFeature = feature;
            }
        });

        return {
            totalFeatures: executionResult.totalFeatures,
            passedFeatures: executionResult.passedFeatures,
            failedFeatures: executionResult.failedFeatures,
            skippedFeatures: executionResult.skippedFeatures,
            totalScenarios,
            passedScenarios,
            failedScenarios,
            skippedScenarios,
            totalSteps,
            passedSteps,
            failedSteps,
            skippedSteps,
            pendingSteps,
            executionTime: totalDuration,
            parallelWorkers: executionResult.metadata && executionResult.metadata['workers'] ? executionResult.metadata['workers'] : 1,
            retryCount: 0, // TODO: Calculate from scenarios
            passRate,
            failureRate,
            status: executionResult.status,
            trends: { // Will be filled by calculateTrends
                passRateTrend: 0,
                executionTimeTrend: 0,
                failureRateTrend: 0,
                lastExecutions: []
            },
            statistics
        };
    }

    /**
     * Create report metrics
     */
    private async createReportMetrics(executionResult: ExecutionResult, evidence: EvidenceCollection): Promise<ReportMetrics> {
        // Calculate execution metrics
        const executionMetrics = {
            totalDuration: executionResult.duration,
            setupDuration: 0, // TODO: Calculate from hooks
            testDuration: executionResult.duration,
            teardownDuration: 0, // TODO: Calculate from hooks
            avgScenarioDuration: executionResult.totalScenarios > 0 ? executionResult.duration / executionResult.totalScenarios : 0,
            avgStepDuration: executionResult.totalSteps > 0 ? executionResult.duration / executionResult.totalSteps : 0,
            parallelEfficiency: 1.0, // TODO: Calculate based on parallel execution
            queueTime: 0,
            retryRate: 0, // TODO: Calculate from scenarios
            timeToFirstFailure: undefined
        };

        // Calculate browser metrics
        const browserMetrics = {
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
        };

        // Calculate network metrics from evidence
        let totalRequests = 0;
        let failedRequests = 0;
        let totalDataTransferred = 0;
        let avgResponseTime = 0;

        if (evidence.networkLogs) {
            totalRequests = evidence.networkLogs.length;
            failedRequests = evidence.networkLogs.filter(log => log.status >= 400).length;
            
            const responseTimes = evidence.networkLogs.map(log => log.duration);
            if (responseTimes.length > 0) {
                avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
            }
            
            totalDataTransferred = evidence.networkLogs.reduce((sum, log) => sum + log.responseSize + log.requestSize, 0);
        }

        const networkMetrics = {
            totalRequests,
            failedRequests,
            cachedRequests: 0,
            avgResponseTime,
            totalDataTransferred,
            totalDataSent: 0,
            totalDataReceived: totalDataTransferred,
            slowestRequest: {
                requestId: '',
                url: '',
                method: 'GET',
                status: 0,
                responseTime: 0,
                size: 0,
                type: '',
                startTime: new Date(),
                endTime: new Date(),
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
            // Additional required properties
            successfulRequests: totalRequests - failedRequests,
            totalBytesTransferred: totalDataTransferred,
            totalTime: avgResponseTime * totalRequests,
            averageResponseTime: avgResponseTime,
            thirdPartyRequests: 0,
            resourceTypes: {},
            protocols: {},
            domains: {},
            thirdPartyCategories: {},
            pageUrl: ''
        };

        // Calculate system metrics
        const systemMetrics = {
            cpuUsage: 0,
            memoryUsage: 0,
            diskIO: 0,
            networkLatency: 0,
            processCount: 1
        };

        const executionMetricsResult: any = {
            totalDuration: executionMetrics.totalDuration,
            setupDuration: executionMetrics.setupDuration,
            testDuration: executionMetrics.testDuration,
            teardownDuration: executionMetrics.teardownDuration,
            avgScenarioDuration: executionMetrics.avgScenarioDuration,
            avgStepDuration: executionMetrics.avgStepDuration,
            parallelEfficiency: executionMetrics.parallelEfficiency,
            queueTime: executionMetrics.queueTime,
            retryRate: executionMetrics.retryRate
        };
        
        if (executionMetrics.timeToFirstFailure !== undefined) {
            executionMetricsResult.timeToFirstFailure = executionMetrics.timeToFirstFailure;
        }

        return {
            execution: executionMetricsResult,
            browser: browserMetrics,
            network: networkMetrics,
            system: systemMetrics
        };
    }

    /**
     * Calculate trends from historical data
     */
    private async calculateTrends(_executionResult: ExecutionResult): Promise<TrendData | undefined> {
        // TODO: Implement trend calculation from historical data
        return {
            passRateTrend: 0,
            executionTimeTrend: 0,
            failureRateTrend: 0,
            lastExecutions: []
        };
    }

    /**
     * Get cached aggregation
     */
    public getCachedAggregation(executionId: string): AggregatedData | undefined {
        return this.aggregationCache.get(executionId);
    }

    /**
     * Clear cache
     */
    public clearCache(): void {
        this.aggregationCache.clear();
        this.logger.info('Aggregation cache cleared');
    }
}