// src/core/network/NetworkInterceptor.ts
import { Page, Route, Request, APIResponse } from 'playwright';
import { 
  URLPattern, 
  RequestHandler, 
  ResponseHandler, 
  MockResponse,
  NetworkError,
  InterceptRule,
  RequestModification,
  NetworkThrottle,
  ResourceType
} from './types/network.types';
import { ActionLogger } from '../logging/ActionLogger';

export class NetworkInterceptor {
  private page: Page;
  private interceptRules: Map<string, InterceptRule> = new Map();
  private recordedRequests: Map<string, Request[]> = new Map();
  private recordedResponses: Map<string, APIResponse[]> = new Map();
  private activeRoutes: Set<string> = new Set();
  private requestCounter: Map<string, number> = new Map();
  private isOfflineMode: boolean = false;
  private throttleSettings: NetworkThrottle | null = null;
  private blockedPatterns: Set<string> = new Set();

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Intercept requests matching pattern
   */
  async interceptRequest(
    pattern: URLPattern,
    handler: RequestHandler
  ): Promise<void> {
    const patternKey = this.createPatternKey(pattern);
    
    try {
      ActionLogger.logInfo('interceptRequest', {
        pattern: patternKey,
        type: 'request'
      });

      const routeHandler = async (route: Route, request: Request) => {
        const url = request.url();
        
        // Check if matches pattern
        if (!this.matchesPattern(url, request, pattern)) {
          await route.continue();
          return;
        }

        // Log interception
        ActionLogger.logInfo('interceptRequest.matched', {
          url,
          method: request.method(),
          pattern: patternKey
        });

        try {
          // Execute handler
          await handler(route, request);
          
          // Track request
          this.trackRequest(patternKey, request);
        } catch (error) {
          ActionLogger.logError('NetworkInterceptor.interceptRequest.handler', error as Error);
          await route.abort('failed');
        }
      };

      // Register route
      await this.page.route('**/*', routeHandler);
      
      // Store rule
      this.interceptRules.set(patternKey, {
        pattern,
        type: 'request',
        handler: routeHandler,
        enabled: true,
        priority: pattern.priority || 0
      });

      this.activeRoutes.add(patternKey);

      ActionLogger.logInfo('interceptRequest.registered', {
        pattern: patternKey,
        rulesCount: this.interceptRules.size
      });
    } catch (error) {
      ActionLogger.logError('NetworkInterceptor.interceptRequest', error as Error);
      throw new Error(`Failed to intercept requests: ${(error as Error).message}`);
    }
  }

  /**
   * Intercept responses matching pattern
   */
  async interceptResponse(
    pattern: URLPattern,
    handler: ResponseHandler
  ): Promise<void> {
    const patternKey = this.createPatternKey(pattern);
    
    try {
      ActionLogger.logInfo('interceptResponse', {
        pattern: patternKey,
        type: 'response'
      });

      const routeHandler = async (route: Route, request: Request) => {
        const url = request.url();
        
        if (!this.matchesPattern(url, request, pattern)) {
          await route.continue();
          return;
        }

        ActionLogger.logInfo('interceptResponse.matched', {
          url,
          method: request.method(),
          pattern: patternKey
        });

        try {
          // Fetch the actual response first
          const response = await route.fetch();
          
          // Track response
          this.trackResponse(patternKey, response);
          
          // Execute handler with response
          await handler(route, response);
        } catch (error) {
          ActionLogger.logError('NetworkInterceptor.interceptResponse.handler', error as Error);
          await route.abort('failed');
        }
      };

      await this.page.route('**/*', routeHandler);
      
      this.interceptRules.set(patternKey, {
        pattern,
        type: 'response',
        handler: routeHandler,
        enabled: true,
        priority: pattern.priority || 0
      });

      this.activeRoutes.add(patternKey);

      ActionLogger.logInfo('interceptResponse.registered', {
        pattern: patternKey
      });
    } catch (error) {
      ActionLogger.logError('NetworkInterceptor.interceptResponse', error as Error);
      throw new Error(`Failed to intercept responses: ${(error as Error).message}`);
    }
  }

