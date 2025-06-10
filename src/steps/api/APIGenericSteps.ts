// src/steps/api/APIGenericSteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { APIContext } from '../../api/context/APIContext';
import { APIContextManager } from '../../api/context/APIContextManager';
import { CSHttpClient } from '../../api/client/CSHttpClient';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { ResponseStorage } from '../../bdd/context/ResponseStorage';
import { FileUtils } from '../../core/utils/FileUtils';
import { ValidationUtils } from '../../core/utils/ValidationUtils';

/**
 * Generic API testing step definitions for core operations
 * Provides fundamental API testing capabilities
 */
export class APIGenericSteps extends CSBDDBaseStepDefinition {
    private apiContextManager: APIContextManager;
    private currentContext: APIContext;
    private httpClient: CSHttpClient;
    private responseStorage: ResponseStorage;

    constructor() {
        super();
        this.apiContextManager = new APIContextManager();
        this.httpClient = new CSHttpClient();
        this.responseStorage = new ResponseStorage();
    }

    /**
     * Sets the current API context for subsequent operations
     * Example: Given user is working with "users" API
     */
    @CSBDDStepDef("user is working with {string} API")
    async setAPIContext(apiName: string): Promise<void> {
        ActionLogger.logAPIAction('setContext', { apiName });
        
        try {
            // Create or get existing context
            this.currentContext = await this.apiContextManager.getOrCreateContext(apiName);
            
            // Load API-specific configuration
            const apiConfig = await this.loadAPIConfig(apiName);
            if (apiConfig) {
                this.currentContext.setBaseUrl(apiConfig.baseUrl);
                this.currentContext.setDefaultHeaders(apiConfig.defaultHeaders || {});
                this.currentContext.setTimeout(apiConfig.timeout || 30000);
            }
            
            // Store in BDD context for other steps
            this.context.set('currentAPIContext', this.currentContext);
            this.context.set('currentAPIName', apiName);
            
            ActionLogger.logAPIAction('contextSet', { 
                apiName, 
                baseUrl: this.currentContext.getBaseUrl(),
                timeout: this.currentContext.getTimeout()
            });
        } catch (error) {
            ActionLogger.logError('Failed to set API context', error);
            throw new Error(`Failed to set API context for '${apiName}': ${error.message}`);
        }
    }

    /**
     * Sets the base URL for API requests
     * Example: Given user sets API base URL to "https://api.example.com"
     */
    @CSBDDStepDef("user sets API base URL to {string}")
    async setAPIBaseURL(baseUrl: string): Promise<void> {
        ActionLogger.logAPIAction('setBaseURL', { baseUrl });
        
        try {
            // Validate URL format
            if (!ValidationUtils.isValidURL(baseUrl)) {
                throw new Error(`Invalid URL format: ${baseUrl}`);
            }
            
            // Get current context or create default
            if (!this.currentContext) {
                this.currentContext = await this.apiContextManager.getOrCreateContext('default');
            }
            
            // Interpolate variables if present
            const interpolatedUrl = await this.interpolateValue(baseUrl);
            
            this.currentContext.setBaseUrl(interpolatedUrl);
            
            ActionLogger.logAPIAction('baseURLSet', { 
                originalUrl: baseUrl,
                interpolatedUrl: interpolatedUrl
            });
        } catch (error) {
            ActionLogger.logError('Failed to set base URL', error);
            throw new Error(`Failed to set API base URL: ${error.message}`);
        }
    }

    /**
     * Sets the timeout for API requests
     * Example: Given user sets API timeout to 60 seconds
     */
    @CSBDDStepDef("user sets API timeout to {int} seconds")
    async setAPITimeout(timeoutSeconds: number): Promise<void> {
        ActionLogger.logAPIAction('setTimeout', { timeoutSeconds });
        
        try {
            if (timeoutSeconds <= 0) {
                throw new Error('Timeout must be greater than 0 seconds');
            }
            
            if (!this.currentContext) {
                this.currentContext = await this.apiContextManager.getOrCreateContext('default');
            }
            
            const timeoutMs = timeoutSeconds * 1000;
            this.currentContext.setTimeout(timeoutMs);
            
            ActionLogger.logAPIAction('timeoutSet', { 
                seconds: timeoutSeconds,
                milliseconds: timeoutMs
            });
        } catch (error) {
            ActionLogger.logError('Failed to set timeout', error);
            throw new Error(`Failed to set API timeout: ${error.message}`);
        }
    }

