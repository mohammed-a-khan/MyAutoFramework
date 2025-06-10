// src/bdd/runner/ScenarioExecutor.ts

import { StepExecutor } from './StepExecutor';
import { HookExecutor } from '../hooks/HookExecutor';
import { ExecutionContext } from '../context/ExecutionContext';
import { ScenarioContext } from '../context/ScenarioContext';
import { BDDContext } from '../context/BDDContext';
import { CSDataProvider } from '../../data/provider/CSDataProvider';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { ScreenshotManager } from '../../core/debugging/ScreenshotManager';
import { VideoRecorder } from '../../core/debugging/VideoRecorder';
import { TraceRecorder } from '../../core/debugging/TraceRecorder';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';
import {
    Scenario,
    ScenarioResult,
    Step,
    StepResult,
    TestData,
    ScenarioOutline,
    ExecutionError,
    DataTable,
    DocString,
    StepStatus,
    ScenarioStatus
} from '../types/bdd.types';

/**
 * Executes individual scenarios with full lifecycle management
 */
export class ScenarioExecutor {
    private stepExecutor: StepExecutor;
    private hookExecutor: HookExecutor;
    private dataProvider: CSDataProvider;
    private screenshotManager: ScreenshotManager;
    private videoRecorder: VideoRecorder;
    private traceRecorder: TraceRecorder;
    private currentContext: ExecutionContext | null = null;

    constructor() {
        this.stepExecutor = new StepExecutor();
        this.hookExecutor = HookExecutor.getInstance();
        this.dataProvider = CSDataProvider.getInstance();
        this.screenshotManager = ScreenshotManager.getInstance();
        this.videoRecorder = VideoRecorder.getInstance();
        this.traceRecorder = TraceRecorder.getInstance();
    }

    /**
     * Execute a scenario
     */
    public async execute(scenario: Scenario, featureContext?: any): Promise<ScenarioResult> {
        // Handle scenario outlines
        if (this.isScenarioOutline(scenario)) {
            return this.executeScenarioOutline(scenario as ScenarioOutline, featureContext);
        }

        // Handle data-driven scenarios
        if (this.hasDataProvider(scenario)) {
            return this.executeDataDrivenScenario(scenario, featureContext);
        }

        // Execute regular scenario
        return this.executeSingleScenario(scenario, featureContext);
    }

    /**
     * Execute a single scenario instance
     */
    private async executeSingleScenario(
        scenario: Scenario, 
        featureContext?: any,
        testData?: TestData,
        exampleData?: any
    ): Promise<ScenarioResult> {
        const startTime = new Date();
        const scenarioId = `${scenario.name}_${Date.now()}`;

        ActionLogger.logInfo('Scenario Execution', `Starting scenario: ${scenario.name}`);
        if (testData) {
            ActionLogger.logDebug('Test Data', JSON.stringify(testData));
        }

        const result: ScenarioResult = {
            id: scenarioId,
            scenario: scenario.name,
            tags: scenario.tags,
            startTime,
            endTime: new Date(),
            duration: 0,
            status: ScenarioStatus.PASSED,
            steps: [],
            error: null,
            retries: 0,
            timestamp: new Date()
        };

        try {
            // Create execution context
            this.currentContext = await this.createExecutionContext(scenario, featureContext, testData || exampleData);

            // Start recording if enabled
            await this.startRecording(scenarioId);

            // Execute before scenario hooks
            await this.executeBeforeScenarioHooks(scenario, this.currentContext);

            // Execute steps
            result.steps = await this.executeSteps(scenario.steps, this.currentContext);

            // Determine scenario status
            result.status = this.determineScenarioStatus(result.steps);

            // Handle retries if failed
            if (result.status === ScenarioStatus.FAILED && this.shouldRetry(scenario)) {
                result.retries = await this.handleRetries(scenario, result);
            }

        } catch (error) {
            ActionLogger.logError('Scenario execution error', new Error(`Scenario: ${scenario.name}`));
            result.status = ScenarioStatus.FAILED;
            const err = error as Error;
            result.error = {
                type: 'execution',
                message: err.message,
                stack: err.stack,
                context: {
                    scenario: scenario.name
                },
                timestamp: new Date()
            } as ExecutionError;
        } finally {
            try {
                // Execute after scenario hooks
                await this.executeAfterScenarioHooks(scenario, this.currentContext, result);

                // Stop recording and collect artifacts
                const artifacts = await this.stopRecording(scenarioId, result.status);
                // Store artifacts in attachments if needed
                if (artifacts.length > 0) {
                    result.attachments = artifacts.map(a => ({
                        data: a.path,
                        mimeType: a.type === 'video' ? 'video/webm' : 'application/zip',
                        name: a.type
                    }));
                }

                // Take failure screenshot if needed
                if (result.status === ScenarioStatus.FAILED) {
                    await this.captureFailureEvidence(scenarioId, result);
                }

                // Cleanup resources
                await this.cleanup();

            } catch (cleanupError) {
                ActionLogger.logError('Scenario cleanup error', cleanupError as Error);
            }

            // Finalize result
            result.endTime = new Date();
            result.duration = result.endTime.getTime() - result.startTime.getTime();

            // Log scenario completion
            this.logScenarioCompletion(result);
        }

        return result;
    }

