// src/integrations/ado/ADOIntegrationService.ts
import { ADOClient } from './ADOClient';
import { ADOConfig } from './ADOConfig';
import { TestSuiteManager } from './TestSuiteManager';
import { TestRunManager } from './TestRunManager';
import { TestResultUploader } from './TestResultUploader';
import { EvidenceUploader } from './EvidenceUploader';
import { Logger } from '../../core/utils/Logger';
import { FeatureResult, ScenarioResult, ExecutionResult } from '../../bdd/types/bdd.types';

export interface ADOTestRun {
  id: number;
  name: string;
  state: string;
  startedDate?: string;
  completedDate?: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  notExecutedTests: number;
  url: string;
}

export interface ADOTestResult {
  id: number;
  testCaseId: number;
  testPointId: number;
  outcome: 'Passed' | 'Failed' | 'NotExecuted' | 'Blocked' | 'NotApplicable';
  state: 'Pending' | 'Queued' | 'InProgress' | 'Paused' | 'Completed';
  errorMessage?: string;
  stackTrace?: string;
  startedDate: string;
  completedDate: string;
  durationInMs: number;
  comment?: string;
  associatedBugs?: number[];
  attachments?: Array<{ id: string; name: string; url: string }>;
}

export interface ADOUploadOptions {
  testPlanId?: number;
  testSuiteId?: number;
  buildId?: string;
  releaseId?: string;
  runName?: string;
  includeScreenshots?: boolean;
  includeVideos?: boolean;
  includeLogs?: boolean;
  createBugsOnFailure?: boolean;
  updateTestCases?: boolean;
}

export class ADOIntegrationService {
  private static readonly logger = Logger.getInstance(ADOIntegrationService.name);
  private static instance: ADOIntegrationService;
  
  private readonly client: ADOClient;
  private readonly testSuiteManager: TestSuiteManager;
  private readonly testRunManager: TestRunManager;
  private readonly testResultUploader: TestResultUploader;
  private readonly evidenceUploader: EvidenceUploader;
  
  private currentTestRun: ADOTestRun | null = null;
  private testCaseMapping = new Map<string, number>();
  private uploadQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;