  /**
   * Mock response for matching requests
   */
  async mockResponse(
    pattern: URLPattern,
    response: MockResponse
  ): Promise<void> {
    const patternKey = this.createPatternKey(pattern);
    
    try {
      ActionLogger.logInfo('mockResponse', {
        pattern: patternKey,
        status: response.status || 200
      });

      await this.interceptRequest(pattern, async (route, request) => {
        const mockDelay = response.delay || 0;
        
        // Apply delay if specified
        if (mockDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, mockDelay));
        }

        // Build response
        const fulfillOptions: any = {
          status: response.status || 200,
          headers: {
            'Content-Type': response.contentType || 'application/json',
            ...response.headers
          }
        };

        // Set body based on type
        if (response.json !== undefined) {
          fulfillOptions.body = JSON.stringify(response.json);
        } else if (response.text !== undefined) {
          fulfillOptions.body = response.text;
        } else if (response.body !== undefined) {
          fulfillOptions.body = response.body;
        }

        // Add path if specified (file response)
        if (response.path) {
          fulfillOptions.path = response.path;
        }

        ActionLogger.logInfo('mockResponse.fulfilling', {
          url: request.url(),
          status: fulfillOptions.status,
          bodySize: fulfillOptions.body ? fulfillOptions.body.length : 0
        });

        await route.fulfill(fulfillOptions);
      });

