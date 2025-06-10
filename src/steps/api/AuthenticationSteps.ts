// src/steps/api/AuthenticationSteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { APIContext } from '../../api/context/APIContext';
import { CertificateManager } from '../../api/auth/CertificateManager';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { FileUtils } from '../../core/utils/FileUtils';
import { CryptoUtils } from '../../core/utils/CryptoUtils';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';

/**
 * Step definitions for API authentication
 * Supports all authentication methods: Basic, Bearer, API Key, OAuth2, Certificate, NTLM, AWS
 */
export class AuthenticationSteps extends CSBDDBaseStepDefinition {
    private certificateManager: CertificateManager;

    constructor() {
        super();
        this.certificateManager = new CertificateManager();
    }

    /**
     * Sets Bearer token authentication
     * Example: Given user sets bearer token "{{authToken}}"
     */
    @CSBDDStepDef("user sets bearer token {string}")
    async setBearerToken(token: string): Promise<void> {
        ActionLogger.logAPIAction('setBearerToken', { tokenLength: token.length });
        
        try {
            const currentContext = this.getAPIContext();
            const interpolatedToken = await this.interpolateValue(token);
            
            // Set Authorization header
            currentContext.setHeader('Authorization', `Bearer ${interpolatedToken}`);
            
            // Store authentication config
            currentContext.setAuthentication({
                type: 'bearer',
                token: interpolatedToken
            });
            
            ActionLogger.logAPIAction('bearerTokenSet', { 
                tokenLength: interpolatedToken.length,
                tokenPreview: this.maskToken(interpolatedToken)
            });
        } catch (error) {
            ActionLogger.logError('Failed to set bearer token', error);
            throw new Error(`Failed to set bearer token: ${error.message}`);
        }
    }

    /**
     * Sets Basic authentication
     * Example: Given user sets basic auth username "admin" and password "{{password}}"
     */
    @CSBDDStepDef("user sets basic auth username {string} and password {string}")
    async setBasicAuth(username: string, password: string): Promise<void> {
        ActionLogger.logAPIAction('setBasicAuth', { username });
        
        try {
            const currentContext = this.getAPIContext();
            const interpolatedUsername = await this.interpolateValue(username);
            const interpolatedPassword = await this.interpolateValue(password);
            
            // Create Basic auth header
            const credentials = `${interpolatedUsername}:${interpolatedPassword}`;
            const encodedCredentials = Buffer.from(credentials).toString('base64');
            
            currentContext.setHeader('Authorization', `Basic ${encodedCredentials}`);
            
            // Store authentication config
            currentContext.setAuthentication({
                type: 'basic',
                username: interpolatedUsername,
                password: interpolatedPassword
            });
            
            ActionLogger.logAPIAction('basicAuthSet', { 
                username: interpolatedUsername,
                credentialsLength: credentials.length
            });
        } catch (error) {
            ActionLogger.logError('Failed to set basic auth', error);
            throw new Error(`Failed to set basic authentication: ${error.message}`);
        }
    }

    /**
     * Sets API key authentication in header
     * Example: Given user sets API key header "X-API-Key" to "{{apiKey}}"
     */
    @CSBDDStepDef("user sets API key header {string} to {string}")
    async setAPIKeyHeader(headerName: string, apiKey: string): Promise<void> {
        ActionLogger.logAPIAction('setAPIKeyHeader', { headerName });
        
        try {
            const currentContext = this.getAPIContext();
            const interpolatedKey = await this.interpolateValue(apiKey);
            
            currentContext.setHeader(headerName, interpolatedKey);
            
            // Store authentication config
            currentContext.setAuthentication({
                type: 'apikey',
                location: 'header',
                name: headerName,
                value: interpolatedKey
            });
            
            ActionLogger.logAPIAction('apiKeyHeaderSet', { 
                headerName,
                keyLength: interpolatedKey.length,
                keyPreview: this.maskToken(interpolatedKey)
            });
        } catch (error) {
            ActionLogger.logError('Failed to set API key header', error);
            throw new Error(`Failed to set API key header: ${error.message}`);
        }
    }

