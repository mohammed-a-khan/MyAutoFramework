// src/steps/api/RequestExecutionSteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { APIContext } from '../../api/context/APIContext';
import { CSHttpClient } from '../../api/client/CSHttpClient';
import { RequestBuilder } from '../../api/client/RequestBuilder';
import { ResponseStorage } from '../../bdd/context/ResponseStorage';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { FileUtils } from '../../core/utils/FileUtils';
import { StringUtils } from '../../core/utils/StringUtils';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';

/**
 * Step definitions for executing API requests
 * Handles all HTTP methods and request execution scenarios
 */
export class RequestExecutionSteps extends CSBDDBaseStepDefinition {
    private httpClient: CSHttpClient;
    private responseStorage: ResponseStorage;

    constructor() {
        super();
        this.httpClient = new CSHttpClient();
        this.responseStorage = new ResponseStorage();
    }

    /**
     * Sends a request with the configured method
     * Example: When user sends request
     */
    @CSBDDStepDef("user sends request")
    async sendRequest(): Promise<void> {
        const currentContext = this.getAPIContext();
        const method = currentContext.getMethod() || 'GET';
        
        ActionLogger.logAPIAction('sendRequest', { 
            method,
            baseUrl: currentContext.getBaseUrl(),
            path: currentContext.getPath()
        });
        
        try {
            await this.executeRequest(currentContext);
        } catch (error) {
            ActionLogger.logError('Failed to send request', error);
            throw new Error(`Failed to send ${method} request: ${error.message}`);
        }
    }

    /**
     * Sends a GET request
     * Example: When user sends GET request
     */
    @CSBDDStepDef("user sends GET request")
    async sendGETRequest(): Promise<void> {
        ActionLogger.logAPIAction('sendGETRequest', {});
        
        try {
            const currentContext = this.getAPIContext();
            currentContext.setMethod('GET');
            
            await this.executeRequest(currentContext);
        } catch (error) {
            ActionLogger.logError('Failed to send GET request', error);
            throw new Error(`Failed to send GET request: ${error.message}`);
        }
    }

    /**
     * Sends a GET request to a specific path
     * Example: When user sends GET request to "/api/users"
     */
    @CSBDDStepDef("user sends GET request to {string}")
    async sendGETRequestTo(path: string): Promise<void> {
        ActionLogger.logAPIAction('sendGETRequestTo', { path });
        
        try {
            const currentContext = this.getAPIContext();
            const interpolatedPath = await this.interpolateValue(path);
            
            currentContext.setMethod('GET');
            currentContext.setPath(interpolatedPath);
            
            await this.executeRequest(currentContext);
        } catch (error) {
            ActionLogger.logError('Failed to send GET request', error);
            throw new Error(`Failed to send GET request to '${path}': ${error.message}`);
        }
    }

    /**
     * Sends a POST request
     * Example: When user sends POST request
     */
    @CSBDDStepDef("user sends POST request")
    async sendPOSTRequest(): Promise<void> {
        ActionLogger.logAPIAction('sendPOSTRequest', {});
        
        try {
            const currentContext = this.getAPIContext();
            currentContext.setMethod('POST');
            
            await this.executeRequest(currentContext);
        } catch (error) {
            ActionLogger.logError('Failed to send POST request', error);
            throw new Error(`Failed to send POST request: ${error.message}`);
        }
    }

    /**
     * Sends a POST request to a specific path
     * Example: When user sends POST request to "/api/users"
     */
    @CSBDDStepDef("user sends POST request to {string}")
    async sendPOSTRequestTo(path: string): Promise<void> {
        ActionLogger.logAPIAction('sendPOSTRequestTo', { path });
        
        try {
            const currentContext = this.getAPIContext();
            const interpolatedPath = await this.interpolateValue(path);
            
            currentContext.setMethod('POST');
            currentContext.setPath(interpolatedPath);
            
            await this.executeRequest(currentContext);
        } catch (error) {
            ActionLogger.logError('Failed to send POST request', error);
            throw new Error(`Failed to send POST request to '${path}': ${error.message}`);
        }
    }

    /**
     * Sends a PUT request
     * Example: When user sends PUT request
     */
    @CSBDDStepDef("user sends PUT request")
    async sendPUTRequest(): Promise<void> {
        ActionLogger.logAPIAction('sendPUTRequest', {});
        
        try {
            const currentContext = this.getAPIContext();
            currentContext.setMethod('PUT');
            
            await this.executeRequest(currentContext);
        } catch (error) {
            ActionLogger.logError('Failed to send PUT request', error);
            throw new Error(`Failed to send PUT request: ${error.message}`);
        }
    }

