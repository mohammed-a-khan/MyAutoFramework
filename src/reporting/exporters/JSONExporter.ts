// src/reporting/exporters/JSONExporter.ts

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { Readable, Transform, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { ExportResult, ExportOptions, ExecutionResult } from '../types/reporting.types';
import { Logger } from '../../utils/Logger';
import { DateUtils } from '../../utils/DateUtils';
import { FileUtils } from '../../utils/FileUtils';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

interface JSONExportOptions extends ExportOptions {
  pretty?: boolean;
  includeEvidence?: boolean;
  includeMetrics?: boolean;
  includeLogs?: boolean;
  includeTimings?: boolean;
  schema?: 'default' | 'junit' | 'cucumber' | 'testng' | 'allure' | 'custom';
  customSchema?: any;
  compress?: boolean;
  streaming?: boolean;
  maxDepth?: number;
  dateFormat?: 'iso' | 'timestamp' | 'custom';
  customDateFormat?: string;
  excludeEmpty?: boolean;
  includeMetadata?: boolean;
}

interface StreamingOptions {
  batchSize: number;
  flushInterval: number;
  maxMemory: number;
}

export class JSONExporter {
  private logger = new Logger('JSONExporter');
  private readonly memoryThreshold = 50 * 1024 * 1024; // 50MB
  
  async export(
    result: ExecutionResult,
    outputPath: string,
    options: JSONExportOptions = {}
  ): Promise<ExportResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting JSON export', { outputPath, options });

      // Ensure directory exists
      await FileUtils.ensureDirectory(path.dirname(outputPath));

      // Transform result based on schema
      const transformedResult = this.transformBySchema(result, options);
      
      // Determine if streaming is needed
      const estimatedSize = this.estimateSize(transformedResult);
      const shouldStream = options.streaming || estimatedSize > this.memoryThreshold;

      let fileSize: number;
      let finalPath = outputPath;

      if (shouldStream) {
        fileSize = await this.exportWithStreaming(transformedResult, outputPath, options);
      } else {
        fileSize = await this.exportDirect(transformedResult, outputPath, options);
      }

      if (options.compress) {
        finalPath = outputPath + '.gz';
      }

      const exportTime = Date.now() - startTime;
      this.logger.info('JSON export completed', { 
        exportTime,
        fileSize,
        schema: options.schema || 'default',
        streaming: shouldStream,
        compressed: options.compress
      });

      return {
        success: true,
        outputPath: finalPath,
        format: 'json',
        exportTime,
        fileSize,
        metadata: {
          schema: options.schema || 'default',
          compressed: options.compress || false,
          streaming: shouldStream,
          pretty: options.pretty || false
        }
      };

    } catch (error) {
      this.logger.error('JSON export failed', error);
      return {
        success: false,
        outputPath,
        format: 'json',
        exportTime: Date.now() - startTime,
        error: error.message,
        stack: error.stack
      };
    }
  }

  private transformBySchema(
    result: ExecutionResult,
    options: JSONExportOptions
  ): any {
    switch (options.schema) {
      case 'junit':
        return this.transformToJUnit(result, options);
      case 'cucumber':
        return this.transformToCucumber(result, options);
      case 'testng':
        return this.transformToTestNG(result, options);
      case 'allure':
        return this.transformToAllure(result, options);
      case 'custom':
        return this.applyCustomSchema(result, options.customSchema);
      default:
        return this.transformToDefault(result, options);
    }
  }

  private transformToDefault(
    result: ExecutionResult,
    options: JSONExportOptions
  ): any {
    const transformed: any = {
      framework: {
        name: 'CS Test Automation Framework',
        version: '1.0.0',
        exportVersion: '1.0.0'
      },
      execution: {
        id: result.executionId,
        environment: result.environment,
        startTime: this.formatDate(result.startTime, options),
        endTime: this.formatDate(result.endTime, options),
        duration: result.duration,
        status: result.summary.failed > 0 ? 'failed' : 'passed'
      },
      summary: {
        features: {
          total: result.summary.totalFeatures,
          passed: result.features.filter(f => 
            f.scenarios.every(s => s.status === 'passed')
          ).length,
          failed: result.features.filter(f => 
            f.scenarios.some(s => s.status === 'failed')
          ).length
        },
        scenarios: {
          total: result.summary.totalScenarios,
          passed: result.summary.passed,
          failed: result.summary.failed,
          skipped: result.summary.skipped,
          pending: result.summary.pending || 0
        },
        steps: {
          total: result.summary.totalSteps,
          passed: result.summary.passedSteps || 0,
          failed: result.summary.failedSteps || 0,
          skipped: result.summary.skippedSteps || 0,
          pending: result.summary.pendingSteps || 0
        },
        passRate: result.summary.totalScenarios > 0 
          ? (result.summary.passed / result.summary.totalScenarios * 100).toFixed(2) + '%'
          : '0%'
      },
      features: result.features.map(feature => this.transformFeature(feature, options)),
      ...(options.includeMetrics && result.metrics && {
        metrics: this.transformMetrics(result.metrics, options)
      }),
      ...(options.includeLogs && result.logs && {
        logs: options.excludeEmpty && result.logs.length === 0 
          ? undefined 
          : this.transformLogs(result.logs, options)
      }),
      ...(options.includeTimings && result.timings && {
        timings: this.transformTimings(result.timings, options)
      }),
      ...(result.tags && result.tags.length > 0 && {
        tags: this.transformTags(result.tags)
      }),
      ...(options.includeMetadata && {
        metadata: {
          ...result.metadata,
          exportedAt: this.formatDate(new Date(), options),
          exportOptions: {
            schema: options.schema || 'default',
            pretty: options.pretty || false,
            compressed: options.compress || false
          }
        }
      })
    };

    // Remove undefined values if excludeEmpty is true
    if (options.excludeEmpty) {
      return this.removeEmpty(transformed);
    }

    return transformed;
  }

  private transformFeature(feature: any, options: JSONExportOptions): any {
    return {
      name: feature.name,
      description: feature.description,
      file: feature.file,
      line: feature.line || 1,
      tags: feature.tags || [],
      background: feature.background,
      scenarios: feature.scenarios.map((scenario: any) => 
        this.transformScenario(scenario, options)
      ),
      statistics: {
        scenarios: {
          total: feature.scenarios.length,
          passed: feature.scenarios.filter((s: any) => s.status === 'passed').length,
          failed: feature.scenarios.filter((s: any) => s.status === 'failed').length,
          skipped: feature.scenarios.filter((s: any) => s.status === 'skipped').length
        },
        duration: feature.scenarios.reduce((sum: number, s: any) => sum + s.duration, 0),
        status: feature.scenarios.some((s: any) => s.status === 'failed') ? 'failed' : 'passed'
      }
    };
  }

  private transformScenario(scenario: any, options: JSONExportOptions): any {
    const transformed: any = {
      name: scenario.name,
      description: scenario.description,
      tags: scenario.tags || [],
      line: scenario.line || 1,
      keyword: scenario.keyword || 'Scenario',
      status: scenario.status,
      startTime: this.formatDate(scenario.startTime, options),
      endTime: this.formatDate(scenario.endTime, options),
      duration: scenario.duration,
      retries: scenario.retries || 0,
      steps: scenario.steps.map((step: any) => this.transformStep(step, options)),
      ...(scenario.parameters && {
        parameters: scenario.parameters
      }),
      ...(scenario.examples && {
        examples: scenario.examples
      }),
      ...(scenario.error && {
        error: {
          message: scenario.error,
          stack: scenario.errorStack,
          details: scenario.errorDetails
        }
      }),
      ...(options.includeEvidence && {
        evidence: {
          screenshots: scenario.screenshots || [],
          videos: scenario.videos || [],
          attachments: scenario.attachments || []
        }
      })
    };

    if (options.excludeEmpty) {
      return this.removeEmpty(transformed);
    }

    return transformed;
  }

  private transformStep(step: any, options: JSONExportOptions): any {
    const transformed: any = {
      keyword: step.keyword,
      text: step.text,
      line: step.line || 1,
      status: step.status,
      duration: step.duration,
      hidden: step.hidden || false,
      ...(step.argument && {
        argument: step.argument
      }),
      ...(step.dataTable && {
        dataTable: step.dataTable
      }),
      ...(step.docString && {
        docString: step.docString
      }),
      ...(step.error && {
        error: {
          message: step.error,
          stack: step.errorStack
        }
      }),
      ...(options.includeEvidence && {
        evidence: {
          screenshots: step.screenshots || [],
          logs: step.logs || []
        }
      })
    };

    if (options.excludeEmpty) {
      return this.removeEmpty(transformed);
    }

    return transformed;
  }

  private transformToJUnit(result: ExecutionResult, options: JSONExportOptions): any {
    return {
      testsuites: {
        '@name': 'CS Test Automation',
        '@tests': result.summary.totalScenarios,
        '@failures': result.summary.failed,
        '@errors': 0,
        '@skipped': result.summary.skipped,
        '@time': (result.duration / 1000).toFixed(3),
        '@timestamp': new Date(result.startTime).toISOString(),
        testsuite: result.features.map(feature => ({
          '@name': feature.name,
          '@tests': feature.scenarios.length,
          '@failures': feature.scenarios.filter(s => s.status === 'failed').length,
          '@errors': 0,
          '@skipped': feature.scenarios.filter(s => s.status === 'skipped').length,
          '@time': (feature.scenarios.reduce((sum, s) => sum + s.duration, 0) / 1000).toFixed(3),
          '@timestamp': new Date(feature.scenarios[0]?.startTime || result.startTime).toISOString(),
          properties: {
            property: [
              { '@name': 'environment', '@value': result.environment },
              { '@name': 'browser', '@value': result.metadata?.browser || 'unknown' }
            ]
          },
          testcase: feature.scenarios.map(scenario => {
            const testcase: any = {
              '@name': scenario.name,
              '@classname': feature.name,
              '@time': (scenario.duration / 1000).toFixed(3)
            };

            if (scenario.status === 'failed') {
              testcase.failure = {
                '@message': scenario.error || 'Test failed',
                '@type': 'AssertionError',
                '#text': scenario.errorStack || scenario.errorDetails || scenario.error
              };
            }

            if (scenario.status === 'skipped') {
              testcase.skipped = {
                '@message': 'Test was skipped'
              };
            }

            if (scenario.logs && scenario.logs.length > 0) {
              testcase['system-out'] = scenario.logs
                .map(log => `[${log.timestamp}] ${log.level}: ${log.message}`)
                .join('\n');
            }

            if (scenario.errorStack) {
              testcase['system-err'] = scenario.errorStack;
            }

            return testcase;
          })
        }))
      }
    };
  }

  private transformToCucumber(result: ExecutionResult, options: JSONExportOptions): any {
    return result.features.map(feature => ({
      description: feature.description || '',
      elements: feature.scenarios.map(scenario => ({
        description: scenario.description || '',
        id: `${feature.name.toLowerCase().replace(/\s+/g, '-')};${scenario.name.toLowerCase().replace(/\s+/g, '-')}`,
        keyword: scenario.keyword || 'Scenario',
        line: scenario.line || 1,
        name: scenario.name,
        steps: scenario.steps.map((step, index) => ({
          arguments: step.dataTable ? [{
            rows: step.dataTable.map((row: any) => ({ cells: row }))
          }] : step.docString ? [{
            content: step.docString,
            line: step.line || index + 1
          }] : [],
          keyword: step.keyword + ' ',
          line: step.line || index + 1,
          match: {
            location: 'steps/unknown.js:0'
          },
          name: step.text,
          result: {
            duration: step.duration * 1000000, // Convert to nanoseconds
            status: step.status,
            ...(step.error && {
              error_message: step.error + (step.errorStack ? '\n' + step.errorStack : '')
            })
          }
        })),
        tags: scenario.tags.map(tag => ({
          line: scenario.line ? scenario.line - 1 : 0,
          name: tag
        })),
        type: 'scenario'
      })),
      id: feature.name.toLowerCase().replace(/\s+/g, '-'),
      keyword: 'Feature',
      line: feature.line || 1,
      name: feature.name,
      tags: feature.tags.map((tag, index) => ({
        line: index,
        name: tag
      })),
      uri: feature.file
    }));
  }

  private transformToTestNG(result: ExecutionResult, options: JSONExportOptions): any {
    const suites = result.features.map(feature => {
      const scenarios = feature.scenarios;
      const passed = scenarios.filter(s => s.status === 'passed').length;
      const failed = scenarios.filter(s => s.status === 'failed').length;
      const skipped = scenarios.filter(s => s.status === 'skipped').length;

      return {
        '@name': feature.name,
        '@duration-ms': scenarios.reduce((sum, s) => sum + s.duration, 0),
        '@started-at': new Date(scenarios[0]?.startTime || result.startTime).toISOString(),
        '@finished-at': new Date(scenarios[scenarios.length - 1]?.endTime || result.endTime).toISOString(),
        groups: {},
        test: scenarios.map(scenario => ({
          '@name': scenario.name,
          '@duration-ms': scenario.duration,
          '@started-at': new Date(scenario.startTime).toISOString(),
          '@finished-at': new Date(scenario.endTime).toISOString(),
          class: {
            '@name': feature.name.replace(/\s+/g, '.')
          },
          'test-method': {
            '@signature': `${scenario.name.replace(/\s+/g, '_')}()`,
            '@name': scenario.name.replace(/\s+/g, '_'),
            '@is-config': false,
            '@duration-ms': scenario.duration,
            '@started-at': new Date(scenario.startTime).toISOString(),
            '@finished-at': new Date(scenario.endTime).toISOString(),
            ...(scenario.status === 'failed' && {
              exception: {
                '@class': 'java.lang.AssertionError',
                message: scenario.error || 'Assertion failed',
                'full-stacktrace': scenario.errorStack || scenario.errorDetails || ''
              }
            }),
            ...(scenario.parameters && {
              params: Object.entries(scenario.parameters).map(([key, value], index) => ({
                param: {
                  '@index': index,
                  value: String(value)
                }
              }))
            })
          }
        }))
      };
    });

    return {
      'testng-results': {
        '@version': '1.0',
        '@skipped': result.summary.skipped,
        '@failed': result.summary.failed,
        '@total': result.summary.totalScenarios,
        '@passed': result.summary.passed,
        'reporter-output': {},
        suite: suites
      }
    };
  }

  private transformToAllure(result: ExecutionResult, options: JSONExportOptions): any {
    return {
      uid: result.executionId,
      name: 'CS Test Automation Results',
      children: result.features.map(feature => ({
        uid: `feature-${feature.name.toLowerCase().replace(/\s+/g, '-')}`,
        name: feature.name,
        befores: [],
        afters: [],
        children: feature.scenarios.map(scenario => ({
          uid: `${scenario.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
          name: scenario.name,
          status: scenario.status,
          stage: 'finished',
          start: scenario.startTime,
          stop: scenario.endTime,
          steps: scenario.steps.map(step => ({
            name: `${step.keyword} ${step.text}`,
            status: step.status,
            stage: 'finished',
            start: scenario.startTime,
            stop: scenario.startTime + step.duration,
            statusDetails: step.error ? {
              message: step.error,
              trace: step.errorStack
            } : {},
            attachments: [
              ...(step.screenshots || []).map(s => ({
                name: s.name || 'screenshot',
                source: s.path,
                type: 'image/png'
              }))
            ]
          })),
          labels: [
            { name: 'feature', value: feature.name },
            { name: 'framework', value: 'CS Test Automation' },
            { name: 'environment', value: result.environment },
            ...scenario.tags.map(tag => ({ name: 'tag', value: tag }))
          ],
          parameters: Object.entries(scenario.parameters || {}).map(([name, value]) => ({
            name,
            value: String(value)
          })),
          attachments: [
            ...(scenario.screenshots || []).map(s => ({
              name: s.name || 'screenshot',
              source: s.path,
              type: 'image/png'
            })),
            ...(scenario.videos || []).map(v => ({
              name: v.name || 'video',
              source: v.path,
              type: 'video/mp4'
            }))
          ],
          statusDetails: scenario.error ? {
            message: scenario.error,
            trace: scenario.errorStack
          } : {},
          historyId: `${feature.name}::${scenario.name}`.toLowerCase().replace(/\s+/g, '-')
        }))
      }))
    };
  }

  private applyCustomSchema(data: any, schema: any): any {
    if (!schema) return data;

    if (typeof schema === 'function') {
      return schema(data);
    }

    if (typeof schema === 'object' && schema !== null) {
      // JSONPath-based transformation
      const result: any = {};
      
      for (const [targetKey, sourcePath] of Object.entries(schema)) {
        if (typeof sourcePath === 'string') {
          result[targetKey] = this.extractByPath(data, sourcePath);
        } else if (typeof sourcePath === 'object') {
          result[targetKey] = this.applyCustomSchema(data, sourcePath);
        }
      }
      
      return result;
    }

    return data;
  }

  private extractByPath(data: any, path: string): any {
    // Simple JSONPath implementation
    if (path.startsWith('$')) {
      path = path.substring(1);
    }
    
    if (path.startsWith('.')) {
      path = path.substring(1);
    }

    const parts = path.split('.');
    let current = data;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      // Handle array notation
      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, propertyName, index] = arrayMatch;
        current = current[propertyName]?.[parseInt(index)];
      } else if (part === '*' && Array.isArray(current)) {
        // Wildcard for arrays
        return current.map(item => this.extractByPath(item, parts.slice(parts.indexOf(part) + 1).join('.')));
      } else {
        current = current[part];
      }
    }

    return current;
  }

  private async exportDirect(
    data: any,
    outputPath: string,
    options: JSONExportOptions
  ): Promise<number> {
    const jsonString = options.pretty 
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);

    const buffer = Buffer.from(jsonString, 'utf8');

    if (options.compress) {
      const compressed = await gzip(buffer);
      await fs.promises.writeFile(outputPath + '.gz', compressed);
      return compressed.length;
    } else {
      await fs.promises.writeFile(outputPath, buffer);
      return buffer.length;
    }
  }

  private async exportWithStreaming(
    data: any,
    outputPath: string,
    options: JSONExportOptions
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      let totalSize = 0;
      const writeStream = fs.createWriteStream(outputPath);
      
      // Create JSON stringifier transform stream
      const jsonStream = new Transform({
        writableObjectMode: true,
        transform(chunk, encoding, callback) {
          try {
            const json = options.pretty 
              ? JSON.stringify(chunk, null, 2) 
              : JSON.stringify(chunk);
            
            const buffer = Buffer.from(json);
            totalSize += buffer.length;
            callback(null, buffer);
          } catch (error) {
            callback(error);
          }
        }
      });

      // Setup pipeline
      const streams: any[] = [jsonStream];
      
      if (options.compress) {
        const gzipStream = zlib.createGzip({
          level: zlib.constants.Z_BEST_COMPRESSION
        });
        streams.push(gzipStream);
        writeStream.path = outputPath + '.gz';
      }
      
      streams.push(writeStream);

      // Handle errors
      const cleanup = () => {
        streams.forEach(stream => {
          if (stream && typeof stream.destroy === 'function') {
            stream.destroy();
          }
        });
      };

      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };

      // Pipe streams
      let currentStream = jsonStream;
      for (let i = 1; i < streams.length; i++) {
        currentStream = currentStream.pipe(streams[i]);
        streams[i].on('error', handleError);
      }

      writeStream.on('finish', () => resolve(totalSize));
      writeStream.on('error', handleError);

      // Start streaming data
      this.streamObject(data, jsonStream, options);
    });
  }

  private streamObject(obj: any, stream: Transform, options: JSONExportOptions): void {
    const processValue = (value: any, depth: number = 0): void => {
      if (options.maxDepth && depth > options.maxDepth) {
        stream.write('"[Max Depth Reached]"');
        return;
      }

      if (value === null) {
        stream.write('null');
      } else if (value === undefined) {
        stream.write('null');
      } else if (typeof value === 'boolean') {
        stream.write(value ? 'true' : 'false');
      } else if (typeof value === 'number') {
        stream.write(String(value));
      } else if (typeof value === 'string') {
        stream.write(JSON.stringify(value));
      } else if (value instanceof Date) {
        stream.write(JSON.stringify(this.formatDate(value, options)));
      } else if (Array.isArray(value)) {
        stream.write('[');
        value.forEach((item, index) => {
          if (index > 0) stream.write(',');
          if (options.pretty) stream.write('\n' + '  '.repeat(depth + 1));
          processValue(item, depth + 1);
        });
        if (options.pretty && value.length > 0) {
          stream.write('\n' + '  '.repeat(depth));
        }
        stream.write(']');
      } else if (typeof value === 'object') {
        stream.write('{');
        const entries = Object.entries(value);
        let writtenCount = 0;
        
        entries.forEach(([key, val], index) => {
          if (options.excludeEmpty && (val === null || val === undefined || 
              (Array.isArray(val) && val.length === 0) ||
              (typeof val === 'object' && Object.keys(val).length === 0))) {
            return;
          }
          
          if (writtenCount > 0) stream.write(',');
          if (options.pretty) stream.write('\n' + '  '.repeat(depth + 1));
          stream.write(JSON.stringify(key) + ':');
          if (options.pretty) stream.write(' ');
          processValue(val, depth + 1);
          writtenCount++;
        });
        
        if (options.pretty && writtenCount > 0) {
          stream.write('\n' + '  '.repeat(depth));
        }
        stream.write('}');
      } else {
        stream.write(JSON.stringify(value));
      }
    };

    processValue(obj);
    stream.end();
  }

  private formatDate(date: Date | string | number, options: JSONExportOptions): string {
    const dateObj = date instanceof Date ? date : new Date(date);
    
    switch (options.dateFormat) {
      case 'timestamp':
        return String(dateObj.getTime());
      case 'custom':
        if (options.customDateFormat) {
          return DateUtils.format(dateObj, options.customDateFormat);
        }
        return dateObj.toISOString();
      case 'iso':
      default:
        return dateObj.toISOString();
    }
  }

  private estimateSize(obj: any): number {
    // Rough estimation of JSON size
    const sample = JSON.stringify(obj).substring(0, 1000);
    const avgCharSize = Buffer.byteLength(sample) / sample.length;
    return this.countChars(obj) * avgCharSize;
  }

  private countChars(obj: any): number {
    if (obj === null || obj === undefined) return 4;
    if (typeof obj === 'boolean') return obj ? 4 : 5;
    if (typeof obj === 'number') return String(obj).length;
    if (typeof obj === 'string') return obj.length + 2;
    if (obj instanceof Date) return 24;
    
    if (Array.isArray(obj)) {
      return 2 + obj.reduce((sum, item) => sum + this.countChars(item) + 1, 0);
    }
    
    if (typeof obj === 'object') {
      return 2 + Object.entries(obj).reduce((sum, [key, value]) => {
        return sum + key.length + 3 + this.countChars(value) + 1;
      }, 0);
    }
    
    return JSON.stringify(obj).length;
  }

  private removeEmpty(obj: any): any {
    if (obj === null || obj === undefined) return undefined;
    
    if (Array.isArray(obj)) {
      const filtered = obj.map(item => this.removeEmpty(item)).filter(item => item !== undefined);
      return filtered.length > 0 ? filtered : undefined;
    }
    
    if (typeof obj === 'object' && obj !== null) {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        const cleaned = this.removeEmpty(value);
        if (cleaned !== undefined) {
          result[key] = cleaned;
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }
    
    return obj;
  }

  private transformMetrics(metrics: any, options: JSONExportOptions): any {
    return {
      performance: metrics.performance ? {
        pageLoadTime: this.formatMetricStats(metrics.performance.pageLoadTime),
        firstContentfulPaint: this.formatMetricStats(metrics.performance.firstContentfulPaint),
        largestContentfulPaint: this.formatMetricStats(metrics.performance.largestContentfulPaint),
        timeToInteractive: this.formatMetricStats(metrics.performance.timeToInteractive),
        totalBlockingTime: this.formatMetricStats(metrics.performance.totalBlockingTime),
        cumulativeLayoutShift: this.formatMetricStats(metrics.performance.cumulativeLayoutShift),
        speedIndex: this.formatMetricStats(metrics.performance.speedIndex)
      } : null,
      resources: metrics.resources ? {
        cpu: this.formatMetricStats(metrics.resources.cpu),
        memory: this.formatMetricStats(metrics.resources.memory),
        network: metrics.resources.network
      } : null,
      custom: metrics.custom || {}
    };
  }

  private formatMetricStats(stats: any): any {
    if (!stats) return null;
    
    return {
      min: stats.min,
      max: stats.max,
      avg: stats.avg,
      median: stats.p50,
      p90: stats.p90,
      p95: stats.p95,
      p99: stats.p99,
      count: stats.count,
      stdDev: stats.stdDev
    };
  }

  private transformLogs(logs: any[], options: JSONExportOptions): any[] {
    const maxLogs = 10000; // Prevent huge files
    const processedLogs = logs.slice(0, maxLogs);
    
    return processedLogs.map(log => ({
      timestamp: this.formatDate(log.timestamp, options),
      level: log.level,
      source: log.source,
      category: log.category,
      message: log.message,
      ...(log.data && { data: log.data })
    }));
  }

  private transformTimings(timings: any, options: JSONExportOptions): any {
    return {
      setup: timings.setup,
      execution: timings.execution,
      teardown: timings.teardown,
      reporting: timings.reporting,
      total: timings.total,
      breakdown: timings.breakdown
    };
  }

  private transformTags(tags: any[]): any {
    return tags.map(tag => ({
      name: tag.name,
      count: tag.count,
      scenarios: tag.scenarios || tag.count,
      passRate: tag.passRate,
      avgDuration: tag.avgDuration
    }));
  }

  async exportPartial(
    result: ExecutionResult,
    outputPath: string,
    filter: (feature: any) => boolean,
    options: JSONExportOptions = {}
  ): Promise<ExportResult> {
    const filteredResult = {
      ...result,
      features: result.features.filter(filter),
      summary: this.recalculateSummary(result.features.filter(filter))
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
      pending: scenarios.filter(s => s.status === 'pending').length,
      passedSteps: steps.filter(s => s.status === 'passed').length,
      failedSteps: steps.filter(s => s.status === 'failed').length,
      skippedSteps: steps.filter(s => s.status === 'skipped').length,
      pendingSteps: steps.filter(s => s.status === 'pending').length
    };
  }

  async merge(
    results: ExecutionResult[],
    outputPath: string,
    options: JSONExportOptions = {}
  ): Promise<ExportResult> {
    const mergedResult: ExecutionResult = {
      executionId: `merged-${Date.now()}`,
      environment: results[0]?.environment || 'unknown',
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
      tags: [],
      metadata: {
        merged: true,
        sourceCount: results.length,
        mergedAt: new Date().toISOString()
      }
    };

    // Merge features
    const featureMap = new Map<string, any>();
    
    for (const result of results) {
      for (const feature of result.features) {
        const existing = featureMap.get(feature.name);
        if (existing) {
          existing.scenarios.push(...feature.scenarios);
        } else {
          featureMap.set(feature.name, { ...feature });
        }
      }
    }

    mergedResult.features = Array.from(featureMap.values());
    mergedResult.summary = this.recalculateSummary(mergedResult.features);
    mergedResult.duration = mergedResult.endTime - mergedResult.startTime;

    // Merge tags
    const tagMap = new Map<string, any>();
    for (const result of results) {
      if (result.tags) {
        for (const tag of result.tags) {
          const existing = tagMap.get(tag.name);
          if (existing) {
            existing.count += tag.count;
            existing.scenarios = (existing.scenarios || 0) + (tag.scenarios || tag.count);
          } else {
            tagMap.set(tag.name, { ...tag });
          }
        }
      }
    }
    mergedResult.tags = Array.from(tagMap.values());

    return this.export(mergedResult, outputPath, options);
  }
}