  private constructor() {
    this.client = ADOClient.getInstance();
    this.testSuiteManager = new TestSuiteManager(this.client);
    this.testRunManager = new TestRunManager(this.client);
    this.testResultUploader = new TestResultUploader(this.client);
    this.evidenceUploader = new EvidenceUploader(this.client);
    
    ADOIntegrationService.logger.info('ADO Integration Service initialized');
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ADOIntegrationService {
    if (!this.instance) {
      this.instance = new ADOIntegrationService();
    }
    return this.instance;
  }

  /**
   * Initialize service
   */
  async initialize(): Promise<void> {
    try {
      ADOIntegrationService.logger.info('Initializing ADO integration...');
      
      // Initialize configuration
      ADOConfig.initialize();
      
      // Verify connection
      await this.verifyConnection();
      
      // Load test case mappings if configured
      const config = ADOConfig.getConfig();
      if (config.testPlanId && config.testSuiteId) {
        await this.loadTestCaseMappings(config.testPlanId, config.testSuiteId);
      }
      
      ADOIntegrationService.logger.info('ADO integration initialized successfully');
    } catch (error) {
      ADOIntegrationService.logger.error('Failed to initialize ADO integration:', error as Error);
      throw error;
    }
  }

  /**
   * Verify ADO connection
   */
  private async verifyConnection(): Promise<void> {
    try {
      ADOIntegrationService.logger.info('Verifying ADO connection...');
      
      // Try to get project info
      const projectUrl = `${ADOConfig.getBaseUrl()}/core/projects/${ADOConfig.getConfig().projectName}`;
      const response = await this.client.get(projectUrl);
      
      if (response.status === 200) {
        ADOIntegrationService.logger.info(`Successfully connected to ADO project: ${response.data.name}`);
      }
    } catch (error) {
      ADOIntegrationService.logger.error('ADO connection verification failed:', error as Error);
      throw new Error(`Failed to connect to ADO: ${(error as Error).message}`);
    }
  }

  /**
   * Upload test results to ADO
   */
  async uploadTestResults(
    executionResult: ExecutionResult,
    options?: ADOUploadOptions
  ): Promise<ADOTestRun> {
    try {
      ADOIntegrationService.logger.info('Starting test results upload to ADO...');
      
      // Merge options with config
      const uploadOptions = this.mergeUploadOptions(options);
      
      // Create test run
      this.currentTestRun = await this.createTestRun(executionResult, uploadOptions);
      ADOIntegrationService.logger.info(`Created test run: ${this.currentTestRun.name} (ID: ${this.currentTestRun.id})`);
      
      // Upload results for each feature
      for (const feature of executionResult.features) {
        await this.uploadFeatureResults(feature, uploadOptions);
      }
      
      // Process upload queue
      await this.processUploadQueue();
      
      // Complete test run
      await this.completeTestRun();
      
      ADOIntegrationService.logger.info(`Test results uploaded successfully. Run ID: ${this.currentTestRun.id}`);
      return this.currentTestRun;
    } catch (error) {
      ADOIntegrationService.logger.error('Failed to upload test results:', error as Error);
      
      // Try to mark run as aborted
      if (this.currentTestRun) {
        try {
          await this.testRunManager.updateTestRun(this.currentTestRun.id, {
            state: 'Aborted',
            comment: `Upload failed: ${(error as Error).message}`
          });
        } catch (updateError) {
          ADOIntegrationService.logger.error('Failed to mark test run as aborted:', updateError as Error);
        }
      }
      
      throw error;
    }
  }

  /**
   * Create test run
   */
  private async createTestRun(
    executionResult: ExecutionResult,
    options: Required<ADOUploadOptions>
  ): Promise<ADOTestRun> {
    const runData = {
      name: options.runName,
      automated: true,
      state: 'InProgress' as 'InProgress',
      startedDate: executionResult.startTime.toISOString(),
      buildId: options.buildId,
      releaseEnvironmentId: options.releaseId,
      comment: this.generateRunComment(executionResult),
      testPlanId: options.testPlanId,
      testSuiteId: options.testSuiteId
    };
    
    const testRun = await this.testRunManager.createTestRun(runData);
    
    return {
      id: testRun.id,
      name: testRun.name,
      state: testRun.state,
      startedDate: testRun.startedDate || '',
      totalTests: executionResult.summary.total,
      passedTests: executionResult.summary.passed,
      failedTests: executionResult.summary.failed,
      notExecutedTests: executionResult.summary.skipped,
      url: testRun.url
    };
  }

  /**
   * Upload feature results
   */
  private async uploadFeatureResults(
    feature: FeatureResult,
    options: Required<ADOUploadOptions>
  ): Promise<void> {
    ADOIntegrationService.logger.info(`Uploading results for feature: ${feature.name}`);
    
    for (const scenario of feature.scenarios) {
      await this.uploadScenarioResult(scenario, feature, options);
    }
  }

  /**
   * Upload scenario result
   */
  private async uploadScenarioResult(
    scenario: ScenarioResult,
    feature: FeatureResult,
    options: Required<ADOUploadOptions>
  ): Promise<void> {
    try {
      // Get or create test case ID
      const testCaseId = await this.getOrCreateTestCase(scenario, feature);
      
      if (!testCaseId) {
        ADOIntegrationService.logger.warn(`No test case mapping found for scenario: ${scenario.scenario}`);
        return;
      }
      
      // Create test result
      const testResult: ADOTestResult = {
        id: 0, // Will be assigned by ADO
        testCaseId,
        testPointId: 0, // Will be resolved by ADO
        outcome: this.mapOutcome(scenario.status),
        state: 'Completed',
        startedDate: scenario.startTime.toISOString(),
        completedDate: scenario.endTime.toISOString(),
        durationInMs: scenario.duration,
        errorMessage: scenario.error?.message || '',
        stackTrace: scenario.error?.stack || '',
        comment: this.generateResultComment(scenario),
        attachments: []
      };
      
      // Upload the result
      const uploadedResult = await this.testResultUploader.uploadTestResult(
        this.currentTestRun!.id,
        testResult
      );
      
      // Queue evidence uploads from attachments
      if (scenario.attachments && scenario.attachments.length > 0) {
        for (const attachment of scenario.attachments) {
          if (attachment.path) {
            if ((attachment.mimeType === 'image/png' || attachment.mimeType === 'image/jpeg') && options.includeScreenshots) {
              this.queueEvidenceUpload(async () => {
                await this.evidenceUploader.uploadScreenshot(
                  this.currentTestRun!.id,
                  uploadedResult.id,
                  attachment.path!
                );
              });
            } else if (attachment.mimeType === 'video/webm' && options.includeVideos) {
              this.queueEvidenceUpload(async () => {
                await this.evidenceUploader.uploadVideo(
                  this.currentTestRun!.id,
                  uploadedResult.id,
                  attachment.path!
                );
              });
            } else if ((attachment.mimeType === 'text/plain' || attachment.mimeType === 'application/json') && options.includeLogs) {
              this.queueEvidenceUpload(async () => {
                await this.evidenceUploader.uploadLog(
                  this.currentTestRun!.id,
                  uploadedResult.id,
                  attachment.path!,
                  attachment.name || 'log.txt'
                );
              });
            }
          }
        }
      }
      
      // Create bug if needed
      if (scenario.status === 'failed' && options.createBugsOnFailure) {
        this.queueEvidenceUpload(async () => {
          await this.createBugForFailure(scenario, uploadedResult);
        });
      }
      
      ADOIntegrationService.logger.debug(`Uploaded result for scenario: ${scenario.scenario}`);
    } catch (error) {
      ADOIntegrationService.logger.error(`Failed to upload scenario result: ${scenario.scenario}`, error as Error);
      throw error;
    }
  }

  /**
   * Get or create test case
   */
  private async getOrCreateTestCase(
    scenario: ScenarioResult,
    feature: FeatureResult
  ): Promise<number | null> {
    // Check if we have a mapping
    const mappingKey = `${feature.name}::${scenario.scenario}`;
    if (this.testCaseMapping.has(mappingKey)) {
      return this.testCaseMapping.get(mappingKey)!;
    }
    
    // Try to find by tags
    const testCaseTag = scenario.tags?.find(tag => tag.startsWith('@TestCase-'));
    if (testCaseTag) {
      const testCaseId = parseInt(testCaseTag.substring(10), 10);
      if (!isNaN(testCaseId)) {
        this.testCaseMapping.set(mappingKey, testCaseId);
        return testCaseId;
      }
    }
    
    // If update test cases is enabled, create new test case
    if (ADOConfig.getConfig().updateTestCases) {
      const testCase = await this.createTestCase(scenario, feature);
      this.testCaseMapping.set(mappingKey, testCase.id);
      return testCase.id;
    }
    
    return null;
  }

  /**
   * Create test case
   */
  private async createTestCase(
    scenario: ScenarioResult,
    feature: FeatureResult
  ): Promise<{ id: number }> {
    const testCaseData = [
      {
        op: 'add',
        path: '/fields/System.Title',
        value: scenario.scenario
      },
      {
        op: 'add',
        path: '/fields/System.WorkItemType',
        value: 'Test Case'
      },
      {
        op: 'add',
        path: '/fields/System.Description',
        value: this.generateTestCaseDescription(scenario, feature)
      },
      {
        op: 'add',
        path: '/fields/Microsoft.VSTS.TCM.AutomatedTestName',
        value: `${feature.name}.${scenario.scenario}`
      },
      {
        op: 'add',
        path: '/fields/Microsoft.VSTS.TCM.AutomatedTestStorage',
        value: 'CS Test Automation Framework'
      },
      {
        op: 'add',
        path: '/fields/Microsoft.VSTS.TCM.AutomationStatus',
        value: 'Automated'
      }
    ];
    
    // Add custom fields if configured
    const customFields = ADOConfig.getConfig().customFields;
    if (customFields) {
      for (const [field, value] of Object.entries(customFields)) {
        testCaseData.push({
          op: 'add',
          path: `/fields/${field}`,
          value
        });
      }
    }
    
    const response = await this.client.post(
      ADOConfig.buildUrl(ADOConfig.getEndpoints().testCases),
      testCaseData,
      {
        headers: {
          'Content-Type': 'application/json-patch+json'
        }
      }
    );
    
    return { id: response.data.id };
  }

  /**
   * Load test case mappings
   */
  private async loadTestCaseMappings(testPlanId: number, testSuiteId: number): Promise<void> {
    try {
      ADOIntegrationService.logger.info('Loading test case mappings...');
      
      const testPoints = await this.testSuiteManager.getTestPoints(testPlanId, testSuiteId);
      
      for (const testPoint of testPoints) {
        const testCase = await this.getTestCase(testPoint.testCaseId);
        const automatedTestName = testCase.fields['Microsoft.VSTS.TCM.AutomatedTestName'];
        
        if (automatedTestName) {
          this.testCaseMapping.set(automatedTestName, testCase.id);
        }
      }
      
      ADOIntegrationService.logger.info(`Loaded ${this.testCaseMapping.size} test case mappings`);
    } catch (error) {
      ADOIntegrationService.logger.error('Failed to load test case mappings:', error as Error);
    }
  }

  /**
   * Get test case details
   */
  private async getTestCase(testCaseId: number): Promise<any> {
    const url = ADOConfig.buildUrl(
      `${ADOConfig.getEndpoints().testCases}/${testCaseId}`
    );
    
    const response = await this.client.get(url);
    return response.data;
  }


  /**
   * Create bug for failure
   */
  private async createBugForFailure(
    scenario: ScenarioResult,
    testResult: ADOTestResult
  ): Promise<void> {
    try {
      const bugTemplate = ADOConfig.getBugTemplate();
      if (!bugTemplate) return;
      
      const bugData = [
        {
          op: 'add',
          path: '/fields/System.Title',
          value: ADOConfig.formatBugTitle(scenario.scenario, scenario.error?.message)
        },
        {
          op: 'add',
          path: '/fields/System.WorkItemType',
          value: 'Bug'
        },
        {
          op: 'add',
          path: '/fields/Microsoft.VSTS.TCM.ReproSteps',
          value: this.generateReproSteps(scenario)
        },
        {
          op: 'add',
          path: '/fields/System.Description',
          value: `Test Failed: ${scenario.scenario}\n\nError: ${scenario.error?.message}\n\nStack Trace:\n${scenario.error?.stack}`
        },
        {
          op: 'add',
          path: '/fields/Microsoft.VSTS.Common.Priority',
          value: bugTemplate.priority
        },
        {
          op: 'add',
          path: '/fields/Microsoft.VSTS.Common.Severity',
          value: bugTemplate.severity
        }
      ];
      
      // Add optional fields
      if (bugTemplate.assignedTo) {
        bugData.push({
          op: 'add',
          path: '/fields/System.AssignedTo',
          value: bugTemplate.assignedTo
        });
      }
      
      if (bugTemplate.areaPath) {
        bugData.push({
          op: 'add',
          path: '/fields/System.AreaPath',
          value: bugTemplate.areaPath
        });
      }
      
      if (bugTemplate.iterationPath) {
        bugData.push({
          op: 'add',
          path: '/fields/System.IterationPath',
          value: bugTemplate.iterationPath
        });
      }
      
      if (bugTemplate.tags && bugTemplate.tags.length > 0) {
        bugData.push({
          op: 'add',
          path: '/fields/System.Tags',
          value: bugTemplate.tags.join('; ')
        });
      }
      
      // Add custom fields
      if (bugTemplate.customFields) {
        for (const [field, value] of Object.entries(bugTemplate.customFields)) {
          bugData.push({
            op: 'add',
            path: `/fields/${field}`,
            value
          });
        }
      }
      
      const response = await this.client.post(
        ADOConfig.buildUrl(ADOConfig.getEndpoints().workItems),
        bugData,
        {
          headers: {
            'Content-Type': 'application/json-patch+json'
          }
        }
      );
      
      const bugId = response.data.id;
      
      // Link bug to test result
      await this.linkBugToTestResult(testResult.id, bugId);
      
      ADOIntegrationService.logger.info(`Created bug ${bugId} for failed test: ${scenario.scenario}`);
    } catch (error) {
      ADOIntegrationService.logger.error('Failed to create bug for failure:', error as Error);
    }
  }

  /**
   * Link bug to test result
   */
  private async linkBugToTestResult(testResultId: number, bugId: number): Promise<void> {
    const linkData = [
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'Microsoft.VSTS.Common.TestedBy-Reverse',
          url: `${ADOConfig.getBaseUrl()}/wit/workitems/${bugId}`
        }
      }
    ];
    