    /**
     * Sets API key authentication in query parameter
     * Example: Given user sets API key parameter "api_key" to "{{apiKey}}"
     */
    @CSBDDStepDef("user sets API key parameter {string} to {string}")
    async setAPIKeyParameter(paramName: string, apiKey: string): Promise<void> {
        ActionLogger.logAPIAction('setAPIKeyParameter', { paramName });
        
        try {
            const currentContext = this.getAPIContext();
            const interpolatedKey = await this.interpolateValue(apiKey);
            
            currentContext.setQueryParameter(paramName, interpolatedKey);
            
            // Store authentication config
            currentContext.setAuthentication({
                type: 'apikey',
                location: 'query',
                name: paramName,
                value: interpolatedKey
            });
            
            ActionLogger.logAPIAction('apiKeyParameterSet', { 
                paramName,
                keyLength: interpolatedKey.length,
                keyPreview: this.maskToken(interpolatedKey)
            });
        } catch (error) {
            ActionLogger.logError('Failed to set API key parameter', error);
            throw new Error(`Failed to set API key parameter: ${error.message}`);
        }
    }

    /**
     * Sets OAuth2 client credentials
     * Example: Given user sets OAuth2 client credentials:
     *   | clientId     | {{clientId}}     |
     *   | clientSecret | {{clientSecret}} |
     *   | tokenUrl     | {{tokenUrl}}     |
     */
    @CSBDDStepDef("user sets OAuth2 client credentials:")
    async setOAuth2ClientCredentials(dataTable: any): Promise<void> {
        ActionLogger.logAPIAction('setOAuth2ClientCredentials', {});
        
        try {
            const currentContext = this.getAPIContext();
            const credentials: any = {};
            
            // Parse data table
            const rows = dataTable.hashes ? dataTable.hashes() : dataTable.rows();
            
            for (const row of rows) {
                const key = row[0] || row.key || row.property;
                const value = row[1] || row.value;
                
                if (key && value) {
                    credentials[key] = await this.interpolateValue(String(value));
                }
            }
            
            // Validate required fields
            if (!credentials.clientId || !credentials.clientSecret || !credentials.tokenUrl) {
                throw new Error('OAuth2 client credentials require: clientId, clientSecret, tokenUrl');
            }
            
            // Store authentication config
            currentContext.setAuthentication({
                type: 'oauth2',
                flow: 'client_credentials',
                clientId: credentials.clientId,
                clientSecret: credentials.clientSecret,
                tokenUrl: credentials.tokenUrl,
                scope: credentials.scope || '',
                grantType: 'client_credentials'
            });
            
            ActionLogger.logAPIAction('oauth2ClientCredentialsSet', { 
                clientId: credentials.clientId,
                tokenUrl: credentials.tokenUrl,
                hasScope: !!credentials.scope
            });
        } catch (error) {
            ActionLogger.logError('Failed to set OAuth2 client credentials', error);
            throw new Error(`Failed to set OAuth2 client credentials: ${error.message}`);
        }
    }

    /**
     * Sets OAuth2 access token directly
     * Example: Given user sets OAuth2 access token "{{accessToken}}"
     */
    @CSBDDStepDef("user sets OAuth2 access token {string}")
    async setOAuth2AccessToken(accessToken: string): Promise<void> {
        ActionLogger.logAPIAction('setOAuth2AccessToken', {});
        
        try {
            const currentContext = this.getAPIContext();
            const interpolatedToken = await this.interpolateValue(accessToken);
            
            // Set Authorization header
            currentContext.setHeader('Authorization', `Bearer ${interpolatedToken}`);
            
            // Store authentication config
            currentContext.setAuthentication({
                type: 'oauth2',
                flow: 'manual',
                accessToken: interpolatedToken
            });
            
            ActionLogger.logAPIAction('oauth2AccessTokenSet', { 
                tokenLength: interpolatedToken.length,
                tokenPreview: this.maskToken(interpolatedToken)
            });
        } catch (error) {
            ActionLogger.logError('Failed to set OAuth2 access token', error);
            throw new Error(`Failed to set OAuth2 access token: ${error.message}`);
        }
    }

