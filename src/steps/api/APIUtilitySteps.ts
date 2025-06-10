// src/steps/api/APIUtilitySteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { APIContext } from '../../api/context/APIContext';
import { ResponseStorage } from '../../bdd/context/ResponseStorage';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { FileUtils } from '../../core/utils/FileUtils';
import { DateUtils } from '../../core/utils/DateUtils';
import { StringUtils } from '../../core/utils/StringUtils';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';

/**
 * Utility step definitions for API testing
 * Provides helper steps for delays, logging, data extraction, and debugging
 */
export class APIUtilitySteps extends CSBDDBaseStepDefinition {
    private responseStorage: ResponseStorage;

    constructor() {
        super();
        this.responseStorage = new ResponseStorage();
    }

    /**
     * Waits for specified seconds
     * Example: Given user waits for 5 seconds
     */
    @CSBDDStepDef("user waits for {int} seconds")
    async waitForSeconds(seconds: number): Promise<void> {
        ActionLogger.logAPIAction('wait', { seconds });
        
        try {
            if (seconds < 0) {
                throw new Error('Wait time cannot be negative');
            }
            
            if (seconds > 300) {
                throw new Error('Wait time cannot exceed 300 seconds (5 minutes)');
            }
            
            const milliseconds = seconds * 1000;
            await new Promise(resolve => setTimeout(resolve, milliseconds));
            
            ActionLogger.logAPIAction('waitCompleted', { 
                seconds,
                milliseconds
            });
        } catch (error) {
            ActionLogger.logError('Wait failed', error);
            throw error;
        }
    }

    /**
     * Waits for specified milliseconds
     * Example: Given user waits for 500 milliseconds
     */
    @CSBDDStepDef("user waits for {int} milliseconds")
    async waitForMilliseconds(milliseconds: number): Promise<void> {
        ActionLogger.logAPIAction('waitMs', { milliseconds });
        
        try {
            if (milliseconds < 0) {
                throw new Error('Wait time cannot be negative');
            }
            
            if (milliseconds > 300000) {
                throw new Error('Wait time cannot exceed 300000 milliseconds (5 minutes)');
            }
            
            await new Promise(resolve => setTimeout(resolve, milliseconds));
            
            ActionLogger.logAPIAction('waitMsCompleted', { milliseconds });
        } catch (error) {
            ActionLogger.logError('Wait failed', error);
            throw error;
        }
    }

    /**
     * Logs the response body
     * Example: Given user logs response body
     */
    @CSBDDStepDef("user logs response body")
    async logResponseBody(): Promise<void> {
        ActionLogger.logAPIAction('logResponseBody', {});
        
        try {
            const response = this.getLastResponse();
            const bodyText = this.getResponseBodyAsString(response);
            
            console.log('\n========== RESPONSE BODY ==========');
            console.log(this.formatResponseBody(bodyText));
            console.log('===================================\n');
            
            ActionLogger.logAPIAction('responseBodyLogged', { 
                bodyLength: bodyText.length,
                contentType: response.headers['content-type'] || 'unknown'
            });
        } catch (error) {
            ActionLogger.logError('Failed to log response body', error);
            throw error;
        }
    }

    /**
     * Logs the response headers
     * Example: Given user logs response headers
     */
    @CSBDDStepDef("user logs response headers")
    async logResponseHeaders(): Promise<void> {
        ActionLogger.logAPIAction('logResponseHeaders', {});
        
        try {
            const response = this.getLastResponse();
            
            console.log('\n========== RESPONSE HEADERS ==========');
            Object.entries(response.headers).forEach(([key, value]) => {
                console.log(`${key}: ${value}`);
            });
            console.log('=====================================\n');
            
            ActionLogger.logAPIAction('responseHeadersLogged', { 
                headerCount: Object.keys(response.headers).length
            });
        } catch (error) {
            ActionLogger.logError('Failed to log response headers', error);
            throw error;
        }
    }

