// src/bdd/runner/StepExecutor.ts

import { StepRegistry } from '../decorators/StepRegistry';
import { StepMatcher } from '../decorators/StepMatcher';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { DebugManager } from '../../core/debugging/DebugManager';
import { ScreenshotManager } from '../../core/debugging/ScreenshotManager';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';
import { 
    Step, 
    StepResult, 
    StepDefinition,
    DataTable,
    DocString,
    StepStatus,
    ExecutionError,
    Attachment
} from '../types/bdd.types';
import { ExecutionContext } from '../context/ExecutionContext';

/**
 * Executes individual test steps by matching them to step definitions
 */
export class StepExecutor {
    private stepRegistry: StepRegistry;
    private stepMatcher: StepMatcher;
    // private parameterTypeRegistry: ParameterTypeRegistry;
    private debugManager: DebugManager;
    private screenshotManager: ScreenshotManager;
    private currentContext!: ExecutionContext;

    constructor() {
        this.stepRegistry = StepRegistry.getInstance();
        this.stepMatcher = StepMatcher.getInstance();
        // this.parameterTypeRegistry = ParameterTypeRegistry.getInstance();
        this.debugManager = DebugManager.getInstance();
        this.screenshotManager = ScreenshotManager.getInstance();
    }

    /**
     * Execute a single step
     */
    public async execute(step: Step, context: ExecutionContext): Promise<StepResult> {
        this.currentContext = context;
        
        const startTime = Date.now();
        
        const result: StepResult = {
            id: `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            keyword: step.keyword,
            text: step.text,
            status: StepStatus.PENDING,
            duration: 0,
            startTime: new Date(),
            endTime: new Date()
        };

        try {
            // Log step start
            ActionLogger.logStepStart(step.keyword, step.text);

            // Check for debug breakpoint
            await this.checkDebugBreakpoint(step);

            // Find matching step definition
            const stepDefinition = await this.findStepDefinition(step);
            
            if (!stepDefinition) {
                throw new Error(`No step definition found for: ${step.keyword} ${step.text}`);
            }

            // Extract parameters
            const parameters = this.extractParameters(step, stepDefinition);

            // Prepare arguments
            const stepArgument = step.dataTable || step.docString || undefined;
            const args = await this.prepareArguments(parameters, stepArgument, context);

            // Execute step definition
            await this.executeStepDefinition(stepDefinition, args, context);

            // Mark as passed
            result.status = StepStatus.PASSED;
            result.endTime = new Date();

            // Take screenshot if configured
            if (this.shouldTakeScreenshot('passed')) {
                const screenshot = await this.takeScreenshot('passed');
                if (!result.attachments) {
                    result.attachments = [];
                }
                result.attachments.push(screenshot);
            }

        } catch (error) {
            // Handle different error types
            result.status = this.determineErrorStatus(error);
            result.error = this.formatError(error);
            result.endTime = new Date();

            // Log error
            ActionLogger.logError(`Step failed: ${step.keyword} ${step.text}`, error as Error);

            // Take failure screenshot
            if (this.shouldTakeScreenshot('failed')) {
                try {
                    const screenshot = await this.takeScreenshot('failed');
                    if (!result.attachments) {
                        result.attachments = [];
                    }
                    result.attachments.push(screenshot);
                } catch (screenshotError) {
                    ActionLogger.logError('Failed to take screenshot', screenshotError as Error);
                }
            }

            // Handle debug mode
            if (this.debugManager.isDebugMode() && result.status === StepStatus.FAILED) {
                await this.debugManager.pauseNow();
            }

        } finally {
            // Calculate duration
            result.duration = Date.now() - startTime;

            // Log step completion
            ActionLogger.logInfo(`Step completed: ${step.keyword} ${step.text}`, 
                `Status: ${result.status}, Duration: ${result.duration}ms`);

            // Update context with step result
            context.setMetadata('lastStepResult', result);
        }

        return result;
    }

    /**
     * Find matching step definition
     */
    private async findStepDefinition(step: Step): Promise<StepDefinition | null> {
        const stepText = `${step.keyword} ${step.text}`.trim();
        
        // Try to find matching step definition
        let definition = this.stepRegistry.findStepDefinition(stepText);

        // Try keyword variations
        if (!definition && this.canUseAlternativeKeywords(step.keyword)) {
            const alternatives = this.getAlternativeKeywords(step.keyword);
            for (const alt of alternatives) {
                const altText = `${alt} ${step.text}`.trim();
                definition = this.stepRegistry.findStepDefinition(altText);
                if (definition) break;
            }
        }

        // Log if no definition found
        if (!definition) {
            ActionLogger.logWarn(`No step definition found for: ${stepText}`);
        }

        return definition;
    }

    /**
     * Extract parameters from step text
     */
    private extractParameters(step: Step, _definition: StepDefinition): any[] {
        const stepText = `${step.keyword} ${step.text}`.trim();
        const match = this.stepMatcher.match(stepText);
        
        if (!match) {
            throw new Error('Step text does not match pattern');
        }

        // Extract and transform parameters
        const rawParams = match.parameters || [];
        const transformedParams = rawParams.map((param) => {
            return this.autoTransformParameter(param);
        });

        return transformedParams;
    }

    /**
     * Prepare arguments for step execution
     */
    private async prepareArguments(
        parameters: any[], 
        stepArgument: DataTable | DocString | undefined,
        context: ExecutionContext
    ): Promise<any[]> {
        const args = [...parameters];

        // Add step argument if present
        if (stepArgument) {
            if ('rows' in stepArgument) {
                args.push(this.transformDataTable(stepArgument as DataTable));
            } else if ('content' in stepArgument) {
                args.push(this.transformDocString(stepArgument as DocString));
            }
        }

        // Add context as last parameter if step expects it
        // This is determined by the step definition's expectsContext flag
        if (this.stepExpectsContext(parameters.length, stepArgument)) {
            args.push(context);
        }

        return args;
    }

    /**
     * Execute step definition function
     */
    private async executeStepDefinition(
        definition: StepDefinition,
        args: any[],
        context: ExecutionContext
    ): Promise<void> {
        // Set timeout for step execution
        const timeout = definition.timeout || ConfigurationManager.getInt('STEP_TIMEOUT', 30000);
        
        // Create timeout promise
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Step timeout after ${timeout}ms`)), timeout);
        });

        try {
            // Execute with timeout
            await Promise.race([
                this.executeWithContext(definition, args, context),
                timeoutPromise
            ]);
        } catch (error) {
            // Enhance error with step information
            const err = error as Error;
            if (err.message && err.message.includes('Step timeout')) {
                err.message = `${err.message}\nStep: ${definition.patternString}`;
            }
            throw err;
        }
    }

    /**
     * Execute step with proper context binding
     */
    private async executeWithContext(
        definition: StepDefinition,
        args: any[],
        _context: ExecutionContext
    ): Promise<void> {
        // Bind the step function to the correct context
        const boundFunction = definition.implementation.bind(null);
        
        // Execute the step
        await boundFunction(...args);
    }

    /**
     * Transform DataTable argument
     */
    private transformDataTable(dataTable: DataTable): any {
        // Return different representations based on step needs
        return {
            raw: () => dataTable.rows,
            rows: () => dataTable.rows.slice(1), // Without header
            hashes: () => this.dataTableToHashes(dataTable),
            rowsHash: () => this.dataTableToRowsHash(dataTable),
            transpose: () => this.transposeDataTable(dataTable)
        };
    }

    /**
     * Transform DocString argument
     */
    private transformDocString(docString: DocString): string {
        return docString.content;
    }

    /**
     * Convert DataTable to array of objects
     */
    private dataTableToHashes(dataTable: DataTable): any[] {
        if (dataTable.rows.length < 2) return [];
        
        const headers = dataTable.rows[0];
        if (!headers) return [];
        const hashes: any[] = [];
        
        for (let i = 1; i < dataTable.rows.length; i++) {
            const hash: any = {};
            const row = dataTable.rows[i];
            
            headers.forEach((header, index) => {
                if (header !== undefined && row && row[index] !== undefined) {
                    hash[header] = row[index];
                }
            });
            
            hashes.push(hash);
        }
        
        return hashes;
    }

    /**
     * Convert DataTable to key-value pairs
     */
    private dataTableToRowsHash(dataTable: DataTable): Record<string, string> {
        const hash: Record<string, string> = {};
        
        dataTable.rows.forEach(row => {
            if (row && row.length >= 2 && row[0] !== undefined && row[1] !== undefined) {
                hash[row[0]] = row[1];
            }
        });
        
        return hash;
    }

    /**
     * Transpose DataTable
     */
    private transposeDataTable(dataTable: DataTable): string[][] {
        if (dataTable.rows.length === 0) return [];
        
        const transposed: string[][] = [];
        const rowCount = dataTable.rows.length;
        const colCount = Math.max(...dataTable.rows.map(row => row.length));
        
        for (let col = 0; col < colCount; col++) {
            const newRow: string[] = [];
            for (let row = 0; row < rowCount; row++) {
                const value = dataTable.rows[row]?.[col];
                newRow.push(value ?? '');
            }
            transposed.push(newRow);
        }
        
        return transposed;
    }

    /**
     * Auto-transform parameter based on value
     */
    private autoTransformParameter(value: string): any {
        // Try to parse as number
        if (/^\d+$/.test(value)) {
            return parseInt(value, 10);
        }
        
        if (/^\d+\.\d+$/.test(value)) {
            return parseFloat(value);
        }
        
        // Try to parse as boolean
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
        
        // Try to parse as null/undefined
        if (value.toLowerCase() === 'null') return null;
        if (value.toLowerCase() === 'undefined') return undefined;
        
        // Try to parse as JSON
        if (value.startsWith('{') || value.startsWith('[')) {
            try {
                return JSON.parse(value);
            } catch (e) {
                // Not valid JSON, return as string
            }
        }
        
        // Remove quotes if present
        if (value.startsWith('"') && value.endsWith('"')) {
            return value.slice(1, -1);
        }
        
        if (value.startsWith("'") && value.endsWith("'")) {
            return value.slice(1, -1);
        }
        
        return value;
    }

    /**
     * Check if we can use alternative keywords
     */
    private canUseAlternativeKeywords(keyword: string): boolean {
        return ['And', 'But', '*'].includes(keyword);
    }

    /**
     * Get alternative keywords to try
     */
    private getAlternativeKeywords(keyword: string): string[] {
        if (keyword === 'And' || keyword === 'But' || keyword === '*') {
            return ['Given', 'When', 'Then'];
        }
        return [];
    }

    /**
     * Determine if step expects context parameter
     */
    private stepExpectsContext(paramCount: number, stepArgument: DataTable | DocString | undefined): boolean {
        // This is a heuristic - in real implementation, step definitions
        // would declare if they expect context
        const expectedParams = paramCount + (stepArgument ? 1 : 0);
        return expectedParams < 3; // Assume steps with few params might want context
    }

    /**
     * Check for debug breakpoint
     */
    private async checkDebugBreakpoint(step: Step): Promise<void> {
        if (!this.debugManager.isDebugMode()) return;

        const stepText = `${step.keyword} ${step.text}`;
        await this.debugManager.checkStepBreakpoint(stepText, this.currentContext);
    }

    /**
     * Determine error status based on error type
     */
    private determineErrorStatus(error: any): StepStatus {
        if (error.pending || error.constructor?.name === 'PendingError') {
            return StepStatus.PENDING;
        }
        if (error.skipped || error.constructor?.name === 'SkippedError') {
            return StepStatus.SKIPPED;
        }
        return StepStatus.FAILED;
    }

    /**
     * Format error for reporting
     */
    private formatError(error: any): ExecutionError {
        const err = error as Error;
        return {
            type: 'execution',
            message: err.message || String(error),
            stack: err.stack || '',
            context: {},
            timestamp: new Date()
        };
    }

    /**
     * Check if screenshot should be taken
     */
    private shouldTakeScreenshot(status: string): boolean {
        if (status === 'failed') {
            return ConfigurationManager.getBoolean('SCREENSHOT_ON_FAILURE', true);
        }
        if (status === 'passed') {
            return ConfigurationManager.getBoolean('SCREENSHOT_ON_PASS', false);
        }
        return false;
    }

    /**
     * Take screenshot
     */
    private async takeScreenshot(status: string): Promise<Attachment> {
        try {
            const page = this.currentContext.getPage();
            if (!page) {
                throw new Error('No page available for screenshot');
            }
            
            const screenshotPath = await this.screenshotManager.takeScreenshot(
                page,
                {
                    type: 'png',
                    fullPage: status === 'failed'
                }
            );

            return {
                data: screenshotPath,
                mimeType: 'image/png',
                name: `Screenshot - ${status}`
            };
        } catch (error) {
            ActionLogger.logError('Screenshot failed', error as Error);
            throw error;
        }
    }
}

