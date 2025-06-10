#!/usr/bin/env node

/**
 * CS Test Automation Framework
 * Main Entry Point - Production Implementation
 * 
 * This file serves as:
 * 1. CLI entry point for npm test command
 * 2. Framework exports for programmatic use
 * 3. Process management and error handling
 * 4. Signal handling for graceful shutdown
 */

import * as path from 'path';
import * as fs from 'fs';
import { performance } from 'perf_hooks';
import * as cluster from 'cluster';
import * as os from 'os';

// Core Framework Imports
import { CSBDDRunner } from './bdd/runner/CSBDDRunner';
import { CommandLineParser } from './core/cli/CommandLineParser';
import { ExecutionOptions } from './core/cli/ExecutionOptions';
import { ConfigurationManager } from './core/configuration/ConfigurationManager';
import { Logger } from './core/utils/Logger';
import { ProxyManager } from './core/proxy/ProxyManager';
import { ActionLogger } from './core/logging/ActionLogger';
import { DebugManager } from './core/debugging/DebugManager';
import { ReportOrchestrator } from './reporting/core/ReportOrchestrator';
import { ADOIntegrationService } from './integrations/ado/ADOIntegrationService';

// Framework Exports
export { CSWebElement } from './core/elements/CSWebElement';
export { CSBasePage } from './core/pages/CSBasePage';
export { CSGetElement } from './core/elements/decorators/CSGetElement';
export { CSBDDStepDef } from './bdd/decorators/CSBDDStepDef';
export { CSBDDBaseStepDefinition } from './bdd/base/CSBDDBaseStepDefinition';
export { PageFactory } from './core/pages/PageFactory';
export { PageRegistry } from './core/pages/PageRegistry';
export { CSHttpClient } from './api/client/CSHttpClient';
export { CSDatabase } from './database/client/CSDatabase';
export { CSDataProvider } from './data/provider/CSDataProvider';
export { ConfigurationManager } from './core/configuration/ConfigurationManager';
export { ActionLogger } from './core/logging/ActionLogger';
export { AIElementIdentifier } from './core/ai/engine/AIElementIdentifier';
export { SelfHealingEngine } from './core/ai/healing/SelfHealingEngine';

// Type Exports
export * from './core/elements/types/element.types';
export * from './core/browser/types/browser.types';
export * from './core/pages/types/page.types';
export * from './bdd/types/bdd.types';
export * from './api/types/api.types';
export * from './database/types/database.types';
export * from './data/types/data.types';
export * from './reporting/types/reporting.types';

// Framework Metadata
const FRAMEWORK_VERSION = '1.0.0';
const FRAMEWORK_NAME = 'CS Test Automation Framework';
const FRAMEWORK_BANNER = `
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║     ██████╗███████╗    ████████╗███████╗███████╗████████╗     ║
║    ██╔════╝██╔════╝    ╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝     ║
║    ██║     ███████╗       ██║   █████╗  ███████╗   ██║        ║
║    ██║     ╚════██║       ██║   ██╔══╝  ╚════██║   ██║        ║
║    ╚██████╗███████║       ██║   ███████╗███████║   ██║        ║
║     ╚═════╝╚══════╝       ╚═╝   ╚══════╝╚══════╝   ╚═╝        ║
║                                                                ║
║            Test Automation Framework v${FRAMEWORK_VERSION}              ║
║                  Powered by TypeScript & AI                    ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`;

// Global Error Handlers
const exitHandler = new Map<string, Function>();
const runningProcesses = new Set<any>();
let isShuttingDown = false;

/**
 * Main CLI Entry Point
 */
async function main(): Promise<void> {
    const startTime = performance.now();
    let executionResult: any = null;

    try {
        // Display banner
        console.log('\x1b[35m%s\x1b[0m', FRAMEWORK_BANNER); // Magenta color for brand

        // Parse command line arguments
        const options = CommandLineParser.parse(process.argv);

        // Show help if requested
        if (options.help) {
            displayHelp();
            process.exit(0);
        }

        // Show version if requested
        if (options.version) {
            console.log(`${FRAMEWORK_NAME} v${FRAMEWORK_VERSION}`);
            process.exit(0);
        }

        // Initialize logger
        await Logger.initialize({
            level: options.logLevel || 'info',
            console: !options.quiet,
            file: options.logFile !== false,
            path: options.logPath || './logs'
        });

        Logger.info(`Starting ${FRAMEWORK_NAME} v${FRAMEWORK_VERSION}`);
        Logger.info(`Node.js ${process.version} on ${os.platform()} ${os.arch()}`);
        Logger.info(`Working directory: ${process.cwd()}`);

        // Validate environment
        await validateEnvironment();

        // Setup signal handlers
        setupSignalHandlers();

        // Check if running in cluster mode
        if (options.cluster && cluster.isMaster) {
            await runInClusterMode(options);
        } else {
            // Run tests
            executionResult = await runTests(options);
        }

        // Calculate execution time
        const executionTime = ((performance.now() - startTime) / 1000).toFixed(2);
        
        // Display summary
        if (executionResult && !options.quiet) {
            displayExecutionSummary(executionResult, executionTime);
        }

        // Exit with appropriate code
        const exitCode = executionResult?.failed > 0 ? 1 : 0;
        await gracefulShutdown(exitCode);

    } catch (error) {
        Logger.error('Fatal error during execution', error);
        console.error('\x1b[31m%s\x1b[0m', '✖ Fatal error occurred. Check logs for details.');
        await gracefulShutdown(1);
    }
}