    /**
     * Enables or disables SSL certificate validation
     * Example: Given user disables SSL validation
     */
    @CSBDDStepDef("user disables SSL validation")
    async disableSSLValidation(): Promise<void> {
        ActionLogger.logAPIAction('disableSSL', {});
        
        try {
            if (!this.currentContext) {
                this.currentContext = await this.apiContextManager.getOrCreateContext('default');
            }
            
            this.currentContext.setSSLValidation(false);
            
            ActionLogger.logAPIAction('sslValidationDisabled', {});
            ActionLogger.logWarning('SSL validation disabled - use only for testing!');
        } catch (error) {
            ActionLogger.logError('Failed to disable SSL validation', error);
            throw error;
        }
    }

    /**
     * Enables SSL certificate validation (default)
     * Example: Given user enables SSL validation
     */
    @CSBDDStepDef("user enables SSL validation")
    async enableSSLValidation(): Promise<void> {
        ActionLogger.logAPIAction('enableSSL', {});
        
        try {
            if (!this.currentContext) {
                this.currentContext = await this.apiContextManager.getOrCreateContext('default');
            }
            
            this.currentContext.setSSLValidation(true);
            
            ActionLogger.logAPIAction('sslValidationEnabled', {});
        } catch (error) {
            ActionLogger.logError('Failed to enable SSL validation', error);
            throw error;
        }
    }

    /**
     * Sets the number of retry attempts for failed requests
     * Example: Given user sets API retry count to 3
     */
    @CSBDDStepDef("user sets API retry count to {int}")
    async setRetryCount(retryCount: number): Promise<void> {
        ActionLogger.logAPIAction('setRetryCount', { retryCount });
        
        try {
            if (retryCount < 0) {
                throw new Error('Retry count cannot be negative');
            }
            
            if (!this.currentContext) {
                this.currentContext = await this.apiContextManager.getOrCreateContext('default');
            }
            
            this.currentContext.setRetryCount(retryCount);
            
            ActionLogger.logAPIAction('retryCountSet', { retryCount });
        } catch (error) {
            ActionLogger.logError('Failed to set retry count', error);
            throw new Error(`Failed to set retry count: ${error.message}`);
        }
    }

    /**
     * Sets the delay between retry attempts
     * Example: Given user sets API retry delay to 2 seconds
     */
    @CSBDDStepDef("user sets API retry delay to {int} seconds")
    async setRetryDelay(delaySeconds: number): Promise<void> {
        ActionLogger.logAPIAction('setRetryDelay', { delaySeconds });
        
        try {
            if (delaySeconds < 0) {
                throw new Error('Retry delay cannot be negative');
            }
            
            if (!this.currentContext) {
                this.currentContext = await this.apiContextManager.getOrCreateContext('default');
            }
            
            const delayMs = delaySeconds * 1000;
            this.currentContext.setRetryDelay(delayMs);
            
            ActionLogger.logAPIAction('retryDelaySet', { 
                seconds: delaySeconds,
                milliseconds: delayMs
            });
        } catch (error) {
            ActionLogger.logError('Failed to set retry delay', error);
            throw new Error(`Failed to set retry delay: ${error.message}`);
        }
    }