    /**
     * Loads client certificate for mutual TLS
     * Example: Given user loads certificate from "certs/client.p12" with password "{{certPassword}}"
     */
    @CSBDDStepDef("user loads certificate from {string} with password {string}")
    async loadCertificate(certPath: string, password: string): Promise<void> {
        ActionLogger.logAPIAction('loadCertificate', { certPath });
        
        try {
            const currentContext = this.getAPIContext();
            const resolvedPath = await this.resolveCertPath(certPath);
            const interpolatedPassword = await this.interpolateValue(password);
            
            // Check if certificate exists
            if (!await FileUtils.exists(resolvedPath)) {
                throw new Error(`Certificate file not found: ${resolvedPath}`);
            }
            
            // Load certificate
            const certificate = await this.certificateManager.loadCertificate({
                certPath: resolvedPath,
                passphrase: interpolatedPassword,
                type: this.detectCertType(resolvedPath)
            });
            
            // Store authentication config
            currentContext.setAuthentication({
                type: 'certificate',
                cert: certificate.cert,
                key: certificate.key,
                ca: certificate.ca,
                passphrase: interpolatedPassword
            });
            
            ActionLogger.logAPIAction('certificateLoaded', { 
                certPath: resolvedPath,
                type: certificate.type,
                hasCA: !!certificate.ca
            });
        } catch (error) {
            ActionLogger.logError('Failed to load certificate', error);
            throw new Error(`Failed to load certificate from '${certPath}': ${error.message}`);
        }
    }

    /**
     * Sets client certificate authentication details
     * Example: Given user sets certificate authentication:
     *   | certFile | certs/client.crt |
     *   | keyFile  | certs/client.key |
     *   | caFile   | certs/ca.crt     |
     */
    @CSBDDStepDef("user sets certificate authentication:")
    async setCertificateAuth(dataTable: any): Promise<void> {
        ActionLogger.logAPIAction('setCertificateAuth', {});
        
        try {
            const currentContext = this.getAPIContext();
            const certConfig: any = {};
            
            // Parse data table
            const rows = dataTable.hashes ? dataTable.hashes() : dataTable.rows();
            
            for (const row of rows) {
                const key = row[0] || row.key || row.property;
                const value = row[1] || row.value;
                
                if (key && value) {
                    certConfig[key] = await this.interpolateValue(String(value));
                }
            }
            
            // Load certificate files
            const authConfig: any = { type: 'certificate' };
            
            if (certConfig.certFile) {
                const certPath = await this.resolveCertPath(certConfig.certFile);
                authConfig.cert = await FileUtils.readFile(certPath);
            }
            
            if (certConfig.keyFile) {
                const keyPath = await this.resolveCertPath(certConfig.keyFile);
                authConfig.key = await FileUtils.readFile(keyPath);
            }
            
            if (certConfig.caFile) {
                const caPath = await this.resolveCertPath(certConfig.caFile);
                authConfig.ca = await FileUtils.readFile(caPath);
            }
            
            if (certConfig.passphrase) {
                authConfig.passphrase = certConfig.passphrase;
            }
            
            currentContext.setAuthentication(authConfig);
            
            ActionLogger.logAPIAction('certificateAuthSet', { 
                hasCert: !!authConfig.cert,
                hasKey: !!authConfig.key,
                hasCA: !!authConfig.ca,
                hasPassphrase: !!authConfig.passphrase
            });
        } catch (error) {
            ActionLogger.logError('Failed to set certificate authentication', error);
            throw new Error(`Failed to set certificate authentication: ${error.message}`);
        }
    }

