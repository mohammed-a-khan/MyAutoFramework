// src/steps/api/ResponseValidationSteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { ResponseValidator } from '../../api/validators/ResponseValidator';
import { StatusCodeValidator } from '../../api/validators/StatusCodeValidator';
import { HeaderValidator } from '../../api/validators/HeaderValidator';
import { BodyValidator } from '../../api/validators/BodyValidator';
import { SchemaValidator } from '../../api/validators/SchemaValidator';
import { JSONPathValidator } from '../../api/validators/JSONPathValidator';
import { XMLValidator } from '../../api/validators/XMLValidator';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { FileUtils } from '../../core/utils/FileUtils';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';
import { StringUtils } from '../../core/utils/StringUtils';

/**
 * Step definitions for validating API responses
 * Provides comprehensive validation capabilities for all response aspects
 */
export class ResponseValidationSteps extends CSBDDBaseStepDefinition {
    private responseValidator: ResponseValidator;
    private statusCodeValidator: StatusCodeValidator;
    private headerValidator: HeaderValidator;
    private bodyValidator: BodyValidator;
    private schemaValidator: SchemaValidator;
    private jsonPathValidator: JSONPathValidator;
    private xmlValidator: XMLValidator;

    constructor() {
        super();
        this.responseValidator = new ResponseValidator();
        this.statusCodeValidator = new StatusCodeValidator();
        this.headerValidator = new HeaderValidator();
        this.bodyValidator = new BodyValidator();
        this.schemaValidator = new SchemaValidator();
        this.jsonPathValidator = new JSONPathValidator();
        this.xmlValidator = new XMLValidator();
    }

    /**
     * Validates response status code
     * Example: Then the response status code should be 200
     */
    @CSBDDStepDef("the response status code should be {int}")
    async validateStatusCode(expectedCode: number): Promise<void> {
        ActionLogger.logAPIAction('validateStatusCode', { expectedCode });
        
        try {
            const response = this.getLastResponse();
            const result = this.statusCodeValidator.validate(response.statusCode, expectedCode);
            
            if (!result.valid) {
                throw new Error(`Status code validation failed: Expected ${expectedCode} but got ${response.statusCode}. ${result.message || ''}`);
            }
            
            ActionLogger.logAPIAction('statusCodeValidated', { 
                expected: expectedCode,
                actual: response.statusCode
            });
        } catch (error) {
            ActionLogger.logError('Status code validation failed', error);
            throw error;
        }
    }

    /**
     * Validates response status code is in range
     * Example: Then the response status code should be between 200 and 299
     */
    @CSBDDStepDef("the response status code should be between {int} and {int}")
    async validateStatusCodeRange(minCode: number, maxCode: number): Promise<void> {
        ActionLogger.logAPIAction('validateStatusCodeRange', { minCode, maxCode });
        
        try {
            const response = this.getLastResponse();
            const result = this.statusCodeValidator.validateRange(response.statusCode, minCode, maxCode);
            
            if (!result.valid) {
                throw new Error(`Status code validation failed: Expected code between ${minCode} and ${maxCode} but got ${response.statusCode}`);
            }
            
            ActionLogger.logAPIAction('statusCodeRangeValidated', { 
                range: `${minCode}-${maxCode}`,
                actual: response.statusCode
            });
        } catch (error) {
            ActionLogger.logError('Status code range validation failed', error);
            throw error;
        }
    }

    /**
     * Validates response body contains text
     * Example: Then the response body should contain "success"
     */
    @CSBDDStepDef("the response body should contain {string}")
    async validateBodyContains(expectedText: string): Promise<void> {
        ActionLogger.logAPIAction('validateBodyContains', { expectedText });
        
        try {
            const response = this.getLastResponse();
            const interpolatedText = await this.interpolateValue(expectedText);
            
            const bodyText = this.getResponseBodyAsString(response);
            const result = this.bodyValidator.validateContains(bodyText, interpolatedText);
            
            if (!result.valid) {
                throw new Error(`Response body validation failed: Expected to contain '${interpolatedText}' but it was not found. Body preview: ${bodyText.substring(0, 200)}...`);
            }
            
            ActionLogger.logAPIAction('bodyContainsValidated', { 
                searchText: interpolatedText,
                found: true
            });
        } catch (error) {
            ActionLogger.logError('Body contains validation failed', error);
            throw error;
        }
    }

