// src/integrations/ado/ADOConfig.ts
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';
import { Logger } from '../../core/utils/Logger';
import { ValidationUtils } from '../../core/utils/ValidationUtils';

export interface ADOConfiguration {
  organizationUrl: string;
  projectName: string;
  personalAccessToken?: string;
  username?: string;
  password?: string;
  authType: 'pat' | 'basic' | 'oauth';
  apiVersion: string;
  proxy?: ADOProxyConfig;
  timeout: number;
  retryCount: number;
  retryDelay: number;
  testPlanId?: number;
  testSuiteId?: number;
  buildId?: string;
  releaseId?: string;
  environment?: string;
  runName?: string;
  automated: boolean;
  uploadAttachments: boolean;
  uploadScreenshots: boolean;
  uploadVideos: boolean;
  uploadLogs: boolean;
  updateTestCases: boolean;
  createBugsOnFailure: boolean;
  bugTemplate?: ADOBugTemplate;
  customFields?: Record<string, any>;
}

export interface ADOProxyConfig {
  enabled: boolean;
  server: string;
  port: number;
  username?: string;
  password?: string;
  bypass?: string[];
}

export interface ADOBugTemplate {
  title: string;
  assignedTo?: string;
  areaPath?: string;
  iterationPath?: string;
  priority: number;
  severity: string;
  tags?: string[];
  customFields?: Record<string, any>;
}

export interface ADOEndpoints {
  testPlans: string;
  testSuites: string;
  testRuns: string;
  testResults: string;
  testCases: string;
  testPoints: string;
  attachments: string;
  workItems: string;
  builds: string;
  releases: string;
}

export class ADOConfig {
  private static readonly logger = Logger.getInstance(ADOConfig.name);
  private static config: ADOConfiguration;
  private static endpoints: ADOEndpoints;

  /**
   * Initialize ADO configuration
   */
  static initialize(): void {
    try {
      ADOConfig.logger.info('Initializing ADO configuration...');

      // Load configuration from environment
      this.config = this.loadConfiguration();

      // Validate configuration
      this.validateConfiguration();

      // Build endpoints
      this.buildEndpoints();

      ADOConfig.logger.info('ADO configuration initialized successfully');
    } catch (error) {
      ADOConfig.logger.error('Failed to initialize ADO configuration:', error as Error);
      throw error;
    }
  }

