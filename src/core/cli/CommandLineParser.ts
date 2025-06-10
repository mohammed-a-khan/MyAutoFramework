// src/core/cli/CommandLineParser.ts

import * as path from 'path';
import * as fs from 'fs';
import { ExecutionOptions, CLIArgument, CLIFlag, CLIOption, ParsedArguments, ValidationError, ConfigFile } from './ExecutionOptions';

/**
 * Production-ready command line parser with full argument validation,
 * help generation, config file support, and error handling
 */
export class CommandLineParser {
  private static readonly VERSION = '1.0.0';
  private static readonly FRAMEWORK_NAME = 'CS Test Automation Framework';
  
  // Argument definitions with full metadata
  private static readonly ARGUMENTS: Map<string, CLIArgument> = new Map([
    ['env', {
      name: 'env',
      aliases: ['e', 'environment'],
      type: 'string',
      required: false,
      default: 'dev',
      description: 'Target environment for test execution',
      choices: ['dev', 'sit', 'qa', 'uat', 'prod'],
      validate: (value: string) => {
        if (!['dev', 'sit', 'qa', 'uat', 'prod'].includes(value)) {
          throw new Error(`Invalid environment: ${value}. Must be one of: dev, sit, qa, uat, prod`);
        }
        return true;
      }
    }],
    ['tags', {
      name: 'tags',
      aliases: ['t', 'tag'],
      type: 'string',
      required: false,
      description: 'Tag expression to filter scenarios (supports AND, OR, NOT)',
      examples: ['@smoke', '@regression and not @flaky', '(@smoke or @sanity) and @critical'],
      validate: (value: string) => {
        // Validate tag expression syntax
        const validTagRegex = /^[@\w\s\(\)]+(\s+(and|or|not)\s+[@\w\s\(\)]+)*$/i;
        if (!validTagRegex.test(value)) {
          throw new Error(`Invalid tag expression: ${value}`);
        }
        return true;
      }
    }],
    ['feature', {
      name: 'feature',
      aliases: ['f', 'features'],
      type: 'string',
      required: false,
      array: true,
      description: 'Feature file(s) or pattern to execute',
      examples: ['login.feature', 'features/*.feature', 'features/api/*.feature'],
      validate: (value: string) => {
        // Check if it's a valid file pattern
        if (value.includes('*') || value.includes('?')) {
          return true; // Glob pattern
        }
        // Check if file exists
        const resolvedPath = path.resolve(process.cwd(), value);
        if (!fs.existsSync(resolvedPath) && !value.includes('*')) {
          throw new Error(`Feature file not found: ${value}`);
        }
        return true;
      }
    }],
    ['scenario', {
      name: 'scenario',
      aliases: ['s', 'scenarios'],
      type: 'string',
      required: false,
      array: true,
      description: 'Scenario name or pattern to execute',
      examples: ['User can login', '*login*', 'User can * with valid *'],
      validate: (value: string) => {
        if (value.length < 3) {
          throw new Error('Scenario pattern must be at least 3 characters');
        }
        return true;
      }
    }],
    ['parallel', {
      name: 'parallel',
      aliases: ['p'],
      type: 'boolean',
      required: false,
      default: false,
      description: 'Enable parallel test execution'
    }],
    ['workers', {
      name: 'workers',
      aliases: ['w'],
      type: 'number',
      required: false,
      default: 4,
      description: 'Number of parallel workers',
      dependsOn: 'parallel',
      validate: (value: number) => {
        if (value < 1 || value > 32) {
          throw new Error('Workers must be between 1 and 32');
        }
        return true;
      }
    }],
    ['browser', {
      name: 'browser',
      aliases: ['b'],
      type: 'string',
      required: false,
      default: 'chromium',
      description: 'Browser to use for testing',
      choices: ['chromium', 'firefox', 'webkit', 'chrome', 'msedge'],
      validate: (value: string) => {
        const validBrowsers = ['chromium', 'firefox', 'webkit', 'chrome', 'msedge'];
        if (!validBrowsers.includes(value)) {
          throw new Error(`Invalid browser: ${value}. Must be one of: ${validBrowsers.join(', ')}`);
        }
        return true;
      }
    }],
    ['headless', {
      name: 'headless',
      aliases: ['hl'],
      type: 'boolean',
      required: false,
      default: false,
      description: 'Run browser in headless mode'
    }],
    ['timeout', {
      name: 'timeout',
      aliases: ['to'],
      type: 'number',
      required: false,
      default: 30000,
      description: 'Default timeout in milliseconds',
      validate: (value: number) => {
        if (value < 1000 || value > 300000) {
          throw new Error('Timeout must be between 1000ms and 300000ms');
        }
        return true;
      }
    }],
    ['retry', {
      name: 'retry',
      aliases: ['r'],
      type: 'number',
      required: false,
      default: 0,
      description: 'Number of retries for failed tests',
      validate: (value: number) => {
        if (value < 0 || value > 5) {
          throw new Error('Retry count must be between 0 and 5');
        }
        return true;
      }
    }],
    ['dry-run', {
      name: 'dry-run',
      aliases: ['dr'],
      type: 'boolean',
      required: false,
      default: false,
      description: 'Parse features without executing tests'
    }],
    ['debug', {
      name: 'debug',
      aliases: ['d'],
      type: 'boolean',
      required: false,
      default: false,
      description: 'Enable debug mode with verbose logging'
    }],
    ['video', {
      name: 'video',
      aliases: ['v'],
      type: 'boolean',
      required: false,
      default: false,
      description: 'Record video of test execution'
    }],
    ['trace', {
      name: 'trace',
      aliases: ['tr'],
      type: 'boolean',
      required: false,
      default: false,
      description: 'Record trace for debugging'
    }],
    ['screenshot', {
      name: 'screenshot',
      aliases: ['ss'],
      type: 'string',
      required: false,
      default: 'on-failure',
      description: 'When to capture screenshots',
      choices: ['always', 'on-failure', 'never'],
      validate: (value: string) => {
        if (!['always', 'on-failure', 'never'].includes(value)) {
          throw new Error('Screenshot must be: always, on-failure, or never');
        }
        return true;
      }
    }],
    ['report-name', {
      name: 'report-name',
      aliases: ['rn'],
      type: 'string',
      required: false,
      default: 'Test Execution Report',
      description: 'Custom name for the test report'
    }],
    ['report-path', {
      name: 'report-path',
      aliases: ['rp'],
      type: 'string',
      required: false,
      default: './reports',
      description: 'Directory path for test reports',
      validate: (value: string) => {
        const resolvedPath = path.resolve(process.cwd(), value);
        const dir = path.dirname(resolvedPath);
        if (!fs.existsSync(dir)) {
          throw new Error(`Report directory does not exist: ${dir}`);
        }
        return true;
      }
    }],
    ['report-format', {
      name: 'report-format',
      aliases: ['rf'],
      type: 'string',
      required: false,
      array: true,
      default: ['html'],
      description: 'Report output formats',
      choices: ['html', 'pdf', 'excel', 'json', 'xml'],
      validate: (value: string) => {
        const validFormats = ['html', 'pdf', 'excel', 'json', 'xml'];
        const formats = value.split(',').map(f => f.trim());
        for (const format of formats) {
          if (!validFormats.includes(format)) {
            throw new Error(`Invalid report format: ${format}`);
          }
        }
        return true;
      }
    }],
    ['config', {
      name: 'config',
      aliases: ['c'],
      type: 'string',
      required: false,
      description: 'Path to configuration file (JSON or JS)',
      validate: (value: string) => {
        const resolvedPath = path.resolve(process.cwd(), value);
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(`Config file not found: ${value}`);
        }
        const ext = path.extname(resolvedPath).toLowerCase();
        if (!['.json', '.js', '.ts'].includes(ext)) {
          throw new Error('Config file must be .json, .js, or .ts');
        }
        return true;
      }
    }],
    ['profile', {
      name: 'profile',
      aliases: ['pr'],
      type: 'string',
      required: false,
      description: 'Execution profile (predefined configurations)',
      choices: ['smoke', 'regression', 'sanity', 'full', 'custom']
    }],
    ['api-base-url', {
      name: 'api-base-url',
      aliases: ['api'],
      type: 'string',
      required: false,
      description: 'Override API base URL',
      validate: (value: string) => {
        try {
          new URL(value);
          return true;
        } catch {
          throw new Error(`Invalid URL: ${value}`);
        }
      }
    }],
    ['db-connection', {
      name: 'db-connection',
      aliases: ['db'],
      type: 'string',
      required: false,
      description: 'Override database connection string'
    }],
    ['proxy', {
      name: 'proxy',
      aliases: ['px'],
      type: 'string',
      required: false,
      description: 'Proxy server URL',
      validate: (value: string) => {
        try {
          new URL(value);
          return true;
        } catch {
          throw new Error(`Invalid proxy URL: ${value}`);
        }
      }
    }],
    ['proxy-auth', {
      name: 'proxy-auth',
      aliases: ['pa'],
      type: 'string',
      required: false,
      description: 'Proxy authentication (username:password)',
      dependsOn: 'proxy',
      validate: (value: string) => {
        if (!value.includes(':')) {
          throw new Error('Proxy auth must be in format username:password');
        }
        return true;
      }
    }],
    ['no-colors', {
      name: 'no-colors',
      aliases: ['nc'],
      type: 'boolean',
      required: false,
      default: false,
      description: 'Disable colored console output'
    }],
    ['quiet', {
      name: 'quiet',
      aliases: ['q'],
      type: 'boolean',
      required: false,
      default: false,
      description: 'Suppress console output except errors'
    }],
    ['verbose', {
      name: 'verbose',
      aliases: ['vb'],
      type: 'boolean',
      required: false,
      default: false,
      description: 'Enable verbose output'
    }],
    ['bail', {
      name: 'bail',
      aliases: ['bl'],
      type: 'boolean',
      required: false,
      default: false,
      description: 'Stop execution on first failure'
    }],
    ['grep', {
      name: 'grep',
      aliases: ['g'],
      type: 'string',
      required: false,
      description: 'Only run tests matching pattern',
      validate: (value: string) => {
        try {
          new RegExp(value);
          return true;
        } catch {
          throw new Error(`Invalid regex pattern: ${value}`);
        }
      }
    }],
    ['grep-invert', {
      name: 'grep-invert',
      aliases: ['gi'],
      type: 'boolean',
      required: false,
      default: false,
      description: 'Run tests NOT matching grep pattern',
      dependsOn: 'grep'
    }],
    ['update-snapshots', {
      name: 'update-snapshots',
      aliases: ['u'],
      type: 'boolean',
      required: false,
      default: false,
      description: 'Update visual regression snapshots'
    }],
    ['ci', {
      name: 'ci',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Running in CI environment (optimizes output)'
    }],
    ['shard', {
      name: 'shard',
      type: 'string',
      required: false,
      description: 'Shard tests for distributed execution (e.g., 1/3)',
      validate: (value: string) => {
        const shardRegex = /^\d+\/\d+$/;
        if (!shardRegex.test(value)) {
          throw new Error('Shard must be in format current/total (e.g., 1/3)');
        }
        const [current, total] = value.split('/').map(Number);
        if (current < 1 || current > total) {
          throw new Error('Current shard must be between 1 and total');
        }
        return true;
      }
    }],
    ['max-failures', {
      name: 'max-failures',
      aliases: ['mf'],
      type: 'number',
      required: false,
      default: 0,
      description: 'Stop after N failures (0 = no limit)',
      validate: (value: number) => {
        if (value < 0) {
          throw new Error('Max failures must be >= 0');
        }
        return true;
      }
    }],
    ['test-data', {
      name: 'test-data',
      aliases: ['td'],
      type: 'string',
      required: false,
      description: 'Path to test data file or directory',
      validate: (value: string) => {
        const resolvedPath = path.resolve(process.cwd(), value);
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(`Test data path not found: ${value}`);
        }
        return true;
      }
    }],
    ['output', {
      name: 'output',
      aliases: ['o'],
      type: 'string',
      required: false,
      array: true,
      description: 'Additional output formats (tap, teamcity, github)',
      choices: ['tap', 'teamcity', 'github', 'junit', 'mocha'],
      validate: (value: string) => {
        const validOutputs = ['tap', 'teamcity', 'github', 'junit', 'mocha'];
        const outputs = value.split(',').map(o => o.trim());
        for (const output of outputs) {
          if (!validOutputs.includes(output)) {
            throw new Error(`Invalid output format: ${output}`);
          }
        }
        return true;
      }
    }]
  ]);

  // Flag definitions
  private static readonly FLAGS: Map<string, CLIFlag> = new Map([
    ['help', {
      name: 'help',
      aliases: ['h'],
      description: 'Show help message'
    }],
    ['version', {
      name: 'version',
      aliases: ['V'],
      description: 'Show version information'
    }],
    ['list-tags', {
      name: 'list-tags',
      aliases: ['lt'],
      description: 'List all available tags'
    }],
    ['list-features', {
      name: 'list-features',
      aliases: ['lf'],
      description: 'List all feature files'
    }],
    ['list-scenarios', {
      name: 'list-scenarios',
      aliases: ['ls'],
      description: 'List all scenarios'
    }],
    ['validate-only', {
      name: 'validate-only',
      aliases: ['vo'],
      description: 'Validate configuration without running tests'
    }]
  ]);

  // Execution profiles
  private static readonly PROFILES: Map<string, Partial<ExecutionOptions>> = new Map([
    ['smoke', {
      tags: '@smoke',
      parallel: true,
      workers: 4,
      timeout: 30000,
      retry: 0,
      screenshot: 'on-failure'
    }],
    ['regression', {
      tags: '@regression',
      parallel: true,
      workers: 8,
      timeout: 60000,
      retry: 2,
      screenshot: 'on-failure',
      video: true
    }],
    ['sanity', {
      tags: '@sanity',
      parallel: false,
      timeout: 45000,
      retry: 1,
      screenshot: 'always'
    }],
    ['full', {
      parallel: true,
      workers: 16,
      timeout: 90000,
      retry: 3,
      screenshot: 'on-failure',
      video: true,
      trace: true
    }]
  ]);

  private static parsedArgs: ParsedArguments | null = null;
  private static validationErrors: ValidationError[] = [];

  /**
   * Parse command line arguments into ExecutionOptions
   */
  public static parse(argv: string[]): ExecutionOptions {
    try {
      // Remove node and script path
      const args = argv.slice(2);
      
      // Check for help or version flags first
      if (this.checkHelpOrVersion(args)) {
        process.exit(0);
      }

      // Parse arguments
      this.parsedArgs = this.parseArguments(args);

      // Load config file if specified
      if (this.parsedArgs.config) {
        this.loadConfigFile(this.parsedArgs.config as string);
      }

      // Apply profile if specified
      if (this.parsedArgs.profile) {
        this.applyProfile(this.parsedArgs.profile as string);
      }

      // Validate all arguments
      this.validateArguments();

      // Handle special flags
      this.handleSpecialFlags();

      // Build and return ExecutionOptions
      return this.buildExecutionOptions();

    } catch (error) {
      this.handleParseError(error);
      process.exit(1);
    }
  }

  /**
   * Parse raw arguments into structured format
   */
  private static parseArguments(args: string[]): ParsedArguments {
    const parsed: ParsedArguments = {};
    let i = 0;

    while (i < args.length) {
      const arg = args[i];

      if (arg.startsWith('--')) {
        // Long option: --option or --option=value
        const equalIndex = arg.indexOf('=');
        
        if (equalIndex > -1) {
          // --option=value format
          const name = arg.substring(2, equalIndex);
          const value = arg.substring(equalIndex + 1);
          this.processArgument(name, value, parsed);
        } else {
          // --option format
          const name = arg.substring(2);
          const argDef = this.findArgument(name);
          
          if (argDef && argDef.type === 'boolean') {
            this.processArgument(name, 'true', parsed);
          } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
            i++;
            this.processArgument(name, args[i], parsed);
          } else if (this.isFlag(name)) {
            parsed[name] = true;
          } else {
            throw new Error(`Option '${name}' requires a value`);
          }
        }
      } else if (arg.startsWith('-') && arg.length > 1) {
        // Short option(s): -o or -abc
        const options = arg.substring(1);
        
        for (let j = 0; j < options.length; j++) {
          const shortOpt = options[j];
          const fullName = this.resolveAlias(shortOpt);
          
          if (!fullName) {
            throw new Error(`Unknown option: -${shortOpt}`);
          }

          const argDef = this.ARGUMENTS.get(fullName);
          
          if (argDef && argDef.type === 'boolean') {
            parsed[fullName] = true;
          } else if (j === options.length - 1 && i + 1 < args.length && !args[i + 1].startsWith('-')) {
            // Last option in group can take value
            i++;
            this.processArgument(fullName, args[i], parsed);
          } else if (this.FLAGS.has(fullName)) {
            parsed[fullName] = true;
          } else {
            throw new Error(`Option '-${shortOpt}' requires a value`);
          }
        }
      } else {
        // Positional argument (treat as feature file)
        if (!parsed.feature) {
          parsed.feature = [];
        }
        (parsed.feature as string[]).push(arg);
      }
      
      i++;
    }

    // Apply defaults
    this.applyDefaults(parsed);

    return parsed;
  }

  /**
   * Process and store argument value
   */
  private static processArgument(name: string, value: string, parsed: ParsedArguments): void {
    const fullName = this.resolveAlias(name) || name;
    const argDef = this.ARGUMENTS.get(fullName);

    if (!argDef && !this.FLAGS.has(fullName)) {
      throw new Error(`Unknown option: ${name}`);
    }

    if (argDef) {
      let processedValue: any = value;

      // Type conversion
      switch (argDef.type) {
        case 'number':
          processedValue = this.parseNumber(value, fullName);
          break;
        case 'boolean':
          processedValue = this.parseBoolean(value, fullName);
          break;
        case 'string':
          processedValue = value;
          break;
      }

      // Handle array values
      if (argDef.array) {
        if (!parsed[fullName]) {
          parsed[fullName] = [];
        }
        (parsed[fullName] as any[]).push(processedValue);
      } else {
        parsed[fullName] = processedValue;
      }
    } else {
      // It's a flag
      parsed[fullName] = true;
    }
  }

  /**
   * Parse number value with validation
   */
  private static parseNumber(value: string, name: string): number {
    const num = Number(value);
    if (isNaN(num)) {
      throw new Error(`Invalid number for option '${name}': ${value}`);
    }
    return num;
  }

  /**
   * Parse boolean value
   */
  private static parseBoolean(value: string, name: string): boolean {
    const lower = value.toLowerCase();
    if (['true', 'yes', '1', 'on'].includes(lower)) {
      return true;
    } else if (['false', 'no', '0', 'off'].includes(lower)) {
      return false;
    } else {
      throw new Error(`Invalid boolean for option '${name}': ${value}`);
    }
  }

  /**
   * Resolve alias to full argument name
   */
  private static resolveAlias(alias: string): string | null {
    // Check arguments
    for (const [name, arg] of this.ARGUMENTS) {
      if (name === alias || arg.aliases?.includes(alias)) {
        return name;
      }
    }

    // Check flags
    for (const [name, flag] of this.FLAGS) {
      if (name === alias || flag.aliases?.includes(alias)) {
        return name;
      }
    }

    return null;
  }

  /**
   * Find argument definition by name or alias
   */
  private static findArgument(name: string): CLIArgument | null {
    const fullName = this.resolveAlias(name) || name;
    return this.ARGUMENTS.get(fullName) || null;
  }

  /**
   * Check if name is a flag
   */
  private static isFlag(name: string): boolean {
    const fullName = this.resolveAlias(name) || name;
    return this.FLAGS.has(fullName);
  }

  /**
   * Apply default values
   */
  private static applyDefaults(parsed: ParsedArguments): void {
    for (const [name, arg] of this.ARGUMENTS) {
      if (!(name in parsed) && 'default' in arg) {
        parsed[name] = arg.default;
      }
    }
  }

  /**
   * Load configuration from file
   */
  private static loadConfigFile(configPath: string): void {
    const resolvedPath = path.resolve(process.cwd(), configPath);
    const ext = path.extname(resolvedPath).toLowerCase();

    try {
      let config: any;

      if (ext === '.json') {
        const content = fs.readFileSync(resolvedPath, 'utf-8');
        config = JSON.parse(content);
      } else if (ext === '.js' || ext === '.ts') {
        // Clear require cache to allow config changes
        delete require.cache[resolvedPath];
        config = require(resolvedPath);
        
        // Handle default exports
        if (config.default) {
          config = config.default;
        }
      }

      // Merge config with parsed args (CLI args take precedence)
      for (const [key, value] of Object.entries(config)) {
        if (!(key in this.parsedArgs!)) {
          this.parsedArgs![key] = value;
        }
      }

    } catch (error) {
      throw new Error(`Failed to load config file: ${error.message}`);
    }
  }

  /**
   * Apply execution profile
   */
  private static applyProfile(profileName: string): void {
    const profile = this.PROFILES.get(profileName);
    
    if (!profile) {
      throw new Error(`Unknown profile: ${profileName}. Available profiles: ${Array.from(this.PROFILES.keys()).join(', ')}`);
    }

    // Merge profile with parsed args (CLI args take precedence)
    for (const [key, value] of Object.entries(profile)) {
      if (!(key in this.parsedArgs!)) {
        this.parsedArgs![key] = value;
      }
    }
  }

  /**
   * Validate all arguments
   */
  private static validateArguments(): void {
    this.validationErrors = [];

    for (const [name, value] of Object.entries(this.parsedArgs!)) {
      const argDef = this.ARGUMENTS.get(name);
      
      if (!argDef && !this.FLAGS.has(name)) {
        continue; // Skip unknown args (might be from config)
      }

      if (argDef) {
        // Check required
        if (argDef.required && !value) {
          this.validationErrors.push({
            argument: name,
            message: `Required option '${name}' is missing`
          });
        }

        // Check choices
        if (argDef.choices && value) {
          const values = Array.isArray(value) ? value : [value];
          for (const v of values) {
            if (!argDef.choices.includes(v)) {
              this.validationErrors.push({
                argument: name,
                message: `Invalid value '${v}' for option '${name}'. Must be one of: ${argDef.choices.join(', ')}`
              });
            }
          }
        }

        // Run custom validation
        if (argDef.validate && value) {
          try {
            const values = Array.isArray(value) ? value : [value];
            for (const v of values) {
              argDef.validate(v);
            }
          } catch (error) {
            this.validationErrors.push({
              argument: name,
              message: error.message
            });
          }
        }

        // Check dependencies
        if (argDef.dependsOn && value && !this.parsedArgs![argDef.dependsOn]) {
          this.validationErrors.push({
            argument: name,
            message: `Option '${name}' requires '${argDef.dependsOn}' to be set`
          });
        }
      }
    }

    // Check for conflicting options
    this.validateConflicts();

    // Throw if validation errors
    if (this.validationErrors.length > 0) {
      const errorMessage = this.validationErrors
        .map(e => `  - ${e.argument}: ${e.message}`)
        .join('\n');
      throw new Error(`Validation errors:\n${errorMessage}`);
    }
  }

  /**
   * Check for conflicting options
   */
  private static validateConflicts(): void {
    // Check debug vs quiet
    if (this.parsedArgs!.debug && this.parsedArgs!.quiet) {
      this.validationErrors.push({
        argument: 'debug/quiet',
        message: 'Cannot use both --debug and --quiet'
      });
    }

    // Check dry-run conflicts
    if (this.parsedArgs!['dry-run']) {
      const conflictingOptions = ['video', 'trace', 'screenshot'];
      for (const opt of conflictingOptions) {
        if (this.parsedArgs![opt]) {
          this.validationErrors.push({
            argument: opt,
            message: `Cannot use --${opt} with --dry-run`
          });
        }
      }
    }

    // Check parallel conflicts
    if (!this.parsedArgs!.parallel && this.parsedArgs!.workers) {
      this.validationErrors.push({
        argument: 'workers',
        message: 'Option --workers requires --parallel'
      });
    }

    // Check shard with parallel
    if (this.parsedArgs!.shard && this.parsedArgs!.parallel) {
      this.validationErrors.push({
        argument: 'shard',
        message: 'Cannot use --shard with --parallel (sharding is for distributed execution)'
      });
    }
  }

  /**
   * Check for help or version flags
   */
  private static checkHelpOrVersion(args: string[]): boolean {
    for (const arg of args) {
      const cleaned = arg.replace(/^-+/, '');
      
      if (['help', 'h'].includes(cleaned)) {
        this.showHelp();
        return true;
      }
      
      if (['version', 'V'].includes(cleaned)) {
        this.showVersion();
        return true;
      }
    }
    
    return false;
  }

  /**
   * Handle special flags that don't run tests
   */
  private static handleSpecialFlags(): void {
    if (this.parsedArgs!['list-tags']) {
      this.listTags();
      process.exit(0);
    }

    if (this.parsedArgs!['list-features']) {
      this.listFeatures();
      process.exit(0);
    }

    if (this.parsedArgs!['list-scenarios']) {
      this.listScenarios();
      process.exit(0);
    }

    if (this.parsedArgs!['validate-only']) {
      console.log('✓ Configuration is valid');
      process.exit(0);
    }
  }

  /**
   * Build ExecutionOptions from parsed arguments
   */
  private static buildExecutionOptions(): ExecutionOptions {
    const options: ExecutionOptions = {
      // Environment
      environment: this.parsedArgs!.env as string,
      
      // Test selection
      tags: this.parsedArgs!.tags as string,
      features: this.parsedArgs!.feature as string[],
      scenarios: this.parsedArgs!.scenario as string[],
      grep: this.parsedArgs!.grep as string,
      grepInvert: this.parsedArgs!['grep-invert'] as boolean,
      
      // Execution settings
      parallel: this.parsedArgs!.parallel as boolean,
      workers: this.parsedArgs!.workers as number,
      browser: this.parsedArgs!.browser as string,
      headless: this.parsedArgs!.headless as boolean,
      timeout: this.parsedArgs!.timeout as number,
      retry: this.parsedArgs!.retry as number,
      dryRun: this.parsedArgs!['dry-run'] as boolean,
      bail: this.parsedArgs!.bail as boolean,
      maxFailures: this.parsedArgs!['max-failures'] as number,
      shard: this.parsedArgs!.shard as string,
      
      // Debug settings
      debug: this.parsedArgs!.debug as boolean,
      verbose: this.parsedArgs!.verbose as boolean,
      quiet: this.parsedArgs!.quiet as boolean,
      noColors: this.parsedArgs!['no-colors'] as boolean,
      
      // Evidence collection
      video: this.parsedArgs!.video as boolean,
      trace: this.parsedArgs!.trace as boolean,
      screenshot: this.parsedArgs!.screenshot as 'always' | 'on-failure' | 'never',
      updateSnapshots: this.parsedArgs!['update-snapshots'] as boolean,
      
      // Reporting
      reportName: this.parsedArgs!['report-name'] as string,
      reportPath: this.parsedArgs!['report-path'] as string,
      reportFormats: this.parseReportFormats(this.parsedArgs!['report-format']),
      outputFormats: this.parseOutputFormats(this.parsedArgs!.output),
      
      // Configuration
      configFile: this.parsedArgs!.config as string,
      profile: this.parsedArgs!.profile as string,
      testDataPath: this.parsedArgs!['test-data'] as string,
      
      // Overrides
      apiBaseUrl: this.parsedArgs!['api-base-url'] as string,
      dbConnection: this.parsedArgs!['db-connection'] as string,
      
      // Proxy settings
      proxy: this.parsedArgs!.proxy as string,
      proxyAuth: this.parseProxyAuth(this.parsedArgs!['proxy-auth'] as string),
      
      // CI settings
      ci: this.parsedArgs!.ci as boolean,
      
      // Metadata
      executionId: this.generateExecutionId(),
      startTime: new Date(),
      commandLine: process.argv.join(' ')
    };

    return options;
  }

  /**
   * Parse report formats
   */
  private static parseReportFormats(value: any): string[] {
    if (!value) return ['html'];
    
    if (Array.isArray(value)) {
      return value.flatMap(v => v.split(',').map(f => f.trim()));
    }
    
    return value.split(',').map(f => f.trim());
  }

  /**
   * Parse output formats
   */
  private static parseOutputFormats(value: any): string[] {
    if (!value) return [];
    
    if (Array.isArray(value)) {
      return value.flatMap(v => v.split(',').map(f => f.trim()));
    }
    
    return value.split(',').map(f => f.trim());
  }

  /**
   * Parse proxy authentication
   */
  private static parseProxyAuth(value: string): { username: string; password: string } | undefined {
    if (!value) return undefined;
    
    const [username, password] = value.split(':');
    return { username, password: password || '' };
  }

  /**
   * Generate unique execution ID
   */
  private static generateExecutionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const hostname = require('os').hostname().replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
    
    return `${hostname}-${timestamp}-${random}`;
  }

  /**
   * Show help message
   */
  private static showHelp(): void {
    console.log(`
${this.FRAMEWORK_NAME} v${this.VERSION}

USAGE:
  npm test -- [options] [files...]

OPTIONS:`);

    // Group options by category
    const categories = {
      'Test Selection': ['env', 'tags', 'feature', 'scenario', 'grep', 'grep-invert'],
      'Execution': ['parallel', 'workers', 'browser', 'headless', 'timeout', 'retry', 'dry-run', 'bail', 'max-failures', 'shard'],
      'Debug & Evidence': ['debug', 'verbose', 'quiet', 'video', 'trace', 'screenshot', 'update-snapshots'],
      'Reporting': ['report-name', 'report-path', 'report-format', 'output'],
      'Configuration': ['config', 'profile', 'test-data', 'api-base-url', 'db-connection'],
      'Network': ['proxy', 'proxy-auth'],
      'Other': ['no-colors', 'ci']
    };

    for (const [category, options] of Object.entries(categories)) {
      console.log(`\n${category}:`);
      
      for (const optName of options) {
        const arg = this.ARGUMENTS.get(optName);
        if (!arg) continue;
        
        let line = `  --${arg.name}`;
        
        // Add aliases
        if (arg.aliases && arg.aliases.length > 0) {
          const shortAliases = arg.aliases.filter(a => a.length === 1);
          const longAliases = arg.aliases.filter(a => a.length > 1);
          
          if (shortAliases.length > 0) {
            line += `, -${shortAliases.join(', -')}`;
          }
          if (longAliases.length > 0) {
            line += `, --${longAliases.join(', --')}`;
          }
        }
        
        // Add type indicator
        if (arg.type !== 'boolean') {
          line += ` <${arg.type}>`;
        }
        
        // Add description
        console.log(line.padEnd(40) + arg.description);
        
        // Add additional info
        if (arg.choices) {
          console.log(''.padEnd(40) + `Choices: ${arg.choices.join(', ')}`);
        }
        if ('default' in arg) {
          console.log(''.padEnd(40) + `Default: ${arg.default}`);
        }
        if (arg.examples) {
          console.log(''.padEnd(40) + `Examples: ${arg.examples.join(', ')}`);
        }
      }
    }

    // Add flags section
    console.log('\nFLAGS:');
    for (const [name, flag] of this.FLAGS) {
      let line = `  --${flag.name}`;
      
      if (flag.aliases && flag.aliases.length > 0) {
        const shortAliases = flag.aliases.filter(a => a.length === 1);
        const longAliases = flag.aliases.filter(a => a.length > 1);
        
        if (shortAliases.length > 0) {
          line += `, -${shortAliases.join(', -')}`;
        }
        if (longAliases.length > 0) {
          line += `, --${longAliases.join(', --')}`;
        }
      }
      
      console.log(line.padEnd(40) + flag.description);
    }

    // Add examples
    console.log(`
EXAMPLES:
  # Run smoke tests in dev environment
  npm test -- --env=dev --tags=@smoke

  # Run specific feature with retry
  npm test -- --feature=login.feature --retry=2

  # Run tests in parallel with video recording
  npm test -- --parallel --workers=4 --video

  # Run regression tests with custom report
  npm test -- --profile=regression --report-name="Regression Suite"

  # Run with proxy
  npm test -- --proxy=http://proxy.company.com:8080 --proxy-auth=user:pass

  # List all available scenarios
  npm test -- --list-scenarios

  # Run tests matching pattern
  npm test -- --grep="user.*login" --env=qa

  # Run specific shard for distributed execution
  npm test -- --shard=2/5

For more information, visit: https://github.com/company/cs-test-framework`);
  }

  /**
   * Show version information
   */
  private static showVersion(): void {
    console.log(`${this.FRAMEWORK_NAME} v${this.VERSION}`);
    console.log(`Node.js: ${process.version}`);
    console.log(`Platform: ${process.platform} ${process.arch}`);
    
    // Show dependency versions
    try {
      const packagePath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      
      console.log('\nDependencies:');
      const deps = ['playwright', 'typescript', 'xlsx'];
      
      for (const dep of deps) {
        const version = packageJson.dependencies?.[dep] || packageJson.devDependencies?.[dep];
        if (version) {
          console.log(`  ${dep}: ${version}`);
        }
      }
    } catch {
      // Ignore if package.json not found
    }
  }

  /**
   * List all available tags
   */
  private static listTags(): void {
    console.log('Discovering tags...\n');
    
    try {
      const featuresPath = path.join(process.cwd(), 'features');
      const tags = new Set<string>();
      
      // Recursively find all .feature files
      const findFeatureFiles = (dir: string): string[] => {
        const files: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            files.push(...findFeatureFiles(fullPath));
          } else if (entry.name.endsWith('.feature')) {
            files.push(fullPath);
          }
        }
        
        return files;
      };
      
      const featureFiles = findFeatureFiles(featuresPath);
      
      // Parse tags from feature files
      for (const file of featureFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const tagRegex = /@[\w-]+/g;
        const matches = content.match(tagRegex);
        
        if (matches) {
          matches.forEach(tag => tags.add(tag));
        }
      }
      
      // Display tags
      const sortedTags = Array.from(tags).sort();
      
      if (sortedTags.length === 0) {
        console.log('No tags found.');
      } else {
        console.log(`Found ${sortedTags.length} tags:\n`);
        
        for (const tag of sortedTags) {
          console.log(`  ${tag}`);
        }
        
        console.log('\nExample usage:');
        console.log('  npm test -- --tags=@smoke');
        console.log('  npm test -- --tags="@regression and not @flaky"');
      }
      
    } catch (error) {
      console.error(`Error listing tags: ${error.message}`);
    }
  }

  /**
   * List all feature files
   */
  private static listFeatures(): void {
    console.log('Discovering feature files...\n');
    
    try {
      const featuresPath = path.join(process.cwd(), 'features');
      
      // Recursively find all .feature files
      const findFeatureFiles = (dir: string, basePath: string = ''): void => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.join(basePath, entry.name);
          
          if (entry.isDirectory()) {
            findFeatureFiles(fullPath, relativePath);
          } else if (entry.name.endsWith('.feature')) {
            // Read first line to get feature name
            const content = fs.readFileSync(fullPath, 'utf-8');
            const firstLine = content.split('\n')[0];
            const featureName = firstLine.replace(/^Feature:\s*/, '').trim();
            
            console.log(`  ${relativePath}`);
            console.log(`    ${featureName}\n`);
          }
        }
      };
      
      findFeatureFiles(featuresPath);
      
      console.log('Example usage:');
      console.log('  npm test -- --feature=login.feature');
      console.log('  npm test -- --feature=features/api/*.feature');
      
    } catch (error) {
      console.error(`Error listing features: ${error.message}`);
    }
  }

  /**
   * List all scenarios
   */
  private static listScenarios(): void {
    console.log('Discovering scenarios...\n');
    
    try {
      const featuresPath = path.join(process.cwd(), 'features');
      let totalScenarios = 0;
      
      // Recursively find and parse feature files
      const processFeatureFile = (filePath: string): void => {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        
        let currentFeature = '';
        let currentTags: string[] = [];
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          
          if (line.startsWith('Feature:')) {
            currentFeature = line.replace('Feature:', '').trim();
            console.log(`\n${path.relative(process.cwd(), filePath)}`);
            console.log(`Feature: ${currentFeature}`);
          } else if (line.startsWith('@')) {
            currentTags = line.match(/@[\w-]+/g) || [];
          } else if (line.startsWith('Scenario:') || line.startsWith('Scenario Outline:')) {
            const scenarioName = line.replace(/Scenario(\s+Outline)?:/, '').trim();
            const tags = currentTags.length > 0 ? ` [${currentTags.join(', ')}]` : '';
            
            console.log(`  - ${scenarioName}${tags}`);
            totalScenarios++;
            currentTags = [];
          }
        }
      };
      
      // Find all feature files
      const findFeatureFiles = (dir: string): void => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            findFeatureFiles(fullPath);
          } else if (entry.name.endsWith('.feature')) {
            processFeatureFile(fullPath);
          }
        }
      };
      
      findFeatureFiles(featuresPath);
      
      console.log(`\nTotal scenarios: ${totalScenarios}`);
      console.log('\nExample usage:');
      console.log('  npm test -- --scenario="User can login"');
      console.log('  npm test -- --scenario="*login*"');
      
    } catch (error) {
      console.error(`Error listing scenarios: ${error.message}`);
    }
  }

  /**
   * Handle parse errors
   */
  private static handleParseError(error: any): void {
    console.error(`\n❌ Error: ${error.message}\n`);
    
    // Suggest help
    console.error('Run with --help for usage information.');
    
    // Show relevant help for common errors
    if (error.message.includes('Unknown option')) {
      console.error('\nDid you mean one of these?');
      const optionName = error.message.match(/Unknown option: (.+)/)?.[1];
      
      if (optionName) {
        // Find similar options
        const similar = this.findSimilarOptions(optionName);
        similar.forEach(opt => console.error(`  --${opt}`));
      }
    }
  }

  /**
   * Find similar option names (for error suggestions)
   */
  private static findSimilarOptions(input: string): string[] {
    const allOptions = [
      ...Array.from(this.ARGUMENTS.keys()),
      ...Array.from(this.FLAGS.keys())
    ];
    
    // Simple Levenshtein distance
    const getDistance = (a: string, b: string): number => {
      const matrix: number[][] = [];
      
      for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
      }
      
      for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
      }
      
      for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
          if (b.charAt(i - 1) === a.charAt(j - 1)) {
            matrix[i][j] = matrix[i - 1][j - 1];
          } else {
            matrix[i][j] = Math.min(
              matrix[i - 1][j - 1] + 1,
              matrix[i][j - 1] + 1,
              matrix[i - 1][j] + 1
            );
          }
        }
      }
      
      return matrix[b.length][a.length];
    };
    
    // Find options with distance <= 3
    const suggestions = allOptions
      .map(opt => ({ option: opt, distance: getDistance(input, opt) }))
      .filter(item => item.distance <= 3)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map(item => item.option);
    
    return suggestions;
  }

  /**
   * Get parsed arguments (for testing)
   */
  public static getParsedArguments(): ParsedArguments | null {
    return this.parsedArgs;
  }

  /**
   * Reset parser state (for testing)
   */
  public static reset(): void {
    this.parsedArgs = null;
    this.validationErrors = [];
  }
}