    /**
     * Enables request/response logging
     * Example: Given user enables API request logging
     */
    @CSBDDStepDef("user enables API request logging")
    async enableRequestLogging(): Promise<void> {
        ActionLogger.logAPIAction('enableRequestLogging', {});
        
        try {
            if (!this.currentContext) {
                this.currentContext = await this.apiContextManager.getOrCreateContext('default');
            }
            
            this.currentContext.setRequestLogging(true);
            
            ActionLogger.logAPIAction('requestLoggingEnabled', {});
        } catch (error) {
            ActionLogger.logError('Failed to enable request logging', error);
            throw error;
        }
    }

    /**
     * Disables request/response logging
     * Example: Given user disables API request logging
     */
    @CSBDDStepDef("user disables API request logging")
    async disableRequestLogging(): Promise<void> {
        ActionLogger.logAPIAction('disableRequestLogging', {});
        
        try {
            if (!this.currentContext) {
                this.currentContext = await this.apiContextManager.getOrCreateContext('default');
            }
            
            this.currentContext.setRequestLogging(false);
            
            ActionLogger.logAPIAction('requestLoggingDisabled', {});
        } catch (error) {
            ActionLogger.logError('Failed to disable request logging', error);
            throw error;
        }
    }

    /**
     * Clears all stored API responses
     * Example: Given user clears all API responses
     */
    @CSBDDStepDef("user clears all API responses")
    async clearAllResponses(): Promise<void> {
        ActionLogger.logAPIAction('clearResponses', {});
        
        try {
            const scenarioId = this.context.getScenarioId();
            this.responseStorage.clearScenarioResponses(scenarioId);
            
            if (this.currentContext) {
                this.currentContext.clearHistory();
            }
            
            ActionLogger.logAPIAction('responsesCleared', {});
        } catch (error) {
            ActionLogger.logError('Failed to clear responses', error);
            throw error;
        }
    }

    /**
     * Switches to a different API context
     * Example: Given user switches to "payments" API context
     */
    @CSBDDStepDef("user switches to {string} API context")
    async switchAPIContext(contextName: string): Promise<void> {
        ActionLogger.logAPIAction('switchContext', { contextName });
        
        try {
            const context = await this.apiContextManager.getContext(contextName);
            if (!context) {
                throw new Error(`API context '${contextName}' not found`);
            }
            
            this.currentContext = context;
            this.context.set('currentAPIContext', this.currentContext);
            this.context.set('currentAPIName', contextName);
            
            ActionLogger.logAPIAction('contextSwitched', { 
                contextName,
                baseUrl: context.getBaseUrl()
            });
        } catch (error) {
            ActionLogger.logError('Failed to switch context', error);
            throw new Error(`Failed to switch to API context '${contextName}': ${error.message}`);
        }
    }

    /**
     * Creates a new named API context
     * Example: Given user creates "internal" API context
     */
    @CSBDDStepDef("user creates {string} API context")
    async createAPIContext(contextName: string): Promise<void> {
        ActionLogger.logAPIAction('createContext', { contextName });
        
        try {
            const context = await this.apiContextManager.createContext(contextName);
            
            ActionLogger.logAPIAction('contextCreated', { 
                contextName,
                contextId: context.getId()
            });
        } catch (error) {
            ActionLogger.logError('Failed to create context', error);
            throw new Error(`Failed to create API context '${contextName}': ${error.message}`);
        }
    }

    /**
     * Sets a custom user agent for API requests
     * Example: Given user sets API user agent to "MyTestAgent/1.0"
     */
    @CSBDDStepDef("user sets API user agent to {string}")
    async setUserAgent(userAgent: string): Promise<void> {
        ActionLogger.logAPIAction('setUserAgent', { userAgent });
        
        try {
            if (!this.currentContext) {
                this.currentContext = await this.apiContextManager.getOrCreateContext('default');
            }
            
            const interpolatedAgent = await this.interpolateValue(userAgent);
            this.currentContext.setDefaultHeader('User-Agent', interpolatedAgent);
            
            ActionLogger.logAPIAction('userAgentSet', { 
                originalAgent: userAgent,
                interpolatedAgent: interpolatedAgent
            });
        } catch (error) {
            ActionLogger.logError('Failed to set user agent', error);
            throw new Error(`Failed to set user agent: ${error.message}`);
        }
    }

