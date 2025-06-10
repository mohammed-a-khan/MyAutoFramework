// src/steps/api/APIChainingSteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { APIContext } from '../../api/context/APIContext';
import { APIChainContext } from '../../api/context/APIChainContext';
import { ResponseStorage } from '../../bdd/context/ResponseStorage';
import { JSONPathValidator } from '../../api/validators/JSONPathValidator';
import { XMLValidator } from '../../api/validators/XMLValidator';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { StringUtils } from '../../core/utils/StringUtils';

/**
 * Step definitions for chaining API responses
 * Enables using data from previous responses in subsequent requests
 */
export class APIChainingSteps extends CSBDDBaseStepDefinition {
    private responseStorage: ResponseStorage;
    private chainContext: APIChainContext;
    private jsonPathValidator: JSONPathValidator;
    private xmlValidator: XMLValidator;

    constructor() {
        super();
        this.responseStorage = new ResponseStorage();
        this.chainContext = new APIChainContext();
        this.jsonPathValidator = new JSONPathValidator();
        this.xmlValidator = new XMLValidator();
    }

    /**
     * Uses JSON path value from stored response as request body field
     * Example: When user uses response JSON path "$.id" from "createUserResponse" as request body field "userId"
     */
    @CSBDDStepDef("user uses response JSON path {string} from {string} as request body field {string}")
    async useJSONPathAsBodyField(jsonPath: string, responseAlias: string, fieldName: string): Promise<void> {
        ActionLogger.logAPIAction('useJSONPathAsBodyField', { jsonPath, responseAlias, fieldName });
        
        try {
            // Get stored response
            const storedResponse = this.getStoredResponse(responseAlias);
            
            // Extract value from JSON path
            const jsonBody = this.parseResponseAsJSON(storedResponse);
            const value = this.jsonPathValidator.extractValue(jsonBody, jsonPath);
            
            if (value === undefined) {
                throw new Error(`JSON path '${jsonPath}' not found in response '${responseAlias}'`);
            }
            
            // Get current API context
            const currentContext = this.getAPIContext();
            
            // Get or create request body
            let body = currentContext.getBody();
            if (!body || typeof body !== 'object') {
                body = {};
            }
            
            // Set field value
            this.setNestedProperty(body, fieldName, value);
            currentContext.setBody(body);
            
            // Store in chain context
            this.chainContext.addChainStep({
                source: responseAlias,
                sourcePath: jsonPath,
                targetType: 'body',
                targetField: fieldName,
                value: value
            });
            
            ActionLogger.logAPIAction('jsonPathUsedAsBodyField', { 
                jsonPath,
                responseAlias,
                fieldName,
                valueType: typeof value,
                value: this.truncateValue(value)
            });
        } catch (error) {
            ActionLogger.logError('Failed to use JSON path as body field', error);
            throw new Error(`Failed to use JSON path from '${responseAlias}': ${error.message}`);
        }
    }

    /**
     * Uses response header value from stored response as request header
     * Example: When user uses response header "X-Auth-Token" from "loginResponse" as request header "Authorization"
     */
    @CSBDDStepDef("user uses response header {string} from {string} as request header {string}")
    async useResponseHeaderAsRequestHeader(sourceHeader: string, responseAlias: string, targetHeader: string): Promise<void> {
        ActionLogger.logAPIAction('useResponseHeaderAsRequestHeader', { sourceHeader, responseAlias, targetHeader });
        
        try {
            // Get stored response
            const storedResponse = this.getStoredResponse(responseAlias);
            
            // Find header value
            const headerValue = this.findHeader(storedResponse.headers, sourceHeader);
            if (!headerValue) {
                throw new Error(`Header '${sourceHeader}' not found in response '${responseAlias}'`);
            }
            
            // Get current API context
            const currentContext = this.getAPIContext();
            
            // Set header
            currentContext.setHeader(targetHeader, headerValue);
            
            // Store in chain context
            this.chainContext.addChainStep({
                source: responseAlias,
                sourceType: 'header',
                sourceHeader: sourceHeader,
                targetType: 'header',
                targetHeader: targetHeader,
                value: headerValue
            });
            
            ActionLogger.logAPIAction('responseHeaderUsedAsRequestHeader', { 
                sourceHeader,
                responseAlias,
                targetHeader,
                value: headerValue
            });
        } catch (error) {
            ActionLogger.logError('Failed to use response header', error);
            throw new Error(`Failed to use response header from '${responseAlias}': ${error.message}`);
        }
    }

