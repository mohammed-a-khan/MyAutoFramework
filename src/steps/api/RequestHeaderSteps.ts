// src/steps/api/RequestHeaderSteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { APIContext } from '../../api/context/APIContext';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { ValidationUtils } from '../../core/utils/ValidationUtils';
import { StringUtils } from '../../core/utils/StringUtils';

/**
 * Step definitions for managing API request headers
 * Provides comprehensive header manipulation capabilities
 */
export class RequestHeaderSteps extends CSBDDBaseStepDefinition {
    
    /**
     * Sets a single request header
     * Example: Given user sets request header "Content-Type" to "application/json"
     */
    @CSBDDStepDef("user sets request header {string} to {string}")
    async setRequestHeader(headerName: string, headerValue: string): Promise<void> {
        ActionLogger.logAPIAction('setRequestHeader', { headerName, headerValue });
        
        try {
            const currentContext = this.getAPIContext();
            
            // Validate header name
            if (!headerName || headerName.trim().length === 0) {
                throw new Error('Header name cannot be empty');
            }
            
            // Check for restricted headers
            this.validateHeaderName(headerName);
            
            // Interpolate value
            const interpolatedValue = await this.interpolateValue(headerValue);
            
            currentContext.setHeader(headerName, interpolatedValue);
            
            ActionLogger.logAPIAction('requestHeaderSet', { 
                headerName,
                originalValue: headerValue,
                interpolatedValue: interpolatedValue,
                isDefault: false
            });
        } catch (error) {
            ActionLogger.logError('Failed to set request header', error);
            throw new Error(`Failed to set request header '${headerName}': ${error.message}`);
        }
    }

    /**
     * Sets multiple request headers from a data table
     * Example: Given user sets request headers:
     *   | Authorization | Bearer {{token}} |
     *   | X-API-Key    | {{apiKey}}       |
     */
    @CSBDDStepDef("user sets request headers:")
    async setRequestHeaders(dataTable: any): Promise<void> {
        ActionLogger.logAPIAction('setRequestHeaders', { headers: dataTable });
        
        try {
            const currentContext = this.getAPIContext();
            const headers: Record<string, string> = {};
            
            // Parse data table
            const rows = dataTable.hashes ? dataTable.hashes() : dataTable.rows();
            
            for (const row of rows) {
                const headerName = row[0] || row.header || row.name;
                const headerValue = row[1] || row.value;
                
                if (!headerName) {
                    throw new Error('Header name cannot be empty');
                }
                
                // Validate header name
                this.validateHeaderName(headerName);
                
                // Interpolate value
                const interpolatedValue = await this.interpolateValue(String(headerValue || ''));
                headers[headerName] = interpolatedValue;
                
                currentContext.setHeader(headerName, interpolatedValue);
            }
            
            ActionLogger.logAPIAction('requestHeadersSet', { 
                headers: headers,
                count: Object.keys(headers).length
            });
        } catch (error) {
            ActionLogger.logError('Failed to set request headers', error);
            throw new Error(`Failed to set request headers: ${error.message}`);
        }
    }

    /**
     * Removes a request header
     * Example: Given user removes request header "X-Debug"
     */
    @CSBDDStepDef("user removes request header {string}")
    async removeRequestHeader(headerName: string): Promise<void> {
        ActionLogger.logAPIAction('removeRequestHeader', { headerName });
        
        try {
            const currentContext = this.getAPIContext();
            
            currentContext.removeHeader(headerName);
            
            ActionLogger.logAPIAction('requestHeaderRemoved', { headerName });
        } catch (error) {
            ActionLogger.logError('Failed to remove request header', error);
            throw new Error(`Failed to remove request header '${headerName}': ${error.message}`);
        }
    }

    /**
     * Clears all request headers
     * Example: Given user clears all request headers
     */
    @CSBDDStepDef("user clears all request headers")
    async clearAllRequestHeaders(): Promise<void> {
        ActionLogger.logAPIAction('clearRequestHeaders', {});
        
        try {
            const currentContext = this.getAPIContext();
            
            currentContext.clearHeaders();
            
            ActionLogger.logAPIAction('requestHeadersCleared', {});
        } catch (error) {
            ActionLogger.logError('Failed to clear request headers', error);
            throw error;
        }
    }

