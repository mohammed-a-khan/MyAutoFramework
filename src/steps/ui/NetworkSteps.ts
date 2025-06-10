// src/steps/ui/NetworkSteps.ts
import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { NetworkInterceptor } from '../../core/network/NetworkInterceptor';
import { RequestMocker } from '../../core/network/RequestMocker';
import { ResponseModifier } from '../../core/network/ResponseModifier';
import { HARRecorder } from '../../core/network/HARRecorder';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';
import { MockResponse, URLPattern } from '../../core/network/types/network.types';
import { DataTable } from '../../bdd/types/bdd.types';

export class NetworkSteps extends CSBDDBaseStepDefinition {
    private networkInterceptor: NetworkInterceptor;
    private requestMocker: RequestMocker;
    private responseModifier: ResponseModifier;
    private harRecorder: HARRecorder;

    constructor() {
        super();
        this.networkInterceptor = new NetworkInterceptor();
        this.requestMocker = new RequestMocker();
        this.responseModifier = new ResponseModifier();
        this.harRecorder = new HARRecorder();
    }

    @CSBDDStepDef('user mocks {string} endpoint with response:')
    @CSBDDStepDef('I mock {string} with response:')
    async mockEndpointWithResponse(endpoint: string, docString: string): Promise<void> {
        ActionLogger.logStep('Mock endpoint', { endpoint });
        
        try {
            let responseData: any;
            
            // Try to parse as JSON
            try {
                responseData = JSON.parse(docString);
            } catch {
                // If not JSON, use as plain text
                responseData = docString;
            }
            
            const mockResponse: MockResponse = {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: responseData
            };
            
            await this.requestMocker.mockEndpoint(this.resolveEndpoint(endpoint), mockResponse);
            
            ActionLogger.logSuccess('Endpoint mocked', { 
                endpoint,
                responseType: typeof responseData 
            });
        } catch (error) {
            ActionLogger.logError('Mock endpoint failed', error as Error);
            throw new Error(`Failed to mock endpoint "${endpoint}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user mocks {string} endpoint with status {int}')
    @CSBDDStepDef('I mock {string} to return status {int}')
    async mockEndpointWithStatus(endpoint: string, statusCode: number): Promise<void> {
        ActionLogger.logStep('Mock endpoint with status', { endpoint, statusCode });
        
        try {
            const mockResponse: MockResponse = {
                status: statusCode,
                statusText: this.getStatusText(statusCode),
                body: ''
            };
            
            await this.requestMocker.mockEndpoint(this.resolveEndpoint(endpoint), mockResponse);
            
            ActionLogger.logSuccess('Endpoint mocked with status', { endpoint, statusCode });
        } catch (error) {
            ActionLogger.logError('Mock endpoint with status failed', error as Error);
            throw new Error(`Failed to mock endpoint "${endpoint}" with status ${statusCode}: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user mocks {string} endpoint from file {string}')
    @CSBDDStepDef('I mock {string} with response from {string}')
    async mockEndpointFromFile(endpoint: string, filePath: string): Promise<void> {
        ActionLogger.logStep('Mock endpoint from file', { endpoint, filePath });
        
        try {
            const resolvedPath = this.resolveFilePath(filePath);
            await this.requestMocker.mockFromFile(this.resolveEndpoint(endpoint), resolvedPath);
            
            ActionLogger.logSuccess('Endpoint mocked from file', { endpoint, filePath: resolvedPath });
        } catch (error) {
            ActionLogger.logError('Mock endpoint from file failed', error as Error);
            throw new Error(`Failed to mock endpoint "${endpoint}" from file: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user intercepts {string} requests')
    @CSBDDStepDef('I intercept requests to {string}')
    async interceptRequests(pattern: string): Promise<void> {
        ActionLogger.logStep('Intercept requests', { pattern });
        
        try {
            const urlPattern: URLPattern = { url: pattern };
            
            await this.networkInterceptor.recordRequests(urlPattern);
            
            ActionLogger.logSuccess('Request interception started', { pattern });
        } catch (error) {
            ActionLogger.logError('Intercept requests failed', error as Error);
            throw new Error(`Failed to intercept requests to "${pattern}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user blocks {string} requests')
    @CSBDDStepDef('I block requests to {string}')
    async blockRequests(pattern: string): Promise<void> {
        ActionLogger.logStep('Block requests', { pattern });
        
        try {
            const urlPattern: URLPattern = { url: pattern };
            
            await this.networkInterceptor.abortRequests(urlPattern);
            
            ActionLogger.logSuccess('Requests blocked', { pattern });
        } catch (error) {
            ActionLogger.logError('Block requests failed', error as Error);
            throw new Error(`Failed to block requests to "${pattern}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user delays {string} requests by {int} milliseconds')
    @CSBDDStepDef('I delay requests to {string} by {int} ms')
    async delayRequests(pattern: string, delay: number): Promise<void> {
        ActionLogger.logStep('Delay requests', { pattern, delay });
        
        try {
            const urlPattern: URLPattern = { url: pattern };
            
            await this.networkInterceptor.delayRequests(urlPattern, delay);
            
            ActionLogger.logSuccess('Request delay configured', { pattern, delay });
        } catch (error) {
            ActionLogger.logError('Delay requests failed', error as Error);
            throw new Error(`Failed to delay requests to "${pattern}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user throttles {string} requests to {int} kbps')
    @CSBDDStepDef('I throttle bandwidth for {string} to {int} kbps')
    async throttleRequests(pattern: string, bandwidth: number): Promise<void> {
        ActionLogger.logStep('Throttle requests', { pattern, bandwidth });
        
        try {
            const urlPattern: URLPattern = { url: pattern };
            
            await this.networkInterceptor.throttleRequests(urlPattern, bandwidth);
            
            ActionLogger.logSuccess('Request throttling configured', { pattern, bandwidth });
        } catch (error) {
            ActionLogger.logError('Throttle requests failed', error as Error);
            throw new Error(`Failed to throttle requests to "${pattern}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user should see {int} requests to {string}')
    @CSBDDStepDef('there should be {int} requests to {string}')
    async assertRequestCount(expectedCount: number, pattern: string): Promise<void> {
        ActionLogger.logStep('Assert request count', { expectedCount, pattern });
        
        try {
            const recordedRequests = this.networkInterceptor.getRecordedRequests()
                .filter(req => req.url().includes(pattern));
            
            const actualCount = recordedRequests.length;
            
            if (actualCount !== expectedCount) {
                throw new Error(`Request count mismatch. Expected: ${expectedCount}, Actual: ${actualCount}`);
            }
            
            ActionLogger.logSuccess('Request count assertion passed', { 
                pattern,
                expectedCount,
                actualCount 
            });
        } catch (error) {
            ActionLogger.logError('Request count assertion failed', error as Error);
            throw error;
        }
    }

    @CSBDDStepDef('user verifies request to {string} contains header {string} with value {string}')
    @CSBDDStepDef('the request to {string} should have header {string} as {string}')
    async verifyRequestHeader(pattern: string, headerName: string, expectedValue: string): Promise<void> {
        ActionLogger.logStep('Verify request header', { pattern, headerName, expectedValue });
        
        try {
            const requests = this.networkInterceptor.getRecordedRequests()
                .filter(req => req.url().includes(pattern));
            
            if (requests.length === 0) {
                throw new Error(`No requests found matching pattern "${pattern}"`);
            }
            
            const request = requests[requests.length - 1]; // Get most recent
            const actualValue = request.headers()[headerName.toLowerCase()];
            
            if (actualValue !== expectedValue) {
                throw new Error(`Header value mismatch. Expected: "${expectedValue}", Actual: "${actualValue}"`);
            }
            
            ActionLogger.logSuccess('Request header verified', { 
                pattern,
                headerName,
                expectedValue 
            });
        } catch (error) {
            ActionLogger.logError('Request header verification failed', error as Error);
            throw error;
        }
    }

    @CSBDDStepDef('user starts recording network traffic')
    @CSBDDStepDef('I start HAR recording')
    async startHARRecording(): Promise<void> {
        ActionLogger.logStep('Start HAR recording');
        
        try {
            await this.harRecorder.startRecording(this.page, {
                content: ConfigurationManager.get('HAR_CONTENT_TYPE', 'embed') as any,
                maxSize: ConfigurationManager.getInt('HAR_MAX_SIZE', 50 * 1024 * 1024) // 50MB default
            });
            
            ActionLogger.logSuccess('HAR recording started');
        } catch (error) {
            ActionLogger.logError('Start HAR recording failed', error as Error);
            throw new Error(`Failed to start HAR recording: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user stops recording network traffic')
    @CSBDDStepDef('I stop HAR recording')
    async stopHARRecording(): Promise<void> {
        ActionLogger.logStep('Stop HAR recording');
        
        try {
            const har = await this.harRecorder.stopRecording();
            
            // Store HAR for later use
            this.context.set('lastHAR', har);
            
            ActionLogger.logSuccess('HAR recording stopped', {
                entryCount: har.log.entries.length
            });
        } catch (error) {
            ActionLogger.logError('Stop HAR recording failed', error as Error);
            throw new Error(`Failed to stop HAR recording: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user saves network recording to {string}')
    @CSBDDStepDef('I save HAR to {string}')
    async saveHAR(fileName: string): Promise<void> {
        ActionLogger.logStep('Save HAR file', { fileName });
        
        try {
            const harPath = this.resolveHARPath(fileName);
            await this.harRecorder.saveHAR(harPath);
            
            ActionLogger.logSuccess('HAR file saved', { path: harPath });
        } catch (error) {
            ActionLogger.logError('Save HAR failed', error as Error);
            throw new Error(`Failed to save HAR to "${fileName}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user analyzes network performance')
    @CSBDDStepDef('I analyze HAR performance')
    async analyzeNetworkPerformance(): Promise<void> {
        ActionLogger.logStep('Analyze network performance');
        
        try {
            const har = this.context.get('lastHAR');
            if (!har) {
                throw new Error('No HAR recording found. Please start and stop recording first.');
            }
            
            const analysis = this.harRecorder.analyzeHAR(har);
            const metrics = this.harRecorder.getPerformanceMetrics(har);
            
            // Store analysis results
            this.context.set('networkAnalysis', analysis);
            this.context.set('performanceMetrics', metrics);
            
            ActionLogger.logSuccess('Network performance analyzed', {
                totalRequests: analysis.summary.totalRequests,
                totalSize: `${(analysis.summary.totalSize / 1024 / 1024).toFixed(2)} MB`,
                avgResponseTime: `${analysis.summary.averageResponseTime.toFixed(2)} ms`,
                pageLoadTime: `${metrics.pageLoadTime.toFixed(2)} ms`
            });
        } catch (error) {
            ActionLogger.logError('Network analysis failed', error as Error);
            throw new Error(`Failed to analyze network performance: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user enables offline mode')
    @CSBDDStepDef('I go offline')
    async enableOfflineMode(): Promise<void> {
        ActionLogger.logStep('Enable offline mode');
        
        try {
            await this.networkInterceptor.enableOfflineMode();
            
            ActionLogger.logSuccess('Offline mode enabled');
        } catch (error) {
            ActionLogger.logError('Enable offline mode failed', error as Error);
            throw new Error(`Failed to enable offline mode: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user disables offline mode')
    @CSBDDStepDef('I go online')
    async disableOfflineMode(): Promise<void> {
        ActionLogger.logStep('Disable offline mode');
        
        try {
            await this.networkInterceptor.clearInterceptors();
            
            ActionLogger.logSuccess('Offline mode disabled');
        } catch (error) {
            ActionLogger.logError('Disable offline mode failed', error as Error);
            throw new Error(`Failed to disable offline mode: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user modifies response for {string} endpoint:')
    @CSBDDStepDef('I modify {string} response to:')
    async modifyResponse(endpoint: string, dataTable: DataTable): Promise<void> {
        ActionLogger.logStep('Modify response', { endpoint });
        
        try {
            const modifications = dataTable.hashes();
            const urlPattern: URLPattern = { url: this.resolveEndpoint(endpoint) };
            
            for (const mod of modifications) {
                if (mod.field && mod.value) {
                    await this.responseModifier.injectField(
                        urlPattern,
                        mod.field,
                        this.parseValue(mod.value)
                    );
                }
                
                if (mod.header && mod.headerValue) {
                    await this.responseModifier.injectHeader(
                        urlPattern,
                        mod.header,
                        mod.headerValue
                    );
                }
            }
            
            ActionLogger.logSuccess('Response modifications configured', { 
                endpoint,
                modificationCount: modifications.length 
            });
        } catch (error) {
            ActionLogger.logError('Modify response failed', error as Error);
            throw new Error(`Failed to modify response for "${endpoint}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user clears all network mocks')
    @CSBDDStepDef('I clear network mocks')
    async clearNetworkMocks(): Promise<void> {
        ActionLogger.logStep('Clear network mocks');
        
        try {
            await this.requestMocker.clearMocks();
            await this.networkInterceptor.clearInterceptors();
            await this.responseModifier.clearModifiers();
            
            ActionLogger.logSuccess('All network mocks cleared');
        } catch (error) {
            ActionLogger.logError('Clear network mocks failed', error as Error);
            throw new Error(`Failed to clear network mocks: ${(error as Error).message}`);
        }
    }

    private resolveEndpoint(endpoint: string): string {
        if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
            return endpoint;
        }
        
        const apiBaseUrl = ConfigurationManager.get('API_BASE_URL', '');
        if (apiBaseUrl && !endpoint.startsWith('/')) {
            return `${apiBaseUrl}/${endpoint}`;
        }
        
        return endpoint;
    }

    private getStatusText(statusCode: number): string {
        const statusTexts: Record<number, string> = {
            200: 'OK',
            201: 'Created',
            204: 'No Content',
            400: 'Bad Request',
            401: 'Unauthorized',
            403: 'Forbidden',
            404: 'Not Found',
            500: 'Internal Server Error',
            502: 'Bad Gateway',
            503: 'Service Unavailable'
        };
        
        return statusTexts[statusCode] || 'Unknown';
    }

    private resolveFilePath(filePath: string): string {
        const path = require('path');
        
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        
        const mockDataDir = ConfigurationManager.get('MOCK_DATA_DIR', './test-data/mocks');
        return path.resolve(mockDataDir, filePath);
    }

    private resolveHARPath(fileName: string): string {
        const path = require('path');
        const harDir = ConfigurationManager.get('HAR_OUTPUT_DIR', './reports/har');
        
        if (!fileName.endsWith('.har')) {
            fileName += '.har';
        }
        
        return path.resolve(harDir, fileName);
    }

    private parseValue(value: string): any {
        // Try to parse as JSON
        try {
            return JSON.parse(value);
        } catch {
            // Return as string if not JSON
            return value;
        }
    }
}