    /**
     * Uses stored variable in request URL
     * Example: Then user uses "userId" in request URL "/users/{{userId}}"
     */
    @CSBDDStepDef("user uses {string} in request URL {string}")
    async useVariableInURL(variableName: string, urlPath: string): Promise<void> {
        ActionLogger.logAPIAction('useVariableInURL', { variableName, urlPath });
        
        try {
            const currentContext = this.getAPIContext();
            
            // Get variable value
            const variableValue = this.context.getVariable(variableName);
            if (variableValue === undefined) {
                throw new Error(`Variable '${variableName}' not found`);
            }
            
            // Replace in URL
            const interpolatedPath = urlPath.replace(`{{${variableName}}}`, String(variableValue));
            
            currentContext.setPath(interpolatedPath);
            
            // Store in chain context
            this.chainContext.addChainStep({
                source: 'variable',
                sourceVariable: variableName,
                targetType: 'url',
                targetPath: urlPath,
                value: variableValue,
                interpolatedValue: interpolatedPath
            });
            
            ActionLogger.logAPIAction('variableUsedInURL', { 
                variableName,
                originalPath: urlPath,
                interpolatedPath,
                value: String(variableValue)
            });
        } catch (error) {
            ActionLogger.logError('Failed to use variable in URL', error);
            throw new Error(`Failed to use variable in URL: ${error.message}`);
        }
    }

    /**
     * Uses JSON path from last response in current request
     * Example: When user uses last response JSON path "$.token" as header "Authorization" with prefix "Bearer "
     */
    @CSBDDStepDef("user uses last response JSON path {string} as header {string} with prefix {string}")
    async useLastResponseJSONPathAsHeaderWithPrefix(jsonPath: string, headerName: string, prefix: string): Promise<void> {
        ActionLogger.logAPIAction('useLastResponseJSONPathAsHeader', { jsonPath, headerName, prefix });
        
        try {
            const lastResponse = this.getLastResponse();
            const currentContext = this.getAPIContext();
            
            // Extract value from JSON path
            const jsonBody = this.parseResponseAsJSON(lastResponse);
            const value = this.jsonPathValidator.extractValue(jsonBody, jsonPath);
            
            if (value === undefined) {
                throw new Error(`JSON path '${jsonPath}' not found in last response`);
            }
            
            // Set header with prefix
            const headerValue = prefix + String(value);
            currentContext.setHeader(headerName, headerValue);
            
            // Store in chain context
            this.chainContext.addChainStep({
                source: 'lastResponse',
                sourcePath: jsonPath,
                targetType: 'header',
                targetHeader: headerName,
                prefix: prefix,
                value: value,
                finalValue: headerValue
            });
            
            ActionLogger.logAPIAction('lastResponseJSONPathUsedAsHeader', { 
                jsonPath,
                headerName,
                prefix,
                value: this.truncateValue(value),
                finalValue: this.truncateValue(headerValue)
            });
        } catch (error) {
            ActionLogger.logError('Failed to use last response JSON path', error);
            throw new Error(`Failed to use last response JSON path: ${error.message}`);
        }
    }

    /**
     * Chains multiple values from response to request body
     * Example: When user chains from "userResponse" to request body:
     *   | $.id       | userId     |
     *   | $.email    | userEmail  |
     *   | $.name     | userName   |
     */
    @CSBDDStepDef("user chains from {string} to request body:")
    async chainMultipleValuesToBody(responseAlias: string, dataTable: any): Promise<void> {
        ActionLogger.logAPIAction('chainMultipleValuesToBody', { responseAlias });
        
        try {
            const storedResponse = this.getStoredResponse(responseAlias);
            const currentContext = this.getAPIContext();
            
            // Parse response as JSON
            const jsonBody = this.parseResponseAsJSON(storedResponse);
            
            // Get or create request body
            let body = currentContext.getBody();
            if (!body || typeof body !== 'object') {
                body = {};
            }
            
            // Parse data table
            const rows = dataTable.hashes ? dataTable.hashes() : dataTable.rows();
            let chainedCount = 0;
            
            for (const row of rows) {
                const sourcePath = row[0] || row.sourcePath || row.jsonPath;
                const targetField = row[1] || row.targetField || row.field;
                
                if (!sourcePath || !targetField) {
                    continue;
                }
                
                // Extract value
                const value = this.jsonPathValidator.extractValue(jsonBody, sourcePath);
                if (value !== undefined) {
                    this.setNestedProperty(body, targetField, value);
                    chainedCount++;
                    
                    // Store in chain context
                    this.chainContext.addChainStep({
                        source: responseAlias,
                        sourcePath: sourcePath,
                        targetType: 'body',
                        targetField: targetField,
                        value: value
                    });
                }
            }
            
            currentContext.setBody(body);
            
            ActionLogger.logAPIAction('multipleValuesChainedToBody', { 
                responseAlias,
                chainedCount,
                totalFields: rows.length
            });
        } catch (error) {
            ActionLogger.logError('Failed to chain multiple values', error);
            throw new Error(`Failed to chain values from '${responseAlias}': ${error.message}`);
        }
    }