    /**
     * Logs the complete response
     * Example: Given user logs complete response
     */
    @CSBDDStepDef("user logs complete response")
    async logCompleteResponse(): Promise<void> {
        ActionLogger.logAPIAction('logCompleteResponse', {});
        
        try {
            const response = this.getLastResponse();
            const bodyText = this.getResponseBodyAsString(response);
            
            console.log('\n========== COMPLETE RESPONSE ==========');
            console.log(`Status: ${response.statusCode} ${response.statusText}`);
            console.log(`Response Time: ${response.responseTime}ms`);
            console.log('\nHeaders:');
            Object.entries(response.headers).forEach(([key, value]) => {
                console.log(`  ${key}: ${value}`);
            });
            console.log('\nBody:');
            console.log(this.formatResponseBody(bodyText));
            console.log('======================================\n');
            
            ActionLogger.logAPIAction('completeResponseLogged', { 
                statusCode: response.statusCode,
                responseTime: response.responseTime,
                bodyLength: bodyText.length
            });
        } catch (error) {
            ActionLogger.logError('Failed to log complete response', error);
            throw error;
        }
    }

    /**
     * Saves response body to file
     * Example: Given user saves response to "response.json"
     */
    @CSBDDStepDef("user saves response to {string}")
    async saveResponseToFile(fileName: string): Promise<void> {
        ActionLogger.logAPIAction('saveResponseToFile', { fileName });
        
        try {
            const response = this.getLastResponse();
            const bodyText = this.getResponseBodyAsString(response);
            
            // Resolve save path
            const savePath = await this.resolveSavePath(fileName);
            
            // Ensure directory exists
            await FileUtils.ensureDirectoryExists(FileUtils.getDirectory(savePath));
            
            // Save file
            await FileUtils.writeFile(savePath, bodyText);
            
            ActionLogger.logAPIAction('responseFileSaved', { 
                fileName: savePath,
                fileSize: bodyText.length
            });
        } catch (error) {
            ActionLogger.logError('Failed to save response to file', error);
            throw new Error(`Failed to save response to file '${fileName}': ${error.message}`);
        }
    }

    /**
     * Saves complete response including headers to file
     * Example: Given user saves complete response to "full-response.txt"
     */
    @CSBDDStepDef("user saves complete response to {string}")
    async saveCompleteResponseToFile(fileName: string): Promise<void> {
        ActionLogger.logAPIAction('saveCompleteResponseToFile', { fileName });
        
        try {
            const response = this.getLastResponse();
            const bodyText = this.getResponseBodyAsString(response);
            
            // Build complete response text
            let completeResponse = `HTTP Response\n`;
            completeResponse += `=============\n\n`;
            completeResponse += `Status: ${response.statusCode} ${response.statusText}\n`;
            completeResponse += `Response Time: ${response.responseTime}ms\n\n`;
            completeResponse += `Headers:\n`;
            completeResponse += `--------\n`;
            
            Object.entries(response.headers).forEach(([key, value]) => {
                completeResponse += `${key}: ${value}\n`;
            });
            
            completeResponse += `\nBody:\n`;
            completeResponse += `-----\n`;
            completeResponse += bodyText;
            
            // Resolve save path
            const savePath = await this.resolveSavePath(fileName);
            
            // Ensure directory exists
            await FileUtils.ensureDirectoryExists(FileUtils.getDirectory(savePath));
            
            // Save file
            await FileUtils.writeFile(savePath, completeResponse);
            
            ActionLogger.logAPIAction('completeResponseFileSaved', { 
                fileName: savePath,
                fileSize: completeResponse.length
            });
        } catch (error) {
            ActionLogger.logError('Failed to save complete response to file', error);
            throw new Error(`Failed to save complete response to file '${fileName}': ${error.message}`);
        }
    }

    /**
     * Stores response with an alias for later use
     * Example: Given user stores response as "createUserResponse"
     */
    @CSBDDStepDef("user stores response as {string}")
    async storeResponseAs(alias: string): Promise<void> {
        ActionLogger.logAPIAction('storeResponseAs', { alias });
        
        try {
            const response = this.getLastResponse();
            const scenarioId = this.context.getScenarioId();
            
            // Store in response storage
            this.responseStorage.store(alias, response, scenarioId);
            
            // Also store in context for easy access
            this.context.set(`response_${alias}`, response);
            
            ActionLogger.logAPIAction('responseStored', { 
                alias,
                statusCode: response.statusCode,
                hasBody: !!response.body
            });
        } catch (error) {
            ActionLogger.logError('Failed to store response', error);
            throw new Error(`Failed to store response as '${alias}': ${error.message}`);
        }
    }