  /**
   * Load configuration from environment
   */
  private static loadConfiguration(): ADOConfiguration {
    const config: ADOConfiguration = {
      organizationUrl: ConfigurationManager.get('ADO_ORGANIZATION_URL', '').replace(/\/$/, ''),
      projectName: ConfigurationManager.get('ADO_PROJECT_NAME', ''),
      authType: ConfigurationManager.get('ADO_AUTH_TYPE', 'pat') as 'pat' | 'basic' | 'oauth',
      apiVersion: ConfigurationManager.get('ADO_API_VERSION', '7.0'),
      timeout: ConfigurationManager.getInt('ADO_TIMEOUT', 60000),
      retryCount: ConfigurationManager.getInt('ADO_RETRY_COUNT', 3),
      retryDelay: ConfigurationManager.getInt('ADO_RETRY_DELAY', 1000),
      automated: ConfigurationManager.getBoolean('ADO_AUTOMATED', true),
      uploadAttachments: ConfigurationManager.getBoolean('ADO_UPLOAD_ATTACHMENTS', true),
      uploadScreenshots: ConfigurationManager.getBoolean('ADO_UPLOAD_SCREENSHOTS', true),
      uploadVideos: ConfigurationManager.getBoolean('ADO_UPLOAD_VIDEOS', true),
      uploadLogs: ConfigurationManager.getBoolean('ADO_UPLOAD_LOGS', true),
      updateTestCases: ConfigurationManager.getBoolean('ADO_UPDATE_TEST_CASES', false),
      createBugsOnFailure: ConfigurationManager.getBoolean('ADO_CREATE_BUGS_ON_FAILURE', false)
    };

    // Load authentication
    switch (config.authType) {
      case 'pat':
        config.personalAccessToken = ConfigurationManager.get('ADO_PAT', '');
        break;
      case 'basic':
        config.username = ConfigurationManager.get('ADO_USERNAME', '');
        config.password = ConfigurationManager.get('ADO_PASSWORD', '');
        break;
      case 'oauth':
        // OAuth configuration would be loaded here
        break;
    }

    // Load optional configuration
    const testPlanId = ConfigurationManager.get('ADO_TEST_PLAN_ID', '');
    if (testPlanId) {
      config.testPlanId = parseInt(testPlanId, 10);
    }

    const testSuiteId = ConfigurationManager.get('ADO_TEST_SUITE_ID', '');
    if (testSuiteId) {
      config.testSuiteId = parseInt(testSuiteId, 10);
    }

    config.buildId = ConfigurationManager.get('ADO_BUILD_ID', '');
    config.releaseId = ConfigurationManager.get('ADO_RELEASE_ID', '');
    config.environment = ConfigurationManager.get('ADO_ENVIRONMENT', '');
    config.runName = ConfigurationManager.get('ADO_RUN_NAME', `Automated Test Run - ${new Date().toISOString()}`);

    // Load proxy configuration
    if (ConfigurationManager.getBoolean('ADO_PROXY_ENABLED', false)) {
      config.proxy = {
        enabled: true,
        server: ConfigurationManager.getRequired('ADO_PROXY_SERVER'),
        port: ConfigurationManager.getInt('ADO_PROXY_PORT', 8080),
        username: ConfigurationManager.get('ADO_PROXY_USERNAME'),
        password: ConfigurationManager.get('ADO_PROXY_PASSWORD'),
        bypass: ConfigurationManager.getArray('ADO_PROXY_BYPASS', ',')
      };
    }

    // Load bug template
    if (config.createBugsOnFailure) {
      config.bugTemplate = {
        title: ConfigurationManager.get('ADO_BUG_TITLE_TEMPLATE', 'Test Failed: {testName}'),
        assignedTo: ConfigurationManager.get('ADO_BUG_ASSIGNED_TO'),
        areaPath: ConfigurationManager.get('ADO_BUG_AREA_PATH'),
        iterationPath: ConfigurationManager.get('ADO_BUG_ITERATION_PATH'),
        priority: ConfigurationManager.getInt('ADO_BUG_PRIORITY', 2),
        severity: ConfigurationManager.get('ADO_BUG_SEVERITY', 'Medium'),
        tags: ConfigurationManager.getArray('ADO_BUG_TAGS', ',')
      };
    }

    // Load custom fields
    const customFieldsJson = ConfigurationManager.get('ADO_CUSTOM_FIELDS', '');
    if (customFieldsJson) {
      try {
        config.customFields = JSON.parse(customFieldsJson);
      } catch (error) {
        ADOConfig.logger.warn('Failed to parse ADO_CUSTOM_FIELDS:', error as Error);
      }
    }

    return config;
  }