    /**
     * Uses XML path value from stored response
     * Example: When user uses XML path "//user/id" from "xmlResponse" as query parameter "userId"
     */
    @CSBDDStepDef("user uses XML path {string} from {string} as query parameter {string}")
    async useXMLPathAsQueryParameter(xmlPath: string, responseAlias: string, paramName: string): Promise<void> {
        ActionLogger.logAPIAction('useXMLPathAsQueryParameter', { xmlPath, responseAlias, paramName });
        
        try {
            const storedResponse = this.getStoredResponse(responseAlias);
            const currentContext = this.getAPIContext();
            
            // Get response body as string
            const xmlBody = this.getResponseBodyAsString(storedResponse);
            
            // Extract value using XPath
            const result = this.xmlValidator.extractXPathValue(xmlBody, xmlPath);
            
            if (!result || !result.value) {
                throw new Error(`XML path '${xmlPath}' not found in response '${responseAlias}'`);
            }
            
            // Set query parameter
            currentContext.setQueryParameter(paramName, String(result.value));
            
            // Store in chain context
            this.chainContext.addChainStep({
                source: responseAlias,
                sourcePath: xmlPath,
                sourceType: 'xml',
                targetType: 'query',
                targetParameter: paramName,
                value: result.value
            });
            
            ActionLogger.logAPIAction('xmlPathUsedAsQueryParameter', { 
                xmlPath,
                responseAlias,
                paramName,
                value: String(result.value)
            });
        } catch (error) {
            ActionLogger.logError('Failed to use XML path', error);
            throw new Error(`Failed to use XML path from '${responseAlias}': ${error.message}`);
        }
    }