/**
 * Run tests with full framework initialization
 */
async function runTests(options: ExecutionOptions): Promise<any> {
    try {
        // Load configuration
        Logger.info('Loading configuration...');
        await ConfigurationManager.loadConfiguration(options.environment || 'dev');
        
        // Validate configuration
        const configValidation = ConfigurationManager.validate();
        if (!configValidation.valid) {
            throw new Error(`Configuration validation failed:\n${configValidation.errors.join('\n')}`);
        }

        // Setup proxy if configured
        if (ConfigurationManager.getBoolean('PROXY_ENABLED', false)) {
            Logger.info('Configuring proxy...');
            await ProxyManager.configure({
                server: ConfigurationManager.getRequired('PROXY_SERVER'),
                port: ConfigurationManager.getInt('PROXY_PORT'),
                username: ConfigurationManager.get('PROXY_USERNAME'),
                password: ConfigurationManager.get('PROXY_PASSWORD'),
                bypass: ConfigurationManager.getArray('PROXY_BYPASS')
            });
        }

        // Initialize action logger
        await ActionLogger.initialize({
            enabled: ConfigurationManager.getBoolean('ACTION_LOGGING_ENABLED', true),
            logLevel: ConfigurationManager.get('ACTION_LOG_LEVEL', 'info'),
            includeScreenshots: ConfigurationManager.getBoolean('LOG_SCREENSHOTS', true),
            includeTimings: ConfigurationManager.getBoolean('LOG_TIMINGS', true)
        });

        // Setup debug mode if requested
        if (options.debug) {
            Logger.info('Enabling debug mode...');
            DebugManager.enableDebugMode();
            
            if (options.breakpoint) {
                DebugManager.setBreakpoint(options.breakpoint);
            }
        }

        // Initialize ADO integration if enabled
        if (ConfigurationManager.getBoolean('ADO_INTEGRATION_ENABLED', false)) {
            Logger.info('Initializing ADO integration...');
            await ADOIntegrationService.initialize({
                organization: ConfigurationManager.getRequired('ADO_ORGANIZATION'),
                project: ConfigurationManager.getRequired('ADO_PROJECT'),
                pat: ConfigurationManager.getRequired('ADO_PAT'),
                testPlanId: ConfigurationManager.getInt('ADO_TEST_PLAN_ID'),
                uploadResults: ConfigurationManager.getBoolean('ADO_UPLOAD_RESULTS', true),
                uploadEvidence: ConfigurationManager.getBoolean('ADO_UPLOAD_EVIDENCE', true),
                createBugsOnFailure: ConfigurationManager.getBoolean('ADO_CREATE_BUGS', false)
            });
        }

        // Create runner instance
        const runner = new CSBDDRunner();

        // Register progress handler
        if (!options.quiet) {
            runner.on('progress', (event) => {
                displayProgress(event);
            });
        }

        // Execute tests
        Logger.info('Starting test execution...');
        const result = await runner.run(options);

        // Generate reports
        if (!options.skipReport) {
            Logger.info('Generating reports...');
            await ReportOrchestrator.generateReports(result, {
                outputPath: options.reportPath || ConfigurationManager.get('REPORT_PATH', './reports'),
                formats: options.reportFormats || ['html', 'json'],
                theme: {
                    primaryColor: ConfigurationManager.get('REPORT_THEME_PRIMARY_COLOR', '#93186C'),
                    secondaryColor: ConfigurationManager.get('REPORT_THEME_SECONDARY_COLOR', '#FFFFFF')
                },
                includeLogs: ConfigurationManager.getBoolean('REPORT_INCLUDE_LOGS', true),
                includeScreenshots: ConfigurationManager.getBoolean('REPORT_INCLUDE_SCREENSHOTS', true),
                includeVideos: ConfigurationManager.getBoolean('REPORT_INCLUDE_VIDEOS', false)
            });
        }

        // Upload to ADO if enabled
        if (ADOIntegrationService.isInitialized() && !options.skipADO) {
            Logger.info('Uploading results to Azure DevOps...');
            await ADOIntegrationService.uploadTestResults(result);
        }

        return result;

    } catch (error) {
        Logger.error('Test execution failed', error);
        throw error;
    }
}