    /**
     * Execute scenario outline with examples
     */
    private async executeScenarioOutline(
        outline: ScenarioOutline,
        featureContext?: any
    ): Promise<ScenarioResult> {
        ActionLogger.logInfo('Scenario Outline', `Executing outline: ${outline.name}`);

        const results: ScenarioResult[] = [];

        for (const example of outline.examples) {
            for (const row of example.rows) {
                // Create scenario from outline with example data
                const scenario = this.createScenarioFromOutline(outline, example.header, row);
                
                // Execute scenario
                const result = await this.executeSingleScenario(
                    scenario,
                    featureContext,
                    undefined,
                    this.createExampleData(example.header, row)
                );

                results.push(result);

                // Stop on first failure if configured
                if (result.status === ScenarioStatus.FAILED && process.env['STOP_ON_FAILURE'] === 'true') {
                    break;
                }
            }
        }

        // Merge results
        return this.mergeOutlineResults(outline, results);
    }

    /**
     * Execute data-driven scenario
     */
    private async executeDataDrivenScenario(
        scenario: Scenario,
        featureContext?: any
    ): Promise<ScenarioResult> {
        ActionLogger.logInfo('Data-Driven Scenario', `Executing: ${scenario.name}`);

        // Load test data
        const testDataSet = await this.loadTestData(scenario);
        const results: ScenarioResult[] = [];

        for (const testData of testDataSet) {
            // Skip if execution flag is false
            if (testData._execute === false) {
                ActionLogger.logDebug('Skipping test data', JSON.stringify(testData));
                continue;
            }

            // Execute scenario with test data
            const result = await this.executeSingleScenario(
                scenario,
                featureContext,
                testData
            );

            results.push(result);

            // Stop on first failure if configured
            if (result.status === ScenarioStatus.FAILED && process.env['STOP_ON_FAILURE'] === 'true') {
                break;
            }
        }

        // Merge results
        return this.mergeDataDrivenResults(scenario, results);
    }

