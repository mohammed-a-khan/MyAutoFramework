import { stepRegistry } from './StepRegistry';
import { Logger } from '../../core/utils/Logger';
import { ActionLogger } from '../../core/logging/ActionLogger';

export interface StepDefinitionOptions {
  timeout?: number;
  wrapperOptions?: any;
  retry?: number;
}

/**
 * Decorator for marking methods as step definitions
 * @param pattern - String or RegExp pattern to match step text
 * @param options - Optional step configuration
 */
export function CSBDDStepDef(pattern: string | RegExp, options?: StepDefinitionOptions) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    if (typeof originalMethod !== 'function') {
      throw new Error(`@CSBDDStepDef can only be applied to methods`);
    }
    
    // Extract parameter count from method
    const paramCount = originalMethod.length;
    
    // Create step definition metadata
    const stepDefinition = {
      pattern: pattern,
      method: originalMethod,
      methodName: propertyKey,
      className: target.constructor.name,
      parameterCount: paramCount,
      timeout: options?.timeout,
      retry: options?.retry || 0,
      location: `${target.constructor.name}.${propertyKey}`,
      isAsync: isAsyncFunction(originalMethod)
    };
    
    // Create metadata for step registration
    const metadata = {
      filePath: `${target.constructor.name}.ts`,
      line: 0, // Line number not available at runtime
      timeout: options?.timeout,
      className: target.constructor.name,
      methodName: propertyKey
    };
    
    // Register the step definition
    stepRegistry.registerStep(pattern, originalMethod, metadata);
    
    // Log registration
    Logger.getInstance().debug(`Registered step definition: ${pattern.toString()} -> ${stepDefinition.location}`);
    ActionLogger.logStepDefinitionLoading('registered', {
      pattern: pattern.toString(),
      location: stepDefinition.location,
      className: target.constructor.name,
      methodName: propertyKey
    });
    
    // Wrap the method to add error handling and logging
    descriptor.value = async function(...args: any[]) {
      const stepText = args[args.length - 1]?.stepText || pattern.toString();
      const startTime = Date.now();
      
      try {
        ActionLogger.logStepStart(stepText, stepDefinition.location);
        
        // Bind 'this' context properly
        const result = await originalMethod.apply(this, args);
        
        const duration = Date.now() - startTime;
        ActionLogger.logStepPass(stepText, duration);
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        ActionLogger.logStepFail(stepText, error instanceof Error ? error : new Error(String(error)), duration);
        throw error;
      }
    };
    
    return descriptor;
  };
}

/**
 * Decorator for marking methods as Before hooks
 */
export function Before(options?: { tags?: string; order?: number; timeout?: number }) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const hook = {
      type: 'before' as const,
      method: descriptor.value,
      methodName: propertyKey,
      className: target.constructor.name,
      tags: options?.tags,
      order: options?.order || 0,
      timeout: options?.timeout,
      location: `${target.constructor.name}.${propertyKey}`
    };
    
    const registerOptions: {
      tags?: string;
      order?: number;
      timeout?: number;
      name?: string;
    } = {
      name: `${target.constructor.name}.${propertyKey}`
    };
    
    if (options?.tags !== undefined) {
      registerOptions.tags = options.tags;
    }
    if (options?.order !== undefined) {
      registerOptions.order = options.order;
    }
    if (options?.timeout !== undefined) {
      registerOptions.timeout = options.timeout;
    }
    
    stepRegistry.registerHook('Before', descriptor.value, registerOptions);
    Logger.getInstance().debug(`Registered Before hook: ${hook.location}`);
  };
}

/**
 * Decorator for marking methods as After hooks
 */
export function After(options?: { tags?: string; order?: number; timeout?: number }) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const hook = {
      type: 'after' as const,
      method: descriptor.value,
      methodName: propertyKey,
      className: target.constructor.name,
      tags: options?.tags,
      order: options?.order || 0,
      timeout: options?.timeout,
      location: `${target.constructor.name}.${propertyKey}`
    };
    
    const registerOptions: {
      tags?: string;
      order?: number;
      timeout?: number;
      name?: string;
    } = {
      name: `${target.constructor.name}.${propertyKey}`
    };
    
    if (options?.tags !== undefined) {
      registerOptions.tags = options.tags;
    }
    if (options?.order !== undefined) {
      registerOptions.order = options.order;
    }
    if (options?.timeout !== undefined) {
      registerOptions.timeout = options.timeout;
    }
    
    stepRegistry.registerHook('After', descriptor.value, registerOptions);
    Logger.getInstance().debug(`Registered After hook: ${hook.location}`);
  };
}

/**
 * Decorator for marking methods as BeforeStep hooks
 */