    /**
     * Sends a PUT request to a specific path
     * Example: When user sends PUT request to "/api/users/123"
     */
    @CSBDDStepDef("user sends PUT request to {string}")
    async sendPUTRequestTo(path: string): Promise<void> {
        ActionLogger.logAPIAction('sendPUTRequestTo', { path });
        
        try {
            const currentContext = this.getAPIContext();
            const interpolatedPath = await this.interpolateValue(path);
            
            currentContext.setMethod('PUT');
            currentContext.setPath(interpolatedPath);
            
            await this.executeRequest(currentContext);
        } catch (error) {
            ActionLogger.logError('Failed to send PUT request', error);
            throw new Error(`Failed to send PUT request to '${path}': ${error.message}`);
        }
    }

    /**
     * Sends a DELETE request
     * Example: When user sends DELETE request
     */
    @CSBDDStepDef("user sends DELETE request")
    async sendDELETERequest(): Promise<void> {
        ActionLogger.logAPIAction('sendDELETERequest', {});
        
        try {
            const currentContext = this.getAPIContext();
            currentContext.setMethod('DELETE');
            
            await this.executeRequest(currentContext);
        } catch (error) {
            ActionLogger.logError('Failed to send DELETE request', error);
            throw new Error(`Failed to send DELETE request: ${error.message}`);
        }
    }

    /**
     * Sends a DELETE request to a specific path
     * Example: When user sends DELETE request to "/api/users/123"
     */
    @CSBDDStepDef("user sends DELETE request to {string}")
    async sendDELETERequestTo(path: string): Promise<void> {
        ActionLogger.logAPIAction('sendDELETERequestTo', { path });
        
        try {
            const currentContext = this.getAPIContext();
            const interpolatedPath = await this.interpolateValue(path);
            
            currentContext.setMethod('DELETE');
            currentContext.setPath(interpolatedPath);
            
            await this.executeRequest(currentContext);
        } catch (error) {
            ActionLogger.logError('Failed to send DELETE request', error);
            throw new Error(`Failed to send DELETE request to '${path}': ${error.message}`);
        }
    }

    /**
     * Sends a PATCH request
     * Example: When user sends PATCH request
     */
    @CSBDDStepDef("user sends PATCH request")
    async sendPATCHRequest(): Promise<void> {
        ActionLogger.logAPIAction('sendPATCHRequest', {});
        
        try {
            const currentContext = this.getAPIContext();
            currentContext.setMethod('PATCH');
            
            await this.executeRequest(currentContext);
        } catch (error) {
            ActionLogger.logError('Failed to send PATCH request', error);
            throw new Error(`Failed to send PATCH request: ${error.message}`);
        }
    }

    /**
     * Sends a PATCH request to a specific path
     * Example: When user sends PATCH request to "/api/users/123"
     */
    @CSBDDStepDef("user sends PATCH request to {string}")
    async sendPATCHRequestTo(path: string): Promise<void> {
        ActionLogger.logAPIAction('sendPATCHRequestTo', { path });
        
        try {
            const currentContext = this.getAPIContext();
            const interpolatedPath = await this.interpolateValue(path);
            
            currentContext.setMethod('PATCH');
            currentContext.setPath(interpolatedPath);
            
            await this.executeRequest(currentContext);
        } catch (error) {
            ActionLogger.logError('Failed to send PATCH request', error);
            throw new Error(`Failed to send PATCH request to '${path}': ${error.message}`);
        }
    }

    /**
     * Sends a HEAD request
     * Example: When user sends HEAD request
     */
    @CSBDDStepDef("user sends HEAD request")
    async sendHEADRequest(): Promise<void> {
        ActionLogger.logAPIAction('sendHEADRequest', {});
        
        try {
            const currentContext = this.getAPIContext();
            currentContext.setMethod('HEAD');
            
            await this.executeRequest(currentContext);
        } catch (error) {
            ActionLogger.logError('Failed to send HEAD request', error);
            throw new Error(`Failed to send HEAD request: ${error.message}`);
        }
    }