    /**
     * Validates response body does not contain text
     * Example: Then the response body should not contain "error"
     */
    @CSBDDStepDef("the response body should not contain {string}")
    async validateBodyNotContains(text: string): Promise<void> {
        ActionLogger.logAPIAction('validateBodyNotContains', { text });
        
        try {
            const response = this.getLastResponse();
            const interpolatedText = await this.interpolateValue(text);
            
            const bodyText = this.getResponseBodyAsString(response);
            
            if (bodyText.includes(interpolatedText)) {
                throw new Error(`Response body validation failed: Expected NOT to contain '${interpolatedText}' but it was found`);
            }
            
            ActionLogger.logAPIAction('bodyNotContainsValidated', { 
                searchText: interpolatedText,
                notFound: true
            });
        } catch (error) {
            ActionLogger.logError('Body not contains validation failed', error);
            throw error;
        }
    }

    /**
     * Validates response body equals expected value
     * Example: Then the response body should equal "OK"
     */
    @CSBDDStepDef("the response body should equal {string}")
    async validateBodyEquals(expectedBody: string): Promise<void> {
        ActionLogger.logAPIAction('validateBodyEquals', { 
            expectedLength: expectedBody.length 
        });
        
        try {
            const response = this.getLastResponse();
            const interpolatedBody = await this.interpolateValue(expectedBody);
            
            const bodyText = this.getResponseBodyAsString(response);
            
            if (bodyText !== interpolatedBody) {
                throw new Error(`Response body validation failed: Expected body to equal '${interpolatedBody}' but got '${bodyText}'`);
            }
            
            ActionLogger.logAPIAction('bodyEqualsValidated', { 
                bodyLength: bodyText.length
            });
        } catch (error) {
            ActionLogger.logError('Body equals validation failed', error);
            throw error;
        }
    }

    /**
     * Validates JSON path exists
     * Example: Then the response JSON path "$.data.id" should exist
     */
    @CSBDDStepDef("the response JSON path {string} should exist")
    async validateJSONPathExists(jsonPath: string): Promise<void> {
        ActionLogger.logAPIAction('validateJSONPathExists', { jsonPath });
        
        try {
            const response = this.getLastResponse();
            const jsonBody = this.parseResponseAsJSON(response);
            
            const value = this.jsonPathValidator.extractValue(jsonBody, jsonPath);
            
            if (value === undefined) {
                throw new Error(`JSON path validation failed: Path '${jsonPath}' does not exist in response`);
            }
            
            ActionLogger.logAPIAction('jsonPathExistsValidated', { 
                jsonPath,
                valueType: typeof value
            });
        } catch (error) {
            ActionLogger.logError('JSON path exists validation failed', error);
            throw error;
        }
    }

    /**
     * Validates JSON path value equals expected
     * Example: Then the response JSON path "$.status" should equal "active"
     */
    @CSBDDStepDef("the response JSON path {string} should equal {string}")
    async validateJSONPathEquals(jsonPath: string, expectedValue: string): Promise<void> {
        ActionLogger.logAPIAction('validateJSONPathEquals', { jsonPath, expectedValue });
        
        try {
            const response = this.getLastResponse();
            const jsonBody = this.parseResponseAsJSON(response);
            const interpolatedValue = await this.interpolateValue(expectedValue);
            
            // Parse expected value
            const parsedExpected = this.parseExpectedValue(interpolatedValue);
            
            const result = this.jsonPathValidator.validatePath(jsonBody, jsonPath, parsedExpected);
            
            if (!result.valid) {
                throw new Error(`JSON path validation failed: ${result.message}`);
            }
            
            ActionLogger.logAPIAction('jsonPathEqualsValidated', { 
                jsonPath,
                expectedValue: parsedExpected,
                actualValue: result.actualValue
            });
        } catch (error) {
            ActionLogger.logError('JSON path equals validation failed', error);
            throw error;
        }
    }

