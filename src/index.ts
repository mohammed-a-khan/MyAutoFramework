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

import * as fs from 'fs';
import { performance } from 'perf_hooks';
import * as cluster from 'node:cluster';
import * as os from 'os';

// Core Framework Imports
import { CSBDDRunner } from './bdd/runner/CSBDDRunner';
import { CommandLineParser } from './core/cli/CommandLineParser';
import { ExecutionOptions } from './core/cli/ExecutionOptions';
import { ConfigurationManager } from './core/configuration/ConfigurationManager';
import { logger } from './core/utils/Logger';
import { ProxyManager } from './core/proxy/ProxyManager';
// import { ActionLogger } from './core/logging/ActionLogger'; // Not used directly
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
export { logger } from './core/utils/Logger';
export { AIElementIdentifier } from './core/ai/engine/AIElementIdentifier';
export { SelfHealingEngine } from './core/ai/healing/SelfHealingEngine';

// Type Exports - Limited to avoid conflicts
// Export only the main types from each module
export * from './bdd/types/bdd.types';
// Commented out to avoid conflicts - import these directly from their modules when needed
// export * from './api/types/api.types';
// export * from './database/types/database.types';
// export * from './data/types/data.types';
// export * from './reporting/types/reporting.types';
// export * from './core/pages/types/page.types';
// export * from './core/network/types/network.types';
// export * from './core/storage/types/storage.types';
// export * from './core/debugging/types/debug.types';
// export * from './core/interactions/types/interaction.types';
// export * from './core/proxy/proxy.types';

// Export configuration types except conflicting ExecutionConfig
export { 
    ConfigMap,
    ValidationResult as ConfigValidationResult,
    BrowserConfig as BrowserConfiguration,
    APIConfig,
    DatabaseConfig as DBConfig,
    ReportConfig as ReportConfiguration,
    ProxyConfig as ProxyConfiguration,
    AIConfig
} from './core/configuration/types/config.types';

// Export element types - commented to avoid conflicts with bdd types
// export * from './core/elements/types/element.types';

// Export ElementMetadata from decorator
export { ElementMetadata } from './core/elements/decorators/ElementMetadata';

