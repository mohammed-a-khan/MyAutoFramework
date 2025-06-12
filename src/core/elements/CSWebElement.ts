// src/core/elements/CSWebElement.ts
import { Page, Locator, Download, ElementHandle } from 'playwright';
import { 
  CSGetElementOptions, 
  ClickOptions, 
  TypeOptions, 
  AssertOptions,
  ElementState,
  ActionRecord,
  WaitOptions,
  ScreenshotOptions,
  BoundingBox
} from './types/element.types';
import { ElementResolver } from './ElementResolver';
import { ElementActionLogger } from './ElementActionLogger';
import { SelfHealingEngine } from '../ai/healing/SelfHealingEngine';
import { ActionLogger } from '../logging/ActionLogger';

export class CSWebElement {
  public page!: Page;
  public options!: CSGetElementOptions;
  public description!: string;
  
  private locator?: Locator;
  private actionHistory: ActionRecord[] = [];
  private lastResolvedAt?: Date;
  private cacheValidityMs = 5000; // Cache valid for 5 seconds
  private readonly elementId: string;

  constructor() {
    this.elementId = `element_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async resolve(): Promise<Locator> {
    const startTime = Date.now();
    
    try {
      // Check cache first
      if (this.locator && this.isCacheValid()) {
        return this.locator;
      }
      
      // Try resolution
      this.locator = await ElementResolver.getInstance().resolve(this);
      this.lastResolvedAt = new Date();
      
      // Log success
      ActionLogger.logInfo(`Element resolved successfully: ${this.description}`, {
        duration: Date.now() - startTime,
        locator: `${this.options.locatorType}=${this.options.locatorValue}`
      });
      
      return this.locator;
    } catch (error) {
      // Try AI healing if enabled
      if (this.options.aiEnabled) {
        try {
          ActionLogger.logInfo(`Attempting AI healing for element: ${this.description}`);
          this.locator = await SelfHealingEngine.getInstance().heal(this);
          this.lastResolvedAt = new Date();
          return this.locator;
        } catch (healingError) {
          ActionLogger.logError('AI healing failed', healingError as Error);
        }
      }
      
      // Log failure
      ActionLogger.logError(`Element resolution failed: ${this.description}`, error as Error);
      throw error;
    }
  }

  private isCacheValid(): boolean {
    if (!this.lastResolvedAt) return false;
    return Date.now() - this.lastResolvedAt.getTime() < this.cacheValidityMs;
  }

  async getLocator(): Promise<Locator> {
    return await this.resolve();
  }

  async elementHandle(): Promise<ElementHandle | null> {
    const locator = await this.resolve();
    return await locator.elementHandle();
  }

  private async logAction(action: string, parameters: any[], result: 'success' | 'failure', error?: Error): Promise<void> {
    const record: ActionRecord = {
      id: `${this.elementId}_${Date.now()}`,
      timestamp: new Date(),
      elementDescription: this.description,
      elementLocator: `${this.options.locatorType}=${this.options.locatorValue}`,
      action,
      parameters,
      duration: 0, // Will be updated by action logger
      success: result === 'success'
    };
    
    if (error) {
      record.error = error.message;
      if (error.stack) {
        record.stackTrace = error.stack;
      }
    }
    
    this.actionHistory.push(record);
    ElementActionLogger.getInstance().logAction(record);
  }

  private async captureElementState(): Promise<ElementState> {
    try {
      const locator = await this.resolve();
      const element = await locator.elementHandle();
      
      if (!element) {
        return {
          visible: false,
          enabled: false,
          text: '',
          value: '',
          attributes: {},
          boundingBox: null
        };
      }

      const state = await element.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const styles = window.getComputedStyle(el);
        
        return {
          visible: rect.width > 0 && rect.height > 0 && styles.display !== 'none' && styles.visibility !== 'hidden',
          enabled: !(el as any).disabled,
          text: el.textContent || '',
          value: (el as any).value || '',
          attributes: Array.from(el.attributes).reduce((acc, attr) => {
            acc[attr.name] = attr.value;
            return acc;
          }, {} as Record<string, string>),
          boundingBox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          },
          classList: Array.from(el.classList),
          tagName: el.tagName.toLowerCase()
        };
      });

      return state;
    } catch (error) {
      return {
        visible: false,
        enabled: false,
        text: '',
        value: '',
        attributes: {},
        boundingBox: null
      };
    }
  }

  // Basic Interaction Methods

  async click(options?: ClickOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      
      if (this.options.waitForVisible) {
        const waitOptions: { state: 'visible'; timeout?: number } = { state: 'visible' };
        if (this.options.waitTimeout !== undefined) {
          waitOptions.timeout = this.options.waitTimeout;
        }
        await locator.waitFor(waitOptions);
      }
      if (this.options.waitForEnabled) {
        // Wait for element to be enabled
        const waitOptions: { state: 'visible'; timeout?: number } = { state: 'visible' };
        if (this.options.waitTimeout !== undefined) {
          waitOptions.timeout = this.options.waitTimeout;
        }
        await locator.waitFor(waitOptions);
        
        const functionOptions: { timeout?: number } = {};
        if (this.options.waitTimeout !== undefined) {
          functionOptions.timeout = this.options.waitTimeout;
        }
        
        await this.page.waitForFunction(
          (selector) => {
            const element = document.querySelector(selector);
            return element && !(element as any).disabled;
          },
          `${this.options.locatorType}=${this.options.locatorValue}`,
          functionOptions
        );
      }

      await locator.click(options);
      
      await this.logAction('click', [options], 'success');
      ActionLogger.logInfo(`Element clicked: ${this.description}`, { 
        action: 'click',
        duration: Date.now() - startTime,
        options 
      });
    } catch (error) {
      await this.logAction('click', [options], 'failure', error as Error);
      throw error;
    }
  }

  async doubleClick(options?: ClickOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.dblclick(options);
      
      await this.logAction('doubleClick', [options], 'success');
      ActionLogger.logInfo(`Element double-clicked: ${this.description}`, { 
        action: 'doubleClick',
        duration: Date.now() - startTime,
        options 
      });
    } catch (error) {
      await this.logAction('doubleClick', [options], 'failure', error as Error);
      throw error;
    }
  }

  async rightClick(options?: ClickOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.click({ ...options, button: 'right' });
      
      await this.logAction('rightClick', [options], 'success');
      ActionLogger.logInfo(`Element right-clicked: ${this.description}`, { 
        action: 'rightClick',
        duration: Date.now() - startTime,
        options 
      });
    } catch (error) {
      await this.logAction('rightClick', [options], 'failure', error as Error);
      throw error;
    }
  }

  async tripleClick(): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.click({ clickCount: 3 });
      
      await this.logAction('tripleClick', [], 'success');
      ActionLogger.logInfo(`Element triple-clicked: ${this.description}`, { 
        action: 'tripleClick',
        duration: Date.now() - startTime 
      });
    } catch (error) {
      await this.logAction('tripleClick', [], 'failure', error as Error);
      throw error;
    }
  }

  async type(text: string, options?: TypeOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.type(text, options);
      
      await this.logAction('type', [text.length > 20 ? text.substring(0, 20) + '...' : text, options], 'success');
      ActionLogger.logInfo(`Text typed into element: ${this.description}`, { 
        action: 'type',
        duration: Date.now() - startTime,
        characters: text.length,
        options 
      });
    } catch (error) {
      await this.logAction('type', [text, options], 'failure', error as Error);
      throw error;
    }
  }

  async fill(text: string): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.fill(text);
      
      await this.logAction('fill', [text.length > 20 ? text.substring(0, 20) + '...' : text], 'success');
      ActionLogger.logInfo(`Element filled with text: ${this.description}`, { 
        action: 'fill',
        duration: Date.now() - startTime,
        characters: text.length 
      });
    } catch (error) {
      await this.logAction('fill', [text], 'failure', error as Error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.clear();
      
      await this.logAction('clear', [], 'success');
      ActionLogger.logInfo(`Element cleared: ${this.description}`, { 
        action: 'clear',
        duration: Date.now() - startTime 
      });
    } catch (error) {
      await this.logAction('clear', [], 'failure', error as Error);
      throw error;
    }
  }

  async press(key: string): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.press(key);
      
      await this.logAction('press', [key], 'success');
      ActionLogger.logInfo(`Key pressed on element: ${this.description}`, { 
        action: 'press',
        duration: Date.now() - startTime,
        key 
      });
    } catch (error) {
      await this.logAction('press', [key], 'failure', error as Error);
      throw error;
    }
  }

  async selectOption(value: string | string[]): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.selectOption(value);
      
      await this.logAction('selectOption', [value], 'success');
      ActionLogger.logInfo(`Option selected in element: ${this.description}`, { 
        action: 'selectOption',
        duration: Date.now() - startTime,
        value 
      });
    } catch (error) {
      await this.logAction('selectOption', [value], 'failure', error as Error);
      throw error;
    }
  }

  async selectText(): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.selectText();
      
      await this.logAction('selectText', [], 'success');
      ActionLogger.logInfo(`Text selected in element: ${this.description}`, { 
        action: 'selectText',
        duration: Date.now() - startTime 
      });
    } catch (error) {
      await this.logAction('selectText', [], 'failure', error as Error);
      throw error;
    }
  }

  async check(): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.check();
      
      await this.logAction('check', [], 'success');
      ActionLogger.logInfo(`Element checked: ${this.description}`, { 
        action: 'check',
        duration: Date.now() - startTime 
      });
    } catch (error) {
      await this.logAction('check', [], 'failure', error as Error);
      throw error;
    }
  }

  async uncheck(): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.uncheck();
      
      await this.logAction('uncheck', [], 'success');
      ActionLogger.logInfo(`Element unchecked: ${this.description}`, { 
        action: 'uncheck',
        duration: Date.now() - startTime 
      });
    } catch (error) {
      await this.logAction('uncheck', [], 'failure', error as Error);
      throw error;
    }
  }

  async hover(): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.hover();
      
      await this.logAction('hover', [], 'success');
      ActionLogger.logInfo(`Element hovered: ${this.description}`, { 
        action: 'hover',
        duration: Date.now() - startTime 
      });
    } catch (error) {
      await this.logAction('hover', [], 'failure', error as Error);
      throw error;
    }
  }

  async focus(): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.focus();
      
      await this.logAction('focus', [], 'success');
      ActionLogger.logInfo(`Element focused: ${this.description}`, { 
        action: 'focus',
        duration: Date.now() - startTime 
      });
    } catch (error) {
      await this.logAction('focus', [], 'failure', error as Error);
      throw error;
    }
  }

  async blur(): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.blur();
      
      await this.logAction('blur', [], 'success');
      ActionLogger.logInfo(`Element blurred: ${this.description}`, { 
        action: 'blur',
        duration: Date.now() - startTime 
      });
    } catch (error) {
      await this.logAction('blur', [], 'failure', error as Error);
      throw error;
    }
  }

  async scrollIntoView(): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.scrollIntoViewIfNeeded();
      
      await this.logAction('scrollIntoView', [], 'success');
      ActionLogger.logInfo(`Element scrolled into view: ${this.description}`, { 
        action: 'scrollIntoView',
        duration: Date.now() - startTime 
      });
    } catch (error) {
      await this.logAction('scrollIntoView', [], 'failure', error as Error);
      throw error;
    }
  }

  async waitFor(options?: WaitOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      
      // Create waitFor options with proper state
      const waitOptions: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number } = {};
      
      if (options?.state) {
        waitOptions.state = options.state;
      }
      if (options?.timeout !== undefined) {
        waitOptions.timeout = options.timeout;
      }
      
      await locator.waitFor(waitOptions);
      
      await this.logAction('waitFor', [options], 'success');
      ActionLogger.logInfo(`Waited for element: ${this.description}`, { 
        action: 'waitFor',
        duration: Date.now() - startTime,
        state: options?.state 
      });
    } catch (error) {
      await this.logAction('waitFor', [options], 'failure', error as Error);
      throw error;
    }
  }

  // Advanced Interaction Methods

  async dragTo(target: CSWebElement): Promise<void> {
    const startTime = Date.now();
    try {
      const sourceLocator = await this.resolve();
      const targetLocator = await target.resolve();
      
      await sourceLocator.dragTo(targetLocator);
      
      await this.logAction('dragTo', [target.description], 'success');
      ActionLogger.logInfo(`Element dragged to target: ${this.description}`, { 
        action: 'dragTo',
        duration: Date.now() - startTime,
        target: target.description 
      });
    } catch (error) {
      await this.logAction('dragTo', [target.description], 'failure', error as Error);
      throw error;
    }
  }

  async dragToPosition(x: number, y: number): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      const box = await locator.boundingBox();
      
      if (!box) {
        throw new Error('Element has no bounding box');
      }

      await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await this.page.mouse.down();
      await this.page.mouse.move(x, y);
      await this.page.mouse.up();
      
      await this.logAction('dragToPosition', [x, y], 'success');
      ActionLogger.logInfo(`Element dragged to position: ${this.description}`, { 
        action: 'dragToPosition',
        duration: Date.now() - startTime,
        position: { x, y } 
      });
    } catch (error) {
      await this.logAction('dragToPosition', [x, y], 'failure', error as Error);
      throw error;
    }
  }

  async dragByOffset(offsetX: number, offsetY: number): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      const box = await locator.boundingBox();
      
      if (!box) {
        throw new Error('Element has no bounding box');
      }

      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      
      await this.page.mouse.move(startX, startY);
      await this.page.mouse.down();
      await this.page.mouse.move(startX + offsetX, startY + offsetY);
      await this.page.mouse.up();
      
      await this.logAction('dragByOffset', [offsetX, offsetY], 'success');
      ActionLogger.logInfo(`Element dragged by offset: ${this.description}`, { 
        action: 'dragByOffset',
        duration: Date.now() - startTime,
        offset: { x: offsetX, y: offsetY } 
      });
    } catch (error) {
      await this.logAction('dragByOffset', [offsetX, offsetY], 'failure', error as Error);
      throw error;
    }
  }

  async upload(files: string | string[]): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.setInputFiles(files);
      
      const fileList = Array.isArray(files) ? files : [files];
      await this.logAction('upload', [fileList], 'success');
      ActionLogger.logInfo(`Files uploaded to element: ${this.description}`, { 
        action: 'upload',
        duration: Date.now() - startTime,
        files: fileList.length 
      });
    } catch (error) {
      await this.logAction('upload', [files], 'failure', error as Error);
      throw error;
    }
  }

  async download(action: () => Promise<void>): Promise<Download> {
    const startTime = Date.now();
    try {
      const downloadPromise = this.page.waitForEvent('download');
      await action();
      const download = await downloadPromise;
      
      await this.logAction('download', [], 'success');
      ActionLogger.logInfo(`Download initiated from element: ${this.description}`, { 
        action: 'download',
        duration: Date.now() - startTime,
        url: download.url() 
      });
      
      return download;
    } catch (error) {
      await this.logAction('download', [], 'failure', error as Error);
      throw error;
    }
  }

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      const screenshot = await locator.screenshot(options);
      
      await this.logAction('screenshot', [options?.path], 'success');
      ActionLogger.logInfo(`Screenshot taken of element: ${this.description}`, { 
        action: 'screenshot',
        duration: Date.now() - startTime,
        path: options?.path 
      });
      
      if (options?.path) {
        ElementActionLogger.getInstance().logScreenshot(this, screenshot);
      }
      
      return screenshot;
    } catch (error) {
      await this.logAction('screenshot', [options?.path], 'failure', error as Error);
      throw error;
    }
  }

  async mouseWheel(deltaX: number, deltaY: number): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      const box = await locator.boundingBox();
      
      if (!box) {
        throw new Error('Element has no bounding box');
      }

      await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await this.page.mouse.wheel(deltaX, deltaY);
      
      await this.logAction('mouseWheel', [deltaX, deltaY], 'success');
      ActionLogger.logInfo(`Mouse wheel scrolled on element: ${this.description}`, { 
        action: 'mouseWheel',
        duration: Date.now() - startTime,
        delta: { x: deltaX, y: deltaY } 
      });
    } catch (error) {
      await this.logAction('mouseWheel', [deltaX, deltaY], 'failure', error as Error);
      throw error;
    }
  }

  async pinch(scale: number): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      const box = await locator.boundingBox();
      
      if (!box) {
        throw new Error('Element has no bounding box');
      }

      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      const distance = 100;
      
      // Simulate pinch gesture
      await this.page.touchscreen.tap(centerX - distance / 2, centerY);
      await this.page.touchscreen.tap(centerX + distance / 2, centerY);
      
      const newDistance = distance * scale;
      await this.page.evaluate(({ cx, cy, d2 }) => {
        const touchEvent = new TouchEvent('touchmove', {
          touches: [
            new Touch({ identifier: 1, target: document.body, clientX: cx - d2 / 2, clientY: cy }),
            new Touch({ identifier: 2, target: document.body, clientX: cx + d2 / 2, clientY: cy })
          ]
        });
        document.dispatchEvent(touchEvent);
      }, { cx: centerX, cy: centerY, d2: newDistance });
      
      await this.logAction('pinch', [scale], 'success');
      ActionLogger.logInfo(`Pinch gesture performed on element: ${this.description}`, { 
        action: 'pinch',
        duration: Date.now() - startTime,
        scale 
      });
    } catch (error) {
      await this.logAction('pinch', [scale], 'failure', error as Error);
      throw error;
    }
  }

  async tap(): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      await locator.tap();
      
      await this.logAction('tap', [], 'success');
      ActionLogger.logInfo(`Element tapped: ${this.description}`, { 
        action: 'tap',
        duration: Date.now() - startTime 
      });
    } catch (error) {
      await this.logAction('tap', [], 'failure', error as Error);
      throw error;
    }
  }

  async swipe(direction: 'up' | 'down' | 'left' | 'right', distance: number = 100): Promise<void> {
    const startTime = Date.now();
    try {
      const locator = await this.resolve();
      const box = await locator.boundingBox();
      
      if (!box) {
        throw new Error('Element has no bounding box');
      }

      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      
      let endX = centerX;
      let endY = centerY;
      
      switch (direction) {
        case 'up':
          endY = centerY - distance;
          break;
        case 'down':
          endY = centerY + distance;
          break;
        case 'left':
          endX = centerX - distance;
          break;
        case 'right':
          endX = centerX + distance;
          break;
      }
      
      await this.page.touchscreen.tap(centerX, centerY);
      await this.page.waitForTimeout(100);
      
      // Simulate swipe motion
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const x = centerX + (endX - centerX) * (i / steps);
        const y = centerY + (endY - centerY) * (i / steps);
        await this.page.evaluate(({ px, py }) => {
          const touchEvent = new TouchEvent('touchmove', {
            touches: [new Touch({ identifier: 1, target: document.body, clientX: px, clientY: py })]
          });
          document.dispatchEvent(touchEvent);
        }, { px: x, py: y });
        await this.page.waitForTimeout(10);
      }
      
      await this.page.evaluate(() => {
        document.dispatchEvent(new TouchEvent('touchend'));
      });
      
      await this.logAction('swipe', [direction, distance], 'success');
      ActionLogger.logInfo(`Swipe performed on element: ${this.description}`, { 
        action: 'swipe',
        duration: Date.now() - startTime,
        direction,
        distance 
      });
    } catch (error) {
      await this.logAction('swipe', [direction, distance], 'failure', error as Error);
      throw error;
    }
  }

  // Validation Methods

  async isVisible(): Promise<boolean> {
    try {
      const locator = await this.resolve();
      return await locator.isVisible();
    } catch (error) {
      return false;
    }
  }

  async isHidden(): Promise<boolean> {
    try {
      const locator = await this.resolve();
      return await locator.isHidden();
    } catch (error) {
      return true;
    }
  }

  async isEnabled(): Promise<boolean> {
    try {
      const locator = await this.resolve();
      return await locator.isEnabled();
    } catch (error) {
      return false;
    }
  }

  async isDisabled(): Promise<boolean> {
    try {
      const locator = await this.resolve();
      return await locator.isDisabled();
    } catch (error) {
      return true;
    }
  }

  async isChecked(): Promise<boolean> {
    try {
      const locator = await this.resolve();
      return await locator.isChecked();
    } catch (error) {
      return false;
    }
  }

  async isEditable(): Promise<boolean> {
    try {
      const locator = await this.resolve();
      return await locator.isEditable();
    } catch (error) {
      return false;
    }
  }

  async isPresent(): Promise<boolean> {
    try {
      const locator = await this.resolve();
      return await locator.count() > 0;
    } catch (error) {
      return false;
    }
  }

  async isInViewport(): Promise<boolean> {
    try {
      const locator = await this.resolve();
      const box = await locator.boundingBox();
      if (!box) return false;
      
      // Check if element is in viewport by evaluating in the browser
      return await locator.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return (
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
          rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
      });
    } catch (error) {
      return false;
    }
  }


  async getText(): Promise<string> {
    try {
      const locator = await this.resolve();
      return await locator.textContent() || '';
    } catch (error) {
      await this.logAction('getText', [], 'failure', error as Error);
      throw error;
    }
  }

  async getInnerText(): Promise<string> {
    try {
      const locator = await this.resolve();
      return await locator.innerText();
    } catch (error) {
      await this.logAction('getInnerText', [], 'failure', error as Error);
      throw error;
    }
  }

  async getValue(): Promise<string> {
    try {
      const locator = await this.resolve();
      return await locator.inputValue();
    } catch (error) {
      await this.logAction('getValue', [], 'failure', error as Error);
      throw error;
    }
  }

  async getAttribute(name: string): Promise<string | null> {
    try {
      const locator = await this.resolve();
      return await locator.getAttribute(name);
    } catch (error) {
      await this.logAction('getAttribute', [name], 'failure', error as Error);
      throw error;
    }
  }

  async getCSSProperty(property: string): Promise<string> {
    try {
      const locator = await this.resolve();
      return await locator.evaluate((el, prop) => {
        return window.getComputedStyle(el).getPropertyValue(prop);
      }, property);
    } catch (error) {
      await this.logAction('getCSSProperty', [property], 'failure', error as Error);
      throw error;
    }
  }

  async getCount(): Promise<number> {
    try {
      const locator = await this.resolve();
      return await locator.count();
    } catch (error) {
      await this.logAction('getCount', [], 'failure', error as Error);
      throw error;
    }
  }

  async getBoundingBox(): Promise<BoundingBox | null> {
    try {
      const locator = await this.resolve();
      return await locator.boundingBox();
    } catch (error) {
      await this.logAction('getBoundingBox', [], 'failure', error as Error);
      throw error;
    }
  }

  // Assertion Methods

  async assertText(expected: string, options?: AssertOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const actual = await this.getText();
      
      if (actual !== expected) {
        const error = new Error(`Text assertion failed. Expected: "${expected}", Actual: "${actual}"`);
        
        if (options?.screenshot) {
          await this.screenshot({ path: `assertion-failure-${Date.now()}.png` });
        }
        
        if (!options?.soft) {
          throw error;
        } else {
          ActionLogger.logWarn(`Soft assertion failed: ${error.message}`);
        }
      }
      
      await this.logAction('assertText', [expected, options], 'success');
      ActionLogger.logInfo(`Text assertion passed for element: ${this.description}`, { 
        action: 'assertText',
        duration: Date.now() - startTime,
        expected,
        actual,
        success: true 
      });
    } catch (error) {
      await this.logAction('assertText', [expected, options], 'failure', error as Error);
      ActionLogger.logError(`Text assertion failed for element: ${this.description}`, error as Error);
      throw error;
    }
  }

  async assertTextContains(expected: string, options?: AssertOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const actual = await this.getText();
      
      if (!actual.includes(expected)) {
        const error = new Error(`Text contains assertion failed. Expected to contain: "${expected}", Actual: "${actual}"`);
        
        if (options?.screenshot) {
          await this.screenshot({ path: `assertion-failure-${Date.now()}.png` });
        }
        
        if (!options?.soft) {
          throw error;
        } else {
          ActionLogger.logWarn(`Soft assertion failed: ${error.message}`);
        }
      }
      
      await this.logAction('assertTextContains', [expected, options], 'success');
      ActionLogger.logInfo(`Text contains assertion passed for element: ${this.description}`, { 
        action: 'assertTextContains',
        duration: Date.now() - startTime,
        expected,
        actual,
        success: true 
      });
    } catch (error) {
      await this.logAction('assertTextContains', [expected, options], 'failure', error as Error);
      ActionLogger.logError(`Text contains assertion failed for element: ${this.description}`, error as Error);
      throw error;
    }
  }

  async assertValue(expected: string, options?: AssertOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const actual = await this.getValue();
      
      if (actual !== expected) {
        const error = new Error(`Value assertion failed. Expected: "${expected}", Actual: "${actual}"`);
        
        if (options?.screenshot) {
          await this.screenshot({ path: `assertion-failure-${Date.now()}.png` });
        }
        
        if (!options?.soft) {
          throw error;
        } else {
          ActionLogger.logWarn(`Soft assertion failed: ${error.message}`);
        }
      }
      
      await this.logAction('assertValue', [expected, options], 'success');
      ActionLogger.logInfo(`Value assertion passed for element: ${this.description}`, { 
        action: 'assertValue',
        duration: Date.now() - startTime,
        expected,
        actual,
        success: true 
      });
    } catch (error) {
      await this.logAction('assertValue', [expected, options], 'failure', error as Error);
      ActionLogger.logError(`Value assertion failed for element: ${this.description}`, error as Error);
      throw error;
    }
  }

  async assertAttribute(name: string, expected: string, options?: AssertOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const actual = await this.getAttribute(name);
      
      if (actual !== expected) {
        const error = new Error(`Attribute assertion failed. Attribute: "${name}", Expected: "${expected}", Actual: "${actual}"`);
        
        if (options?.screenshot) {
          await this.screenshot({ path: `assertion-failure-${Date.now()}.png` });
        }
        
        if (!options?.soft) {
          throw error;
        } else {
          ActionLogger.logWarn(`Soft assertion failed: ${error.message}`);
        }
      }
      
      await this.logAction('assertAttribute', [name, expected, options], 'success');
      ActionLogger.logInfo(`Attribute assertion passed for element: ${this.description}`, { 
        action: 'assertAttribute',
        duration: Date.now() - startTime,
        attribute: name,
        expected,
        actual,
        success: true 
      });
    } catch (error) {
      await this.logAction('assertAttribute', [name, expected, options], 'failure', error as Error);
      ActionLogger.logError(`Attribute assertion failed for element: ${this.description}`, error as Error);
      throw error;
    }
  }

  async assertCSSProperty(property: string, expected: string, options?: AssertOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const actual = await this.getCSSProperty(property);
      
      if (actual !== expected) {
        const error = new Error(`CSS property assertion failed. Property: "${property}", Expected: "${expected}", Actual: "${actual}"`);
        
        if (options?.screenshot) {
          await this.screenshot({ path: `assertion-failure-${Date.now()}.png` });
        }
        
        if (!options?.soft) {
          throw error;
        } else {
          ActionLogger.logWarn(`Soft assertion failed: ${error.message}`);
        }
      }
      
      await this.logAction('assertCSSProperty', [property, expected, options], 'success');
      ActionLogger.logInfo(`CSS property assertion passed for element: ${this.description}`, { 
        action: 'assertCSSProperty',
        duration: Date.now() - startTime,
        property,
        expected,
        actual,
        success: true 
      });
    } catch (error) {
      await this.logAction('assertCSSProperty', [property, expected, options], 'failure', error as Error);
      ActionLogger.logError(`CSS property assertion failed for element: ${this.description}`, error as Error);
      throw error;
    }
  }

  async assertVisible(options?: AssertOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const isVisible = await this.isVisible();
      
      if (!isVisible) {
        const error = new Error(`Element visibility assertion failed. Expected element to be visible: ${this.description}`);
        
        if (options?.screenshot) {
          await this.page.screenshot({ path: `assertion-failure-${Date.now()}.png`, fullPage: true });
        }
        
        if (!options?.soft) {
          throw error;
        } else {
          ActionLogger.logWarn(`Soft assertion failed: ${error.message}`);
        }
      }
      
      await this.logAction('assertVisible', [options], 'success');
      ActionLogger.logInfo(`Visibility assertion passed for element: ${this.description}`, { 
        action: 'assertVisible',
        duration: Date.now() - startTime,
        success: true 
      });
    } catch (error) {
      await this.logAction('assertVisible', [options], 'failure', error as Error);
      ActionLogger.logError(`Visibility assertion failed for element: ${this.description}`, error as Error);
      throw error;
    }
  }

  async assertHidden(options?: AssertOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const isHidden = await this.isHidden();
      
      if (!isHidden) {
        const error = new Error(`Element hidden assertion failed. Expected element to be hidden: ${this.description}`);
        
        if (options?.screenshot) {
          await this.screenshot({ path: `assertion-failure-${Date.now()}.png` });
        }
        
        if (!options?.soft) {
          throw error;
        } else {
          ActionLogger.logWarn(`Soft assertion failed: ${error.message}`);
        }
      }
      
      await this.logAction('assertHidden', [options], 'success');
      ActionLogger.logInfo(`Hidden assertion passed for element: ${this.description}`, { 
        action: 'assertHidden',
        duration: Date.now() - startTime,
        success: true 
      });
    } catch (error) {
      await this.logAction('assertHidden', [options], 'failure', error as Error);
      ActionLogger.logError(`Hidden assertion failed for element: ${this.description}`, error as Error);
      throw error;
    }
  }

  async assertEnabled(options?: AssertOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const isEnabled = await this.isEnabled();
      
      if (!isEnabled) {
        const error = new Error(`Element enabled assertion failed. Expected element to be enabled: ${this.description}`);
        
        if (options?.screenshot) {
          await this.screenshot({ path: `assertion-failure-${Date.now()}.png` });
        }
        
        if (!options?.soft) {
          throw error;
        } else {
          ActionLogger.logWarn(`Soft assertion failed: ${error.message}`);
        }
      }
      
      await this.logAction('assertEnabled', [options], 'success');
      ActionLogger.logInfo(`Enabled assertion passed for element: ${this.description}`, { 
        action: 'assertEnabled',
        duration: Date.now() - startTime,
        success: true 
      });
    } catch (error) {
      await this.logAction('assertEnabled', [options], 'failure', error as Error);
      ActionLogger.logError(`Enabled assertion failed for element: ${this.description}`, error as Error);
      throw error;
    }
  }

  async assertDisabled(options?: AssertOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const isDisabled = await this.isDisabled();
      
      if (!isDisabled) {
        const error = new Error(`Element disabled assertion failed. Expected element to be disabled: ${this.description}`);
        
        if (options?.screenshot) {
          await this.screenshot({ path: `assertion-failure-${Date.now()}.png` });
        }
        
        if (!options?.soft) {
          throw error;
        } else {
          ActionLogger.logWarn(`Soft assertion failed: ${error.message}`);
        }
      }
      
      await this.logAction('assertDisabled', [options], 'success');
      ActionLogger.logInfo(`Disabled assertion passed for element: ${this.description}`, { 
        action: 'assertDisabled',
        duration: Date.now() - startTime,
        success: true 
      });
    } catch (error) {
      await this.logAction('assertDisabled', [options], 'failure', error as Error);
      ActionLogger.logError(`Disabled assertion failed for element: ${this.description}`, error as Error);
      throw error;
    }
  }

  async assertChecked(options?: AssertOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const isChecked = await this.isChecked();
      
      if (!isChecked) {
        const error = new Error(`Element checked assertion failed. Expected element to be checked: ${this.description}`);
        
        if (options?.screenshot) {
          await this.screenshot({ path: `assertion-failure-${Date.now()}.png` });
        }
        
        if (!options?.soft) {
          throw error;
        } else {
          ActionLogger.logWarn(`Soft assertion failed: ${error.message}`);
        }
      }
      
      await this.logAction('assertChecked', [options], 'success');
      ActionLogger.logInfo(`Checked assertion passed for element: ${this.description}`, { 
        action: 'assertChecked',
        duration: Date.now() - startTime,
        success: true 
      });
    } catch (error) {
      await this.logAction('assertChecked', [options], 'failure', error as Error);
      ActionLogger.logError(`Checked assertion failed for element: ${this.description}`, error as Error);
      throw error;
    }
  }

  async assertUnchecked(options?: AssertOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const isChecked = await this.isChecked();
      
      if (isChecked) {
        const error = new Error(`Element unchecked assertion failed. Expected element to be unchecked: ${this.description}`);
        
        if (options?.screenshot) {
          await this.screenshot({ path: `assertion-failure-${Date.now()}.png` });
        }
        
        if (!options?.soft) {
          throw error;
        } else {
          ActionLogger.logWarn(`Soft assertion failed: ${error.message}`);
        }
      }
      
      await this.logAction('assertUnchecked', [options], 'success');
      ActionLogger.logInfo(`Unchecked assertion passed for element: ${this.description}`, { 
        action: 'assertUnchecked',
        duration: Date.now() - startTime,
        success: true 
      });
    } catch (error) {
      await this.logAction('assertUnchecked', [options], 'failure', error as Error);
      ActionLogger.logError(`Unchecked assertion failed for element: ${this.description}`, error as Error);
      throw error;
    }
  }

  async assertCount(expected: number, options?: AssertOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const actual = await this.getCount();
      
      if (actual !== expected) {
        const error = new Error(`Element count assertion failed. Expected: ${expected}, Actual: ${actual}`);
        
        if (options?.screenshot) {
          await this.page.screenshot({ path: `assertion-failure-${Date.now()}.png`, fullPage: true });
        }
        
        if (!options?.soft) {
          throw error;
        } else {
          ActionLogger.logWarn(`Soft assertion failed: ${error.message}`);
        }
      }
      
      await this.logAction('assertCount', [expected, options], 'success');
      ActionLogger.logInfo(`Count assertion passed for element: ${this.description}`, { 
        action: 'assertCount',
        duration: Date.now() - startTime,
        expected,
        actual,
        success: true 
      });
    } catch (error) {
      await this.logAction('assertCount', [expected, options], 'failure', error as Error);
      ActionLogger.logError(`Count assertion failed for element: ${this.description}`, error as Error);
      throw error;
    }
  }

  async assertInViewport(options?: AssertOptions): Promise<void> {
    const startTime = Date.now();
    try {
      const inViewport = await this.isInViewport();
      
      if (!inViewport) {
        const error = new Error(`Element in viewport assertion failed. Expected element to be in viewport: ${this.description}`);
        
        if (options?.screenshot) {
          await this.page.screenshot({ path: `assertion-failure-${Date.now()}.png`, fullPage: true });
        }
        
        if (!options?.soft) {
          throw error;
        } else {
          ActionLogger.logWarn(`Soft assertion failed: ${error.message}`);
        }
      }
      
      await this.logAction('assertInViewport', [options], 'success');
      ActionLogger.logInfo(`In viewport assertion passed for element: ${this.description}`, { 
        action: 'assertInViewport',
        duration: Date.now() - startTime,
        success: true 
      });
    } catch (error) {
      await this.logAction('assertInViewport', [options], 'failure', error as Error);
      ActionLogger.logError(`In viewport assertion failed for element: ${this.description}`, error as Error);
      throw error;
    }
  }

  // Soft assertion variants
  async softAssertText(expected: string): Promise<void> {
    await this.assertText(expected, { soft: true });
  }

  async softAssertTextContains(expected: string): Promise<void> {
    await this.assertTextContains(expected, { soft: true });
  }

  async softAssertValue(expected: string): Promise<void> {
    await this.assertValue(expected, { soft: true });
  }

  async softAssertAttribute(name: string, expected: string): Promise<void> {
    await this.assertAttribute(name, expected, { soft: true });
  }

  async softAssertCSSProperty(property: string, expected: string): Promise<void> {
    await this.assertCSSProperty(property, expected, { soft: true });
  }

  async softAssertVisible(): Promise<void> {
    await this.assertVisible({ soft: true });
  }

  async softAssertHidden(): Promise<void> {
    await this.assertHidden({ soft: true });
  }

  async softAssertEnabled(): Promise<void> {
    await this.assertEnabled({ soft: true });
  }

  async softAssertDisabled(): Promise<void> {
    await this.assertDisabled({ soft: true });
  }

  async softAssertChecked(): Promise<void> {
    await this.assertChecked({ soft: true });
  }

  async softAssertUnchecked(): Promise<void> {
    await this.assertUnchecked({ soft: true });
  }

  async softAssertCount(expected: number): Promise<void> {
    await this.assertCount(expected, { soft: true });
  }

  async softAssertInViewport(): Promise<void> {
    await this.assertInViewport({ soft: true });
  }

  // Helper methods
  
  invalidateCache(): void {
    delete this.locator;
    delete this.lastResolvedAt;
  }

  getActionHistory(): ActionRecord[] {
    return [...this.actionHistory];
  }

  getLastAction(): ActionRecord | undefined {
    return this.actionHistory[this.actionHistory.length - 1];
  }

  getElementId(): string {
    return this.elementId;
  }

  async getElementState(): Promise<ElementState> {
    return await this.captureElementState();
  }
}