    /**
     * Extracts value from response and stores as variable
     * Example: Given user extracts JSON path "$.id" as "userId"
     */
    @CSBDDStepDef("user extracts JSON path {string} as {string}")
    async extractJSONPathAsVariable(jsonPath: string, variableName: string): Promise<void> {
        ActionLogger.logAPIAction('extractJSONPath', { jsonPath, variableName });
        
        try {
            const response = this.getLastResponse();
            const jsonBody = this.parseResponseAsJSON(response);
            
            // Import JSONPathValidator to extract value
            const { JSONPathValidator } = await import('../../api/validators/JSONPathValidator');
            const validator = new JSONPathValidator();
            
            const value = validator.extractValue(jsonBody, jsonPath);
            
            if (value === undefined) {
                throw new Error(`JSON path '${jsonPath}' not found in response`);
            }
            
            // Store as variable
            this.context.setVariable(variableName, value);
            
            ActionLogger.logAPIAction('jsonPathExtracted', { 
                jsonPath,
                variableName,
                valueType: typeof value,
                value: this.truncateValue(value)
            });
        } catch (error) {
            ActionLogger.logError('Failed to extract JSON path', error);
            throw new Error(`Failed to extract JSON path '${jsonPath}': ${error.message}`);
        }
    }

    /**
     * Extracts response header and stores as variable
     * Example: Given user extracts header "X-Request-ID" as "requestId"
     */
    @CSBDDStepDef("user extracts header {string} as {string}")
    async extractHeaderAsVariable(headerName: string, variableName: string): Promise<void> {
        ActionLogger.logAPIAction('extractHeader', { headerName, variableName });
        
        try {
            const response = this.getLastResponse();
            
            // Find header (case-insensitive)
            const headerValue = this.findHeader(response.headers, headerName);
            
            if (headerValue === undefined) {
                throw new Error(`Header '${headerName}' not found in response`);
            }
            
            // Store as variable
            this.context.setVariable(variableName, headerValue);
            
            ActionLogger.logAPIAction('headerExtracted', { 
                headerName,
                variableName,
                value: headerValue
            });
        } catch (error) {
            ActionLogger.logError('Failed to extract header', error);
            throw new Error(`Failed to extract header '${headerName}': ${error.message}`);
        }
    }

    /**
     * Sets a variable to a value
     * Example: Given user sets variable "baseUrl" to "https://api.example.com"
     */
    @CSBDDStepDef("user sets variable {string} to {string}")
    async setVariable(variableName: string, value: string): Promise<void> {
        ActionLogger.logAPIAction('setVariable', { variableName, value });
        
        try {
            const interpolatedValue = await this.interpolateValue(value);
            this.context.setVariable(variableName, interpolatedValue);
            
            ActionLogger.logAPIAction('variableSet', { 
                variableName,
                originalValue: value,
                interpolatedValue,
                valueType: typeof interpolatedValue
            });
        } catch (error) {
            ActionLogger.logError('Failed to set variable', error);
            throw new Error(`Failed to set variable '${variableName}': ${error.message}`);
        }
    }

    /**
     * Generates a random value and stores as variable
     * Example: Given user generates random "uuid" as "requestId"
     */
    @CSBDDStepDef("user generates random {string} as {string}")
    async generateRandomValue(type: string, variableName: string): Promise<void> {
        ActionLogger.logAPIAction('generateRandomValue', { type, variableName });
        
        try {
            let value: any;
            
            switch (type.toLowerCase()) {
                case 'uuid':
                case 'guid':
                    value = this.generateUUID();
                    break;
                    
                case 'number':
                case 'int':
                case 'integer':
                    value = Math.floor(Math.random() * 1000000);
                    break;
                    
                case 'string':
                case 'text':
                    value = StringUtils.generateRandomString(10);
                    break;
                    
                case 'email':
                    value = `test_${StringUtils.generateRandomString(8)}@example.com`;
                    break;
                    
                case 'timestamp':
                    value = Date.now();
                    break;
                    
                case 'date':
                    value = DateUtils.formatDate(new Date(), 'YYYY-MM-DD');
                    break;
                    
                case 'datetime':
                    value = new Date().toISOString();
                    break;
                    
                case 'boolean':
                case 'bool':
                    value = Math.random() < 0.5;
                    break;
                    
                default:
                    throw new Error(`Unknown random type: ${type}. Supported types: uuid, number, string, email, timestamp, date, datetime, boolean`);
            }
            
            // Store as variable
            this.context.setVariable(variableName, value);
            
            ActionLogger.logAPIAction('randomValueGenerated', { 
                type,
                variableName,
                value: String(value)
            });
        } catch (error) {
            ActionLogger.logError('Failed to generate random value', error);
            throw new Error(`Failed to generate random value: ${error.message}`);
        }
    }