/**
 * Run tests in cluster mode for better performance
 */
async function runInClusterMode(options: ExecutionOptions): Promise<any> {
    const numWorkers = options.workers || os.cpus().length;
    Logger.info(`Running in cluster mode with ${numWorkers} workers`);

    return new Promise((resolve, reject) => {
        const results: any[] = [];
        let workersFinished = 0;

        // Setup cluster
        cluster.setupMaster({
            exec: __filename,
            args: process.argv.slice(2).concat(['--worker'])
        });

        // Fork workers
        for (let i = 0; i < numWorkers; i++) {
            const worker = cluster.fork({
                WORKER_ID: i,
                WORKER_OPTIONS: JSON.stringify(options)
            });

            runningProcesses.add(worker);

            worker.on('message', (msg) => {
                if (msg.type === 'result') {
                    results.push(msg.data);
                }
            });

            worker.on('exit', (code, signal) => {
                runningProcesses.delete(worker);
                workersFinished++;

                if (code !== 0 && !isShuttingDown) {
                    Logger.error(`Worker ${worker.process.pid} died with code ${code}`);
                }

                if (workersFinished === numWorkers) {
                    // Aggregate results
                    const aggregatedResult = aggregateWorkerResults(results);
                    resolve(aggregatedResult);
                }
            });
        }

        // Handle cluster errors
        cluster.on('exit', (worker, code, signal) => {
            if (!isShuttingDown) {
                Logger.warn(`Worker ${worker.process.pid} died, spawning replacement...`);
                const newWorker = cluster.fork();
                runningProcesses.add(newWorker);
            }
        });
    });
}

/**
 * Aggregate results from multiple workers
 */
function aggregateWorkerResults(results: any[]): any {
    const aggregated = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
        features: [],
        scenarios: [],
        steps: []
    };

    for (const result of results) {
        aggregated.total += result.total || 0;
        aggregated.passed += result.passed || 0;
        aggregated.failed += result.failed || 0;
        aggregated.skipped += result.skipped || 0;
        aggregated.duration += result.duration || 0;
        aggregated.features.push(...(result.features || []));
        aggregated.scenarios.push(...(result.scenarios || []));
        aggregated.steps.push(...(result.steps || []));
    }

    return aggregated;
}

/**
 * Validate environment before running tests
 */
async function validateEnvironment(): Promise<void> {
    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
    if (majorVersion < 14) {
        throw new Error(`Node.js 14 or higher is required. Current version: ${nodeVersion}`);
    }

    // Check required directories
    const requiredDirs = ['features', 'src/steps'];
    for (const dir of requiredDirs) {
        if (!fs.existsSync(dir)) {
            throw new Error(`Required directory not found: ${dir}`);
        }
    }

    // Check for config directory
    if (!fs.existsSync('config/environments')) {
        throw new Error('Configuration directory not found: config/environments');
    }

    // Validate TypeScript is available
    try {
        require('typescript');
    } catch {
        throw new Error('TypeScript is not installed. Run: npm install typescript');
    }

    // Check for Playwright
    try {
        require('playwright');
    } catch {
        throw new Error('Playwright is not installed. Run: npm install playwright');
    }
}

/**
 * Setup signal handlers for graceful shutdown
 */