    /**
     * Sends an OPTIONS request
     * Example: When user sends OPTIONS request
     */
    @CSBDDStepDef("user sends OPTIONS request")
    async sendOPTIONSRequest(): Promise<void> {
        ActionLogger.logAPIAction('sendOPTIONSRequest', {});
        
        try {
            const currentContext = this.getAPIContext();
            currentContext.setMethod('OPTIONS');
            
            await this.executeRequest(currentContext);
        } catch (error) {
            ActionLogger.logError('Failed to send OPTIONS request', error);
            throw new Error(`Failed to send OPTIONS request: ${error.message}`);
        }
    }

    /**
     * Uploads a file
     * Example: When user uploads file "data.csv" to "/api/upload"
     */
    @CSBDDStepDef("user uploads file {string} to {string}")
    async uploadFile(filePath: string, uploadPath: string): Promise<void> {
        ActionLogger.logAPIAction('uploadFile', { filePath, uploadPath });
        
        try {
            const currentContext = this.getAPIContext();
            
            // Resolve file path
            const resolvedPath = await this.resolveFilePath(filePath);
            
            // Check if file exists
            if (!await FileUtils.exists(resolvedPath)) {
                throw new Error(`Upload file not found: ${resolvedPath}`);
            }
            
            // Get file info
            const fileStats = await FileUtils.getFileStats(resolvedPath);
            const fileName = FileUtils.getFileName(resolvedPath);
            const mimeType = this.getMimeType(resolvedPath);
            
            // Set up multipart form data
            const multipartData = {
                _isMultipart: true,
                fields: {},
                files: {
                    file: {
                        path: resolvedPath,
                        filename: fileName,
                        contentType: mimeType,
                        size: fileStats.size
                    }
                }
            };
            
            // Configure request
            const interpolatedPath = await this.interpolateValue(uploadPath);
            currentContext.setMethod('POST');
            currentContext.setPath(interpolatedPath);
            currentContext.setBody(multipartData);
            currentContext.setHeader('Content-Type', 'multipart/form-data');
            
            await this.executeRequest(currentContext);
            
            ActionLogger.logAPIAction('fileUploaded', { 
                fileName,
                fileSize: fileStats.size,
                uploadPath: interpolatedPath
            });
        } catch (error) {
            ActionLogger.logError('Failed to upload file', error);
            throw new Error(`Failed to upload file '${filePath}': ${error.message}`);
        }
    }

    /**
     * Downloads a file from an endpoint
     * Example: When user downloads file from "/api/files/123" as "output.pdf"
     */
    @CSBDDStepDef("user downloads file from {string} as {string}")
    async downloadFile(downloadPath: string, saveAs: string): Promise<void> {
        ActionLogger.logAPIAction('downloadFile', { downloadPath, saveAs });
        
        try {
            const currentContext = this.getAPIContext();
            
            // Configure request
            const interpolatedPath = await this.interpolateValue(downloadPath);
            currentContext.setMethod('GET');
            currentContext.setPath(interpolatedPath);
            currentContext.setRequestOption('responseType', 'stream');
            
            // Execute request
            const response = await this.executeRequestInternal(currentContext);
            
            // Save file
            const savePath = await this.resolveSavePath(saveAs);
            await FileUtils.ensureDirectoryExists(FileUtils.getDirectory(savePath));
            
            await FileUtils.writeFile(savePath, response.body, 'binary');
            
            ActionLogger.logAPIAction('fileDownloaded', { 
                downloadPath: interpolatedPath,
                savedAs: savePath,
                size: response.headers['content-length'] || 'unknown'
            });
        } catch (error) {
            ActionLogger.logError('Failed to download file', error);
            throw new Error(`Failed to download file from '${downloadPath}': ${error.message}`);
        }
    }

    /**
     * Executes a request with custom method
     * Example: When user sends "CUSTOM" request to "/api/endpoint"
     */
    @CSBDDStepDef("user sends {string} request to {string}")
    async sendCustomRequest(method: string, path: string): Promise<void> {
        ActionLogger.logAPIAction('sendCustomRequest', { method, path });
        
        try {
            const currentContext = this.getAPIContext();
            const interpolatedPath = await this.interpolateValue(path);
            
            currentContext.setMethod(method.toUpperCase());
            currentContext.setPath(interpolatedPath);
            
            await this.executeRequest(currentContext);
        } catch (error) {
            ActionLogger.logError('Failed to send custom request', error);
            throw new Error(`Failed to send ${method} request to '${path}': ${error.message}`);
        }
    }