    /**
     * Validates JSON path value contains expected text
     * Example: Then the response JSON path "$.message" should contain "success"
     */
    @CSBDDStepDef("the response JSON path {string} should contain {string}")
    async validateJSONPathContains(jsonPath: string, expectedText: string): Promise<void> {
        ActionLogger.logAPIAction('validateJSONPathContains', { jsonPath, expectedText });
        
        try {
            const response = this.getLastResponse();
            const jsonBody = this.parseResponseAsJSON(response);
            const interpolatedText = await this.interpolateValue(expectedText);
            
            const value = this.jsonPathValidator.extractValue(jsonBody, jsonPath);
            
            if (value === undefined) {
                throw new Error(`JSON path validation failed: Path '${jsonPath}' does not exist`);
            }
            
            const stringValue = String(value);
            if (!stringValue.includes(interpolatedText)) {
                throw new Error(`JSON path validation failed: Expected '${jsonPath}' to contain '${interpolatedText}' but got '${stringValue}'`);
            }
            
            ActionLogger.logAPIAction('jsonPathContainsValidated', { 
                jsonPath,
                containsText: interpolatedText
            });
        } catch (error) {
            ActionLogger.logError('JSON path contains validation failed', error);
            throw error;
        }
    }

    /**
     * Validates JSON path array length
     * Example: Then the response JSON path "$.items" should have 5 elements
     */
    @CSBDDStepDef("the response JSON path {string} should have {int} elements")
    async validateJSONPathArrayLength(jsonPath: string, expectedLength: number): Promise<void> {
        ActionLogger.logAPIAction('validateJSONPathArrayLength', { jsonPath, expectedLength });
        
        try {
            const response = this.getLastResponse();
            const jsonBody = this.parseResponseAsJSON(response);
            
            const value = this.jsonPathValidator.extractValue(jsonBody, jsonPath);
            
            if (!Array.isArray(value)) {
                throw new Error(`JSON path validation failed: Path '${jsonPath}' is not an array`);
            }
            
            if (value.length !== expectedLength) {
                throw new Error(`JSON path validation failed: Expected array at '${jsonPath}' to have ${expectedLength} elements but has ${value.length}`);
            }
            
            ActionLogger.logAPIAction('jsonPathArrayLengthValidated', { 
                jsonPath,
                expectedLength,
                actualLength: value.length
            });
        } catch (error) {
            ActionLogger.logError('JSON path array length validation failed', error);
            throw error;
        }
    }

    /**
     * Validates response against JSON schema
     * Example: Then the response should match schema "user-schema.json"
     */
    @CSBDDStepDef("the response should match schema {string}")
    async validateJSONSchema(schemaFile: string): Promise<void> {
        ActionLogger.logAPIAction('validateJSONSchema', { schemaFile });
        
        try {
            const response = this.getLastResponse();
            const jsonBody = this.parseResponseAsJSON(response);
            
            // Load schema
            const schemaPath = await this.resolveSchemaPath(schemaFile);
            const schemaContent = await FileUtils.readFile(schemaPath);
            const schema = JSON.parse(schemaContent);
            
            // Validate
            const result = this.schemaValidator.validateSchema(jsonBody, schema);
            
            if (!result.valid) {
                const errors = result.errors.map(e => `  - ${e.path}: ${e.message}`).join('\n');
                throw new Error(`Schema validation failed:\n${errors}`);
            }
            
            ActionLogger.logAPIAction('schemaValidated', { 
                schemaFile: schemaPath,
                valid: true
            });
        } catch (error) {
            ActionLogger.logError('Schema validation failed', error);
            throw error;
        }
    }

    /**
     * Validates response header exists
     * Example: Then the response should have header "Content-Type"
     */
    @CSBDDStepDef("the response should have header {string}")
    async validateHeaderExists(headerName: string): Promise<void> {
        ActionLogger.logAPIAction('validateHeaderExists', { headerName });
        
        try {
            const response = this.getLastResponse();
            const result = this.headerValidator.validateHeaderExists(response.headers, headerName);
            
            if (!result.valid) {
                throw new Error(`Header validation failed: Expected header '${headerName}' not found`);
            }
            
            ActionLogger.logAPIAction('headerExistsValidated', { 
                headerName,
                value: response.headers[headerName]
            });
        } catch (error) {
            ActionLogger.logError('Header exists validation failed', error);
            throw error;
        }
    }

