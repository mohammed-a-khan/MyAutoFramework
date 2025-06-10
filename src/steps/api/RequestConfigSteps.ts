// src/steps/api/RequestConfigSteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { APIContext } from '../../api/context/APIContext';
import { RequestBuilder } from '../../api/client/RequestBuilder';
import { RequestTemplateEngine } from '../../api/templates/RequestTemplateEngine';
import { FileUtils } from '../../core/utils/FileUtils';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { ValidationUtils } from '../../core/utils/ValidationUtils';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';

/**
 * Step definitions for configuring API requests
 * Handles request setup, templates, and configuration options
 */
export class RequestConfigSteps extends CSBDDBaseStepDefinition {
    private templateEngine: RequestTemplateEngine;

    constructor() {
        super();
        this.templateEngine = new RequestTemplateEngine();
    }

    /**
     * Loads a request configuration from a file
     * Example: Given user loads request from "templates/user-create.json" file
     */
    @CSBDDStepDef("user loads request from {string} file")
    async loadRequestFromFile(filePath: string): Promise<void> {
        ActionLogger.logAPIAction('loadRequestFile', { filePath });
        
        try {
            const currentContext = this.getAPIContext();
            
            // Resolve file path
            const resolvedPath = await this.resolveFilePath(filePath);
            
            // Check if file exists
            if (!await FileUtils.exists(resolvedPath)) {
                throw new Error(`Request file not found: ${resolvedPath}`);
            }
            
            // Read file content
            const fileContent = await FileUtils.readFile(resolvedPath);
            
            // Determine file type and parse
            const requestConfig = await this.parseRequestFile(resolvedPath, fileContent);
            
            // Process template if needed
            const variables = this.context.getAllVariables();
            const processedConfig = await this.templateEngine.processTemplate(
                JSON.stringify(requestConfig),
                variables
            );
            
            const finalConfig = JSON.parse(processedConfig);
            
            // Apply configuration to context
            this.applyRequestConfig(currentContext, finalConfig);
            
            ActionLogger.logAPIAction('requestFileLoaded', { 
                filePath: resolvedPath,
                method: finalConfig.method,
                url: finalConfig.url
            });
        } catch (error) {
            ActionLogger.logError('Failed to load request file', error);
            throw new Error(`Failed to load request from file '${filePath}': ${error.message}`);
        }
    }

    /**
     * Sets the request method
     * Example: Given user sets request method to "POST"
     */
    @CSBDDStepDef("user sets request method to {string}")
    async setRequestMethod(method: string): Promise<void> {
        ActionLogger.logAPIAction('setRequestMethod', { method });
        
        try {
            const currentContext = this.getAPIContext();
            const upperMethod = method.toUpperCase();
            
            // Validate method
            const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
            if (!validMethods.includes(upperMethod)) {
                throw new Error(`Invalid HTTP method: ${method}. Valid methods are: ${validMethods.join(', ')}`);
            }
            
            currentContext.setMethod(upperMethod);
            
            ActionLogger.logAPIAction('requestMethodSet', { method: upperMethod });
        } catch (error) {
            ActionLogger.logError('Failed to set request method', error);
            throw error;
        }
    }

    /**
     * Sets the request URL path
     * Example: Given user sets request path to "/api/v1/users"
     */
    @CSBDDStepDef("user sets request path to {string}")
    async setRequestPath(path: string): Promise<void> {
        ActionLogger.logAPIAction('setRequestPath', { path });
        
        try {
            const currentContext = this.getAPIContext();
            
            // Interpolate variables
            const interpolatedPath = await this.interpolateValue(path);
            
            currentContext.setPath(interpolatedPath);
            
            ActionLogger.logAPIAction('requestPathSet', { 
                originalPath: path,
                interpolatedPath: interpolatedPath
            });
        } catch (error) {
            ActionLogger.logError('Failed to set request path', error);
            throw new Error(`Failed to set request path: ${error.message}`);
        }
    }

    /**
     * Sets a custom timeout for the current request
     * Example: Given user sets request timeout to 30 seconds
     */
    @CSBDDStepDef("user sets request timeout to {int} seconds")
    async setRequestTimeout(timeoutSeconds: number): Promise<void> {
        ActionLogger.logAPIAction('setRequestTimeout', { timeoutSeconds });
        
        try {
            if (timeoutSeconds <= 0) {
                throw new Error('Timeout must be greater than 0 seconds');
            }
            
            const currentContext = this.getAPIContext();
            const timeoutMs = timeoutSeconds * 1000;
            
            currentContext.setRequestOption('timeout', timeoutMs);
            
            ActionLogger.logAPIAction('requestTimeoutSet', { 
                seconds: timeoutSeconds,
                milliseconds: timeoutMs
            });
        } catch (error) {
            ActionLogger.logError('Failed to set request timeout', error);
            throw new Error(`Failed to set request timeout: ${error.message}`);
        }
    }

