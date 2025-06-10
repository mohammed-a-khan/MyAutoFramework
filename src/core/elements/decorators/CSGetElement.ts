// src/core/elements/decorators/CSGetElement.ts
import 'reflect-metadata';
import { CSGetElementOptions } from '../types/element.types';
import { ElementMetadata } from './ElementMetadata';
import { CSWebElement } from '../CSWebElement';
import { ActionLogger } from '../../logging/ActionLogger';

/**
 * Decorator for defining page elements with automatic initialization
 * @param options Element locator options
 */
export function CSGetElement(options: CSGetElementOptions): PropertyDecorator {
  return function(target: any, propertyKey: string | symbol) {
    // Validate options
    validateOptions(options, propertyKey);
    
    // Store metadata
    const className = target.constructor.name;
    ElementMetadata.store(className, propertyKey.toString(), options);
    
    // Define the property getter
    const getter = function(this: any) {
      const propKey = propertyKey.toString();
      const elementKey = `_element_${propKey}`;
      
      // Check if element already exists
      if (this[elementKey]) {
        return this[elementKey];
      }
      
      // Create new element instance
      const element = new CSWebElement();
      
      // Initialize element properties
      if (this.page) {
        element.page = this.page;
      } else {
        throw new Error(`Page not initialized for ${className}.${propKey}. Ensure page is set before accessing elements.`);
      }
      
      element.options = options;
      element.description = options.description;
      
      // Store element instance
      this[elementKey] = element;
      
      // Log element initialization
      ActionLogger.logDebug(`Element initialized: ${className}.${propKey} - ${options.description}`);
      
      return element;
    };
    
    // Define the property setter
    const setter = function(this: any, _value: any) {
      throw new Error(`Cannot set ${className}.${propertyKey.toString()}. Elements are read-only.`);
    };
    
    // Delete existing property if exists
    if (delete (target as any)[propertyKey]) {
      // Define new property with getter/setter
      Object.defineProperty(target, propertyKey, {
        get: getter,
        set: setter,
        enumerable: true,
        configurable: true
      });
    }
  };
}

function validateOptions(options: CSGetElementOptions, propertyKey: string | symbol): void {
  if (!options) {
    throw new Error(`@CSGetElement options are required for property '${propertyKey.toString()}'`);
  }
  
  if (!options.description) {
    throw new Error(`@CSGetElement on '${propertyKey.toString()}' must have a description`);
  }
  
  if (!options.locatorType) {
    throw new Error(`@CSGetElement on '${propertyKey.toString()}' must have a locatorType`);
  }
  
  if (!options.locatorValue) {
    throw new Error(`@CSGetElement on '${propertyKey.toString()}' must have a locatorValue`);
  }
  
  // Validate locator type
  const validTypes = ['css', 'xpath', 'text', 'role', 'testid', 'label', 'placeholder', 'alt', 'title'];
  if (!validTypes.includes(options.locatorType)) {
    throw new Error(
      `Invalid locatorType '${options.locatorType}' for '${propertyKey.toString()}'. ` +
      `Valid types are: ${validTypes.join(', ')}`
    );
  }
  
  // Validate layout selectors
  if (options.maxDistance !== undefined && options.maxDistance < 0) {
    throw new Error(`maxDistance must be positive for '${propertyKey.toString()}'`);
  }
  
  // Validate AI options
  if (options.aiEnabled && !options.aiDescription) {
    throw new Error(`aiDescription is required when aiEnabled is true for '${propertyKey.toString()}'`);
  }
  
  if (options.aiConfidenceThreshold !== undefined && 
      (options.aiConfidenceThreshold < 0 || options.aiConfidenceThreshold > 1)) {
    throw new Error(`aiConfidenceThreshold must be between 0 and 1 for '${propertyKey.toString()}'`);
  }
  
  // Validate nth selector
  if (options.nth !== undefined && 
      typeof options.nth !== 'number' && 
      options.nth !== 'first' && 
      options.nth !== 'last') {
    throw new Error(`nth must be a number, 'first', or 'last' for '${propertyKey.toString()}'`);
  }
}

// Additional decorators for common element types

/**
 * Decorator for button elements
 */
export function CSButton(options: Partial<CSGetElementOptions> & { text: string }): PropertyDecorator {
  return CSGetElement({
    locatorType: 'role',
    locatorValue: `button:${options.text}`,
    description: options.description || `${options.text} button`,
    ...options
  });
}

/**
 * Decorator for input elements
 */
export function CSInput(options: Partial<CSGetElementOptions> & { label?: string; placeholder?: string }): PropertyDecorator {
  if (options.label) {
    return CSGetElement({
      locatorType: 'label',
      locatorValue: options.label,
      description: options.description || `${options.label} input`,
      ...options
    });
  } else if (options.placeholder) {
    return CSGetElement({
      locatorType: 'placeholder',
      locatorValue: options.placeholder,
      description: options.description || `${options.placeholder} input`,
      ...options
    });
  } else {
    throw new Error('CSInput requires either label or placeholder');
  }
}

/**
 * Decorator for link elements
 */
export function CSLink(options: Partial<CSGetElementOptions> & { text: string }): PropertyDecorator {
  return CSGetElement({
    locatorType: 'role',
    locatorValue: `link:${options.text}`,
    description: options.description || `${options.text} link`,
    ...options
  });
}

/**
 * Decorator for checkbox elements
 */
export function CSCheckbox(options: Partial<CSGetElementOptions> & { label: string }): PropertyDecorator {
  return CSGetElement({
    locatorType: 'role',
    locatorValue: `checkbox:${options.label}`,
    description: options.description || `${options.label} checkbox`,
    ...options
  });
}

/**
 * Decorator for select/dropdown elements
 */
export function CSSelect(options: Partial<CSGetElementOptions> & { label?: string; name?: string }): PropertyDecorator {
  if (options.label) {
    return CSGetElement({
      locatorType: 'label',
      locatorValue: options.label,
      description: options.description || `${options.label} dropdown`,
      ...options
    });
  } else if (options.name) {
    return CSGetElement({
      locatorType: 'css',
      locatorValue: `select[name="${options.name}"]`,
      description: options.description || `${options.name} dropdown`,
      ...options
    });
  } else {
    throw new Error('CSSelect requires either label or name');
  }
}

/**
 * Decorator for text elements
 */
export function CSText(options: Partial<CSGetElementOptions> & { text: string }): PropertyDecorator {
  return CSGetElement({
    locatorType: 'text',
    locatorValue: options.text,
    description: options.description || `Text: ${options.text}`,
    ...options
  });
}

/**
 * Decorator for elements by test ID
 */
export function CSTestId(options: Partial<CSGetElementOptions> & { testId: string }): PropertyDecorator {
  return CSGetElement({
    locatorType: 'testid',
    locatorValue: options.testId,
    description: options.description || `Test ID: ${options.testId}`,
    ...options
  });
}

/**
 * Decorator for image elements
 */
export function CSImage(options: Partial<CSGetElementOptions> & { alt: string }): PropertyDecorator {
  return CSGetElement({
    locatorType: 'alt',
    locatorValue: options.alt,
    description: options.description || `Image: ${options.alt}`,
    ...options
  });
}