    /**
     * Validates response header value
     * Example: Then the response header "Content-Type" should equal "application/json"
     */
    @CSBDDStepDef("the response header {string} should equal {string}")
    async validateHeaderEquals(headerName: string, expectedValue: string): Promise<void> {
        ActionLogger.logAPIAction('validateHeaderEquals', { headerName, expectedValue });
        
        try {
            const response = this.getLastResponse();
            const interpolatedValue = await this.interpolateValue(expectedValue);
            
            const result = this.headerValidator.validateHeader(response.headers, headerName, interpolatedValue);
            
            if (!result.valid) {
                const actualValue = response.headers[headerName] || 'not found';
                throw new Error(`Header validation failed: Expected header '${headerName}' to equal '${interpolatedValue}' but got '${actualValue}'`);
            }
            
            ActionLogger.logAPIAction('headerEqualsValidated', { 
                headerName,
                expectedValue: interpolatedValue,
                actualValue: response.headers[headerName]
            });
        } catch (error) {
            ActionLogger.logError('Header equals validation failed', error);
            throw error;
        }
    }

    /**
     * Validates response header contains value
     * Example: Then the response header "Content-Type" should contain "json"
     */
    @CSBDDStepDef("the response header {string} should contain {string}")
    async validateHeaderContains(headerName: string, expectedText: string): Promise<void> {
        ActionLogger.logAPIAction('validateHeaderContains', { headerName, expectedText });
        
        try {
            const response = this.getLastResponse();
            const interpolatedText = await this.interpolateValue(expectedText);
            
            const headerValue = response.headers[headerName];
            if (!headerValue) {
                throw new Error(`Header validation failed: Header '${headerName}' not found`);
            }
            
            if (!headerValue.includes(interpolatedText)) {
                throw new Error(`Header validation failed: Expected header '${headerName}' to contain '${interpolatedText}' but got '${headerValue}'`);
            }
            
            ActionLogger.logAPIAction('headerContainsValidated', { 
                headerName,
                containsText: interpolatedText,
                headerValue
            });
        } catch (error) {
            ActionLogger.logError('Header contains validation failed', error);
            throw error;
        }
    }

    /**
     * Validates response time
     * Example: Then the response time should be less than 2000 ms
     */
    @CSBDDStepDef("the response time should be less than {int} ms")
    async validateResponseTime(maxTimeMs: number): Promise<void> {
        ActionLogger.logAPIAction('validateResponseTime', { maxTimeMs });
        
        try {
            const response = this.getLastResponse();
            const responseTime = response.responseTime || 0;
            
            if (responseTime > maxTimeMs) {
                throw new Error(`Response time validation failed: Expected response time less than ${maxTimeMs}ms but was ${responseTime}ms`);
            }
            
            ActionLogger.logAPIAction('responseTimeValidated', { 
                maxTime: maxTimeMs,
                actualTime: responseTime
            });
        } catch (error) {
            ActionLogger.logError('Response time validation failed', error);
            throw error;
        }
    }

    /**
     * Validates XML response with XPath
     * Example: Then the XML response path "//user/name" should equal "John"
     */
    @CSBDDStepDef("the XML response path {string} should equal {string}")
    async validateXPathEquals(xpath: string, expectedValue: string): Promise<void> {
        ActionLogger.logAPIAction('validateXPathEquals', { xpath, expectedValue });
        
        try {
            const response = this.getLastResponse();
            const xmlBody = this.getResponseBodyAsString(response);
            const interpolatedValue = await this.interpolateValue(expectedValue);
            
            const result = this.xmlValidator.validateXPath(xmlBody, xpath, interpolatedValue);
            
            if (!result.valid) {
                throw new Error(`XPath validation failed: ${result.message}`);
            }
            
            ActionLogger.logAPIAction('xpathEqualsValidated', { 
                xpath,
                expectedValue: interpolatedValue
            });
        } catch (error) {
            ActionLogger.logError('XPath equals validation failed', error);
            throw error;
        }
    }