    /**
     * Disables redirect following for the current request
     * Example: Given user disables redirect following for request
     */
    @CSBDDStepDef("user disables redirect following for request")
    async disableRequestRedirects(): Promise<void> {
        ActionLogger.logAPIAction('disableRequestRedirects', {});
        
        try {
            const currentContext = this.getAPIContext();
            currentContext.setRequestOption('followRedirects', false);
            
            ActionLogger.logAPIAction('requestRedirectsDisabled', {});
        } catch (error) {
            ActionLogger.logError('Failed to disable request redirects', error);
            throw error;
        }
    }

    /**
     * Sets query parameters from a data table
     * Example: Given user sets query parameters:
     *   | page | 1 |
     *   | limit | 10 |
     */
    @CSBDDStepDef("user sets query parameters:")
    async setQueryParameters(dataTable: any): Promise<void> {
        ActionLogger.logAPIAction('setQueryParameters', { parameters: dataTable });
        
        try {
            const currentContext = this.getAPIContext();
            const params: Record<string, string> = {};
            
            // Parse data table
            const rows = dataTable.hashes ? dataTable.hashes() : dataTable.rows();
            
            for (const row of rows) {
                const key = row[0] || row.key || row.parameter;
                const value = row[1] || row.value;
                
                if (!key) {
                    throw new Error('Query parameter key cannot be empty');
                }
                
                // Interpolate value
                const interpolatedValue = await this.interpolateValue(String(value));
                params[key] = interpolatedValue;
            }
            
            currentContext.setQueryParameters(params);
            
            ActionLogger.logAPIAction('queryParametersSet', { parameters: params });
        } catch (error) {
            ActionLogger.logError('Failed to set query parameters', error);
            throw new Error(`Failed to set query parameters: ${error.message}`);
        }
    }

    /**
     * Sets a single query parameter
     * Example: Given user sets query parameter "page" to "1"
     */
    @CSBDDStepDef("user sets query parameter {string} to {string}")
    async setQueryParameter(key: string, value: string): Promise<void> {
        ActionLogger.logAPIAction('setQueryParameter', { key, value });
        
        try {
            const currentContext = this.getAPIContext();
            
            // Interpolate value
            const interpolatedValue = await this.interpolateValue(value);
            
            currentContext.setQueryParameter(key, interpolatedValue);
            
            ActionLogger.logAPIAction('queryParameterSet', { 
                key,
                originalValue: value,
                interpolatedValue: interpolatedValue
            });
        } catch (error) {
            ActionLogger.logError('Failed to set query parameter', error);
            throw new Error(`Failed to set query parameter '${key}': ${error.message}`);
        }
    }

    /**
     * Removes a query parameter
     * Example: Given user removes query parameter "debug"
     */
    @CSBDDStepDef("user removes query parameter {string}")
    async removeQueryParameter(key: string): Promise<void> {
        ActionLogger.logAPIAction('removeQueryParameter', { key });
        
        try {
            const currentContext = this.getAPIContext();
            currentContext.removeQueryParameter(key);
            
            ActionLogger.logAPIAction('queryParameterRemoved', { key });
        } catch (error) {
            ActionLogger.logError('Failed to remove query parameter', error);
            throw new Error(`Failed to remove query parameter '${key}': ${error.message}`);
        }
    }

    /**
     * Clears all query parameters
     * Example: Given user clears all query parameters
     */
    @CSBDDStepDef("user clears all query parameters")
    async clearQueryParameters(): Promise<void> {
        ActionLogger.logAPIAction('clearQueryParameters', {});
        
        try {
            const currentContext = this.getAPIContext();
            currentContext.clearQueryParameters();
            
            ActionLogger.logAPIAction('queryParametersCleared', {});
        } catch (error) {
            ActionLogger.logError('Failed to clear query parameters', error);
            throw error;
        }
    }

    /**
     * Sets request to use HTTP/2
     * Example: Given user enables HTTP/2 for request
     */
    @CSBDDStepDef("user enables HTTP/2 for request")
    async enableHTTP2(): Promise<void> {
        ActionLogger.logAPIAction('enableHTTP2', {});
        
        try {
            const currentContext = this.getAPIContext();
            currentContext.setRequestOption('http2', true);
            
            ActionLogger.logAPIAction('http2Enabled', {});
        } catch (error) {
            ActionLogger.logError('Failed to enable HTTP/2', error);
            throw error;
        }
    }

    /**
     * Sets request encoding
     * Example: Given user sets request encoding to "gzip"
     */
    @CSBDDStepDef("user sets request encoding to {string}")
    async setRequestEncoding(encoding: string): Promise<void> {
        ActionLogger.logAPIAction('setRequestEncoding', { encoding });
        
        try {
            const currentContext = this.getAPIContext();
            const validEncodings = ['gzip', 'deflate', 'br', 'identity'];
            
            if (!validEncodings.includes(encoding.toLowerCase())) {
                throw new Error(`Invalid encoding: ${encoding}. Valid encodings are: ${validEncodings.join(', ')}`);
            }
            
            currentContext.setRequestOption('encoding', encoding.toLowerCase());
            currentContext.setHeader('Accept-Encoding', encoding.toLowerCase());
            
            ActionLogger.logAPIAction('requestEncodingSet', { encoding: encoding.toLowerCase() });
        } catch (error) {
            ActionLogger.logError('Failed to set request encoding', error);
            throw new Error(`Failed to set request encoding: ${error.message}`);
        }
    }