    /**
     * Sets NTLM authentication
     * Example: Given user sets NTLM auth with username "DOMAIN\user" and password "{{password}}"
     */
    @CSBDDStepDef("user sets NTLM auth with username {string} and password {string}")
    async setNTLMAuth(username: string, password: string): Promise<void> {
        ActionLogger.logAPIAction('setNTLMAuth', { username });
        
        try {
            const currentContext = this.getAPIContext();
            const interpolatedUsername = await this.interpolateValue(username);
            const interpolatedPassword = await this.interpolateValue(password);
            
            // Parse domain from username if present
            let domain = '';
            let user = interpolatedUsername;
            
            if (interpolatedUsername.includes('\\')) {
                const parts = interpolatedUsername.split('\\');
                domain = parts[0];
                user = parts[1];
            }
            
            // Store authentication config
            currentContext.setAuthentication({
                type: 'ntlm',
                username: user,
                password: interpolatedPassword,
                domain: domain,
                workstation: ConfigurationManager.get('NTLM_WORKSTATION', '')
            });
            
            ActionLogger.logAPIAction('ntlmAuthSet', { 
                username: user,
                domain: domain,
                hasWorkstation: !!ConfigurationManager.get('NTLM_WORKSTATION')
            });
        } catch (error) {
            ActionLogger.logError('Failed to set NTLM auth', error);
            throw new Error(`Failed to set NTLM authentication: ${error.message}`);
        }
    }

    /**
     * Sets AWS Signature V4 authentication
     * Example: Given user sets AWS auth with key "{{accessKey}}" and secret "{{secretKey}}"
     */
    @CSBDDStepDef("user sets AWS auth with key {string} and secret {string}")
    async setAWSAuth(accessKey: string, secretKey: string): Promise<void> {
        ActionLogger.logAPIAction('setAWSAuth', {});
        
        try {
            const currentContext = this.getAPIContext();
            const interpolatedKey = await this.interpolateValue(accessKey);
            const interpolatedSecret = await this.interpolateValue(secretKey);
            
            // Store authentication config
            currentContext.setAuthentication({
                type: 'aws',
                accessKeyId: interpolatedKey,
                secretAccessKey: interpolatedSecret,
                region: ConfigurationManager.get('AWS_REGION', 'us-east-1'),
                service: ConfigurationManager.get('AWS_SERVICE', 'execute-api')
            });
            
            ActionLogger.logAPIAction('awsAuthSet', { 
                keyLength: interpolatedKey.length,
                region: ConfigurationManager.get('AWS_REGION', 'us-east-1'),
                service: ConfigurationManager.get('AWS_SERVICE', 'execute-api')
            });
        } catch (error) {
            ActionLogger.logError('Failed to set AWS auth', error);
            throw new Error(`Failed to set AWS authentication: ${error.message}`);
        }
    }

    /**
     * Sets AWS authentication with session token
     * Example: Given user sets AWS auth:
     *   | accessKey    | {{accessKey}}    |
     *   | secretKey    | {{secretKey}}    |
     *   | sessionToken | {{sessionToken}} |
     *   | region       | us-west-2        |
     */
    @CSBDDStepDef("user sets AWS auth:")
    async setAWSAuthDetailed(dataTable: any): Promise<void> {
        ActionLogger.logAPIAction('setAWSAuthDetailed', {});
        
        try {
            const currentContext = this.getAPIContext();
            const awsConfig: any = {};
            
            // Parse data table
            const rows = dataTable.hashes ? dataTable.hashes() : dataTable.rows();
            
            for (const row of rows) {
                const key = row[0] || row.key || row.property;
                const value = row[1] || row.value;
                
                if (key && value) {
                    awsConfig[key] = await this.interpolateValue(String(value));
                }
            }
            
            // Validate required fields
            if (!awsConfig.accessKey || !awsConfig.secretKey) {
                throw new Error('AWS authentication requires: accessKey and secretKey');
            }
            
            // Store authentication config
            currentContext.setAuthentication({
                type: 'aws',
                accessKeyId: awsConfig.accessKey,
                secretAccessKey: awsConfig.secretKey,
                sessionToken: awsConfig.sessionToken,
                region: awsConfig.region || 'us-east-1',
                service: awsConfig.service || 'execute-api'
            });
            
            ActionLogger.logAPIAction('awsAuthDetailedSet', { 
                hasSessionToken: !!awsConfig.sessionToken,
                region: awsConfig.region || 'us-east-1',
                service: awsConfig.service || 'execute-api'
            });
        } catch (error) {
            ActionLogger.logError('Failed to set AWS auth', error);
            throw new Error(`Failed to set AWS authentication: ${error.message}`);
        }
    }