      ActionLogger.logInfo('mockResponse.registered', {
        pattern: patternKey
      });
    } catch (error) {
      ActionLogger.logError('NetworkInterceptor.mockResponse', error as Error);
      throw new Error(`Failed to mock response: ${(error as Error).message}`);
    }
  }

  /**
   * Abort requests matching pattern
   */
  async abortRequests(
    pattern: URLPattern,
    errorCode: string = 'failed'
  ): Promise<void> {
    const patternKey = this.createPatternKey(pattern);
    
    try {
      ActionLogger.logInfo('abortRequests', {
        pattern: patternKey,
        errorCode
      });

      await this.interceptRequest(pattern, async (route, request) => {
        ActionLogger.logInfo('abortRequests.aborting', {
          url: request.url(),
          errorCode
        });

        await route.abort(errorCode);
      });

      this.blockedPatterns.add(patternKey);

      ActionLogger.logInfo('abortRequests.registered', {
        pattern: patternKey,
        blockedCount: this.blockedPatterns.size
      });
    } catch (error) {
      ActionLogger.logError('NetworkInterceptor.abortRequests', error as Error);
      throw new Error(`Failed to abort requests: ${(error as Error).message}`);
    }
  }

  /**
   * Delay requests matching pattern
   */
  async delayRequests(
    pattern: URLPattern,
    delay: number
  ): Promise<void> {
    const patternKey = this.createPatternKey(pattern);
    
    try {
      ActionLogger.logInfo('delayRequests', {
        pattern: patternKey,
        delay
      });

      await this.interceptRequest(pattern, async (route, request) => {
        ActionLogger.logInfo('delayRequests.delaying', {
          url: request.url(),
          delay
        });

        await new Promise(resolve => setTimeout(resolve, delay));
        await route.continue();
      });

      ActionLogger.logInfo('delayRequests.registered', {
        pattern: patternKey,
        delayMs: delay
      });
    } catch (error) {
      ActionLogger.logError('NetworkInterceptor.delayRequests', error as Error);
      throw new Error(`Failed to delay requests: ${(error as Error).message}`);
    }
  }

  /**
   * Throttle network speed
   */
  async throttleRequests(
    pattern: URLPattern,
    bandwidth: number
  ): Promise<void> {
    const patternKey = this.createPatternKey(pattern);
    
    try {
      ActionLogger.logInfo('throttleRequests', {
        pattern: patternKey,
        bandwidth
      });

      // Calculate delays based on bandwidth
      const bytesPerMs = bandwidth / 8000; // Convert from kbps to bytes/ms

      await this.interceptResponse(pattern, async (route, response) => {
        const body = await response.body();
        const size = body.length;
        const delay = Math.ceil(size / bytesPerMs);

        ActionLogger.logInfo('throttleRequests.throttling', {
          url: response.url(),
          size,
          delay,
          bandwidth
        });

        // Simulate download time
        await new Promise(resolve => setTimeout(resolve, delay));

        await route.fulfill({
          status: response.status(),
          headers: response.headers(),
          body
        });
      });

      this.throttleSettings = {
        downloadSpeed: bandwidth,
        uploadSpeed: bandwidth,
        latency: 0
      };

      ActionLogger.logInfo('throttleRequests.registered', {
        pattern: patternKey,
        bandwidthKbps: bandwidth
      });
    } catch (error) {
      ActionLogger.logError('NetworkInterceptor.throttleRequests', error as Error);
      throw new Error(`Failed to throttle requests: ${(error as Error).message}`);
    }
  }

  /**
   * Record requests matching pattern
   */
  async recordRequests(pattern: URLPattern): Promise<void> {
    const patternKey = this.createPatternKey(pattern);
    
    try {
      ActionLogger.logInfo('recordRequests', {
        pattern: patternKey
      });

      await this.interceptRequest(pattern, async (route, request) => {
        this.trackRequest(patternKey, request);
        
        ActionLogger.logInfo('recordRequests.recorded', {
          url: request.url(),
          method: request.method(),
          pattern: patternKey
        });

        await route.continue();
      });

      ActionLogger.logInfo('recordRequests.registered', {
        pattern: patternKey
      });
    } catch (error) {
      ActionLogger.logError('NetworkInterceptor.recordRequests', error as Error);
      throw new Error(`Failed to record requests: ${(error as Error).message}`);
    }
  }

  /**
   * Modify request before sending
   */
  async modifyRequest(
    pattern: URLPattern,
    modifications: RequestModification
  ): Promise<void> {
    const patternKey = this.createPatternKey(pattern);
    
    try {
      ActionLogger.logInfo('modifyRequest', {
        pattern: patternKey,
        modifications: Object.keys(modifications)
      });

      await this.interceptRequest(pattern, async (route, request) => {
        const options: any = {};

        // Apply URL modification
        if (modifications.url) {
          options.url = typeof modifications.url === 'function' 
            ? modifications.url(request.url()) 
            : modifications.url;
        }

        // Apply method modification
        if (modifications.method) {
          options.method = modifications.method;
        }

        // Apply header modifications
        if (modifications.headers) {
          const currentHeaders = request.headers();
          options.headers = typeof modifications.headers === 'function'
            ? modifications.headers(currentHeaders)
            : { ...currentHeaders, ...modifications.headers };
        }

        // Apply post data modification
        if (modifications.postData) {
          const currentData = request.postData();
          options.postData = typeof modifications.postData === 'function'
            ? modifications.postData(currentData)
            : modifications.postData;
        }

        ActionLogger.logInfo('modifyRequest.modified', {
          url: request.url(),
          modifications: Object.keys(options)
        });

        await route.continue(options);
      });

      ActionLogger.logInfo('modifyRequest.registered', {
        pattern: patternKey
      });
    } catch (error) {
      ActionLogger.logError('NetworkInterceptor.modifyRequest', error as Error);
      throw new Error(`Failed to modify request: ${(error as Error).message}`);
    }
  }

  /**
   * Get recorded requests
   */
  getRecordedRequests(pattern?: string): Request[] {
    if (!pattern) {
      // Return all recorded requests
      const allRequests: Request[] = [];
      this.recordedRequests.forEach(requests => {
        allRequests.push(...requests);
      });
      return allRequests;
    }

    return this.recordedRequests.get(pattern) || [];
  }

  /**
   * Get recorded responses
   */
  getRecordedResponses(pattern?: string): APIResponse[] {
    if (!pattern) {
      const allResponses: APIResponse[] = [];
      this.recordedResponses.forEach(responses => {
        allResponses.push(...responses);
      });
      return allResponses;
    }

    return this.recordedResponses.get(pattern) || [];
  }

  /**
   * Get request count for pattern
   */
  getRequestCount(pattern: string): number {
    return this.requestCounter.get(pattern) || 0;
  }

  /**
   * Clear all interceptors
   */
  async clearInterceptors(): Promise<void> {
    try {
      ActionLogger.logInfo('clearInterceptors', {
        count: this.interceptRules.size
      });

      // Unroute all patterns
      await this.page.unroute('**/*');

      // Clear all data
      this.interceptRules.clear();
      this.recordedRequests.clear();
      this.recordedResponses.clear();
      this.activeRoutes.clear();
      this.requestCounter.clear();
      this.blockedPatterns.clear();
      this.isOfflineMode = false;
      this.throttleSettings = null;

      ActionLogger.logInfo('clearInterceptors.complete');
    } catch (error) {
      ActionLogger.logError('NetworkInterceptor.clearInterceptors', error as Error);
      throw new Error(`Failed to clear interceptors: ${(error as Error).message}`);
    }
  }

  /**
   * Enable offline mode
   */
  async enableOfflineMode(): Promise<void> {
    try {
      ActionLogger.logInfo('enableOfflineMode');

      // Set context to offline
      await this.page.context().setOffline(true);
      
      this.isOfflineMode = true;

      ActionLogger.logInfo('enableOfflineMode.enabled');
    } catch (error) {
      ActionLogger.logError('NetworkInterceptor.enableOfflineMode', error as Error);
      throw new Error(`Failed to enable offline mode: ${(error as Error).message}`);
    }
  }

  /**
   * Disable offline mode
   */
  async disableOfflineMode(): Promise<void> {
    try {
      ActionLogger.logInfo('disableOfflineMode');

      await this.page.context().setOffline(false);
      
      this.isOfflineMode = false;

      ActionLogger.logInfo('disableOfflineMode.disabled');
    } catch (error) {
      ActionLogger.logError('NetworkInterceptor.disableOfflineMode', error as Error);
      throw new Error(`Failed to disable offline mode: ${(error as Error).message}`);
    }
  }

  /**
   * Simulate network error
   */
  async simulateNetworkError(
    pattern: URLPattern,
    error: NetworkError
  ): Promise<void> {
    const patternKey = this.createPatternKey(pattern);
    
    try {
      ActionLogger.logInfo('simulateNetworkError', {
        pattern: patternKey,
        errorType: error.type
      });

      await this.interceptRequest(pattern, async (route, request) => {
        ActionLogger.logInfo('simulateNetworkError.simulating', {
          url: request.url(),
          error: error.type
        });

        // Map error types to Playwright error codes
        const errorCodeMap: Record<string, string> = {
          'abort': 'aborted',
          'timeout': 'timedout',
          'failure': 'failed',
          'dns': 'failed',
          'connection': 'connectionrefused'
        };

        const errorCode = errorCodeMap[error.type] || 'failed';
        await route.abort(errorCode);
      });

      ActionLogger.logInfo('simulateNetworkError.registered', {
        pattern: patternKey,
        errorType: error.type
      });
    } catch (error) {
      ActionLogger.logError('NetworkInterceptor.simulateNetworkError', error as Error);
      throw new Error(`Failed to simulate network error: ${(error as Error).message}`);
    }
  }

  /**
   * Get network statistics
   */
  getNetworkStats(): Record<string, any> {
    const totalRequests = Array.from(this.requestCounter.values())
      .reduce((sum, count) => sum + count, 0);

    const totalRecordedRequests = Array.from(this.recordedRequests.values())
      .reduce((sum, requests) => sum + requests.length, 0);

    const totalRecordedResponses = Array.from(this.recordedResponses.values())
      .reduce((sum, responses) => sum + responses.length, 0);

    return {
      totalRequests,
      totalRecordedRequests,
      totalRecordedResponses,
      activeInterceptors: this.interceptRules.size,
      activeRoutes: this.activeRoutes.size,
      blockedPatterns: this.blockedPatterns.size,
      isOfflineMode: this.isOfflineMode,
      throttleSettings: this.throttleSettings,
      requestsByPattern: Object.fromEntries(this.requestCounter)
    };
  }

  // Private helper methods

  private createPatternKey(pattern: URLPattern): string {
    if (typeof pattern.url === 'string') {
      return pattern.url;
    } else if (pattern.url instanceof RegExp) {
      return pattern.url.source;
    } else {
      return `${pattern.method || '*'}:${pattern.resourceType?.join(',') || '*'}`;
    }
  }

  private matchesPattern(
    url: string,
    request: Request,
    pattern: URLPattern
  ): boolean {
    // Check URL match
    if (pattern.url) {
      if (typeof pattern.url === 'string') {
        if (!url.includes(pattern.url)) return false;
      } else if (pattern.url instanceof RegExp) {
        if (!pattern.url.test(url)) return false;
      }
    }

    // Check method match
    if (pattern.method) {
      const methods = Array.isArray(pattern.method) ? pattern.method : [pattern.method];
      if (!methods.includes(request.method())) return false;
    }

    // Check resource type match
    if (pattern.resourceType) {
      const resourceType = request.resourceType() as ResourceType;
      if (!pattern.resourceType.includes(resourceType)) return false;
    }

    return true;
  }

  private trackRequest(pattern: string, request: Request): void {
    // Track in recorded requests
    if (!this.recordedRequests.has(pattern)) {
      this.recordedRequests.set(pattern, []);
    }
    this.recordedRequests.get(pattern)!.push(request);

    // Update counter
    this.requestCounter.set(
      pattern,
      (this.requestCounter.get(pattern) || 0) + 1
    );

    // Limit stored requests
    const requests = this.recordedRequests.get(pattern)!;
    if (requests.length > 100) {
      requests.shift();
    }
  }

  private trackResponse(pattern: string, response: APIResponse): void {
    if (!this.recordedResponses.has(pattern)) {
      this.recordedResponses.set(pattern, []);
    }
    this.recordedResponses.get(pattern)!.push(response);

    // Limit stored responses
    const responses = this.recordedResponses.get(pattern)!;
    if (responses.length > 100) {
      responses.shift();
    }
  }
}