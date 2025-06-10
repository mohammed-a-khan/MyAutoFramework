// src/reporting/exporters/XMLExporter.ts

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { ExportResult, ExportOptions, ExecutionResult } from '../types/reporting.types';
import { Logger } from '../../utils/Logger';
import { DateUtils } from '../../utils/DateUtils';
import { FileUtils } from '../../utils/FileUtils';

const gzip = promisify(zlib.gzip);

interface XMLExportOptions extends ExportOptions {
  format?: 'junit' | 'testng' | 'nunit' | 'xunit' | 'trx' | 'custom';
  pretty?: boolean;
  includeSystemOut?: boolean;
  includeSystemErr?: boolean;
  includeProperties?: boolean;
  includeAttachments?: boolean;
  customTemplate?: string;
  encoding?: BufferEncoding;
  standalone?: boolean;
  compress?: boolean;
  streaming?: boolean;
  escapeInvalidChars?: boolean;
}

interface XMLElement {
  name: string;
  attributes?: Record<string, string | number | boolean>;
  text?: string;
  children?: XMLElement[];
  cdata?: string;
  comment?: string;
}

export class XMLExporter {
  private logger = new Logger('XMLExporter');
  private indentLevel = 0;
  private readonly indentSize = 2;
  private readonly xmlEntities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
  };
  
  async export(
    result: ExecutionResult,
    outputPath: string,
    options: XMLExportOptions = {}
  ): Promise<ExportResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting XML export', { outputPath, options });

      // Ensure directory exists
      await FileUtils.ensureDirectory(path.dirname(outputPath));

      // Generate XML
      const xmlContent = await this.generateXML(result, options);
      
      // Write to file
      let fileSize: number;
      let finalPath = outputPath;
      
      if (options.compress) {
        const compressed = await gzip(Buffer.from(xmlContent, options.encoding || 'utf8'));
        finalPath = outputPath + '.gz';
        await fs.promises.writeFile(finalPath, compressed);
        fileSize = compressed.length;
      } else {
        const buffer = Buffer.from(xmlContent, options.encoding || 'utf8');
        await fs.promises.writeFile(outputPath, buffer);
        fileSize = buffer.length;
      }
      
      const exportTime = Date.now() - startTime;
      
      this.logger.info('XML export completed', { 
        exportTime,
        fileSize,
        format: options.format || 'junit',
        compressed: options.compress || false
      });

      return {
        success: true,
        outputPath: finalPath,
        format: 'xml',
        exportTime,
        fileSize,
        metadata: {
          xmlFormat: options.format || 'junit',
          encoding: options.encoding || 'utf8',
          compressed: options.compress || false,
          pretty: options.pretty !== false
        }
      };

    } catch (error) {
      this.logger.error('XML export failed', error);
      return {
        success: false,
        outputPath,
        format: 'xml',
        exportTime: Date.now() - startTime,
        error: error.message,
        stack: error.stack
      };
    }
  }

  private async generateXML(
    result: ExecutionResult,
    options: XMLExportOptions
  ): Promise<string> {
    const xmlDeclaration = `<?xml version="1.0" encoding="${options.encoding || 'UTF-8'}"${
      options.standalone ? ' standalone="yes"' : ''
    }?>`;
    
    let rootElement: XMLElement;
    
    switch (options.format) {
      case 'testng':
        rootElement = this.generateTestNG(result, options);
        break;
      case 'nunit':
        rootElement = this.generateNUnit(result, options);
        break;
      case 'xunit':
        rootElement = this.generateXUnit(result, options);
        break;
      case 'trx':
        rootElement = this.generateTRX(result, options);
        break;
      case 'custom':
        if (!options.customTemplate) {
          throw new Error('Custom template is required for custom format');
        }
        rootElement = await this.generateCustom(result, options);
        break;
      default:
        rootElement = this.generateJUnit(result, options);
    }

    const xmlBody = this.elementToXML(rootElement, options.pretty !== false);
    return xmlDeclaration + '\n' + xmlBody;
  }

  private generateJUnit(
    result: ExecutionResult,
    options: XMLExportOptions
  ): XMLElement {
    const testsuites: XMLElement = {
      name: 'testsuites',
      attributes: {
        name: 'CS Test Automation',
        tests: result.summary.totalScenarios,
        failures: result.summary.failed,
        errors: 0,
        skipped: result.summary.skipped,
        time: (result.duration / 1000).toFixed(3),
        timestamp: new Date(result.startTime).toISOString()
      },
      children: []
    };

    // Add properties if requested
    if (options.includeProperties && result.metadata) {
      const properties: XMLElement = {
        name: 'properties',
        children: Object.entries(result.metadata).map(([key, value]) => ({
          name: 'property',
          attributes: {
            name: key,
            value: String(value)
          }
        }))
      };
      
      if (properties.children && properties.children.length > 0) {
        testsuites.children!.push(properties);
      }
    }

    // Add test suites (features)
    result.features.forEach(feature => {
      const testsuite: XMLElement = {
        name: 'testsuite',
        attributes: {
          name: feature.name,
          tests: feature.scenarios.length,
          failures: feature.scenarios.filter(s => s.status === 'failed').length,
          errors: 0,
          skipped: feature.scenarios.filter(s => s.status === 'skipped').length,
          time: (feature.scenarios.reduce((sum, s) => sum + s.duration, 0) / 1000).toFixed(3),
          timestamp: new Date(feature.scenarios[0]?.startTime || result.startTime).toISOString(),
          hostname: require('os').hostname(),
          id: feature.id || feature.name.toLowerCase().replace(/\s+/g, '-'),
          package: feature.package || feature.file?.split('/').slice(0, -1).join('.') || ''
        },
        children: []
      };

      // Add testsuite properties
      if (options.includeProperties && feature.tags && feature.tags.length > 0) {
        const properties: XMLElement = {
          name: 'properties',
          children: feature.tags.map(tag => ({
            name: 'property',
            attributes: {
              name: 'tag',
              value: tag
            }
          }))
        };
        testsuite.children!.push(properties);
      }

      // Add test cases (scenarios)
      feature.scenarios.forEach(scenario => {
        const testcase: XMLElement = {
          name: 'testcase',
          attributes: {
            name: scenario.name,
            classname: feature.name.replace(/\s+/g, '.'),
            time: (scenario.duration / 1000).toFixed(3),
            ...(scenario.line && { line: scenario.line })
          },
          children: []
        };

        // Add failure information
        if (scenario.status === 'failed' && scenario.error) {
          const failure: XMLElement = {
            name: 'failure',
            attributes: {
              message: this.escapeXML(scenario.error),
              type: scenario.errorType || 'AssertionError'
            }
          };
          
          if (scenario.errorStack || scenario.errorDetails) {
            failure.cdata = scenario.errorStack || scenario.errorDetails;
          } else {
            failure.text = this.escapeXML(scenario.error);
          }
          
          testcase.children!.push(failure);
        }

        // Add error information (for errors vs failures distinction)
        if (scenario.status === 'error' && scenario.error) {
          const error: XMLElement = {
            name: 'error',
            attributes: {
              message: this.escapeXML(scenario.error),
              type: scenario.errorType || 'Error'
            }
          };
          
          if (scenario.errorStack) {
            error.cdata = scenario.errorStack;
          } else {
            error.text = this.escapeXML(scenario.error);
          }
          
          testcase.children!.push(error);
        }

        // Add skipped information
        if (scenario.status === 'skipped') {
          const skipped: XMLElement = {
            name: 'skipped',
            attributes: {}
          };
          
          if (scenario.skipReason) {
            skipped.attributes!.message = this.escapeXML(scenario.skipReason);
          }
          
          testcase.children!.push(skipped);
        }

        // Add system output
        if (options.includeSystemOut && scenario.logs && scenario.logs.length > 0) {
          const systemOut: XMLElement = {
            name: 'system-out',
            cdata: scenario.logs.map(log => 
              `[${new Date(log.timestamp).toISOString()}] [${log.level}] ${log.message}`
            ).join('\n')
          };
          testcase.children!.push(systemOut);
        }

        // Add system error
        if (options.includeSystemErr && scenario.errorLogs && scenario.errorLogs.length > 0) {
          const systemErr: XMLElement = {
            name: 'system-err',
            cdata: scenario.errorLogs.map(log => 
              `[${new Date(log.timestamp).toISOString()}] ${log.message}`
            ).join('\n')
          };
          testcase.children!.push(systemErr);
        }

        // Add attachments as properties
        if (options.includeAttachments && scenario.attachments && scenario.attachments.length > 0) {
          scenario.attachments.forEach((attachment, index) => {
            testcase.children!.push({
              name: 'property',
              attributes: {
                name: `attachment-${index}`,
                value: `${attachment.type}:${attachment.path}`
              }
            });
          });
        }

        testsuite.children!.push(testcase);
      });

      testsuites.children!.push(testsuite);
    });

    return testsuites;
  }

  private generateTestNG(
    result: ExecutionResult,
    options: XMLExportOptions
  ): XMLElement {
    const testngResults: XMLElement = {
      name: 'testng-results',
      attributes: {
        version: '1.0',
        ignored: result.summary.skipped,
        total: result.summary.totalScenarios,
        passed: result.summary.passed,
        failed: result.summary.failed,
        skipped: result.summary.skipped
      },
      children: []
    };

    // Add reporter output
    const reporterOutput: XMLElement = {
      name: 'reporter-output',
      children: []
    };
    
    if (result.logs && result.logs.length > 0) {
      result.logs.slice(0, 100).forEach(log => { // Limit to 100 lines
        reporterOutput.children!.push({
          name: 'line',
          cdata: `[${new Date(log.timestamp).toISOString()}] [${log.level}] ${log.message}`
        });
      });
    }
    
    testngResults.children!.push(reporterOutput);

    // Add suite
    const suite: XMLElement = {
      name: 'suite',
      attributes: {
        name: 'CS Test Automation Suite',
        'started-at': new Date(result.startTime).toISOString(),
        'finished-at': new Date(result.endTime).toISOString(),
        'duration-ms': result.duration
      },
      children: []
    };

    // Add test elements (features)
    result.features.forEach(feature => {
      const test: XMLElement = {
        name: 'test',
        attributes: {
          name: feature.name,
          'started-at': new Date(feature.scenarios[0]?.startTime || result.startTime).toISOString(),
          'finished-at': new Date(
            feature.scenarios[feature.scenarios.length - 1]?.endTime || result.endTime
          ).toISOString(),
          'duration-ms': feature.scenarios.reduce((sum, s) => sum + s.duration, 0)
        },
        children: []
      };

      // Group scenarios by class (feature name)
      const testClass: XMLElement = {
        name: 'class',
        attributes: {
          name: `com.cs.test.${feature.name.replace(/\s+/g, '.')}`
        },
        children: []
      };

      // Add test methods (scenarios)
      feature.scenarios.forEach(scenario => {
        const testMethod: XMLElement = {
          name: 'test-method',
          attributes: {
            signature: `${scenario.name.replace(/\s+/g, '_')}()`,
            name: scenario.name.replace(/\s+/g, '_'),
            'started-at': new Date(scenario.startTime).toISOString(),
            'finished-at': new Date(scenario.endTime).toISOString(),
            'duration-ms': scenario.duration,
            status: scenario.status.toUpperCase(),
            'data-provider': scenario.dataProvider || '',
            description: scenario.description || scenario.name,
            'is-config': 'false'
          },
          children: []
        };

        // Add parameters if data-driven
        if (scenario.parameters && Object.keys(scenario.parameters).length > 0) {
          const params: XMLElement = {
            name: 'params',
            children: Object.entries(scenario.parameters).map(([key, value], index) => ({
              name: 'param',
              attributes: { index: String(index) },
              children: [{
                name: 'value',
                cdata: String(value)
              }]
            }))
          };
          testMethod.children!.push(params);
        }

        // Add groups (tags)
        if (scenario.tags && scenario.tags.length > 0) {
          const groups: XMLElement = {
            name: 'groups',
            children: scenario.tags.map(tag => ({
              name: 'group',
              attributes: { name: tag }
            }))
          };
          testMethod.children!.push(groups);
        }

        // Add exception for failures
        if (scenario.status === 'failed' && scenario.error) {
          const exception: XMLElement = {
            name: 'exception',
            attributes: {
              class: scenario.errorType || 'java.lang.AssertionError'
            },
            children: [
              {
                name: 'message',
                cdata: scenario.error
              }
            ]
          };
          
          if (scenario.errorStack) {
            exception.children!.push({
              name: 'full-stacktrace',
              cdata: scenario.errorStack
            });
          }
          
          testMethod.children!.push(exception);
        }

        // Add reporter output for this method
        if (options.includeSystemOut && scenario.logs && scenario.logs.length > 0) {
          const methodOutput: XMLElement = {
            name: 'reporter-output',
            children: scenario.logs.map(log => ({
              name: 'line',
              cdata: `[${new Date(log.timestamp).toISOString()}] [${log.level}] ${log.message}`
            }))
          };
          testMethod.children!.push(methodOutput);
        }

        testClass.children!.push(testMethod);
      });

      test.children!.push(testClass);
      suite.children!.push(test);
    });

    testngResults.children!.push(suite);
    return testngResults;
  }

  private generateNUnit(
    result: ExecutionResult,
    options: XMLExportOptions
  ): XMLElement {
    const testRun: XMLElement = {
      name: 'test-run',
      attributes: {
        id: result.executionId,
        name: 'CS Test Automation Run',
        fullname: 'CS Test Automation Framework',
        testcasecount: result.summary.totalScenarios,
        result: result.summary.failed > 0 ? 'Failed' : 'Passed',
        'start-time': new Date(result.startTime).toISOString(),
        'end-time': new Date(result.endTime).toISOString(),
        duration: (result.duration / 1000).toFixed(3),
        total: result.summary.totalScenarios,
        passed: result.summary.passed,
        failed: result.summary.failed,
        inconclusive: 0,
        skipped: result.summary.skipped,
        warnings: 0,
        asserts: result.summary.totalSteps || 0},
      children: []
    };

    // Add filter element
    testRun.children!.push({
      name: 'filter',
      children: []
    });

    // Add test-suite hierarchy
    const testSuite: XMLElement = {
      name: 'test-suite',
      attributes: {
        type: 'Assembly',
        id: '0-1',
        name: 'CS.Test.Automation.dll',
        fullname: path.resolve(process.cwd(), 'CS.Test.Automation.dll'),
        runstate: 'Runnable',
        testcasecount: result.summary.totalScenarios,
        result: result.summary.failed > 0 ? 'Failed' : 'Passed',
        'start-time': new Date(result.startTime).toISOString(),
        'end-time': new Date(result.endTime).toISOString(),
        duration: (result.duration / 1000).toFixed(3),
        total: result.summary.totalScenarios,
        passed: result.summary.passed,
        failed: result.summary.failed,
        warnings: 0,
        inconclusive: 0,
        skipped: result.summary.skipped,
        asserts: result.summary.totalSteps || 0
      },
      children: []
    };

    // Add environment
    const environment: XMLElement = {
      name: 'environment',
      attributes: {
        framework: 'CS Test Automation 1.0.0',
        clr: process.version,
        os: `${process.platform} ${process.release.version}`,
        platform: process.arch,
        cwd: process.cwd(),
        'machine-name': require('os').hostname(),
        user: require('os').userInfo().username,
        'user-domain': require('os').hostname(),
        culture: process.env.LANG || 'en-US',
        uiculture: process.env.LANG || 'en-US',
        'os-version': require('os').release()
      }
    };
    testSuite.children!.push(environment);

    // Add settings if any
    if (result.metadata && Object.keys(result.metadata).length > 0) {
      const settings: XMLElement = {
        name: 'settings',
        children: Object.entries(result.metadata).map(([key, value]) => ({
          name: 'setting',
          attributes: {
            name: key,
            value: String(value)
          }
        }))
      };
      testSuite.children!.push(settings);
    }

    // Add properties
    if (options.includeProperties) {
      const properties: XMLElement = {
        name: 'properties',
        children: [
          {
            name: 'property',
            attributes: {
              name: '_PID',
              value: String(process.pid)
            }
          },
          {
            name: 'property',
            attributes: {
              name: '_APPDOMAIN',
              value: 'CS Test Automation'
            }
          }
        ]
      };
      testSuite.children!.push(properties);
    }

    // Add failure element if there are failures
    if (result.summary.failed > 0) {
      const failureMessages = new Set<string>();
      const stackTraces = new Set<string>();
      
      result.features.forEach(feature => {
        feature.scenarios.forEach(scenario => {
          if (scenario.status === 'failed' && scenario.error) {
            failureMessages.add(scenario.error);
            if (scenario.errorStack) {
              stackTraces.add(scenario.errorStack);
            }
          }
        });
      });

      const failure: XMLElement = {
        name: 'failure',
        children: [
          {
            name: 'message',
            cdata: Array.from(failureMessages).join('\n\n')
          }
        ]
      };
      
      if (stackTraces.size > 0) {
        failure.children!.push({
          name: 'stack-trace',
          cdata: Array.from(stackTraces).join('\n\n')
        });
      }
      
      testSuite.children!.push(failure);
    }

    // Add test fixtures (features)
    result.features.forEach((feature, featureIndex) => {
      const testFixture: XMLElement = {
        name: 'test-suite',
        attributes: {
          type: 'TestFixture',
          id: `0-${1000 + featureIndex}`,
          name: feature.name,
          fullname: `CS.Test.Automation.${feature.name.replace(/\s+/g, '.')}`,
          classname: `CS.Test.Automation.${feature.name.replace(/\s+/g, '.')}`,
          runstate: 'Runnable',
          testcasecount: feature.scenarios.length,
          result: feature.scenarios.some(s => s.status === 'failed') ? 'Failed' : 
                  feature.scenarios.every(s => s.status === 'passed') ? 'Passed' : 'Skipped',
          'start-time': new Date(feature.scenarios[0]?.startTime || result.startTime).toISOString(),
          'end-time': new Date(
            feature.scenarios[feature.scenarios.length - 1]?.endTime || result.endTime
          ).toISOString(),
          duration: (feature.scenarios.reduce((sum, s) => sum + s.duration, 0) / 1000).toFixed(3),
          total: feature.scenarios.length,
          passed: feature.scenarios.filter(s => s.status === 'passed').length,
          failed: feature.scenarios.filter(s => s.status === 'failed').length,
          warnings: 0,
          inconclusive: 0,
          skipped: feature.scenarios.filter(s => s.status === 'skipped').length,
          asserts: feature.scenarios.reduce((sum, s) => sum + s.steps.length, 0)
        },
        children: []
      };

      // Add test cases (scenarios)
      feature.scenarios.forEach((scenario, scenarioIndex) => {
        const testCase: XMLElement = {
          name: 'test-case',
          attributes: {
            id: `0-${1000 + featureIndex}${scenarioIndex}`,
            name: scenario.name,
            fullname: `CS.Test.Automation.${feature.name.replace(/\s+/g, '.')}.${scenario.name.replace(/\s+/g, '_')}`,
            methodname: scenario.name.replace(/\s+/g, '_'),
            classname: `CS.Test.Automation.${feature.name.replace(/\s+/g, '.')}`,
            runstate: 'Runnable',
            seed: String(Math.floor(Math.random() * 2147483647)),
            result: scenario.status === 'passed' ? 'Passed' : 
                   scenario.status === 'failed' ? 'Failed' : 'Skipped',
            label: scenario.tags?.join(',') || '',
            'start-time': new Date(scenario.startTime).toISOString(),
            'end-time': new Date(scenario.endTime).toISOString(),
            duration: (scenario.duration / 1000).toFixed(3),
            asserts: scenario.steps.length
          },
          children: []
        };

        // Add properties for parameters
        if (scenario.parameters && Object.keys(scenario.parameters).length > 0) {
          const properties: XMLElement = {
            name: 'properties',
            children: Object.entries(scenario.parameters).map(([key, value]) => ({
              name: 'property',
              attributes: {
                name: key,
                value: String(value)
              }
            }))
          };
          testCase.children!.push(properties);
        }

        // Add failure info
        if (scenario.status === 'failed' && scenario.error) {
          const failure: XMLElement = {
            name: 'failure',
            children: [
              {
                name: 'message',
                cdata: scenario.error
              }
            ]
          };
          
          if (scenario.errorStack) {
            failure.children!.push({
              name: 'stack-trace',
              cdata: scenario.errorStack
            });
          }
          
          testCase.children!.push(failure);
        }

        // Add reason for skipped
        if (scenario.status === 'skipped') {
          const reason: XMLElement = {
            name: 'reason',
            children: [{
              name: 'message',
              cdata: scenario.skipReason || 'Test was skipped'
            }]
          };
          testCase.children!.push(reason);
        }

        // Add output
        if (options.includeSystemOut && scenario.logs && scenario.logs.length > 0) {
          const output: XMLElement = {
            name: 'output',
            cdata: scenario.logs.map(log => 
              `[${new Date(log.timestamp).toISOString()}] [${log.level}] ${log.message}`
            ).join('\n')
          };
          testCase.children!.push(output);
        }

        // Add assertions
        const assertions: XMLElement = {
          name: 'assertions',
          children: scenario.steps.map((step, stepIndex) => ({
            name: 'assertion',
            attributes: {
              result: step.status === 'passed' ? 'Passed' : 
                      step.status === 'failed' ? 'Failed' : 'Skipped',
              message: `${step.keyword} ${step.text}`
            },
            ...(step.error && {
              children: [{
                name: 'stack-trace',
                cdata: step.errorStack || step.error
              }]
            })
          }))
        };
        
        if (assertions.children && assertions.children.length > 0) {
          testCase.children!.push(assertions);
        }

        // Add attachments
        if (options.includeAttachments && scenario.attachments && scenario.attachments.length > 0) {
          const attachments: XMLElement = {
            name: 'attachments',
            children: scenario.attachments.map(att => ({
              name: 'attachment',
              children: [
                {
                  name: 'filePath',
                  cdata: att.path
                },
                {
                  name: 'description',
                  cdata: att.description || att.name || 'Attachment'
                }
              ]
            }))
          };
          testCase.children!.push(attachments);
        }

        testFixture.children!.push(testCase);
      });

      testSuite.children!.push(testFixture);
    });

    testRun.children!.push(testSuite);
    return testRun;
  }

  private generateXUnit(
    result: ExecutionResult,
    options: XMLExportOptions
  ): XMLElement {
    const assemblies: XMLElement = {
      name: 'assemblies',
      attributes: {
        timestamp: new Date(result.startTime).toISOString()
      },
      children: []
    };

    const assembly: XMLElement = {
      name: 'assembly',
      attributes: {
        name: 'CS.Test.Automation.dll',
        environment: result.environment,
        'test-framework': 'CS Test Framework',
        'run-date': new Date(result.startTime).toISOString().split('T')[0],
        'run-time': new Date(result.startTime).toISOString().split('T')[1].split('.')[0],
        'config-file': path.resolve(process.cwd(), 'test.config'),
        time: (result.duration / 1000).toFixed(3),
        total: result.summary.totalScenarios,
        passed: result.summary.passed,
        failed: result.summary.failed,
        skipped: result.summary.skipped,
        errors: 0
      },
      children: []
    };

    // Add errors element (always empty for xUnit 2.0 compatibility)
    assembly.children!.push({
      name: 'errors',
      children: []
    });

    // Add collection per feature
    result.features.forEach(feature => {
      const collection: XMLElement = {
        name: 'collection',
        attributes: {
          name: `Test collection for ${feature.name}`,
          time: (feature.scenarios.reduce((sum, s) => sum + s.duration, 0) / 1000).toFixed(3),
          total: feature.scenarios.length,
          passed: feature.scenarios.filter(s => s.status === 'passed').length,
          failed: feature.scenarios.filter(s => s.status === 'failed').length,
          skipped: feature.scenarios.filter(s => s.status === 'skipped').length
        },
        children: []
      };

      // Add tests
      feature.scenarios.forEach(scenario => {
        const test: XMLElement = {
          name: 'test',
          attributes: {
            name: scenario.name,
            type: `CS.Test.Automation.${feature.name.replace(/\s+/g, '.')}`,
            method: scenario.name.replace(/\s+/g, '_'),
            time: (scenario.duration / 1000).toFixed(3),
            result: scenario.status === 'passed' ? 'Pass' : 
                   scenario.status === 'failed' ? 'Fail' : 'Skip'
          },
          children: []
        };

        // Add traits (tags)
        if (scenario.tags && scenario.tags.length > 0) {
          const traits: XMLElement = {
            name: 'traits',
            children: scenario.tags.map(tag => ({
              name: 'trait',
              attributes: {
                name: 'Category',
                value: tag
              }
            }))
          };
          test.children!.push(traits);
        }

        // Add failure
        if (scenario.status === 'failed' && scenario.error) {
          const failure: XMLElement = {
            name: 'failure',
            attributes: {
              'exception-type': scenario.errorType || 'System.Exception'
            },
            children: [
              {
                name: 'message',
                cdata: scenario.error
              }
            ]
          };
          
          if (scenario.errorStack) {
            failure.children!.push({
              name: 'stack-trace',
              cdata: scenario.errorStack
            });
          }
          
          test.children!.push(failure);
        }

        // Add reason for skip
        if (scenario.status === 'skipped') {
          const reason: XMLElement = {
            name: 'reason',
            cdata: scenario.skipReason || 'Test was skipped'
          };
          test.children!.push(reason);
        }

        // Add output
        if (options.includeSystemOut && scenario.logs && scenario.logs.length > 0) {
          const output: XMLElement = {
            name: 'output',
            cdata: scenario.logs.map(log => 
              `[${new Date(log.timestamp).toISOString()}] [${log.level}] ${log.message}`
            ).join('\n')
          };
          test.children!.push(output);
        }

        collection.children!.push(test);
      });

      assembly.children!.push(collection);
    });

    assemblies.children!.push(assembly);
    return assemblies;
  }

  private generateTRX(
    result: ExecutionResult,
    options: XMLExportOptions
  ): XMLElement {
    const testRunId = result.executionId || this.generateGuid();
    const testListId = this.generateGuid();
    
    const testRun: XMLElement = {
      name: 'TestRun',
      attributes: {
        id: testRunId,
        name: `CS Test Automation @ ${new Date(result.startTime).toISOString()}`,
        runUser: require('os').userInfo().username,
        xmlns: 'http://microsoft.com/schemas/VisualStudio/TeamTest/2010'
      },
      children: []
    };

    // Add TestSettings
    const testSettings: XMLElement = {
      name: 'TestSettings',
      attributes: {
        name: 'Default Test Settings',
        id: this.generateGuid()
      },
      children: [
        {
          name: 'Description',
          text: 'CS Test Automation Framework execution'
        },
        {
          name: 'Deployment',
          attributes: {
            runDeploymentRoot: path.resolve(process.cwd(), 'TestResults', testRunId)
          }
        }
      ]
    };
    testRun.children!.push(testSettings);

    // Add Times
    const times: XMLElement = {
      name: 'Times',
      attributes: {
        creation: new Date(result.startTime).toISOString(),
        queuing: new Date(result.startTime).toISOString(),
        start: new Date(result.startTime).toISOString(),
        finish: new Date(result.endTime).toISOString()
      }
    };
    testRun.children!.push(times);

    // Add ResultSummary
    const resultSummary: XMLElement = {
      name: 'ResultSummary',
      attributes: {
        outcome: result.summary.failed > 0 ? 'Failed' : 'Completed'
      },
      children: [
        {
          name: 'Counters',
          attributes: {
            total: result.summary.totalScenarios,
            executed: result.summary.totalScenarios - result.summary.skipped,
            passed: result.summary.passed,
            failed: result.summary.failed,
            error: 0,
            timeout: 0,
            aborted: 0,
            inconclusive: 0,
            passedButRunAborted: 0,
            notRunnable: 0,
            notExecuted: result.summary.skipped,
            disconnected: 0,
            warning: 0,
            completed: result.summary.passed + result.summary.failed,
            inProgress: 0,
            pending: result.summary.pending || 0
          }
        }
      ]
    };
    
    // Add RunInfos if there are failures
    if (result.summary.failed > 0) {
      const runInfos: XMLElement = {
        name: 'RunInfos',
        children: []
      };
      
      const errorMessages = new Set<string>();
      result.features.forEach(feature => {
        feature.scenarios.forEach(scenario => {
          if (scenario.status === 'failed' && scenario.error) {
            errorMessages.add(scenario.error);
          }
        });
      });
      
      errorMessages.forEach(message => {
        runInfos.children!.push({
          name: 'RunInfo',
          attributes: {
            computerName: require('os').hostname(),
            outcome: 'Error',
            timestamp: new Date().toISOString()
          },
          children: [
            {
              name: 'Text',
              text: message
            }
          ]
        });
      });
      
      if (runInfos.children!.length > 0) {
        resultSummary.children!.push(runInfos);
      }
    }
    
    testRun.children!.push(resultSummary);

    // Add TestDefinitions
    const testDefinitions: XMLElement = {
      name: 'TestDefinitions',
      children: []
    };
    
    const unitTestDefinitions: { id: string; scenario: any; feature: any }[] = [];
    
    result.features.forEach(feature => {
      feature.scenarios.forEach(scenario => {
        const testId = this.generateGuid();
        unitTestDefinitions.push({ id: testId, scenario, feature });
        
        testDefinitions.children!.push({
          name: 'UnitTest',
          attributes: {
            name: scenario.name,
            storage: path.resolve(process.cwd(), 'CS.Test.Automation.dll'),
            id: testId
          },
          children: [
            {
              name: 'Execution',
              attributes: {
                id: this.generateGuid()
              }
            },
            {
              name: 'TestMethod',
              attributes: {
                codeBase: 'CS.Test.Automation.dll',
                adapterTypeName: 'CS.Test.Automation.Adapter',
                className: `CS.Test.Automation.${feature.name.replace(/\s+/g, '.')}`,
                name: scenario.name.replace(/\s+/g, '_')
              }
            }
          ]
        });
      });
    });
    
    testRun.children!.push(testDefinitions);

    // Add TestLists
    const testLists: XMLElement = {
      name: 'TestLists',
      children: [
        {
          name: 'TestList',
          attributes: {
            name: 'Results Not in a List',
            id: this.generateGuid()
          }
        },
        {
          name: 'TestList',
          attributes: {
            name: 'All Loaded Results',
            id: testListId
          }
        }
      ]
    };
    testRun.children!.push(testLists);

    // Add TestEntries
    const testEntries: XMLElement = {
      name: 'TestEntries',
      children: unitTestDefinitions.map(def => ({
        name: 'TestEntry',
        attributes: {
          testId: def.id,
          executionId: this.generateGuid(),
          testListId: testListId
        }
      }))
    };
    testRun.children!.push(testEntries);

    // Add Results
    const results: XMLElement = {
      name: 'Results',
      children: []
    };
    
    unitTestDefinitions.forEach(def => {
      const scenario = def.scenario;
      const executionId = this.generateGuid();
      
      const unitTestResult: XMLElement = {
        name: 'UnitTestResult',
        attributes: {
          executionId: executionId,
          testId: def.id,
          testName: scenario.name,
          computerName: require('os').hostname(),
          duration: this.formatDuration(scenario.duration),
          startTime: new Date(scenario.startTime).toISOString(),
          endTime: new Date(scenario.endTime).toISOString(),
          testType: '13cdc9d9-ddb5-4fa4-a97d-d965ccfc6d4b',
          outcome: scenario.status === 'passed' ? 'Passed' : 
                   scenario.status === 'failed' ? 'Failed' : 'NotExecuted',
          testListId: testListId,
          relativeResultsDirectory: executionId
        },
        children: []
      };
      
      // Add Output
      const output: XMLElement = {
        name: 'Output',
        children: []
      };
      
      // Add StdOut
      if (scenario.logs && scenario.logs.length > 0) {
        output.children!.push({
          name: 'StdOut',
          text: scenario.logs.map(log => 
            `[${new Date(log.timestamp).toISOString()}] [${log.level}] ${log.message}`
          ).join('\n')
        });
      }
      
      // Add ErrorInfo for failures
      if (scenario.status === 'failed' && scenario.error) {
        output.children!.push({
          name: 'ErrorInfo',
          children: [
            {
              name: 'Message',
              text: scenario.error
            },
            ...(scenario.errorStack ? [{
              name: 'StackTrace',
              text: scenario.errorStack
            }] : [])
          ]
        });
      }
      
      if (output.children!.length > 0) {
        unitTestResult.children!.push(output);
      }
      
      // Add ResultFiles for attachments
      if (scenario.attachments && scenario.attachments.length > 0) {
        const resultFiles: XMLElement = {
          name: 'ResultFiles',
          children: scenario.attachments.map(att => ({
            name: 'ResultFile',
            attributes: {
              path: att.path
            }
          }))
        };
        unitTestResult.children!.push(resultFiles);
      }
      
      results.children!.push(unitTestResult);
    });
    
    testRun.children!.push(results);

    return testRun;
  }

  private async generateCustom(
    result: ExecutionResult,
    options: XMLExportOptions
  ): Promise<XMLElement> {
    if (!options.customTemplate) {
      throw new Error('Custom template is required for custom format');
    }

    try {
      const template = await fs.promises.readFile(options.customTemplate, 'utf8');
      return this.processTemplate(template, result);
    } catch (error) {
      this.logger.error('Failed to process custom template', error);
      throw new Error(`Failed to process custom template: ${error.message}`);
    }
  }

  private processTemplate(template: string, data: any): XMLElement {
    // This is a comprehensive template processor that handles:
    // {{variable}} - Variable substitution
    // {{#each collection}} - Iteration
    // {{#if condition}} - Conditionals
    // {{#unless condition}} - Negative conditionals
    // {{> partial}} - Partial templates
    
    const processValue = (tmpl: string, context: any): string => {
      // Variable substitution
      tmpl = tmpl.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
        const value = this.resolvePath(context, path.trim());
        return value !== undefined ? String(value) : '';
      });
      
      // Each loops
      tmpl = tmpl.replace(
        /\{\{#each\s+(\S+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
        (match, collectionPath, loopContent) => {
          const collection = this.resolvePath(context, collectionPath);
          if (Array.isArray(collection)) {
            return collection.map((item, index) => {
              const loopContext = {
                ...context,
                this: item,
                '@index': index,
                '@first': index === 0,
                '@last': index === collection.length - 1
              };
              return processValue(loopContent, loopContext);
            }).join('');
          }
          return '';
        }
      );
      
      // If conditions
      tmpl = tmpl.replace(
        /\{\{#if\s+([^}]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
        (match, condition, truthy, falsy = '') => {
          const value = this.resolvePath(context, condition.trim());
          return value ? processValue(truthy, context) : processValue(falsy, context);
        }
      );
      
      // Unless conditions
      tmpl = tmpl.replace(
        /\{\{#unless\s+([^}]+)\}\}([\s\S]*?)\{\{\/unless\}\}/g,
        (match, condition, content) => {
          const value = this.resolvePath(context, condition.trim());
          return !value ? processValue(content, context) : '';
        }
      );
      
      return tmpl;
    };
    
    const xmlString = processValue(template, data);
    return this.parseTemplateResult(xmlString);
  }

  private resolvePath(obj: any, path: string): any {
    if (path === 'this') return obj;
    if (path.startsWith('@')) return obj[path];
    
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      
      // Handle array access
      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, prop, index] = arrayMatch;
        current = current[prop]?.[parseInt(index)];
      } else {
        current = current[part];
      }
    }
    
    return current;
  }

  private parseTemplateResult(xmlString: string): XMLElement {
    // Parse the template result into XMLElement structure
    const lines = xmlString.trim().split('\n');
    const stack: XMLElement[] = [];
    let root: XMLElement | null = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Self-closing tag
      const selfClosingMatch = trimmed.match(/^<(\w+)([^>]*)\/>$/);
      if (selfClosingMatch) {
        const [, name, attrs] = selfClosingMatch;
        const element: XMLElement = {
          name,
          attributes: this.parseAttributes(attrs)
        };
        
        if (stack.length > 0) {
          const parent = stack[stack.length - 1];
          if (!parent.children) parent.children = [];
          parent.children.push(element);
        } else {
          root = element;
        }
        continue;
      }
      
      // Opening tag
      const openingMatch = trimmed.match(/^<(\w+)([^>]*)>(.*)$/);
      if (openingMatch) {
        const [, name, attrs, rest] = openingMatch;
        const element: XMLElement = {
          name,
          attributes: this.parseAttributes(attrs)
        };
        
        // Check if it has content on same line
        const closingMatch = rest.match(/^(.*)<\/\w+>$/);
        if (closingMatch) {
          const [, content] = closingMatch;
          if (content.includes('<![CDATA[')) {
            element.cdata = content.replace(/<!\[CDATA\[(.*)\]\]>/, '$1');
          } else {
            element.text = content;
          }
          
          if (stack.length > 0) {
            const parent = stack[stack.length - 1];
            if (!parent.children) parent.children = [];
            parent.children.push(element);
          } else {
            root = element;
          }
        } else {
          if (stack.length > 0) {
            const parent = stack[stack.length - 1];
            if (!parent.children) parent.children = [];
            parent.children.push(element);
          } else {
            root = element;
          }
          stack.push(element);
        }
        continue;
      }
      
      // Closing tag
      const closingMatch = trimmed.match(/^<\/(\w+)>$/);
      if (closingMatch) {
        stack.pop();
        continue;
      }
      
      // Content line
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        if (trimmed.includes('<![CDATA[')) {
          parent.cdata = trimmed.replace(/<!\[CDATA\[(.*)\]\]>/, '$1');
        } else {
          parent.text = (parent.text || '') + trimmed;
        }
      }
    }
    
    if (!root) {
      throw new Error('Failed to parse template result');
    }
    
    return root;
  }

  private elementToXML(element: XMLElement, pretty: boolean = true): string {
    const indent = pretty ? ' '.repeat(this.indentLevel * this.indentSize) : '';
    const newline = pretty ? '\n' : '';
    
    let xml = `${indent}<${element.name}`;
    
    // Add attributes
    if (element.attributes) {
      for (const [key, value] of Object.entries(element.attributes)) {
        if (value !== undefined && value !== null) {
          xml += ` ${key}="${this.escapeXML(String(value))}"`;
        }
      }
    }
    
    // Self-closing tag
    if (!element.text && !element.cdata && !element.comment && 
        (!element.children || element.children.length === 0)) {
      xml += '/>';
      return xml;
    }
    
    xml += '>';
    
    // Add content
    if (element.comment) {
      xml += `<!-- ${element.comment} -->`;
    } else if (element.cdata) {
      xml += `<![CDATA[${element.cdata}]]>`;
    } else if (element.text) {
      xml += this.escapeXML(element.text);
    } else if (element.children && element.children.length > 0) {
      xml += newline;
      this.indentLevel++;
      xml += element.children
        .map(child => this.elementToXML(child, pretty))
        .join(newline);
      this.indentLevel--;
      xml += newline + indent;
    }
    
    xml += `</${element.name}>`;
    return xml;
  }

  private escapeXML(str: string): string {
    if (!str) return '';
    
    // Handle invalid XML characters
    if (this.options?.escapeInvalidChars) {
      // Remove or replace invalid XML 1.0 characters
      str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
    }
    
    // Standard XML escaping
    return str.replace(/[&<>"']/g, (char) => {
      return this.xmlEntities[char as keyof typeof this.xmlEntities];
    });
  }

  private parseAttributes(attrString: string): Record<string, string | number | boolean> {
    const attributes: Record<string, string | number | boolean> = {};
    if (!attrString) return attributes;
    
    const attrRegex = /(\w+)=["']([^"']+)["']/g;
    let match;
    
    while ((match = attrRegex.exec(attrString)) !== null) {
      const [, name, value] = match;
      
      // Try to parse as number
      if (!isNaN(Number(value))) {
        attributes[name] = Number(value);
      } 
      // Try to parse as boolean
      else if (value === 'true' || value === 'false') {
        attributes[name] = value === 'true';
      } 
      // Otherwise keep as string
      else {
        attributes[name] = value;
      }
    }
    
    return attributes;
  }

  private generateGuid(): string {
    // Generate a GUID compatible with TRX format
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  private formatDuration(ms: number): string {
    // Format duration for TRX (HH:MM:SS.mmm)
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = ms % 1000;
    
    return `${hours.toString().padStart(2, '0')}:${
      minutes.toString().padStart(2, '0')}:${
      seconds.toString().padStart(2, '0')}.${
      milliseconds.toString().padStart(3, '0')}`;
  }

  async exportStream(
    result: ExecutionResult,
    options: XMLExportOptions = {}
  ): Promise<Readable> {
    const stream = new Readable({
      read() {}
    });
    
    try {
      // Generate XML content
      const xmlContent = await this.generateXML(result, options);
      
      if (options.compress) {
        const compressed = await gzip(Buffer.from(xmlContent, options.encoding || 'utf8'));
        stream.push(compressed);
      } else {
        stream.push(xmlContent, options.encoding || 'utf8');
      }
      
      stream.push(null); // End stream
    } catch (error) {
      stream.destroy(error);
    }
    
    return stream;
  }

  async exportPartial(
    result: ExecutionResult,
    outputPath: string,
    featureFilter: (feature: any) => boolean,
    options: XMLExportOptions = {}
  ): Promise<ExportResult> {
    const filteredResult = {
      ...result,
      features: result.features.filter(featureFilter),
      summary: this.recalculateSummary(result.features.filter(featureFilter))
    };
    
    return this.export(filteredResult, outputPath, options);
  }

  private recalculateSummary(features: any[]): any {
    const scenarios = features.flatMap(f => f.scenarios);
    const steps = scenarios.flatMap(s => s.steps);
    
    return {
      totalFeatures: features.length,
      totalScenarios: scenarios.length,
      totalSteps: steps.length,
      passed: scenarios.filter(s => s.status === 'passed').length,
      failed: scenarios.filter(s => s.status === 'failed').length,
      skipped: scenarios.filter(s => s.status === 'skipped').length,
      pending: scenarios.filter(s => s.status === 'pending').length || 0,
      passedSteps: steps.filter(s => s.status === 'passed').length,
      failedSteps: steps.filter(s => s.status === 'failed').length,
      skippedSteps: steps.filter(s => s.status === 'skipped').length,
      pendingSteps: steps.filter(s => s.status === 'pending').length || 0
    };
  }

  async merge(
    results: ExecutionResult[],
    outputPath: string,
    options: XMLExportOptions = {}
  ): Promise<ExportResult> {
    if (results.length === 0) {
      throw new Error('No results to merge');
    }
    
    const mergedResult: ExecutionResult = {
      executionId: `merged-${Date.now()}`,
      environment: results[0].environment,
      startTime: Math.min(...results.map(r => r.startTime)),
      endTime: Math.max(...results.map(r => r.endTime)),
      duration: 0,
      features: [],
      summary: {
        totalFeatures: 0,
        totalScenarios: 0,
        totalSteps: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        pending: 0
      },
      metadata: {
        merged: true,
        sourceCount: results.length,
        sources: results.map(r => r.executionId)
      }
    };
    
    // Merge features
    const featureMap = new Map<string, any>();
    
    for (const result of results) {
      for (const feature of result.features) {
        const key = feature.name;
        if (featureMap.has(key)) {
          const existing = featureMap.get(key);
          existing.scenarios.push(...feature.scenarios);
        } else {
          featureMap.set(key, {
            ...feature,
            scenarios: [...feature.scenarios]
          });
        }
      }
    }
    
    mergedResult.features = Array.from(featureMap.values());
    mergedResult.summary = this.recalculateSummary(mergedResult.features);
    mergedResult.duration = mergedResult.endTime - mergedResult.startTime;
    
    return this.export(mergedResult, outputPath, options);
  }
}