export function BeforeStep(options?: { tags?: string; order?: number; timeout?: number }) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const hook = {
      type: 'beforeStep' as const,
      method: descriptor.value,
      methodName: propertyKey,
      className: target.constructor.name,
      tags: options?.tags,
      order: options?.order || 0,
      timeout: options?.timeout,
      location: `${target.constructor.name}.${propertyKey}`
    };
    
    const registerOptions: {
      tags?: string;
      order?: number;
      timeout?: number;
      name?: string;
    } = {
      name: `${target.constructor.name}.${propertyKey}`
    };
    
    if (options?.tags !== undefined) {
      registerOptions.tags = options.tags;
    }
    if (options?.order !== undefined) {
      registerOptions.order = options.order;
    }
    if (options?.timeout !== undefined) {
      registerOptions.timeout = options.timeout;
    }
    
    stepRegistry.registerHook('BeforeStep', descriptor.value, registerOptions);
    Logger.getInstance().debug(`Registered BeforeStep hook: ${hook.location}`);
  };
}

/**
 * Decorator for marking methods as AfterStep hooks
 */
export function AfterStep(options?: { tags?: string; order?: number; timeout?: number }) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const hook = {
      type: 'afterStep' as const,
      method: descriptor.value,
      methodName: propertyKey,
      className: target.constructor.name,
      tags: options?.tags,
      order: options?.order || 0,
      timeout: options?.timeout,
      location: `${target.constructor.name}.${propertyKey}`
    };
    
    const registerOptions: {
      tags?: string;
      order?: number;
      timeout?: number;
      name?: string;
    } = {
      name: `${target.constructor.name}.${propertyKey}`
    };
    
    if (options?.tags !== undefined) {
      registerOptions.tags = options.tags;
    }
    if (options?.order !== undefined) {
      registerOptions.order = options.order;
    }
    if (options?.timeout !== undefined) {
      registerOptions.timeout = options.timeout;
    }
    
    stepRegistry.registerHook('AfterStep', descriptor.value, registerOptions);
    Logger.getInstance().debug(`Registered AfterStep hook: ${hook.location}`);
  };
}

/**
 * Decorator for marking methods as BeforeAll hooks
 */
export function BeforeAll(options?: { order?: number; timeout?: number }) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const hook = {
      type: 'beforeAll' as const,
      method: descriptor.value,
      methodName: propertyKey,
      className: target.constructor.name,
      order: options?.order || 0,
      timeout: options?.timeout,
      location: `${target.constructor.name}.${propertyKey}`
    };
    
    const registerOptions: {
      tags?: string;
      order?: number;
      timeout?: number;
      name?: string;
    } = {
      name: `${target.constructor.name}.${propertyKey}`
    };
    
    if (options?.order !== undefined) {
      registerOptions.order = options.order;
    }
    if (options?.timeout !== undefined) {
      registerOptions.timeout = options.timeout;
    }
    
    stepRegistry.registerHook('BeforeAll', descriptor.value, registerOptions);
    Logger.getInstance().debug(`Registered BeforeAll hook: ${hook.location}`);
  };
}

/**
 * Decorator for marking methods as AfterAll hooks
 */
export function AfterAll(options?: { order?: number; timeout?: number }) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const hook = {
      type: 'afterAll' as const,
      method: descriptor.value,
      methodName: propertyKey,
      className: target.constructor.name,
      order: options?.order || 0,
      timeout: options?.timeout,
      location: `${target.constructor.name}.${propertyKey}`
    };
    
    const registerOptions: {
      tags?: string;
      order?: number;
      timeout?: number;
      name?: string;
    } = {
      name: `${target.constructor.name}.${propertyKey}`
    };
    
    if (options?.order !== undefined) {
      registerOptions.order = options.order;
    }
    if (options?.timeout !== undefined) {
      registerOptions.timeout = options.timeout;
    }
    
    stepRegistry.registerHook('AfterAll', descriptor.value, registerOptions);
    Logger.getInstance().debug(`Registered AfterAll hook: ${hook.location}`);
  };
}

/**
 * Decorator for marking a class as containing step definitions
 * Automatically instantiates the class
 */
export function StepDefinitions(target: any) {
  // Create instance of the class to trigger decorator registration
  // This ensures all decorated methods are registered
  new target();
  
  // Log class registration
  Logger.getInstance().debug(`Registered step definition class: ${target.name}`);
  ActionLogger.logStepDefinitionLoading('class_registered', {
    className: target.name
  });
  
  return target;
}

// Helper function to check if a function is async
function isAsyncFunction(fn: Function): boolean {
  return fn.constructor.name === 'AsyncFunction' || 
         (fn.toString().includes('async') && fn.toString().includes('await'));
}

// Re-export commonly used together
export { stepRegistry } from './StepRegistry';
export { ParameterTypeRegistry } from './ParameterTypeRegistry';