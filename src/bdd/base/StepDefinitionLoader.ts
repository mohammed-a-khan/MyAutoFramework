// src/bdd/base/StepDefinitionLoader.ts

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { Logger } from '../../core/utils/Logger';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { stepRegistry } from '../decorators/StepRegistry';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/**
 * Loads step definition files and registers them with the framework
 * Handles auto-discovery, validation, and duplicate detection
 */
export class StepDefinitionLoader {
  private static instance: StepDefinitionLoader;
  private readonly logger: Logger;
  private readonly loadedModules: Set<string>;
  private readonly stepDefinitionPaths: string[];
  private readonly filePatterns: RegExp[];
  private loadingComplete: boolean = false;

  private constructor() {
    this.logger = Logger.getInstance('StepDefinitionLoader');
    this.loadedModules = new Set();
    this.stepDefinitionPaths = this.getStepDefinitionPaths();
    this.filePatterns = this.getFilePatterns();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): StepDefinitionLoader {
    if (!StepDefinitionLoader.instance) {
      StepDefinitionLoader.instance = new StepDefinitionLoader();
    }
    return StepDefinitionLoader.instance;
  }

  /**
   * Load all step definitions
   */
  public async loadAll(): Promise<void> {
    if (this.loadingComplete) {
      this.logger.warn('Step definitions already loaded');
      return;
    }

    const startTime = Date.now();
    this.logger.info('Loading step definitions...');
    ActionLogger.logStepDefinitionLoading('start');

    try {
      // Lock registry during loading
      stepRegistry.lock();

      // Load from all configured paths
      for (const basePath of this.stepDefinitionPaths) {
        await this.loadFromDirectory(basePath);
      }

      // Mark loading complete
      this.loadingComplete = true;

      const stats = stepRegistry.getStats();
      const loadTime = Date.now() - startTime;

      this.logger.info(
        `Step definition loading complete: ${stats.totalSteps} steps, ` +
        `${stats.totalHooks} hooks loaded from ${stats.loadedFiles} files in ${loadTime}ms`
      );

      ActionLogger.logStepDefinitionLoading('complete', {
        steps: stats.totalSteps,
        hooks: stats.totalHooks,
        files: stats.loadedFiles,
        duration: loadTime
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to load step definitions', error instanceof Error ? error : new Error(errorMessage));
      ActionLogger.logStepDefinitionLoading('error', { error: errorMessage });
      throw error;
    } finally {
      // Unlock registry
      stepRegistry.unlock();
    }
  }

  /**
   * Load step definitions from directory
   */
  public async loadFromDirectory(directoryPath: string): Promise<void> {
    const resolvedPath = path.resolve(directoryPath);

    try {
      const stats = await stat(resolvedPath);
      
      if (!stats.isDirectory()) {
        throw new Error(`Not a directory: ${resolvedPath}`);
      }

      this.logger.debug(`Loading from directory: ${resolvedPath}`);
      await this.scanDirectory(resolvedPath);

    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        this.logger.warn(`Step definition directory not found: ${resolvedPath}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Load a specific file
   */
  public async loadFile(filePath: string): Promise<void> {
    const resolvedPath = path.resolve(filePath);

    // Check if already loaded
    if (stepRegistry.isFileLoaded(resolvedPath)) {
      this.logger.debug(`File already loaded: ${resolvedPath}`);
      return;
    }

    // Check if file matches patterns
    if (!this.shouldLoadFile(resolvedPath)) {
      this.logger.debug(`Skipping file (no pattern match): ${resolvedPath}`);
      return;
    }

    try {
      this.logger.debug(`Loading file: ${resolvedPath}`);
      
      // Clear module cache for hot reload support
      this.clearModuleCache(resolvedPath);

      // Import the module
      const module = await this.importModule(resolvedPath);

      // Validate module
      this.validateModule(module, resolvedPath);

      // Mark file as loaded
      stepRegistry.markFileLoaded(resolvedPath);
      this.loadedModules.add(resolvedPath);

      this.logger.debug(`Successfully loaded: ${resolvedPath}`);
      ActionLogger.logFileLoaded(resolvedPath);

    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to load file: ${resolvedPath}`, error instanceof Error ? error : new Error(errorMessage));
      
      // Provide helpful error message
      if (error?.code === 'MODULE_NOT_FOUND') {
        throw new Error(
          `Failed to load step definitions from ${resolvedPath}:\n` +
          `Module not found. Check that the file exists and has no import errors.`
        );
      }

      throw new Error(
        `Failed to load step definitions from ${resolvedPath}:\n${errorMessage}`
      );
    }
  }

  /**
   * Reload all step definitions (for development)
   */
  public async reload(): Promise<void> {
    this.logger.info('Reloading step definitions...');

    // Clear registry
    stepRegistry.clear();
    
    // Clear loaded modules
    this.loadedModules.clear();
    this.loadingComplete = false;

    // Clear all module caches
    this.clearAllModuleCaches();

    // Reload all
    await this.loadAll();
  }

  /**
   * Get loaded modules info
   */
  public getLoadedModules(): string[] {
    return Array.from(this.loadedModules);
  }

  /**
   * Scan directory recursively
   */
  private async scanDirectory(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath);

    for (const entry of entries) {
      const fullPath = path.join(directoryPath, entry);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        // Skip node_modules and hidden directories
        if (!entry.startsWith('.') && entry !== 'node_modules') {
          await this.scanDirectory(fullPath);
        }
      } else if (stats.isFile()) {
        await this.loadFile(fullPath);
      }
    }
  }