    /**
     * Execute scenario steps
     */
    public async executeSteps(steps: Step[], context: any): Promise<StepResult[]> {
        const results: StepResult[] = [];

        for (const step of steps) {
            // Execute before step hooks
            await this.executeBeforeStepHooks(step, context);

            // Execute step
            const stepResult = await this.stepExecutor.execute(step, context);
            results.push(stepResult);

            // Execute after step hooks
            await this.executeAfterStepHooks(step, context, stepResult);

            // Stop execution if step failed
            if (stepResult.status === StepStatus.FAILED) {
                // Mark remaining steps as skipped
                const remainingSteps = steps.slice(steps.indexOf(step) + 1);
                for (const remaining of remainingSteps) {
                    results.push({
                        id: `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        keyword: remaining.keyword,
                        text: remaining.text,
                        status: StepStatus.SKIPPED,
                        duration: 0,
                        startTime: new Date(),
                        endTime: new Date(),
                        skippedReason: 'Previous step failed'
                    });
                }
                break;
            }
        }

        return results;
    }

    /**
     * Create execution context
     */
    private async createExecutionContext(
        scenario: Scenario,
        featureContext: any,
        testData?: any
    ): Promise<ExecutionContext> {
        // Create execution context
        const executionContext = new ExecutionContext(`scenario_${scenario.name}_${Date.now()}`);
        await executionContext.initialize();
        
        // Get browser context and page from execution context
        const browserContext = executionContext.getBrowserContext();
        const page = executionContext.getPage();
        
        // Create scenario context with feature name
        const featureName = featureContext?.feature?.name || 'Unknown Feature';
        const scenarioContext = new ScenarioContext(scenario, featureName);
        
        // Set test data if available
        if (testData) {
            scenarioContext.set('testData', testData);
        }
        
        // Store context data in execution context metadata
        executionContext.setMetadata('scenario', scenario);
        executionContext.setMetadata('scenarioContext', scenarioContext);
        executionContext.setMetadata('featureContext', featureContext);
        executionContext.setMetadata('testData', testData);
        executionContext.setMetadata('bddContext', BDDContext.getInstance());
        executionContext.setMetadata('page', page);
        executionContext.setMetadata('browserContext', browserContext);
        
        return executionContext;
    }

    /**
     * Execute before scenario hooks
     */
    private async executeBeforeScenarioHooks(_scenario: Scenario, context: any): Promise<void> {
        try {
            await this.hookExecutor.executeBeforeHooks(context);
        } catch (error) {
            ActionLogger.logError('Before scenario hooks failed', error as Error);
            throw error;
        }
    }

    /**
     * Execute after scenario hooks
     */
    private async executeAfterScenarioHooks(
        _scenario: Scenario,
        context: any,
        _result: ScenarioResult
    ): Promise<void> {
        try {
            await this.hookExecutor.executeAfterHooks(context);
        } catch (error) {
            ActionLogger.logError('After scenario hooks failed', error as Error);
            // Don't throw - after hooks should not fail the scenario
        }
    }

    /**
     * Execute before step hooks
     */
    private async executeBeforeStepHooks(_step: Step, context: any): Promise<void> {
        try {
            await this.hookExecutor.executeBeforeStepHooks(context);
        } catch (error) {
            ActionLogger.logError('Before step hooks failed', error as Error);
            throw error;
        }
    }

    /**
     * Execute after step hooks
     */
    private async executeAfterStepHooks(
        _step: Step,
        context: any,
        _result: StepResult
    ): Promise<void> {
        try {
            await this.hookExecutor.executeAfterStepHooks(context);
        } catch (error) {
            ActionLogger.logError('After step hooks failed', error as Error);
            // Don't throw
        }
    }

    /**
     * Start recording (video/trace)
     */
    private async startRecording(scenarioId: string): Promise<void> {
        try {
            // Ensure context exists before recording
            if (!this.currentContext) {
                return;
            }
            
            const page = this.currentContext.getPage();
            if (!page) {
                ActionLogger.logWarn('No page available for recording');
                return;
            }
            
            // Start video recording if enabled
            if (process.env['RECORD_VIDEO'] === 'true') {
                await this.videoRecorder.startRecording(page, {
                    enabled: true,
                    format: 'webm',
                    quality: 'medium',
                    fps: 30,
                    width: 1920,
                    height: 1080,
                    preserveOutput: true,
                    compressVideo: false,
                    includeAudio: false,
                    highlightClicks: true,
                    watermark: scenarioId,
                    maxDuration: 300000 // 5 minutes
                });
            }

            // Start trace recording if enabled
            if (process.env['RECORD_TRACE'] === 'true') {
                await this.traceRecorder.startTracing(page, {
                    screenshots: true,
                    snapshots: true,
                    sources: true,
                    title: scenarioId
                });
            }
        } catch (error) {
            ActionLogger.logError('Failed to start recording', error as Error);
        }
    }

    /**
     * Stop recording and collect artifacts
     */
    private async stopRecording(_scenarioId: string, _status: ScenarioStatus): Promise<any[]> {
        const artifacts = [];

        try {
            // Stop video recording
            if (process.env['RECORD_VIDEO'] === 'true') {
                const videoPath = await this.videoRecorder.stopRecording();
                if (videoPath) {
                    artifacts.push({
                        type: 'video',
                        path: videoPath,
                        timestamp: new Date()
                    });
                }
            }

            // Stop trace recording
            if (process.env['RECORD_TRACE'] === 'true') {
                const tracePath = await this.traceRecorder.stopTracing();
                if (tracePath) {
                    artifacts.push({
                        type: 'trace',
                        path: tracePath,
                        timestamp: new Date()
                    });
                }
            }
        } catch (error) {
            ActionLogger.logError('Failed to stop recording', error as Error);
        }

        return artifacts;
    }

    /**
     * Capture failure evidence
     */
    private async captureFailureEvidence(_scenarioId: string, result: ScenarioResult): Promise<void> {
        try {
            // Ensure context and page exist
            if (!this.currentContext) {
                return;
            }
            
            const page = this.currentContext.getPage();
            if (!page) {
                ActionLogger.logWarn('No page available for failure evidence capture');
                return;
            }
            
            // Take screenshot
            const screenshotPath = await this.screenshotManager.takeScreenshot(
                page,
                {
                    type: 'png',
                    fullPage: true
                }
            );

            if (!result.attachments) {
                result.attachments = [];
            }
            result.attachments.push({
                data: screenshotPath,
                mimeType: 'image/png',
                name: 'Failure screenshot'
            });

            // Capture page state
            const pageState = await this.capturePageState();
            result.attachments.push({
                data: JSON.stringify(pageState),
                mimeType: 'application/json',
                name: 'Page state'
            });

        } catch (error) {
            ActionLogger.logError('Failed to capture failure evidence', error as Error);
        }
    }

    /**
     * Capture current page state
     */
    private async capturePageState(): Promise<any> {
        const page = this.currentContext?.getPage();
        if (!page) {
            return {};
        }

        return {
            url: page.url(),
            title: await page.title(),
            cookies: await page.context().cookies(),
            localStorage: await page.evaluate(() => ({ ...localStorage })),
            sessionStorage: await page.evaluate(() => ({ ...sessionStorage })),
            consoleErrors: await page.evaluate(() => 
                (window as any)._consoleErrors || []
            )
        };
    }

    /**
     * Cleanup scenario resources
     */
    private async cleanup(): Promise<void> {
        try {
            // Clear scenario context
            const scenarioContext = this.currentContext?.getMetadata('scenarioContext') as ScenarioContext;
            scenarioContext?.clear();

            // Clear BDD context
            BDDContext.getInstance().clearScenarioState();
            
            // Cleanup execution context (this handles browser resources)
            if (this.currentContext) {
                await this.currentContext.cleanup();
                this.currentContext = null;
            }

        } catch (error) {
            ActionLogger.logError('Cleanup error', error as Error);
        }
    }

    /**
     * Handle scenario retries
     */
    private async handleRetries(scenario: Scenario, result: ScenarioResult): Promise<number> {
        const maxRetries = this.getMaxRetries(scenario);
        let retryCount = 0;

        while (retryCount < maxRetries && result.status === ScenarioStatus.FAILED) {
            retryCount++;
            ActionLogger.logInfo('Retry', `Retrying scenario (${retryCount}/${maxRetries}): ${scenario.name}`);

            // Wait before retry
            await this.waitBeforeRetry(retryCount);

            // Execute scenario again
            const retryResult = await this.executeSingleScenario(scenario);

            if (retryResult.status === ScenarioStatus.PASSED) {
                // Update result with retry information
                result.status = ScenarioStatus.PASSED;
                result.steps = retryResult.steps;
                result.error = null;
                break;
            }
        }

        return retryCount;
    }

    /**
     * Helper methods
     */
    private isScenarioOutline(scenario: Scenario): boolean {
        return scenario.type === 'scenario_outline' && (scenario.examples?.length ?? 0) > 0;
    }

    private hasDataProvider(scenario: Scenario): boolean {
        return scenario.tags.some(tag => tag.startsWith('@DataProvider'));
    }

    private async loadTestData(scenario: Scenario): Promise<TestData[]> {
        const dataProviderTag = scenario.tags.find(tag => tag.startsWith('@DataProvider'));
        if (!dataProviderTag) {
            return [];
        }
        const options = this.parseDataProviderTag(dataProviderTag);
        return this.dataProvider.loadData(options);
    }

    private parseDataProviderTag(tag: string): any {
        // Parse @DataProvider(source="data.xlsx",sheet="TestData")
        const matches = tag.match(/@DataProvider\((.*)\)/);
        if (!matches || !matches[1]) return {};

        const params = matches[1];
        const options: any = {};

        // Parse key-value pairs
        const pairs = params.match(/(\w+)="([^"]+)"/g);
        if (pairs) {
            pairs.forEach(pair => {
                const [key, value] = pair.split('=');
                if (key && value) {
                    options[key] = value.replace(/"/g, '');
                }
            });
        }

        return options;
    }

    private createScenarioFromOutline(
        outline: ScenarioOutline,
        headers: string[],
        values: string[]
    ): Scenario {
        const scenario: Scenario = {
            ...outline,
            name: this.interpolateText(outline.name, headers, values),
            steps: outline.steps.map(step => {
                const interpolatedStep: Step = {
                    ...step,
                    text: this.interpolateText(step.text, headers, values)
                };
                
                if (step.dataTable) {
                    interpolatedStep.dataTable = this.interpolateDataTable(step.dataTable, headers, values);
                }
                
                if (step.docString) {
                    interpolatedStep.docString = this.interpolateDocString(step.docString, headers, values);
                }
                
                return interpolatedStep;
            })
        };

        return scenario;
    }

    private interpolateText(text: string, headers: string[], values: string[]): string {
        let result = text;
        headers.forEach((header, index) => {
            const value = values[index];
            if (value !== undefined) {
                result = result.replace(new RegExp(`<${header}>`, 'g'), value);
            }
        });
        return result;
    }

    private interpolateDataTable(dataTable: DataTable, headers: string[], values: string[]): DataTable {
        // Get rows from the dataTable (whether it's a simple rows array or has methods)
        const originalRows = Array.isArray(dataTable.rows) ? dataTable.rows : 
                           (typeof dataTable.raw === 'function' ? dataTable.raw() : []);
        
        // Create a new DataTable with interpolated values
        const interpolatedRows = originalRows.map(row => 
            row.map(cell => this.interpolateText(cell, headers, values))
        );
        
        // Create a DataTable implementation
        const result = {} as DataTable;
        
        // Set the rows property
        result.rows = interpolatedRows;
        
        // Set the methods
        result.raw = () => interpolatedRows;
        
        result.hashes = () => {
            if (interpolatedRows.length < 2) return [];
            const [headerRow, ...dataRows] = interpolatedRows;
            if (!headerRow) return [];
            
            return dataRows.map(row => {
                const hash: Record<string, string> = {};
                headerRow.forEach((header, index) => {
                    hash[header] = row[index] || '';
                });
                return hash;
            });
        };
        
        result.rows = interpolatedRows;
        
        result.rowsWithoutHeader = () => interpolatedRows.slice(1);
        
        result.rowsHash = () => {
            const hash: Record<string, string> = {};
            interpolatedRows.forEach(row => {
                if (row.length >= 2 && row[0] !== undefined && row[1] !== undefined) {
                    hash[row[0]] = row[1];
                }
            });
            return hash;
        };
        
        return result;
    }
    
    private interpolateDocString(docString: DocString, headers: string[], values: string[]): DocString {
        return {
            ...docString,
            content: this.interpolateText(docString.content, headers, values)
        };
    }

    private createExampleData(headers: string[], values: string[]): any {
        const data: any = {};
        headers.forEach((header, index) => {
            data[header] = values[index];
        });
        return data;
    }

    private determineScenarioStatus(steps: StepResult[]): ScenarioStatus {
        if (steps.some(s => s.status === StepStatus.FAILED)) {
            return ScenarioStatus.FAILED;
        }
        if (steps.some(s => s.status === StepStatus.UNDEFINED || s.status === StepStatus.AMBIGUOUS)) {
            return ScenarioStatus.ERROR;
        }
        if (steps.every(s => s.status === StepStatus.PASSED)) {
            return ScenarioStatus.PASSED;
        }
        if (steps.every(s => s.status === StepStatus.SKIPPED)) {
            return ScenarioStatus.SKIPPED;
        }
        return ScenarioStatus.ERROR;
    }

    private mergeOutlineResults(outline: ScenarioOutline, results: ScenarioResult[]): ScenarioResult {
        const merged: ScenarioResult = {
            id: `scenario_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            scenario: outline.name,
            tags: outline.tags,
            startTime: results[0]?.startTime || new Date(),
            endTime: results[results.length - 1]?.endTime || new Date(),
            duration: results.reduce((sum, r) => sum + r.duration, 0),
            status: this.mergeStatuses(results.map(r => r.status)),
            steps: this.mergeSteps(results),
            error: results.find(r => r.error)?.error || null,
            retries: Math.max(...results.map(r => r.retries || 0)),
            timestamp: new Date(),
            attachments: results.flatMap(r => r.attachments || [])
        };

        return merged;
    }

    private mergeDataDrivenResults(scenario: Scenario, results: ScenarioResult[]): ScenarioResult {
        const merged: ScenarioResult = {
            id: `scenario_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            scenario: scenario.name,
            tags: scenario.tags,
            startTime: results[0]?.startTime || new Date(),
            endTime: results[results.length - 1]?.endTime || new Date(),
            duration: results.reduce((sum, r) => sum + r.duration, 0),
            status: this.mergeStatuses(results.map(r => r.status)),
            steps: this.mergeSteps(results),
            error: results.find(r => r.error)?.error || null,
            retries: Math.max(...results.map(r => r.retries || 0)),
            timestamp: new Date(),
            attachments: results.flatMap(r => r.attachments || [])
        };

        return merged;
    }

    private mergeStatuses(statuses: ScenarioStatus[]): ScenarioStatus {
        if (statuses.includes(ScenarioStatus.FAILED)) return ScenarioStatus.FAILED;
        if (statuses.includes(ScenarioStatus.ERROR)) return ScenarioStatus.ERROR;
        if (statuses.includes(ScenarioStatus.SKIPPED)) return ScenarioStatus.SKIPPED;
        return ScenarioStatus.PASSED;
    }

    private mergeStepStatuses(statuses: StepStatus[]): StepStatus {
        if (statuses.includes(StepStatus.FAILED)) return StepStatus.FAILED;
        if (statuses.includes(StepStatus.UNDEFINED)) return StepStatus.UNDEFINED;
        if (statuses.includes(StepStatus.AMBIGUOUS)) return StepStatus.AMBIGUOUS;
        if (statuses.includes(StepStatus.SKIPPED)) return StepStatus.SKIPPED;
        if (statuses.includes(StepStatus.PENDING)) return StepStatus.PENDING;
        return StepStatus.PASSED;
    }

    private mergeSteps(results: ScenarioResult[]): StepResult[] {
        // Get unique steps structure from first result
        const firstResult = results[0];
        if (!firstResult) return [];

        return firstResult.steps.map((step, stepIndex) => {
            const stepResults = results.map(r => r.steps[stepIndex]).filter(Boolean);
            
            const stepError = stepResults.find(s => s?.error)?.error;
            
            const result: StepResult = {
                id: `step_${stepIndex}_${Date.now()}`,
                keyword: step.keyword || 'Given',
                text: step.text || '',
                status: this.mergeStepStatuses(stepResults.map(s => s?.status).filter((s): s is StepStatus => s !== undefined)),
                duration: stepResults.reduce((sum, s) => sum + (s?.duration || 0), 0) / Math.max(stepResults.length, 1),
                startTime: step.startTime || new Date(),
                endTime: step.endTime || new Date()
            };
            
            // Only add error if it exists
            if (stepError) {
                result.error = stepError;
            }
            
            return result;
        });
    }

    private shouldRetry(scenario: Scenario): boolean {
        // Check if retry is enabled
        if (!ConfigurationManager.getBoolean('RETRY_FAILED_TESTS', false)) {
            return false;
        }

        // Check for @no-retry tag
        if (scenario.tags.includes('@no-retry')) {
            return false;
        }

        // Check for @flaky tag (always retry flaky tests)
        if (scenario.tags.includes('@flaky')) {
            return true;
        }

        return true;
    }

    private getMaxRetries(scenario: Scenario): number {
        // Check for custom retry count in tags
        const retryTag = scenario.tags.find(tag => tag.match(/@retry\(\d+\)/));
        if (retryTag) {
            const match = retryTag.match(/@retry\((\d+)\)/);
            if (match && match[1]) {
                return parseInt(match[1], 10);
            }
        }

        // Default retry count
        return ConfigurationManager.getInt('MAX_RETRY_COUNT', 2);
    }

    private async waitBeforeRetry(retryCount: number): Promise<void> {
        const baseDelay = ConfigurationManager.getInt('RETRY_DELAY_MS', 1000);
        const delay = baseDelay * retryCount; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    private logScenarioCompletion(result: ScenarioResult): void {
        const summary = {
            scenario: result.scenario,
            status: result.status,
            duration: `${result.duration}ms`,
            steps: {
                total: result.steps.length,
                passed: result.steps.filter(s => s.status === StepStatus.PASSED).length,
                failed: result.steps.filter(s => s.status === StepStatus.FAILED).length,
                skipped: result.steps.filter(s => s.status === StepStatus.SKIPPED).length
            },
            retries: result.retries
        };

        if (result.status === ScenarioStatus.PASSED) {
            ActionLogger.logInfo('Scenario completed', JSON.stringify(summary));
        } else {
            ActionLogger.logError('Scenario failed', new Error(JSON.stringify(summary)));
            if (result.error) {
                ActionLogger.logError('Scenario error details', new Error(result.error.message));
            }
        }
    }
}