    /**
     * Sets maximum response size
     * Example: Given user sets maximum response size to 10 MB
     */
    @CSBDDStepDef("user sets maximum response size to {int} MB")
    async setMaxResponseSize(sizeMB: number): Promise<void> {
        ActionLogger.logAPIAction('setMaxResponseSize', { sizeMB });
        
        try {
            if (sizeMB <= 0) {
                throw new Error('Maximum response size must be greater than 0 MB');
            }
            
            const currentContext = this.getAPIContext();
            const sizeBytes = sizeMB * 1024 * 1024;
            
            currentContext.setRequestOption('maxResponseSize', sizeBytes);
            
            ActionLogger.logAPIAction('maxResponseSizeSet', { 
                megabytes: sizeMB,
                bytes: sizeBytes
            });
        } catch (error) {
            ActionLogger.logError('Failed to set max response size', error);
            throw new Error(`Failed to set maximum response size: ${error.message}`);
        }
    }

    /**
     * Helper method to get current API context
     */
    private getAPIContext(): APIContext {
        const context = this.context.get('currentAPIContext') as APIContext;
        if (!context) {
            throw new Error('No API context set. Please use "Given user is working with <api> API" first');
        }
        return context;
    }

    /**
     * Helper method to resolve file paths
     */
    private async resolveFilePath(filePath: string): Promise<string> {
        // Check if absolute path
        if (FileUtils.isAbsolutePath(filePath)) {
            return filePath;
        }
        
        // Try relative to test data directory
        const testDataPath = ConfigurationManager.get('TEST_DATA_PATH', './test-data');
        const resolvedPath = FileUtils.joinPath(testDataPath, 'api', filePath);
        
        if (await FileUtils.exists(resolvedPath)) {
            return resolvedPath;
        }
        
        // Try relative to project root
        return filePath;
    }

    /**
     * Helper method to parse request files
     */
    private async parseRequestFile(filePath: string, content: string): Promise<any> {
        const extension = FileUtils.getExtension(filePath).toLowerCase();
        
        switch (extension) {
            case '.json':
                return JSON.parse(content);
                
            case '.yaml':
            case '.yml':
                // For YAML, we would need a parser, but keeping it simple
                throw new Error('YAML support not implemented. Please use JSON format');
                
            default:
                // Try to parse as JSON
                try {
                    return JSON.parse(content);
                } catch (error) {
                    throw new Error(`Unable to parse request file. Supported formats: JSON`);
                }
        }
    }

    /**
     * Helper method to apply request configuration
     */
    private applyRequestConfig(context: APIContext, config: any): void {
        // Set method
        if (config.method) {
            context.setMethod(config.method.toUpperCase());
        }
        
        // Set URL/path
        if (config.url) {
            if (ValidationUtils.isValidURL(config.url)) {
                // Full URL provided
                const url = new URL(config.url);
                context.setBaseUrl(`${url.protocol}//${url.host}`);
                context.setPath(url.pathname);
                
                // Extract query parameters
                url.searchParams.forEach((value, key) => {
                    context.setQueryParameter(key, value);
                });
            } else {
                // Just a path
                context.setPath(config.url);
            }
        } else if (config.path) {
            context.setPath(config.path);
        }
        
        // Set headers
        if (config.headers) {
            Object.entries(config.headers).forEach(([key, value]) => {
                context.setHeader(key, String(value));
            });
        }
        
        // Set query parameters
        if (config.queryParameters || config.params) {
            const params = config.queryParameters || config.params;
            Object.entries(params).forEach(([key, value]) => {
                context.setQueryParameter(key, String(value));
            });
        }
        
        // Set body
        if (config.body) {
            context.setBody(config.body);
        }
        
        // Set options
        if (config.options) {
            Object.entries(config.options).forEach(([key, value]) => {
                context.setRequestOption(key, value);
            });
        }
        
        // Set authentication
        if (config.auth || config.authentication) {
            const auth = config.auth || config.authentication;
            context.setAuthentication(auth);
        }
    }

    /**
     * Helper method to interpolate variables
     */
    private async interpolateValue(value: string): Promise<string> {
        if (!value.includes('{{')) {
            return value;
        }
        
        const variables = this.context.getAllVariables();
        let interpolated = value;
        
        for (const [key, val] of Object.entries(variables)) {
            interpolated = interpolated.replace(new RegExp(`{{${key}}}`, 'g'), String(val));
        }
        
        return interpolated;
    }
}