    /**
     * Validates response is empty
     * Example: Then the response body should be empty
     */
    @CSBDDStepDef("the response body should be empty")
    async validateBodyEmpty(): Promise<void> {
        ActionLogger.logAPIAction('validateBodyEmpty', {});
        
        try {
            const response = this.getLastResponse();
            const bodyText = this.getResponseBodyAsString(response);
            
            if (bodyText && bodyText.trim().length > 0) {
                throw new Error(`Response body validation failed: Expected empty body but got '${bodyText.substring(0, 100)}...'`);
            }
            
            ActionLogger.logAPIAction('bodyEmptyValidated', {});
        } catch (error) {
            ActionLogger.logError('Body empty validation failed', error);
            throw error;
        }
    }

    /**
     * Validates response matches regex pattern
     * Example: Then the response body should match pattern "^[A-Z0-9]+$"
     */
    @CSBDDStepDef("the response body should match pattern {string}")
    async validateBodyPattern(pattern: string): Promise<void> {
        ActionLogger.logAPIAction('validateBodyPattern', { pattern });
        
        try {
            const response = this.getLastResponse();
            const bodyText = this.getResponseBodyAsString(response);
            
            const regex = new RegExp(pattern);
            if (!regex.test(bodyText)) {
                throw new Error(`Response body validation failed: Body does not match pattern '${pattern}'`);
            }
            
            ActionLogger.logAPIAction('bodyPatternValidated', { pattern });
        } catch (error) {
            ActionLogger.logError('Body pattern validation failed', error);
            throw error;
        }
    }

    /**
     * Validates JSON response against inline schema
     * Example: Then the response should match JSON schema:
     *   """json
     *   {
     *     "type": "object",
     *     "required": ["id", "name"]
     *   }
     *   """
     */
    @CSBDDStepDef("the response should match JSON schema:")
    async validateInlineJSONSchema(schemaJson: string): Promise<void> {
        ActionLogger.logAPIAction('validateInlineJSONSchema', {});
        
        try {
            const response = this.getLastResponse();
            const jsonBody = this.parseResponseAsJSON(response);
            
            // Parse schema
            let schema: any;
            try {
                schema = JSON.parse(schemaJson);
            } catch (error) {
                throw new Error(`Invalid JSON schema: ${error.message}`);
            }
            
            // Validate
            const result = this.schemaValidator.validateSchema(jsonBody, schema);
            
            if (!result.valid) {
                const errors = result.errors.map(e => `  - ${e.path}: ${e.message}`).join('\n');
                throw new Error(`Schema validation failed:\n${errors}`);
            }
            
            ActionLogger.logAPIAction('inlineSchemaValidated', { valid: true });
        } catch (error) {
            ActionLogger.logError('Inline schema validation failed', error);
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
        
        return JSON.stringify(response.body);
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
     * Helper method to parse expected values
     */
    private parseExpectedValue(value: string): any {
        // Try to parse as JSON first
        try {
            return JSON.parse(value);
        } catch {
            // Check for special values
            if (value === 'true') return true;
            if (value === 'false') return false;
            if (value === 'null') return null;
            if (value === 'undefined') return undefined;
            
            // Check if number
            const num = Number(value);
            if (!isNaN(num) && value.trim() !== '') {
                return num;
            }
            
            // Return as string
            return value;
        }
    }

    /**
     * Helper method to resolve schema paths
     */
    private async resolveSchemaPath(schemaFile: string): Promise<string> {
        if (FileUtils.isAbsolutePath(schemaFile)) {
            return schemaFile;
        }
        
        // Try schema directory
        const schemaPath = ConfigurationManager.get('SCHEMA_PATH', './test-data/schemas');
        const resolvedPath = FileUtils.joinPath(schemaPath, schemaFile);
        
        if (await FileUtils.exists(resolvedPath)) {
            return resolvedPath;
        }
        
        // Try test data directory
        const testDataPath = ConfigurationManager.get('TEST_DATA_PATH', './test-data');
        const testDataResolvedPath = FileUtils.joinPath(testDataPath, 'schemas', schemaFile);
        
        if (await FileUtils.exists(testDataResolvedPath)) {
            return testDataResolvedPath;
        }
        
        // Try relative to project root
        if (await FileUtils.exists(schemaFile)) {
            return schemaFile;
        }
        
        throw new Error(`Schema file not found: ${schemaFile}`);
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