    /**
     * Core method to execute the request
     */
    private async executeRequest(context: APIContext): Promise<void> {
        const response = await this.executeRequestInternal(context);
        
        // Store response in context
        context.setLastResponse(response);
        
        // Store in BDD context for validation steps
        this.context.set('lastAPIResponse', response);
        
        // Add to response storage
        const scenarioId = this.context.getScenarioId();
        this.responseStorage.store('last', response, scenarioId);
        
        // Log response summary
        ActionLogger.logAPIAction('responseReceived', {
            statusCode: response.statusCode,
            statusText: response.statusText,
            responseTime: response.responseTime,
            bodySize: response.body ? String(response.body).length : 0
        });
    }

    /**
     * Internal method to execute request and return response
     */
    private async executeRequestInternal(context: APIContext): Promise<any> {
        // Build request
        const requestBuilder = new RequestBuilder()
            .setMethod(context.getMethod() || 'GET')
            .setUrl(this.buildFullUrl(context))
            .setHeaders(this.mergeHeaders(context))
            .setTimeout(context.getTimeout())
            .setRetryCount(context.getRetryCount())
            .setRetryDelay(context.getRetryDelay())
            .setSSLValidation(context.getSSLValidation())
            .setFollowRedirects(context.getFollowRedirects())
            .setMaxRedirects(context.getMaxRedirects());
        
        // Set body if present
        const body = context.getBody();
        if (body) {
            requestBuilder.setBody(body);
        }
        
        // Set authentication if configured
        const auth = context.getAuthentication();
        if (auth) {
            requestBuilder.setAuthentication(auth);
        }
        
        // Apply request options
        const requestOptions = context.getRequestOptions();
        Object.entries(requestOptions).forEach(([key, value]) => {
            requestBuilder.setOption(key, value);
        });
        
        // Log request details if enabled
        if (context.getRequestLogging()) {
            ActionLogger.logAPIRequest({
                method: context.getMethod(),
                url: this.buildFullUrl(context),
                headers: this.mergeHeaders(context),
                body: body
            });
        }
        
        // Execute request
        const startTime = Date.now();
        const request = requestBuilder.build();
        const response = await this.httpClient.request(request);
        response.responseTime = Date.now() - startTime;
        
        // Log response if enabled
        if (context.getRequestLogging()) {
            ActionLogger.logAPIResponse({
                statusCode: response.statusCode,
                statusText: response.statusText,
                headers: response.headers,
                body: response.body,
                responseTime: response.responseTime
            });
        }
        
        return response;
    }

    /**
     * Helper method to build full URL
     */
    private buildFullUrl(context: APIContext): string {
        const baseUrl = context.getBaseUrl();
        const path = context.getPath() || '';
        const queryParams = context.getQueryParameters();
        
        let url = baseUrl;
        
        // Add path
        if (path) {
            if (!baseUrl.endsWith('/') && !path.startsWith('/')) {
                url += '/';
            }
            url += path;
        }
        
        // Add query parameters
        if (Object.keys(queryParams).length > 0) {
            const params = new URLSearchParams(queryParams);
            url += '?' + params.toString();
        }
        
        return url;
    }

    /**
     * Helper method to merge headers
     */
    private mergeHeaders(context: APIContext): Record<string, string> {
        const defaultHeaders = context.getDefaultHeaders();
        const requestHeaders = context.getHeaders();
        
        return {
            ...defaultHeaders,
            ...requestHeaders
        };
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

    /**
     * Helper method to resolve file paths
     */
    private async resolveFilePath(filePath: string): Promise<string> {
        if (FileUtils.isAbsolutePath(filePath)) {
            return filePath;
        }
        
        const testDataPath = ConfigurationManager.get('TEST_DATA_PATH', './test-data');
        const resolvedPath = FileUtils.joinPath(testDataPath, filePath);
        
        if (await FileUtils.exists(resolvedPath)) {
            return resolvedPath;
        }
        
        return filePath;
    }

    /**
     * Helper method to resolve save paths
     */
    private async resolveSavePath(savePath: string): Promise<string> {
        if (FileUtils.isAbsolutePath(savePath)) {
            return savePath;
        }
        
        const downloadsPath = ConfigurationManager.get('DOWNLOADS_PATH', './downloads');
        return FileUtils.joinPath(downloadsPath, savePath);
    }

    /**
     * Helper method to get MIME type
     */
    private getMimeType(filePath: string): string {
        const ext = FileUtils.getExtension(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls': 'application/vnd.ms-excel',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.txt': 'text/plain',
            '.csv': 'text/csv',
            '.zip': 'application/zip',
            '.json': 'application/json',
            '.xml': 'application/xml'
        };
        
        return mimeTypes[ext] || 'application/octet-stream';
    }
}