    await this.testResultUploader.updateTestResult(
      this.currentTestRun!.id,
      testResultId,
      linkData
    );
  }

  /**
   * Complete test run
   */
  private async completeTestRun(): Promise<void> {
    if (!this.currentTestRun) return;
    
    await this.testRunManager.updateTestRun(this.currentTestRun.id, {
      state: 'Completed',
      completedDate: new Date().toISOString()
    });
    
    this.currentTestRun.state = 'Completed';
    this.currentTestRun.completedDate = new Date().toISOString();
  }

  /**
   * Queue evidence upload
   */
  private queueEvidenceUpload(uploadFn: () => Promise<void>): void {
    this.uploadQueue.push(uploadFn);
  }

  /**
   * Process upload queue
   */
  private async processUploadQueue(): Promise<void> {
    if (this.isProcessingQueue || this.uploadQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    ADOIntegrationService.logger.info(`Processing ${this.uploadQueue.length} evidence uploads...`);
    
    try {
      // Process uploads in batches
      const batchSize = 5;
      while (this.uploadQueue.length > 0) {
        const batch = this.uploadQueue.splice(0, batchSize);
        await Promise.all(batch.map(fn => fn().catch(error => {
          ADOIntegrationService.logger.error('Evidence upload failed:', error as Error);
        })));
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Merge upload options with configuration
   */
  private mergeUploadOptions(options?: ADOUploadOptions): Required<ADOUploadOptions> {
    const config = ADOConfig.getConfig();
    const uploadConfig = ADOConfig.getUploadConfig();
    
    return {
      testPlanId: options?.testPlanId ?? config.testPlanId ?? 0,
      testSuiteId: options?.testSuiteId ?? config.testSuiteId ?? 0,
      buildId: options?.buildId ?? config.buildId ?? '',
      releaseId: options?.releaseId ?? config.releaseId ?? '',
      runName: options?.runName ?? config.runName ?? `Automated Test Run - ${new Date().toISOString()}`,
      includeScreenshots: options?.includeScreenshots ?? uploadConfig.uploadScreenshots ?? true,
      includeVideos: options?.includeVideos ?? uploadConfig.uploadVideos ?? true,
      includeLogs: options?.includeLogs ?? uploadConfig.uploadLogs ?? true,
      createBugsOnFailure: options?.createBugsOnFailure ?? config.createBugsOnFailure ?? false,
      updateTestCases: options?.updateTestCases ?? config.updateTestCases ?? false
    };
  }

  /**
   * Map test status to ADO outcome
   */
  private mapOutcome(status: string): ADOTestResult['outcome'] {
    switch (status) {
      case 'passed':
        return 'Passed';
      case 'failed':
        return 'Failed';
      case 'skipped':
        return 'NotExecuted';
      case 'blocked':
        return 'Blocked';
      default:
        return 'NotApplicable';
    }
  }

  /**
   * Generate run comment
   */
  private generateRunComment(executionResult: ExecutionResult): string {
    const { summary } = executionResult;
    return `Automated test run executed ${summary.total} tests. ` +
           `Passed: ${summary.passed}, Failed: ${summary.failed}, Skipped: ${summary.skipped}. ` +
           `Duration: ${summary.duration}ms. ` +
           `Environment: ${executionResult.environment}`;
  }

  /**
   * Generate result comment
   */
  private generateResultComment(scenario: ScenarioResult): string {
    const steps = scenario.steps.length;
    const failedStep = scenario.steps.find(s => s.status === 'failed');
    
    let comment = `Scenario: ${scenario.scenario}\n`;
    comment += `Steps: ${steps}\n`;
    comment += `Duration: ${scenario.duration}ms\n`;
    
    if (failedStep) {
      comment += `\nFailed at step: ${failedStep.text}\n`;
      if (failedStep.error) {
        comment += `Error: ${failedStep.error.message}`;
      }
    }
    
    return comment;
  }

  /**
   * Generate test case description
   */
  private generateTestCaseDescription(scenario: ScenarioResult, feature: FeatureResult): string {
    let description = `Feature: ${feature.name}\n\n`;
    description += `Scenario: ${scenario.scenario}\n\n`;
    description += 'Steps:\n';
    
    for (const step of scenario.steps) {
      description += `- ${step.keyword} ${step.text}\n`;
    }
    
    if (scenario.tags && scenario.tags.length > 0) {
      description += `\nTags: ${scenario.tags.join(', ')}`;
    }
    
    return description;
  }

  /**
   * Generate repro steps
   */
  private generateReproSteps(scenario: ScenarioResult): string {
    let steps = '<ol>';
    
    for (const step of scenario.steps) {
      steps += `<li>${step.keyword} ${step.text}`;
      
      if (step.status === 'failed' && step.error) {
        steps += `<br/><strong>Failed with error:</strong> ${step.error.message}`;
      }
      
      steps += '</li>';
    }
    
    steps += '</ol>';
    return steps;
  }

  /**
   * Get test run by ID
   */
  async getTestRun(runId: number): Promise<ADOTestRun> {
    const testRun = await this.testRunManager.getTestRun(runId);
    const result: ADOTestRun = {
      id: testRun.id,
      name: testRun.name,
      state: testRun.state,
      totalTests: testRun.totalTests,
      passedTests: testRun.passedTests,
      failedTests: testRun.totalTests - testRun.passedTests - testRun.notApplicableTests - testRun.incompleteTests,
      notExecutedTests: testRun.incompleteTests,
      url: testRun.url
    };
    
    if (testRun.startedDate) {
      result.startedDate = testRun.startedDate;
    }
    
    if (testRun.completedDate) {
      result.completedDate = testRun.completedDate;
    }
    
    return result;
  }

  /**
   * Get test results for run
   */
  async getTestResults(runId: number): Promise<ADOTestResult[]> {
    return this.testResultUploader.getTestResults(runId);
  }

  /**
   * Reset service state
   */
  reset(): void {
    this.currentTestRun = null;
    this.testCaseMapping.clear();
    this.uploadQueue = [];
    this.isProcessingQueue = false;
    ADOIntegrationService.logger.info('ADO Integration Service reset');
  }
}