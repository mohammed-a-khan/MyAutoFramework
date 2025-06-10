// src/core/elements/types/element.types.ts
import { Locator } from 'playwright';

// Define BoundingBox type based on Playwright's return type
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CSGetElementOptions {
  // Basic locators
  locatorType: 'css' | 'xpath' | 'text' | 'role' | 'testid' | 'label' | 'placeholder' | 'alt' | 'title';
  locatorValue: string;
  description: string;
  
  // Text matching
  exact?: boolean;
  caseSensitive?: boolean;
  
  // Advanced options
  hasText?: string;
  hasNotText?: string;
  has?: CSGetElementOptions;
  hasNot?: CSGetElementOptions;
  filter?: CSGetElementOptions;
  
  // Layout selectors
  leftOf?: CSGetElementOptions;
  rightOf?: CSGetElementOptions;
  above?: CSGetElementOptions;
  below?: CSGetElementOptions;
  near?: CSGetElementOptions;
  maxDistance?: number;
  
  // Component selectors
  react?: string;
  vue?: string;
  
  // Nth selectors
  nth?: number | 'first' | 'last';
  
  // Fallbacks
  fallbacks?: Array<{
    locatorType: string;
    value: string;
  }>;
  
  // AI options
  aiEnabled?: boolean;
  aiDescription?: string;
  aiConfidenceThreshold?: number;
  
  // Wait options
  waitTimeout?: number;
  waitForVisible?: boolean;
  waitForEnabled?: boolean;
  
  // Frame/Shadow DOM
  iframe?: string | number;
  shadowRoot?: boolean;
  
  // Validation
  strict?: boolean;  // Fail if multiple elements match
  required?: boolean;  // Whether the element is required for page validation
}

export interface ElementAction {
  name: string;
  parameters: any[];
  timestamp: Date;
  element: string;
  duration?: number;
  success?: boolean;
  error?: string;
}

export interface AssertOptions {
  timeout?: number;
  soft?: boolean;
  message?: string;
  screenshot?: boolean;
}

export interface ElementState {
  visible: boolean;
  enabled: boolean;
  text: string;
  value: string;
  attributes: Record<string, string>;
  boundingBox: BoundingBox | null;
  classList?: string[];
  tagName?: string;
}

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
  position?: { x: number; y: number };
  modifiers?: Array<'Alt' | 'Control' | 'Meta' | 'Shift'>;
  force?: boolean;
  noWaitAfter?: boolean;
  trial?: boolean;
  timeout?: number;
}

export interface TypeOptions {
  delay?: number;
  noWaitAfter?: boolean;
  timeout?: number;
}

export interface WaitOptions {
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
  timeout?: number;
}

export interface ScreenshotOptions {
  path?: string;
  type?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  omitBackground?: boolean;
  timeout?: number;
}

export interface ActionRecord {
  id: string;
  timestamp: Date;
  elementDescription: string;
  elementLocator: string;
  action: string;
  parameters: any[];
  duration: number;
  success: boolean;
  error?: string;
  screenshot?: string;
  beforeState?: ElementState;
  afterState?: ElementState;
  stackTrace?: string;
}

export interface ElementMetadataExport {
  timestamp: Date;
  version: string;
  elements: Array<{
    className: string;
    propertyName: string;
    options: CSGetElementOptions;
  }>;
}

export interface LayoutSelectorOptions {
  type: 'leftOf' | 'rightOf' | 'above' | 'below' | 'near';
  target: CSGetElementOptions;
  maxDistance?: number;
}

export interface FilterOptions {
  hasText?: string;
  hasNotText?: string;
  has?: CSGetElementOptions;
  hasNot?: CSGetElementOptions;
}

export interface ComponentOptions {
  framework: 'react' | 'vue' | 'angular';
  componentName: string;
  props?: Record<string, any>;
}

export interface ChainedSelector {
  type: 'parent' | 'child' | 'sibling';
  selector: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

export interface ElementCandidate {
  element: Element;
  locator: Locator;
  score?: number;
  reason?: string;
}

export interface RobustLocator {
  primary: string;
  fallbacks: string[];
  confidence: number;
  strategy: string;
}

export interface ElementResolutionResult {
  locator: Locator;
  strategy: LocatorStrategy;
  confidence: number;
  fallbacksUsed: number;
  resolutionTime: number;
}

export type LocatorStrategy = 
  | 'direct'
  | 'fallback'
  | 'ai'
  | 'layout'
  | 'filter'
  | 'component'
  | 'shadow'
  | 'chained';