// Export browser types
export * from './core/browser/types/browser.types';



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

        // Logger is already initialized as a singleton
        // Configure log level if needed
        if (options.logLevel) {
            logger.setLevel(options.logLevel as any);
        }

        logger.info(`Starting ${FRAMEWORK_NAME} v${FRAMEWORK_VERSION}`);
        logger.info(`Node.js ${process.version} on ${os.platform()} ${os.arch()}`);
        logger.info(`Working directory: ${process.cwd()}`);

        // Validate environment
        await validateEnvironment();

        // Setup signal handlers
        setupSignalHandlers();

        // Check if running in cluster mode
        if (options.cluster && (cluster as any).isPrimary) {
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
        logger.error('Fatal error during execution', error as Error | undefined);
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
        logger.info('Loading configuration...');
        await ConfigurationManager.loadConfiguration(options.environment || 'dev');
        
        // Validate configuration
        const configValidation = ConfigurationManager.validate();
        if (!configValidation.valid) {
            throw new Error(`Configuration validation failed:\n${configValidation.errors.join('\n')}`);
        }

        // Setup proxy if configured
        if (ConfigurationManager.getBoolean('PROXY_ENABLED', false)) {
            logger.info('Configuring proxy...');
            const proxyManager = ProxyManager.getInstance();
            const proxyServer: any = {
                protocol: 'http' as const,
                host: ConfigurationManager.getRequired('PROXY_SERVER'),
                port: ConfigurationManager.getInt('PROXY_PORT')
            };
            
            const username = ConfigurationManager.get('PROXY_USERNAME');
            if (username) {
                proxyServer.auth = {
                    username: username,
                    password: ConfigurationManager.get('PROXY_PASSWORD', '')
                };
            }
            
            const proxyConfig: any = {
                enabled: true,
                servers: [proxyServer],
                bypass: ConfigurationManager.getArray('PROXY_BYPASS')
            };
            await proxyManager.initialize(proxyConfig);
        }

        // Action logger is already initialized as a singleton

        // Setup debug mode if requested
        if (options.debug) {
            logger.info('Enabling debug mode...');
            const debugManager = DebugManager.getInstance();
            debugManager.enableDebugMode();
            
            if (options.breakpoint) {
                debugManager.setBreakpoint(options.breakpoint);
            }
        }

        // Initialize ADO integration if enabled
        if (ConfigurationManager.getBoolean('ADO_INTEGRATION_ENABLED', false)) {
            logger.info('Initializing ADO integration...');
            const adoService = ADOIntegrationService.getInstance();
            await adoService.initialize();
            // ADO config is loaded from environment variables during initialize()
        }

        // Execute tests
        logger.info('Starting test execution...');
        
        // Setup progress handler if not in quiet mode
        if (!options.quiet) {
            const progressInterval = setInterval(() => {
                handleProgressUpdate({ type: 'heartbeat', data: { timestamp: Date.now() } });
            }, 5000);
            
            // Clear interval after execution
            process.on('beforeExit', () => clearInterval(progressInterval));
        }
        
        // Note: CSBDDRunner.run doesn't return a result, it generates reports internally
        const runOptions: any = {
            ...options,
            screenshot: typeof options.screenshot === 'string' ? true : Boolean(options.screenshot)
        };
        await CSBDDRunner.run(runOptions);
        
        // Create a complete ExecutionResult object
        const result: any = {
            total: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            duration: 0,
            features: [],
            scenarios: [],
            steps: [],
            summary: {
                totalFeatures: 0,
                totalScenarios: 0,
                totalSteps: 0,
                passedFeatures: 0,
                passedScenarios: 0,
                passedSteps: 0,
                failedFeatures: 0,
                failedScenarios: 0,
                failedSteps: 0,
                skippedFeatures: 0,
                skippedScenarios: 0,
                skippedSteps: 0,
                pendingFeatures: 0,
                pendingScenarios: 0,
                pendingSteps: 0
            },
            timestamp: new Date().toISOString(),
            startTime: new Date(),
            endTime: new Date(),
            tags: [],
            metadata: {}
        };

        // Generate reports using ReportOrchestrator
        if (!options.skipReport) {
            logger.info('Generating reports...');
            const reportOrchestrator = new ReportOrchestrator();
            const reportConfig = {
                path: options.reportPath || ConfigurationManager.get('REPORT_PATH', './reports'),
                themePrimaryColor: ConfigurationManager.get('REPORT_THEME_PRIMARY_COLOR', '#93186C'),
                themeSecondaryColor: ConfigurationManager.get('REPORT_THEME_SECONDARY_COLOR', '#FFFFFF'),
                generatePDF: false,
                generateExcel: false,
                includeScreenshots: ConfigurationManager.getBoolean('REPORT_INCLUDE_SCREENSHOTS', true),
                includeVideos: ConfigurationManager.getBoolean('REPORT_INCLUDE_VIDEOS', false),
                includeLogs: ConfigurationManager.getBoolean('REPORT_INCLUDE_LOGS', true)
            };
            await reportOrchestrator.initialize(reportConfig as any);
            await reportOrchestrator.generateReports(result);
            logger.info('Reports generated successfully');
        }

        // Upload to ADO if enabled
        const adoService = ADOIntegrationService.getInstance();
        if (!options.skipADO) {
            logger.info('Uploading results to Azure DevOps...');
            await adoService.uploadTestResults(result);
        }

        return result;

    } catch (error) {
        logger.error('Test execution failed', error as Error);
        throw error;
    }
}

/**
 * Run tests in cluster mode for better performance
 */