function setupSignalHandlers(): void {
    const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGHUP'];

    signals.forEach(signal => {
        process.on(signal, async () => {
            Logger.info(`Received ${signal}, initiating graceful shutdown...`);
            await gracefulShutdown(0);
        });
    });

    process.on('uncaughtException', async (error) => {
        Logger.error('Uncaught exception', error);
        await gracefulShutdown(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
        Logger.error('Unhandled rejection', { reason, promise });
        await gracefulShutdown(1);
    });
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(exitCode: number): Promise<void> {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    Logger.info('Starting graceful shutdown...');

    try {
        // Execute registered exit handlers
        for (const [name, handler] of exitHandler.entries()) {
            try {
                Logger.debug(`Running exit handler: ${name}`);
                await handler();
            } catch (error) {
                Logger.error(`Exit handler failed: ${name}`, error);
            }
        }

        // Close running processes
        for (const process of runningProcesses) {
            try {
                if (process.kill) {
                    process.kill('SIGTERM');
                }
            } catch (error) {
                Logger.error('Failed to kill process', error);
            }
        }

        // Close logger
        await Logger.close();

        // Final exit
        process.exit(exitCode);

    } catch (error) {
        console.error('Graceful shutdown failed', error);
        process.exit(1);
    }
}

/**
 * Register exit handler
 */
export function registerExitHandler(name: string, handler: Function): void {
    exitHandler.set(name, handler);
}

/**
 * Display execution progress
 */
function displayProgress(event: any): void {
    const { type, data } = event;

    switch (type) {
        case 'feature:start':
            console.log(`\n📁 Feature: ${data.name}`);
            break;
        case 'scenario:start':
            console.log(`  📋 Scenario: ${data.name}`);
            break;
        case 'step:start':
            process.stdout.write(`    ⏳ ${data.keyword} ${data.text}...`);
            break;
        case 'step:pass':
            console.log(' ✅');
            break;
        case 'step:fail':
            console.log(' ❌');
            if (data.error) {
                console.log(`       Error: ${data.error.message}`);
            }
            break;
        case 'step:skip':
            console.log(' ⏭️');
            break;
    }
}

/**
 * Display execution summary
 */
function displayExecutionSummary(result: any, executionTime: string): void {
    const { total, passed, failed, skipped } = result;
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0';

    console.log('\n' + '═'.repeat(60));
    console.log('📊 EXECUTION SUMMARY');
    console.log('═'.repeat(60));
    console.log(`Total Tests:    ${total}`);
    console.log(`✅ Passed:      ${passed} (${passRate}%)`);
    console.log(`❌ Failed:      ${failed}`);
    console.log(`⏭️  Skipped:     ${skipped}`);
    console.log(`⏱️  Duration:    ${executionTime}s`);
    console.log('═'.repeat(60));

    if (failed > 0) {
        console.log('\n❌ FAILED TESTS:');
        result.failures?.forEach((failure: any, index: number) => {
            console.log(`\n${index + 1}. ${failure.scenario}`);
            console.log(`   Feature: ${failure.feature}`);
            console.log(`   Error: ${failure.error}`);
            if (failure.step) {
                console.log(`   Step: ${failure.step}`);
            }
        });
    }

    // Display report location
    if (result.reportPath) {
        console.log(`\n📄 Report: ${result.reportPath}`);
    }
}

/**
 * Display help information
 */
function displayHelp(): void {
    console.log(`
${FRAMEWORK_NAME} v${FRAMEWORK_VERSION}

USAGE:
  npm test -- [options]

OPTIONS:
  --env <environment>         Environment to run tests (dev, sit, qa, uat)
  --tags <expression>         Tag expression to filter tests
  --feature <pattern>         Feature file pattern
  --scenario <pattern>        Scenario name pattern
  --parallel                  Run tests in parallel
  --workers <number>          Number of parallel workers
  --cluster                   Run in cluster mode
  --retry <number>            Number of retries for failed tests
  --timeout <ms>              Global timeout in milliseconds
  --dry-run                   Parse features without execution
  --debug                     Enable debug mode
  --breakpoint <pattern>      Set breakpoint on step pattern
  --video                     Record test execution videos
  --trace                     Record Playwright traces
  --headed                    Run in headed mode
  --slow-mo <ms>              Slow down operations by ms
  --report-path <path>        Custom report output path
  --report-formats <formats>  Report formats (html,json,xml,pdf,excel)
  --skip-report               Skip report generation
  --skip-ado                  Skip ADO upload
  --quiet                     Suppress console output
  --log-level <level>         Log level (error,warn,info,debug)
  --help                      Show this help
  --version                   Show version

EXAMPLES:
  # Run all tests in dev environment
  npm test -- --env=dev

  # Run smoke tests in parallel
  npm test -- --env=qa --tags=@smoke --parallel

  # Run specific feature with video
  npm test -- --env=uat --feature=login.feature --video

  # Debug specific scenario
  npm test -- --env=dev --scenario="User login" --debug --headed

  # Run with custom report
  npm test -- --env=prod --report-formats=html,pdf --report-path=./custom-reports

ENVIRONMENT VARIABLES:
  CS_ENV                  Override environment
  CS_PARALLEL             Enable parallel execution
  CS_WORKERS              Number of workers
  CS_TIMEOUT              Global timeout
  CS_RETRY                Retry count
  CS_LOG_LEVEL            Log level
  CS_PROXY_SERVER         Proxy server
  CS_PROXY_PORT           Proxy port
  CS_ADO_PAT              ADO Personal Access Token

For more information, visit: https://github.com/your-org/cs-test-framework
`);
}

// Worker mode handling
if (process.env.WORKER_ID) {
    // Running as a worker
    const workerId = process.env.WORKER_ID;
    const options = JSON.parse(process.env.WORKER_OPTIONS || '{}');
    
    Logger.info(`Worker ${workerId} started`);
    
    runTests(options)
        .then(result => {
            process.send({ type: 'result', data: result });
            process.exit(0);
        })
        .catch(error => {
            Logger.error(`Worker ${workerId} failed`, error);
            process.exit(1);
        });
} else if (require.main === module) {
    // Running as main process
    main().catch(error => {
        console.error('Unhandled error in main:', error);
        process.exit(1);
    });
}

// Export main for programmatic use
export { main, runTests, registerExitHandler };