    /**
     * Clears all authentication
     * Example: Given user clears authentication
     */
    @CSBDDStepDef("user clears authentication")
    async clearAuthentication(): Promise<void> {
        ActionLogger.logAPIAction('clearAuthentication', {});
        
        try {
            const currentContext = this.getAPIContext();
            
            // Remove Authorization header
            currentContext.removeHeader('Authorization');
            
            // Clear authentication config
            currentContext.setAuthentication(null);
            
            ActionLogger.logAPIAction('authenticationCleared', {});
        } catch (error) {
            ActionLogger.logError('Failed to clear authentication', error);
            throw error;
        }
    }

    /**
     * Sets custom authentication header
     * Example: Given user sets custom auth header "X-Custom-Auth" to "{{customToken}}"
     */
    @CSBDDStepDef("user sets custom auth header {string} to {string}")
    async setCustomAuthHeader(headerName: string, headerValue: string): Promise<void> {
        ActionLogger.logAPIAction('setCustomAuthHeader', { headerName });
        
        try {
            const currentContext = this.getAPIContext();
            const interpolatedValue = await this.interpolateValue(headerValue);
            
            currentContext.setHeader(headerName, interpolatedValue);
            
            // Store authentication config
            currentContext.setAuthentication({
                type: 'custom',
                headerName: headerName,
                headerValue: interpolatedValue
            });
            
            ActionLogger.logAPIAction('customAuthHeaderSet', { 
                headerName,
                valueLength: interpolatedValue.length,
                valuePreview: this.maskToken(interpolatedValue)
            });
        } catch (error) {
            ActionLogger.logError('Failed to set custom auth header', error);
            throw new Error(`Failed to set custom auth header: ${error.message}`);
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
     * Helper method to mask sensitive tokens
     */
    private maskToken(token: string): string {
        if (token.length <= 8) {
            return '***';
        }
        return token.substring(0, 4) + '...' + token.substring(token.length - 4);
    }

    /**
     * Helper method to resolve certificate paths
     */
    private async resolveCertPath(certPath: string): Promise<string> {
        if (FileUtils.isAbsolutePath(certPath)) {
            return certPath;
        }
        
        // Try certificates directory
        const certsPath = ConfigurationManager.get('CERTIFICATES_PATH', './certs');
        const resolvedPath = FileUtils.joinPath(certsPath, certPath);
        
        if (await FileUtils.exists(resolvedPath)) {
            return resolvedPath;
        }
        
        // Try test data directory
        const testDataPath = ConfigurationManager.get('TEST_DATA_PATH', './test-data');
        const testDataResolvedPath = FileUtils.joinPath(testDataPath, 'certs', certPath);
        
        if (await FileUtils.exists(testDataResolvedPath)) {
            return testDataResolvedPath;
        }
        
        // Try relative to project root
        return certPath;
    }

    /**
     * Helper method to detect certificate type
     */
    private detectCertType(certPath: string): string {
        const ext = FileUtils.getExtension(certPath).toLowerCase();
        
        switch (ext) {
            case '.p12':
            case '.pfx':
                return 'pkcs12';
            case '.pem':
                return 'pem';
            case '.crt':
            case '.cer':
                return 'cert';
            case '.key':
                return 'key';
            default:
                return 'pem';
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