    /**
     * Sets Accept header
     * Example: Given user accepts "application/json"
     */
    @CSBDDStepDef("user accepts {string}")
    async setAcceptHeader(contentType: string): Promise<void> {
        ActionLogger.logAPIAction('setAcceptHeader', { contentType });
        
        try {
            const currentContext = this.getAPIContext();
            
            currentContext.setHeader('Accept', contentType);
            
            ActionLogger.logAPIAction('acceptHeaderSet', { contentType });
        } catch (error) {
            ActionLogger.logError('Failed to set Accept header', error);
            throw new Error(`Failed to set Accept header: ${error.message}`);
        }
    }

    /**
     * Sets Content-Type header
     * Example: Given user sets content type to "application/json"
     */
    @CSBDDStepDef("user sets content type to {string}")
    async setContentTypeHeader(contentType: string): Promise<void> {
        ActionLogger.logAPIAction('setContentType', { contentType });
        
        try {
            const currentContext = this.getAPIContext();
            
            currentContext.setHeader('Content-Type', contentType);
            
            ActionLogger.logAPIAction('contentTypeSet', { contentType });
        } catch (error) {
            ActionLogger.logError('Failed to set Content-Type header', error);
            throw new Error(`Failed to set Content-Type header: ${error.message}`);
        }
    }

    /**
     * Sets a default header that will be used for all requests
     * Example: Given user sets default header "X-Client-ID" to "test-client"
     */
    @CSBDDStepDef("user sets default header {string} to {string}")
    async setDefaultHeader(headerName: string, headerValue: string): Promise<void> {
        ActionLogger.logAPIAction('setDefaultHeader', { headerName, headerValue });
        
        try {
            const currentContext = this.getAPIContext();
            
            // Validate header name
            this.validateHeaderName(headerName);
            
            // Interpolate value
            const interpolatedValue = await this.interpolateValue(headerValue);
            
            currentContext.setDefaultHeader(headerName, interpolatedValue);
            
            ActionLogger.logAPIAction('defaultHeaderSet', { 
                headerName,
                originalValue: headerValue,
                interpolatedValue: interpolatedValue,
                isDefault: true
            });
        } catch (error) {
            ActionLogger.logError('Failed to set default header', error);
            throw new Error(`Failed to set default header '${headerName}': ${error.message}`);
        }
    }

    /**
     * Removes a default header
     * Example: Given user removes default header "X-Debug"
     */
    @CSBDDStepDef("user removes default header {string}")
    async removeDefaultHeader(headerName: string): Promise<void> {
        ActionLogger.logAPIAction('removeDefaultHeader', { headerName });
        
        try {
            const currentContext = this.getAPIContext();
            
            currentContext.removeDefaultHeader(headerName);
            
            ActionLogger.logAPIAction('defaultHeaderRemoved', { headerName });
        } catch (error) {
            ActionLogger.logError('Failed to remove default header', error);
            throw new Error(`Failed to remove default header '${headerName}': ${error.message}`);
        }
    }

    /**
     * Sets custom headers from JSON
     * Example: Given user sets headers from JSON:
     *   """
     *   {
     *     "X-Custom-Header": "value",
     *     "X-Request-ID": "{{requestId}}"
     *   }
     *   """
     */
    @CSBDDStepDef("user sets headers from JSON:")
    async setHeadersFromJSON(jsonString: string): Promise<void> {
        ActionLogger.logAPIAction('setHeadersFromJSON', {});
        
        try {
            const currentContext = this.getAPIContext();
            
            // Parse JSON
            let headers: Record<string, any>;
            try {
                headers = JSON.parse(jsonString);
            } catch (error) {
                throw new Error(`Invalid JSON format: ${error.message}`);
            }
            
            // Validate and set headers
            for (const [headerName, headerValue] of Object.entries(headers)) {
                this.validateHeaderName(headerName);
                
                const valueStr = String(headerValue);
                const interpolatedValue = await this.interpolateValue(valueStr);
                
                currentContext.setHeader(headerName, interpolatedValue);
            }
            
            ActionLogger.logAPIAction('headersSetFromJSON', { 
                count: Object.keys(headers).length,
                headers: headers
            });
        } catch (error) {
            ActionLogger.logError('Failed to set headers from JSON', error);
            throw new Error(`Failed to set headers from JSON: ${error.message}`);
        }
    }