    /**
     * Creates request body by transforming response
     * Example: When user creates request body from "userResponse" with transformation:
     *   """
     *   {
     *     "user": {
     *       "id": "{{$.id}}",
     *       "email": "{{$.email}}",
     *       "updated": true
     *     }
     *   }
     *   """
     */
    @CSBDDStepDef("user creates request body from {string} with transformation:")
    async createBodyFromResponseWithTransformation(responseAlias: string, template: string): Promise<void> {
        ActionLogger.logAPIAction('createBodyFromResponseTransformation', { responseAlias });
        
        try {
            const storedResponse = this.getStoredResponse(responseAlias);
            const currentContext = this.getAPIContext();
            
            // Parse response as JSON
            const jsonBody = this.parseResponseAsJSON(storedResponse);
            
            // Replace placeholders in template
            let transformedBody = template;
            const placeholderRegex = /\{\{(\$[^}]+)\}\}/g;
            const replacements: Array<{path: string, value: any}> = [];
            
            // Find all placeholders and extract values
            let match;
            while ((match = placeholderRegex.exec(template)) !== null) {
                const jsonPath = match[1];
                const value = this.jsonPathValidator.extractValue(jsonBody, jsonPath);
                
                if (value !== undefined) {
                    replacements.push({ path: jsonPath, value });
                    transformedBody = transformedBody.replace(match[0], JSON.stringify(value));
                }
            }
            
            // Parse transformed body
            let finalBody;
            try {
                finalBody = JSON.parse(transformedBody);
            } catch (error) {
                throw new Error(`Invalid JSON after transformation: ${error.message}`);
            }
            
            currentContext.setBody(finalBody);
            
            // Store transformation in chain context
            this.chainContext.addChainStep({
                source: responseAlias,
                sourceType: 'transformation',
                template: template,
                replacements: replacements,
                targetType: 'body',
                value: finalBody
            });
            
            ActionLogger.logAPIAction('bodyCreatedFromResponseTransformation', { 
                responseAlias,
                replacementCount: replacements.length,
                bodySize: JSON.stringify(finalBody).length
            });
        } catch (error) {
            ActionLogger.logError('Failed to create body from response transformation', error);
            throw new Error(`Failed to create body from response '${responseAlias}': ${error.message}`);
        }
    }

    /**
     * Appends value from response to array in request body
     * Example: When user appends JSON path "$.id" from "itemResponse" to request body array "itemIds"
     */
    @CSBDDStepDef("user appends JSON path {string} from {string} to request body array {string}")
    async appendToBodyArray(jsonPath: string, responseAlias: string, arrayField: string): Promise<void> {
        ActionLogger.logAPIAction('appendToBodyArray', { jsonPath, responseAlias, arrayField });
        
        try {
            const storedResponse = this.getStoredResponse(responseAlias);
            const currentContext = this.getAPIContext();
            
            // Extract value from JSON path
            const jsonBody = this.parseResponseAsJSON(storedResponse);
            const value = this.jsonPathValidator.extractValue(jsonBody, jsonPath);
            
            if (value === undefined) {
                throw new Error(`JSON path '${jsonPath}' not found in response '${responseAlias}'`);
            }
            
            // Get or create request body
            let body = currentContext.getBody();
            if (!body || typeof body !== 'object') {
                body = {};
            }
            
            // Get or create array
            let array = this.getNestedProperty(body, arrayField);
            if (!Array.isArray(array)) {
                array = [];
            }
            
            // Append value
            array.push(value);
            this.setNestedProperty(body, arrayField, array);
            currentContext.setBody(body);
            
            // Store in chain context
            this.chainContext.addChainStep({
                source: responseAlias,
                sourcePath: jsonPath,
                targetType: 'body',
                targetField: arrayField,
                operation: 'append',
                value: value,
                arrayLength: array.length
            });
            
            ActionLogger.logAPIAction('valueAppendedToBodyArray', { 
                jsonPath,
                responseAlias,
                arrayField,
                valueType: typeof value,
                newArrayLength: array.length
            });
        } catch (error) {
            ActionLogger.logError('Failed to append to body array', error);
            throw new Error(`Failed to append to body array: ${error.message}`);
        }
    }

    /**
     * Merges response data into request body
     * Example: When user merges response from "userResponse" into request body
     */
    @CSBDDStepDef("user merges response from {string} into request body")
    async mergeResponseIntoBody(responseAlias: string): Promise<void> {
        ActionLogger.logAPIAction('mergeResponseIntoBody', { responseAlias });
        
        try {
            const storedResponse = this.getStoredResponse(responseAlias);
            const currentContext = this.getAPIContext();
            
            // Parse response as JSON
            const responseData = this.parseResponseAsJSON(storedResponse);
            
            // Get current body
            let body = currentContext.getBody();
            if (!body || typeof body !== 'object') {
                body = {};
            }
            
            // Merge response data into body
            const mergedBody = this.deepMerge(body, responseData);
            currentContext.setBody(mergedBody);
            
            // Store in chain context
            this.chainContext.addChainStep({
                source: responseAlias,
                targetType: 'body',
                operation: 'merge',
                value: responseData,
                mergedResult: mergedBody
            });
            
            ActionLogger.logAPIAction('responseeMergedIntoBody', { 
                responseAlias,
                originalKeys: Object.keys(body).length,
                responseKeys: Object.keys(responseData).length,
                mergedKeys: Object.keys(mergedBody).length
            });
        } catch (error) {
            ActionLogger.logError('Failed to merge response into body', error);
            throw new Error(`Failed to merge response '${responseAlias}' into body: ${error.message}`);
        }
    }

    /**
     * Uses response status code in request
     * Example: When user uses status code from "healthResponse" as query parameter "previousStatus"
     */
    @CSBDDStepDef("user uses status code from {string} as query parameter {string}")
    async useStatusCodeAsQueryParameter(responseAlias: string, paramName: string): Promise<void> {
        ActionLogger.logAPIAction('useStatusCodeAsQueryParameter', { responseAlias, paramName });
        
        try {
            const storedResponse = this.getStoredResponse(responseAlias);
            const currentContext = this.getAPIContext();
            
            const statusCode = storedResponse.statusCode;
            if (!statusCode) {
                throw new Error(`No status code found in response '${responseAlias}'`);
            }
            
            // Set query parameter
            currentContext.setQueryParameter(paramName, String(statusCode));
            
            // Store in chain context
            this.chainContext.addChainStep({
                source: responseAlias,
                sourceType: 'statusCode',
                targetType: 'query',
                targetParameter: paramName,
                value: statusCode
            });
            
            ActionLogger.logAPIAction('statusCodeUsedAsQueryParameter', { 
                responseAlias,
                paramName,
                statusCode
            });
        } catch (error) {
            ActionLogger.logError('Failed to use status code', error);
            throw new Error(`Failed to use status code from '${responseAlias}': ${error.message}`);
        }
    }

    /**
     * Clears all chain context
     * Example: Given user clears chain context
     */
    @CSBDDStepDef("user clears chain context")
    async clearChainContext(): Promise<void> {
        ActionLogger.logAPIAction('clearChainContext', {});
        
        try {
            this.chainContext.clear();
            
            ActionLogger.logAPIAction('chainContextCleared', {});
        } catch (error) {
            ActionLogger.logError('Failed to clear chain context', error);
            throw error;
        }
    }

    /**
     * Prints chain history
     * Example: Given user prints chain history
     */
    @CSBDDStepDef("user prints chain history")
    async printChainHistory(): Promise<void> {
        ActionLogger.logAPIAction('printChainHistory', {});
        
        try {
            const history = this.chainContext.getChainHistory();
            
            console.log('\n========== API CHAIN HISTORY ==========');
            if (history.length === 0) {
                console.log('No chain operations performed');
            } else {
                history.forEach((step, index) => {
                    console.log(`\nStep ${index + 1}:`);
                    console.log(`  Source: ${step.source}`);
                    if (step.sourcePath) console.log(`  Source Path: ${step.sourcePath}`);
                    if (step.sourceType) console.log(`  Source Type: ${step.sourceType}`);
                    console.log(`  Target Type: ${step.targetType}`);
                    if (step.targetField) console.log(`  Target Field: ${step.targetField}`);
                    if (step.targetHeader) console.log(`  Target Header: ${step.targetHeader}`);
                    if (step.targetParameter) console.log(`  Target Parameter: ${step.targetParameter}`);
                    if (step.operation) console.log(`  Operation: ${step.operation}`);
                    console.log(`  Value: ${this.truncateValue(step.value)}`);
                });
            }
            console.log('=====================================\n');
            
            ActionLogger.logAPIAction('chainHistoryPrinted', { 
                stepCount: history.length
            });
        } catch (error) {
            ActionLogger.logError('Failed to print chain history', error);
            throw error;
        }
    }

    /**
     * Helper method to get stored response
     */
    private getStoredResponse(alias: string): any {
        // Try response storage first
        const scenarioId = this.context.getScenarioId();
        let response = this.responseStorage.retrieve(alias, scenarioId);
        
        // Try context storage
        if (!response) {
            response = this.context.get(`response_${alias}`);
        }
        
        if (!response) {
            throw new Error(`No response found with alias '${alias}'. Make sure to store the response first using "Given user stores response as '${alias}'"'`);
        }
        
        return response;
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
     * Helper method to parse response as JSON
     */
    private parseResponseAsJSON(response: any): any {
        const bodyText = this.getResponseBodyAsString(response);
        
        try {
            return JSON.parse(bodyText);
        } catch (error) {
            throw new Error(`Failed to parse response as JSON: ${error.message}. Body: ${bodyText.substring(0, 200)}...`);
        }
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
        
        return JSON.stringify(response.body);
    }

    /**
     * Helper method to find header case-insensitively
     */
    private findHeader(headers: Record<string, string>, headerName: string): string | undefined {
        if (!headers) return undefined;
        
        const lowerHeaderName = headerName.toLowerCase();
        
        for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() === lowerHeaderName) {
                return value;
            }
        }
        
        return undefined;
    }

    /**
     * Helper method to set nested property
     */
    private setNestedProperty(obj: any, path: string, value: any): void {
        const keys = path.split('.');
        let current = obj;
        
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }
        
        current[keys[keys.length - 1]] = value;
    }

    /**
     * Helper method to get nested property
     */
    private getNestedProperty(obj: any, path: string): any {
        const keys = path.split('.');
        let current = obj;
        
        for (const key of keys) {
            if (current && typeof current === 'object' && key in current) {
                current = current[key];
            } else {
                return undefined;
            }
        }
        
        return current;
    }

    /**
     * Helper method to deep merge objects
     */
    private deepMerge(target: any, source: any): any {
        const result = { ...target };
        
        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    if (result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
                        result[key] = this.deepMerge(result[key], source[key]);
                    } else {
                        result[key] = source[key];
                    }
                } else {
                    result[key] = source[key];
                }
            }
        }
        
        return result;
    }

    /**
     * Helper method to truncate long values
     */
    private truncateValue(value: any): string {
        const str = JSON.stringify(value);
        if (str.length > 100) {
            return str.substring(0, 100) + '...';
        }
        return str;
    }
}