    /**
     * Prints current variables
     * Example: Given user prints all variables
     */
    @CSBDDStepDef("user prints all variables")
    async printAllVariables(): Promise<void> {
        ActionLogger.logAPIAction('printAllVariables', {});
        
        try {
            const variables = this.context.getAllVariables();
            
            console.log('\n========== CURRENT VARIABLES ==========');
            if (Object.keys(variables).length === 0) {
                console.log('No variables set');
            } else {
                Object.entries(variables).forEach(([key, value]) => {
                    console.log(`${key}: ${this.formatVariableValue(value)}`);
                });
            }
            console.log('=====================================\n');
            
            ActionLogger.logAPIAction('variablesPrinted', { 
                count: Object.keys(variables).length
            });
        } catch (error) {
            ActionLogger.logError('Failed to print variables', error);
            throw error;
        }
    }

    /**
     * Clears all variables
     * Example: Given user clears all variables
     */
    @CSBDDStepDef("user clears all variables")
    async clearAllVariables(): Promise<void> {
        ActionLogger.logAPIAction('clearAllVariables', {});
        
        try {
            this.context.clearVariables();
            
            ActionLogger.logAPIAction('variablesCleared', {});
        } catch (error) {
            ActionLogger.logError('Failed to clear variables', error);
            throw error;
        }
    }

    /**
     * Helper method to get last response
     */
    private getLastResponse(): any {
        const response = this.context.get('lastAPIResponse');
        if (!response) {
            throw new Error('No API response found. Please execute a request first');
        }
        return response;
    }

    /**
     * Helper method to get response body as string
     */
    private getResponseBodyAsString(response: any): string {
        if (!response.body) {
            return '';
        }
        
        if (typeof response.body === 'string') {
            return response.body;
        }
        
        if (Buffer.isBuffer(response.body)) {
            return response.body.toString('utf-8');
        }
        
        return JSON.stringify(response.body, null, 2);
    }

    /**
     * Helper method to parse response as JSON
     */
    private parseResponseAsJSON(response: any): any {
        const bodyText = this.getResponseBodyAsString(response);
        
        try {
            return JSON.parse(bodyText);
        } catch (error) {
            throw new Error(`Failed to parse response as JSON: ${error.message}`);
        }
    }

    /**
     * Helper method to format response body for display
     */
    private formatResponseBody(bodyText: string): string {
        try {
            // Try to parse as JSON and pretty print
            const json = JSON.parse(bodyText);
            return JSON.stringify(json, null, 2);
        } catch {
            // Not JSON, check if XML
            if (bodyText.trim().startsWith('<')) {
                // Basic XML formatting
                return bodyText
                    .replace(/></g, '>\n<')
                    .split('\n')
                    .map((line, index) => {
                        const indent = '  '.repeat(this.getXMLIndentLevel(line));
                        return indent + line.trim();
                    })
                    .join('\n');
            }
            
            // Return as-is
            return bodyText;
        }
    }

    /**
     * Helper method to get XML indent level
     */
    private getXMLIndentLevel(line: string): number {
        if (line.startsWith('</')) return -1;
        if (line.endsWith('/>')) return 0;
        if (line.startsWith('<') && !line.includes('</')) return 1;
        return 0;
    }

    /**
     * Helper method to find header case-insensitively
     */
    private findHeader(headers: Record<string, string>, headerName: string): string | undefined {
        const lowerHeaderName = headerName.toLowerCase();
        
        for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() === lowerHeaderName) {
                return value;
            }
        }
        
        return undefined;
    }

    /**
     * Helper method to truncate long values
     */
    private truncateValue(value: any): string {
        const str = String(value);
        if (str.length > 100) {
            return str.substring(0, 100) + '...';
        }
        return str;
    }

    /**
     * Helper method to format variable value for display
     */
    private formatVariableValue(value: any): string {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    /**
     * Helper method to generate UUID
     */
    private generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Helper method to resolve save paths
     */
    private async resolveSavePath(savePath: string): Promise<string> {
        if (FileUtils.isAbsolutePath(savePath)) {
            return savePath;
        }
        
        const outputPath = ConfigurationManager.get('API_OUTPUT_PATH', './output/api');
        return FileUtils.joinPath(outputPath, savePath);
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