    /**
     * Copies headers from a previous response
     * Example: Given user copies response headers from "loginResponse"
     */
    @CSBDDStepDef("user copies response headers from {string}")
    async copyResponseHeaders(responseAlias: string): Promise<void> {
        ActionLogger.logAPIAction('copyResponseHeaders', { responseAlias });
        
        try {
            const currentContext = this.getAPIContext();
            const storedResponse = this.context.getStoredResponse(responseAlias);
            
            if (!storedResponse) {
                throw new Error(`No response found with alias '${responseAlias}'`);
            }
            
            if (!storedResponse.headers) {
                throw new Error(`Response '${responseAlias}' has no headers`);
            }
            
            // Copy headers
            let copiedCount = 0;
            for (const [headerName, headerValue] of Object.entries(storedResponse.headers)) {
                // Skip certain headers that shouldn't be copied
                if (this.shouldSkipHeader(headerName)) {
                    continue;
                }
                
                currentContext.setHeader(headerName, String(headerValue));
                copiedCount++;
            }
            
            ActionLogger.logAPIAction('responseHeadersCopied', { 
                responseAlias,
                copiedCount,
                skippedHeaders: Object.keys(storedResponse.headers).length - copiedCount
            });
        } catch (error) {
            ActionLogger.logError('Failed to copy response headers', error);
            throw new Error(`Failed to copy response headers from '${responseAlias}': ${error.message}`);
        }
    }

    /**
     * Sets a header with base64 encoded value
     * Example: Given user sets header "X-Auth-Token" to base64 encoded "username:password"
     */
    @CSBDDStepDef("user sets header {string} to base64 encoded {string}")
    async setBase64EncodedHeader(headerName: string, value: string): Promise<void> {
        ActionLogger.logAPIAction('setBase64Header', { headerName });
        
        try {
            const currentContext = this.getAPIContext();
            
            // Interpolate value first
            const interpolatedValue = await this.interpolateValue(value);
            
            // Base64 encode
            const encodedValue = Buffer.from(interpolatedValue).toString('base64');
            
            currentContext.setHeader(headerName, encodedValue);
            
            ActionLogger.logAPIAction('base64HeaderSet', { 
                headerName,
                originalLength: interpolatedValue.length,
                encodedLength: encodedValue.length
            });
        } catch (error) {
            ActionLogger.logError('Failed to set base64 encoded header', error);
            throw new Error(`Failed to set base64 encoded header '${headerName}': ${error.message}`);
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
     * Helper method to validate header names
     */
    private validateHeaderName(headerName: string): void {
        // Check for empty or whitespace-only names
        if (!headerName || headerName.trim().length === 0) {
            throw new Error('Header name cannot be empty');
        }
        
        // Check for invalid characters
        const validHeaderRegex = /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/;
        if (!validHeaderRegex.test(headerName)) {
            throw new Error(`Invalid header name '${headerName}'. Header names must contain only valid HTTP header characters`);
        }
        
        // Warn about potentially problematic headers
        const restrictedHeaders = [
            'Host', 'Connection', 'Content-Length', 'Transfer-Encoding',
            'Upgrade', 'Proxy-Connection', 'TE', 'Trailer'
        ];
        
        if (restrictedHeaders.some(h => h.toLowerCase() === headerName.toLowerCase())) {
            ActionLogger.logWarning(`Setting restricted header '${headerName}' may be overridden by the HTTP client`);
        }
    }

    /**
     * Helper method to determine if a header should be skipped when copying
     */
    private shouldSkipHeader(headerName: string): boolean {
        const skipHeaders = [
            'content-length',
            'transfer-encoding',
            'connection',
            'keep-alive',
            'host',
            'date',
            'server',
            'x-powered-by'
        ];
        
        return skipHeaders.includes(headerName.toLowerCase());
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