    /**
     * Enables following redirects (default behavior)
     * Example: Given user enables redirect following
     */
    @CSBDDStepDef("user enables redirect following")
    async enableRedirectFollowing(): Promise<void> {
        ActionLogger.logAPIAction('enableRedirects', {});
        
        try {
            if (!this.currentContext) {
                this.currentContext = await this.apiContextManager.getOrCreateContext('default');
            }
            
            this.currentContext.setFollowRedirects(true);
            
            ActionLogger.logAPIAction('redirectsEnabled', {});
        } catch (error) {
            ActionLogger.logError('Failed to enable redirects', error);
            throw error;
        }
    }

    /**
     * Disables following redirects
     * Example: Given user disables redirect following
     */
    @CSBDDStepDef("user disables redirect following")
    async disableRedirectFollowing(): Promise<void> {
        ActionLogger.logAPIAction('disableRedirects', {});
        
        try {
            if (!this.currentContext) {
                this.currentContext = await this.apiContextManager.getOrCreateContext('default');
            }
            
            this.currentContext.setFollowRedirects(false);
            
            ActionLogger.logAPIAction('redirectsDisabled', {});
        } catch (error) {
            ActionLogger.logError('Failed to disable redirects', error);
            throw error;
        }
    }

    /**
     * Sets maximum number of redirects to follow
     * Example: Given user sets maximum redirects to 5
     */
    @CSBDDStepDef("user sets maximum redirects to {int}")
    async setMaxRedirects(maxRedirects: number): Promise<void> {
        ActionLogger.logAPIAction('setMaxRedirects', { maxRedirects });
        
        try {
            if (maxRedirects < 0) {
                throw new Error('Maximum redirects cannot be negative');
            }
            
            if (!this.currentContext) {
                this.currentContext = await this.apiContextManager.getOrCreateContext('default');
            }
            
            this.currentContext.setMaxRedirects(maxRedirects);
            
            ActionLogger.logAPIAction('maxRedirectsSet', { maxRedirects });
        } catch (error) {
            ActionLogger.logError('Failed to set max redirects', error);
            throw new Error(`Failed to set maximum redirects: ${error.message}`);
        }
    }

    /**
     * Helper method to load API-specific configuration
     */
    private async loadAPIConfig(apiName: string): Promise<any> {
        try {
            // Try to load from configuration
            const configKey = `API_${apiName.toUpperCase()}_CONFIG`;
            const configPath = ConfigurationManager.get(configKey);
            
            if (configPath) {
                const configContent = await FileUtils.readFile(configPath);
                return JSON.parse(configContent);
            }
            
            // Try to load from standard location
            const standardPath = `config/api/${apiName}.json`;
            if (await FileUtils.exists(standardPath)) {
                const configContent = await FileUtils.readFile(standardPath);
                return JSON.parse(configContent);
            }
            
            // Return default config
            return {
                baseUrl: ConfigurationManager.get(`API_${apiName.toUpperCase()}_BASE_URL`) || 
                        ConfigurationManager.get('API_BASE_URL'),
                timeout: ConfigurationManager.getInt(`API_${apiName.toUpperCase()}_TIMEOUT`) ||
                        ConfigurationManager.getInt('API_DEFAULT_TIMEOUT', 30000)
            };
        } catch (error) {
            ActionLogger.logWarning(`Failed to load API config for '${apiName}': ${error.message}`);
            return null;
        }
    }

    /**
     * Helper method to interpolate variables in values
     */
    private async interpolateValue(value: string): Promise<string> {
        if (!value.includes('{{')) {
            return value;
        }
        
        // Get variables from context
        const variables = this.context.getAllVariables();
        
        // Replace placeholders
        let interpolated = value;
        for (const [key, val] of Object.entries(variables)) {
            interpolated = interpolated.replace(new RegExp(`{{${key}}}`, 'g'), String(val));
        }
        
        return interpolated;
    }
}