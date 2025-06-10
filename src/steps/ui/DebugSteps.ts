// src/steps/ui/DebugSteps.ts
import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { DebugManager } from '../../core/debugging/DebugManager';
import { ScreenshotManager } from '../../core/debugging/ScreenshotManager';
import { TraceRecorder } from '../../core/debugging/TraceRecorder';
import { VideoRecorder } from '../../core/debugging/VideoRecorder';
import { ConsoleLogger } from '../../core/debugging/ConsoleLogger';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';
import { CSWebElement } from '../../core/elements/CSWebElement';
import { CSGetElementOptions } from '../../core/elements/types/element.types';

export class DebugSteps extends CSBDDBaseStepDefinition {
    private debugManager: DebugManager;
    private screenshotManager: ScreenshotManager;
    private traceRecorder: TraceRecorder;
    private videoRecorder: VideoRecorder;
    private consoleLogger: ConsoleLogger;

    constructor() {
        super();
        this.debugManager = new DebugManager();
        this.screenshotManager = new ScreenshotManager();
        this.traceRecorder = new TraceRecorder();
        this.videoRecorder = new VideoRecorder();
        this.consoleLogger = new ConsoleLogger();
    }

    @CSBDDStepDef('user pauses execution')
    @CSBDDStepDef('I pause')
    @CSBDDStepDef('debug pause')
    async pauseExecution(): Promise<void> {
        ActionLogger.logStep('Pause execution for debugging');
        
        try {
            await this.debugManager.pauseNow();
            
            ActionLogger.logSuccess('Execution resumed after pause');
        } catch (error) {
            ActionLogger.logError('Pause execution failed', error as Error);
            throw new Error(`Failed to pause execution: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user pauses for {int} seconds')
    @CSBDDStepDef('I wait for {int} seconds')
    @CSBDDStepDef('pause for {int} seconds')
    async pauseForSeconds(seconds: number): Promise<void> {
        ActionLogger.logStep('Pause for seconds', { seconds });
        
        try {
            await this.page.waitForTimeout(seconds * 1000);
            
            ActionLogger.logSuccess('Pause completed', { seconds });
        } catch (error) {
            ActionLogger.logError('Pause for seconds failed', error as Error);
            throw new Error(`Failed to pause for ${seconds} seconds: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user takes screenshot')
    @CSBDDStepDef('I take a screenshot')
    @CSBDDStepDef('capture screenshot')
    async takeScreenshot(): Promise<void> {
        ActionLogger.logStep('Take screenshot');
        
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const name = `debug-screenshot-${timestamp}`;
            
            await this.debugManager.takeDebugScreenshot(name);
            
            ActionLogger.logSuccess('Screenshot taken', { name });
        } catch (error) {
            ActionLogger.logError('Take screenshot failed', error as Error);
            throw new Error(`Failed to take screenshot: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user takes screenshot named {string}')
    @CSBDDStepDef('I take a screenshot called {string}')
    async takeNamedScreenshot(name: string): Promise<void> {
        ActionLogger.logStep('Take named screenshot', { name });
        
        try {
            await this.debugManager.takeDebugScreenshot(name);
            
            ActionLogger.logSuccess('Screenshot taken', { name });
        } catch (error) {
            ActionLogger.logError('Take named screenshot failed', error as Error);
            throw new Error(`Failed to take screenshot "${name}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user takes full page screenshot')
    @CSBDDStepDef('I capture full page screenshot')
    async takeFullPageScreenshot(): Promise<void> {
        ActionLogger.logStep('Take full page screenshot');
        
        try {
            const screenshot = await this.screenshotManager.takeFullPageScreenshot(this.page);
            
            // Save screenshot
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const path = `${ConfigurationManager.get('SCREENSHOT_PATH', './screenshots')}/full-page-${timestamp}.png`;
            
            const fs = require('fs').promises;
            await fs.writeFile(path, screenshot);
            
            ActionLogger.logSuccess('Full page screenshot taken', { path });
        } catch (error) {
            ActionLogger.logError('Take full page screenshot failed', error as Error);
            throw new Error(`Failed to take full page screenshot: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user takes screenshot of {string}')
    @CSBDDStepDef('I capture screenshot of {string}')
    async takeElementScreenshot(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Take element screenshot', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            const screenshot = await this.screenshotManager.takeElementScreenshot(element);
            
            // Save screenshot
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const sanitizedName = elementDescription.replace(/[^a-zA-Z0-9]/g, '-');
            const path = `${ConfigurationManager.get('SCREENSHOT_PATH', './screenshots')}/element-${sanitizedName}-${timestamp}.png`;
            
            const fs = require('fs').promises;
            await fs.writeFile(path, screenshot);
            
            ActionLogger.logSuccess('Element screenshot taken', { 
                element: elementDescription,
                path 
            });
        } catch (error) {
            ActionLogger.logError('Take element screenshot failed', error as Error);
            throw new Error(`Failed to take screenshot of "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user enables debug mode')
    @CSBDDStepDef('I enable debugging')
    @CSBDDStepDef('debug mode on')
    async enableDebugMode(): Promise<void> {
        ActionLogger.logStep('Enable debug mode');
        
        try {
            this.debugManager.enableDebugMode();
            
            // Also enable verbose logging
            ConfigurationManager.set('LOG_LEVEL', 'debug');
            ConfigurationManager.set('VERBOSE_LOGGING', 'true');
            
            ActionLogger.logSuccess('Debug mode enabled');
        } catch (error) {
            ActionLogger.logError('Enable debug mode failed', error as Error);
            throw new Error(`Failed to enable debug mode: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user sets breakpoint on next step')
    @CSBDDStepDef('I set a breakpoint')
    @CSBDDStepDef('break on next step')
    async setBreakpointOnNextStep(): Promise<void> {
        ActionLogger.logStep('Set breakpoint on next step');
        
        try {
            this.debugManager.pauseOnNextStep();
            
            ActionLogger.logSuccess('Breakpoint set for next step');
        } catch (error) {
            ActionLogger.logError('Set breakpoint failed', error as Error);
            throw new Error(`Failed to set breakpoint: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user sets breakpoint on step matching {string}')
    @CSBDDStepDef('I set breakpoint for steps containing {string}')
    async setBreakpointOnPattern(stepPattern: string): Promise<void> {
        ActionLogger.logStep('Set breakpoint on pattern', { pattern: stepPattern });
        
        try {
            this.debugManager.setBreakpoint(stepPattern);
            
            ActionLogger.logSuccess('Breakpoint set for pattern', { pattern: stepPattern });
        } catch (error) {
            ActionLogger.logError('Set breakpoint pattern failed', error as Error);
            throw new Error(`Failed to set breakpoint for pattern "${stepPattern}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user starts trace recording')
    @CSBDDStepDef('I start recording trace')
    async startTraceRecording(): Promise<void> {
        ActionLogger.logStep('Start trace recording');
        
        try {
            await this.traceRecorder.startTracing(this.page, {
                screenshots: true,
                snapshots: true,
                sources: true
            });
            
            ActionLogger.logSuccess('Trace recording started');
        } catch (error) {
            ActionLogger.logError('Start trace recording failed', error as Error);
            throw new Error(`Failed to start trace recording: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user stops trace recording')
    @CSBDDStepDef('I stop recording trace')
    async stopTraceRecording(): Promise<void> {
        ActionLogger.logStep('Stop trace recording');
        
        try {
            await this.traceRecorder.stopTracing();
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const tracePath = `${ConfigurationManager.get('TRACE_PATH', './traces')}/trace-${timestamp}.zip`;
            
            await this.traceRecorder.saveTrace(tracePath);
            
            ActionLogger.logSuccess('Trace recording stopped and saved', { path: tracePath });
        } catch (error) {
            ActionLogger.logError('Stop trace recording failed', error as Error);
            throw new Error(`Failed to stop trace recording: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user starts video recording')
    @CSBDDStepDef('I start recording video')
    async startVideoRecording(): Promise<void> {
        ActionLogger.logStep('Start video recording');
        
        try {
            await this.videoRecorder.startRecording(this.page, {
                size: { width: 1920, height: 1080 }
            });
            
            ActionLogger.logSuccess('Video recording started');
        } catch (error) {
            ActionLogger.logError('Start video recording failed', error as Error);
            throw new Error(`Failed to start video recording: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user stops video recording')
    @CSBDDStepDef('I stop recording video')
    async stopVideoRecording(): Promise<void> {
        ActionLogger.logStep('Stop video recording');
        
        try {
            const videoPath = await this.videoRecorder.stopRecording();
            
            ActionLogger.logSuccess('Video recording stopped', { path: videoPath });
        } catch (error) {
            ActionLogger.logError('Stop video recording failed', error as Error);
            throw new Error(`Failed to stop video recording: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user captures console logs')
    @CSBDDStepDef('I start capturing browser console')
    async startConsoleCapture(): Promise<void> {
        ActionLogger.logStep('Start console capture');
        
        try {
            this.consoleLogger.startCapture(this.page);
            
            ActionLogger.logSuccess('Console capture started');
        } catch (error) {
            ActionLogger.logError('Start console capture failed', error as Error);
            throw new Error(`Failed to start console capture: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user prints console logs')
    @CSBDDStepDef('I display browser console logs')
    async printConsoleLogs(): Promise<void> {
        ActionLogger.logStep('Print console logs');
        
        try {
            const logs = this.consoleLogger.getConsoleLogs();
            
            if (logs.length === 0) {
                ActionLogger.logInfo('No console logs captured');
                return;
            }
            
            const logOutput = logs.map(log => 
                `[${log.type}] ${log.timestamp}: ${log.text}`
            ).join('\n');
            
            ActionLogger.logInfo('Console logs:\n' + logOutput);
            
            ActionLogger.logSuccess('Console logs printed', { count: logs.length });
        } catch (error) {
            ActionLogger.logError('Print console logs failed', error as Error);
            throw new Error(`Failed to print console logs: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user highlights {string}')
    @CSBDDStepDef('I highlight element {string}')
    async highlightElement(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Highlight element', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            
            // Inject highlighting style
            await this.page.evaluate((el) => {
                const elem = el as HTMLElement;
                elem.style.border = '3px solid red';
                elem.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                elem.style.transition = 'all 0.3s';
                
                // Remove highlighting after 3 seconds
                setTimeout(() => {
                    elem.style.border = '';
                    elem.style.backgroundColor = '';
                }, 3000);
            }, await element.elementHandle());
            
            ActionLogger.logSuccess('Element highlighted', { element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Highlight element failed', error as Error);
            throw new Error(`Failed to highlight "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user captures page state')
    @CSBDDStepDef('I capture current page state')
    async capturePageState(): Promise<void> {
        ActionLogger.logStep('Capture page state');
        
        try {
            const pageState = await this.debugManager.capturePageState(this.page);
            
            // Store for later use
            this.context.set('capturedPageState', pageState);
            
            ActionLogger.logSuccess('Page state captured', {
                url: pageState.url,
                title: pageState.title,
                timestamp: pageState.timestamp
            });
        } catch (error) {
            ActionLogger.logError('Capture page state failed', error as Error);
            throw new Error(`Failed to capture page state: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user prints page metrics')
    @CSBDDStepDef('I display page performance metrics')
    async printPageMetrics(): Promise<void> {
        ActionLogger.logStep('Print page metrics');
        
        try {
            const metrics = await this.page.evaluate(() => {
                const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
                
                return {
                    domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
                    loadComplete: navigation.loadEventEnd - navigation.loadEventStart,
                    domInteractive: navigation.domInteractive - navigation.fetchStart,
                    responseTime: navigation.responseEnd - navigation.requestStart,
                    renderTime: navigation.domComplete - navigation.domLoading
                };
            });
            
            ActionLogger.logInfo('Page Performance Metrics:\n' + 
                `DOM Content Loaded: ${metrics.domContentLoaded}ms\n` +
                `Page Load Complete: ${metrics.loadComplete}ms\n` +
                `DOM Interactive: ${metrics.domInteractive}ms\n` +
                `Response Time: ${metrics.responseTime}ms\n` +
                `Render Time: ${metrics.renderTime}ms`
            );
            
            ActionLogger.logSuccess('Page metrics printed');
        } catch (error) {
            ActionLogger.logError('Print page metrics failed', error as Error);
            throw new Error(`Failed to print page metrics: ${(error as Error).message}`);
        }
    }

    private async findElement(description: string): Promise<CSWebElement> {
        const storedElement = this.context.get<CSWebElement>(`element_${description}`);
        if (storedElement) {
            return storedElement;
        }

        const options: CSGetElementOptions = {
            description,
            locatorType: 'text',
            locatorValue: description,
            aiEnabled: ConfigurationManager.getBoolean('AI_ENABLED', true),
            aiDescription: description,
            waitForVisible: ConfigurationManager.getBoolean('AUTO_WAIT_VISIBLE', true)
        };

        const element = new CSWebElement();
        element.page = this.page;
        element.options = options;
        element.description = description;

        return element;
    }
}