  /**
   * Import module dynamically
   */
  private async importModule(filePath: string): Promise<any> {
    try {
      // Use dynamic import for ES modules support
      const module = await import(filePath);
      return module;
    } catch (error) {
      // Fallback to require for CommonJS
      try {
        return require(filePath);
      } catch (requireError) {
        // Throw original error if both fail
        throw error;
      }
    }
  }

  /**
   * Validate loaded module
   */
  private validateModule(module: any, filePath: string): void {
    if (!module || typeof module !== 'object') {
      throw new Error(`Invalid module: expected object, got ${typeof module}`);
    }

    // Check if module exports any step definition classes
    let hasStepDefinitions = false;

    for (const key of Object.keys(module)) {
      const exported = module[key];

      // Check if it's a class/function that might contain step definitions
      if (typeof exported === 'function') {
        // Check if it has step definition metadata
        if ('getMetadata' in Reflect) {
          const metadata = (Reflect as any).getMetadata('stepDefinitions', exported);
          if (metadata) {
            hasStepDefinitions = true;
          }
        }

        // Instantiate if it's a class
        if (exported.prototype) {
          try {
            new exported();
            hasStepDefinitions = true;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.debug(
              `Failed to instantiate ${key} from ${filePath}: ${errorMessage}`
            );
          }
        }
      }
    }

    if (!hasStepDefinitions) {
      this.logger.warn(
        `No step definitions found in ${filePath}. ` +
        `Make sure the file exports classes with @CSBDDStepDef decorators.`
      );
    }
  }

  /**
   * Check if file should be loaded
   */
  private shouldLoadFile(filePath: string): boolean {
    const fileName = path.basename(filePath);

    // Skip test files
    if (fileName.endsWith('.spec.ts') || fileName.endsWith('.test.ts')) {
      return false;
    }

    // Skip non-TypeScript/JavaScript files
    if (!fileName.endsWith('.ts') && !fileName.endsWith('.js')) {
      return false;
    }

    // Check patterns
    return this.filePatterns.some(pattern => pattern.test(fileName));
  }

  /**
   * Get step definition paths from configuration
   */
  private getStepDefinitionPaths(): string[] {
    const defaultPaths = [
      './src/steps',
      './steps',
      './features/step_definitions',
      './test/steps'
    ];

    const configuredPaths = ConfigurationManager.getArray(
      'STEP_DEFINITION_PATHS',
      ','
    );

    return configuredPaths.length > 0 ? configuredPaths : defaultPaths;
  }

  /**
   * Get file patterns from configuration
   */
  private getFilePatterns(): RegExp[] {
    const defaultPatterns = [
      /.*Steps\.(ts|js)$/,
      /.*StepDef\.(ts|js)$/,
      /.*StepDefinitions\.(ts|js)$/,
      /.*\.steps\.(ts|js)$/
    ];

    const configuredPatterns = ConfigurationManager.getArray(
      'STEP_DEFINITION_PATTERNS',
      ','
    );

    if (configuredPatterns.length > 0) {
      return configuredPatterns.map(pattern => new RegExp(pattern));
    }

    return defaultPatterns;
  }

  /**
   * Clear module cache
   */
  private clearModuleCache(modulePath: string): void {
    const resolvedPath = require.resolve(modulePath);
    delete require.cache[resolvedPath];
  }

  /**
   * Clear all module caches
   */
  private clearAllModuleCaches(): void {
    for (const modulePath of this.loadedModules) {
      try {
        this.clearModuleCache(modulePath);
      } catch (error) {
        // Module might not be in cache
        this.logger.debug(`Could not clear cache for ${modulePath}`);
      }
    }
  }

  /**
   * Export loader state
   */
  public export(): any {
    return {
      loadedModules: Array.from(this.loadedModules),
      stepDefinitionPaths: this.stepDefinitionPaths,
      filePatterns: this.filePatterns.map(p => p.source),
      loadingComplete: this.loadingComplete,
      stats: stepRegistry.getStats()
    };
  }
}

// Export singleton instance
export const stepDefinitionLoader = StepDefinitionLoader.getInstance();