async function runInClusterMode(options: ExecutionOptions): Promise<any> {
    const numWorkers = options.workers || os.cpus().length;
    logger.info(`Running in cluster mode with ${numWorkers} workers`);

    return new Promise((resolve) => {
        const results: any[] = [];
        let workersFinished = 0;

        // Setup cluster
        (cluster as any).setupPrimary({
            exec: __filename,
            args: process.argv.slice(2).concat(['--worker'])
        });

        // Fork workers
        for (let i = 0; i < numWorkers; i++) {
            const worker = (cluster as any).fork({
                WORKER_ID: String(i),
                WORKER_OPTIONS: JSON.stringify(options)
            });

            runningProcesses.add(worker);

            worker.on('message', (msg: any) => {
                if (msg.type === 'result') {
                    results.push(msg.data);
                }
            });

            worker.on('exit', (code: number | null, _signal: string | null) => {
                runningProcesses.delete(worker);
                workersFinished++;

                if (code !== 0 && !isShuttingDown) {
                    logger.error(`Worker ${worker.process.pid} died with code ${code}`);
                }

                if (workersFinished === numWorkers) {
                    // Aggregate results
                    const aggregatedResult = aggregateWorkerResults(results);
                    resolve(aggregatedResult);
                }
            });
        }

        // Handle cluster errors
        (cluster as any).on('exit', (worker: any, _code: number, _signal: string) => {
            if (!isShuttingDown) {
                logger.warn(`Worker ${worker.process?.pid} died, spawning replacement...`);
                const newWorker = (cluster as any).fork();
                runningProcesses.add(newWorker);
            }
        });
    });
}

/**
 * Aggregate results from multiple workers
 */
function aggregateWorkerResults(results: any[]): any {
    const aggregated: any = {
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
    const versionParts = nodeVersion.split('.');
    const majorVersionStr = versionParts[0];
    const majorVersion = majorVersionStr ? parseInt(majorVersionStr.substring(1)) : 0;
    if (majorVersion < 14) {
        throw new Error(`Node.js 14 or higher is required. Current version: ${nodeVersion}`);
    }

    // Check required directories
    const requiredDirs = ['features', 'src/steps'];
    for (let i = 0; i < requiredDirs.length; i++) {
        const dir = requiredDirs[i];
        if (!dir) continue;
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
            logger.info(`Received ${signal}, initiating graceful shutdown...`);
            await gracefulShutdown(0);
        });
    });

    process.on('uncaughtException', async (error) => {
        logger.error('Uncaught exception', error);
        await gracefulShutdown(1);
    });

    process.on('unhandledRejection', async (reason, _promise) => {
        logger.error('Unhandled rejection', reason as Error);
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
    logger.info('Starting graceful shutdown...');

    try {
        // Execute registered exit handlers
        for (const [name, handler] of exitHandler.entries()) {
            try {
                logger.debug(`Running exit handler: ${name}`);
                await handler();
            } catch (error) {
                logger.error(`Exit handler failed: ${name}`, error as Record<string, any>);
            }
        }

        // Close running processes
        for (const process of runningProcesses) {
            try {
                if (process.kill) {
                    process.kill('SIGTERM');
                }
            } catch (error) {
                logger.error('Failed to kill process', error as Record<string, any>);
            }
        }

        // Logger cleanup is handled automatically

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
function handleProgressUpdate(event: any): void {
    displayProgress(event);
}

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
if (process.env['WORKER_ID']) {
    // Running as a worker
    const workerId = process.env['WORKER_ID'];
    const options = JSON.parse(process.env['WORKER_OPTIONS'] || '{}') as ExecutionOptions;
    
    logger.info(`Worker ${workerId} started`);
    
    runTests(options)
        .then(result => {
            process.send!({ type: 'result', data: result });
            process.exit(0);
        })
        .catch(error => {
            logger.error(`Worker ${workerId} failed`, error);
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
export { main, runTests };