  /**
   * Validate configuration
   */
  private static validateConfiguration(): void {
    const errors: string[] = [];

    // Validate organization URL
    if (!this.config.organizationUrl) {
      errors.push('ADO_ORGANIZATION_URL is required');
    } else if (!ValidationUtils.isURL(this.config.organizationUrl)) {
      errors.push('ADO_ORGANIZATION_URL is not a valid URL');
    }

    // Validate project name
    if (!this.config.projectName) {
      errors.push('ADO_PROJECT_NAME is required');
    }

    // Validate authentication
    switch (this.config.authType) {
      case 'pat':
        if (!this.config.personalAccessToken) {
          errors.push('ADO_PAT is required for PAT authentication');
        }
        break;
      case 'basic':
        if (!this.config.username || !this.config.password) {
          errors.push('ADO_USERNAME and ADO_PASSWORD are required for basic authentication');
        }
        break;
    }

    // Validate proxy configuration
    if (this.config.proxy?.enabled) {
      if (!this.config.proxy.server) {
        errors.push('ADO_PROXY_SERVER is required when proxy is enabled');
      }
      if (this.config.proxy.port < 1 || this.config.proxy.port > 65535) {
        errors.push('ADO_PROXY_PORT must be between 1 and 65535');
      }
    }

    // Validate numeric fields
    if (this.config.timeout < 1000) {
      errors.push('ADO_TIMEOUT must be at least 1000ms');
    }
    if (this.config.retryCount < 0) {
      errors.push('ADO_RETRY_COUNT must be non-negative');
    }
    if (this.config.retryDelay < 0) {
      errors.push('ADO_RETRY_DELAY must be non-negative');
    }

    if (errors.length > 0) {
      const errorMessage = `ADO configuration validation failed:\n${errors.join('\n')}`;
      ADOConfig.logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * Build API endpoints
   */
  private static buildEndpoints(): void {
    const baseUrl = `${this.config.organizationUrl}/${this.config.projectName}/_apis`;

    this.endpoints = {
      testPlans: `${baseUrl}/testplan/plans`,
      testSuites: `${baseUrl}/testplan/suites`,
      testRuns: `${baseUrl}/test/runs`,
      testResults: `${baseUrl}/test/runs/{runId}/results`,
      testCases: `${baseUrl}/wit/workitems`,
      testPoints: `${baseUrl}/testplan/plans/{planId}/suites/{suiteId}/testpoints`,
      attachments: `${baseUrl}/wit/attachments`,
      workItems: `${baseUrl}/wit/workitems`,
      builds: `${baseUrl}/build/builds`,
      releases: `${baseUrl}/release/releases`
    };
  }

  /**
   * Get configuration
   */
  static getConfig(): ADOConfiguration {
    if (!this.config) {
      this.initialize();
    }
    return { ...this.config };
  }

  /**
   * Get endpoints
   */
  static getEndpoints(): ADOEndpoints {
    if (!this.endpoints) {
      this.initialize();
    }
    return { ...this.endpoints };
  }

  /**
   * Get base URL
   */
  static getBaseUrl(): string {
    return `${this.config.organizationUrl}/${this.config.projectName}/_apis`;
  }

  /**
   * Get authentication headers
   */
  static getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    switch (this.config.authType) {
      case 'pat':
        const token = Buffer.from(`:${this.config.personalAccessToken}`).toString('base64');
        headers['Authorization'] = `Basic ${token}`;
        break;
      case 'basic':
        const creds = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
        headers['Authorization'] = `Basic ${creds}`;
        break;
      case 'oauth':
        // OAuth token would be added here
        break;
    }

    return headers;
  }

  /**
   * Get API version parameter
   */
  static getApiVersionParam(): string {
    return `api-version=${this.config.apiVersion}`;
  }

  /**
   * Build URL with query parameters
   */
  static buildUrl(endpoint: string, params?: Record<string, any>): string {
    let url = endpoint;

    // Replace path parameters
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url = url.replace(`{${key}}`, encodeURIComponent(value.toString()));
      }
    }

    // Add API version
    const separator = url.includes('?') ? '&' : '?';
    url += `${separator}${this.getApiVersionParam()}`;

    return url;
  }

  /**
   * Get proxy configuration
   */
  static getProxyConfig(): ADOProxyConfig | undefined {
    return this.config.proxy;
  }

  /**
   * Check if proxy should be bypassed for URL
   */
  static shouldBypassProxy(url: string): boolean {
    if (!this.config.proxy?.enabled || !this.config.proxy.bypass) {
      return false;
    }

    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    for (const bypass of this.config.proxy.bypass) {
      const pattern = bypass.toLowerCase()
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*');
      
      if (new RegExp(`^${pattern}$`).test(hostname)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get upload configuration
   */
  static getUploadConfig(): Pick<ADOConfiguration, 
    'uploadAttachments' | 'uploadScreenshots' | 'uploadVideos' | 'uploadLogs'> {
    return {
      uploadAttachments: this.config.uploadAttachments,
      uploadScreenshots: this.config.uploadScreenshots,
      uploadVideos: this.config.uploadVideos,
      uploadLogs: this.config.uploadLogs
    };
  }

  /**
   * Get bug template
   */
  static getBugTemplate(): ADOBugTemplate | undefined {
    return this.config.bugTemplate;
  }

  /**
   * Format bug title
   */
  static formatBugTitle(testName: string, errorMessage?: string): string {
    if (!this.config.bugTemplate) {
      return `Test Failed: ${testName}`;
    }

    return this.config.bugTemplate.title
      .replace('{testName}', testName)
      .replace('{date}', new Date().toISOString().split('T')[0] || '')
      .replace('{time}', new Date().toTimeString().split(' ')[0] || '')
      .replace('{error}', errorMessage || 'Unknown error');
  }

  /**
   * Update configuration at runtime
   */
  static updateConfig(updates: Partial<ADOConfiguration>): void {
    this.config = {
      ...this.config,
      ...updates
    };

    // Re-validate
    this.validateConfiguration();

    // Rebuild endpoints if organization URL or project changed
    if (updates.organizationUrl || updates.projectName) {
      this.buildEndpoints();
    }

    ADOConfig.logger.info('ADO configuration updated', updates);
  }

  /**
   * Reset configuration
   */
  static reset(): void {
    this.config = null as any;
    this.endpoints = null as any;
    ADOConfig.logger.info('ADO configuration reset');
  }
}