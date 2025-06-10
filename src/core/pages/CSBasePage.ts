import { Page } from 'playwright';
import { logger } from '../utils/Logger';
import { ActionLogger } from '../logging/ActionLogger';
import { CSWebElement } from '../elements/CSWebElement';
import { ElementMetadata } from '../elements/decorators/ElementMetadata';
import { PageContext } from './PageContext';
import { WaitOptions, ValidationError } from './types/page.types';

/**
 * CSBasePage - Base class for all page objects
 * Provides common functionality and element management
 */
export abstract class CSBasePage {
    protected page!: Page;
    protected context!: PageContext;
    private _elements: Record<string, CSWebElement> = {};
    private _initialized: boolean = false;
    private _pageLoadTime: number = 0;
    private _validationErrors: ValidationError[] = [];

    /**
     * Get page URL - must be implemented by child classes
     */
    protected abstract get pageUrl(): string;

    /**
     * Wait for page to be ready - must be implemented by child classes
     */
    protected abstract waitForPageLoad(): Promise<void>;

    /**
     * Custom page initialization - optional override
     */
    protected async onPageReady(): Promise<void> {
        // Override in child classes if needed
    }

    /**
     * Initialize the page object
     */
    async initialize(page: Page): Promise<void> {
        if (this._initialized) {
            logger.warn(`${this.constructor.name}: Already initialized`);
            return;
        }

        const startTime = Date.now();

        try {
            this.page = page;
            this.context = new PageContext(page);
            
            // Initialize all decorated elements
            this.initializeElements();
            
            // Wait for page to be ready
            await this.waitForPageLoad();
            
            // Record load time
            this._pageLoadTime = Date.now() - startTime;
            this.context.recordMetric('pageLoadTime', this._pageLoadTime);
            
            // Custom initialization
            await this.onPageReady();
            
            this._initialized = true;
            
            ActionLogger.logPageOperation('page_initialized', this.constructor.name, {
                url: this.page.url(),
                loadTime: this._pageLoadTime
            });
        } catch (error) {
            logger.error(`${this.constructor.name}: Initialization failed`, error as Error);
            throw error;
        }
    }

    /**
     * Navigate to this page
     */
    async navigateTo(url?: string): Promise<void> {
        try {
            const targetUrl = url || this.pageUrl;
            
            if (!targetUrl) {
                throw new Error('No URL specified for navigation');
            }
            
            const startTime = Date.now();
            
            await this.page.goto(targetUrl, {
                waitUntil: 'networkidle',
                timeout: 60000
            });
            
            // Re-initialize after navigation
            await this.initialize(this.page);
            
            const navigationTime = Date.now() - startTime;
            
            ActionLogger.logPageOperation('page_navigate', this.constructor.name, {
                url: targetUrl,
                navigationTime
            });
        } catch (error) {
            logger.error(`${this.constructor.name}: Navigation failed`, error as Error);
            throw error;
        }
    }

    /**
     * Reload the page
     */
    async reload(): Promise<void> {
        try {
            const startTime = Date.now();
            
            await this.page.reload({
                waitUntil: 'networkidle',
                timeout: 60000
            });
            
            // Re-initialize after reload
            await this.initialize(this.page);
            
            const reloadTime = Date.now() - startTime;
            
            ActionLogger.logPageOperation('page_reload', this.constructor.name, {
                reloadTime
            });
        } catch (error) {
            logger.error(`${this.constructor.name}: Reload failed`, error as Error);
            throw error;
        }
    }

    /**
     * Go back in browser history
     */
    async goBack(): Promise<void> {
        try {
            await this.page.goBack({
                waitUntil: 'networkidle',
                timeout: 60000
            });
            
            ActionLogger.logPageOperation('page_back', this.constructor.name);
        } catch (error) {
            logger.error(`${this.constructor.name}: Go back failed`, error as Error);
            throw error;
        }
    }

    /**
     * Go forward in browser history
     */
    async goForward(): Promise<void> {
        try {
            await this.page.goForward({
                waitUntil: 'networkidle',
                timeout: 60000
            });
            
            ActionLogger.logPageOperation('page_forward', this.constructor.name);
        } catch (error) {
            logger.error(`${this.constructor.name}: Go forward failed`, error as Error);
            throw error;
        }
    }

    /**
     * Get page title
     */
    async getTitle(): Promise<string> {
        try {
            const title = await this.page.title();
            
            ActionLogger.logPageOperation('page_get_title', this.constructor.name, {
                title
            });
            
            return title;
        } catch (error) {
            logger.error(`${this.constructor.name}: Failed to get title`, error as Error);
            throw error;
        }
    }

    /**
     * Get current URL
     */
    getURL(): string {
        return this.page.url();
    }

    /**
     * Take page screenshot
     */
    async takeScreenshot(name: string): Promise<void> {
        try {
            const screenshotPath = `./screenshots/${this.constructor.name}_${name}_${Date.now()}.png`;
            
            await this.page.screenshot({
                path: screenshotPath,
                fullPage: true
            });
            
            ActionLogger.logPageOperation('page_screenshot', this.constructor.name, {
                path: screenshotPath
            });
        } catch (error) {
            logger.error(`${this.constructor.name}: Screenshot failed`, error as Error);
            throw error;
        }
    }

    /**
     * Wait for specific load state
     */
    async waitForLoadState(state: 'load' | 'domcontentloaded' | 'networkidle' = 'networkidle'): Promise<void> {
        try {
            await this.page.waitForLoadState(state, {
                timeout: 60000
            });
            
            ActionLogger.logPageOperation('page_wait_load_state', this.constructor.name, {
                state
            });
        } catch (error) {
            logger.error(`${this.constructor.name}: Wait for load state failed`, error as Error);
            throw error;
        }
    }

    /**
     * Wait for URL to match
     */
    async waitForURL(url: string | RegExp, options?: WaitOptions): Promise<void> {
        try {
            await this.page.waitForURL(url, {
                timeout: options?.timeout || 30000,
                waitUntil: options?.waitUntil || 'networkidle'
            });
            
            ActionLogger.logPageOperation('page_wait_url', this.constructor.name, {
                url: url.toString()
            });
        } catch (error) {
            logger.error(`${this.constructor.name}: Wait for URL failed`, error as Error);
            throw error;
        }
    }

    /**
     * Check if this is the current page
     */
    async isCurrentPage(): Promise<boolean> {
        try {
            const currentUrl = this.page.url();
            const expectedUrl = this.pageUrl;
            
            // Basic URL matching - can be overridden for complex logic
            const isMatch = currentUrl.includes(expectedUrl);
            
            ActionLogger.logPageOperation('page_check_current', this.constructor.name, {
                currentUrl,
                expectedUrl,
                isMatch
            });
            
            return isMatch;
        } catch (error) {
            logger.error(`${this.constructor.name}: Failed to check current page`, error as Error);
            throw error;
        }
    }

    /**
     * Wait for element to be ready
     */
    async waitForElement(element: CSWebElement, options?: WaitOptions): Promise<void> {
        try {
            await element.waitFor({
                state: options?.state || 'visible',
                timeout: options?.timeout || 30000
            });
            
            ActionLogger.logPageOperation('page_wait_element', this.constructor.name, {
                element: element.description
            });
        } catch (error) {
            logger.error(`${this.constructor.name}: Wait for element failed`, error as Error);
            throw error;
        }
    }

    /**
     * Scroll to element
     */
    async scrollToElement(element: CSWebElement): Promise<void> {
        try {
            await element.scrollIntoView();
            
            ActionLogger.logPageOperation('page_scroll_to_element', this.constructor.name, {
                element: element.description
            });
        } catch (error) {
            logger.error(`${this.constructor.name}: Scroll to element failed`, error as Error);
            throw error;
        }
    }

    /**
     * Highlight element for debugging
     */
    async highlightElement(element: CSWebElement, duration: number = 2000): Promise<void> {
        try {
            await this.page.evaluate(
                ({ selector, duration }) => {
                    const el = document.querySelector(selector);
                    if (el) {
                        const originalStyle = el.getAttribute('style') || '';
                        el.setAttribute('style', `${originalStyle}; border: 3px solid #93186C !important; background-color: rgba(147, 24, 108, 0.1) !important;`);
                        
                        setTimeout(() => {
                            el.setAttribute('style', originalStyle);
                        }, duration);
                    }
                },
                { 
                    selector: element.options.locatorValue, 
                    duration 
                }
            );
            
            ActionLogger.logPageOperation('page_highlight_element', this.constructor.name, {
                element: element.description,
                duration
            });
        } catch (error) {
            logger.error(`${this.constructor.name}: Highlight element failed`, error as Error);
            // Non-critical error, don't throw
        }
    }

    /**
     * Validate page state
     */
    async validatePage(): Promise<boolean> {
        try {
            this._validationErrors = [];
            
            // Check if we're on the correct page
            const isCorrectPage = await this.isCurrentPage();
            if (!isCorrectPage) {
                this._validationErrors.push({
                    field: 'url',
                    message: 'Not on expected page',
                    severity: 'high'
                });
            }
            
            // Check all required elements are present
            const elements = ElementMetadata.getAll(this.constructor.name);
            for (const [propertyName, options] of Array.from(elements.entries())) {
                try {
                    const element = (this as any)[propertyName] as CSWebElement;
                    const isPresent = await element.isPresent();
                    
                    if (!isPresent && options.required) {
                        this._validationErrors.push({
                            field: propertyName,
                            message: `Required element '${options.description}' not found`,
                            severity: 'high'
                        });
                    }
                } catch (error) {
                    this._validationErrors.push({
                        field: propertyName,
                        message: `Error checking element '${options.description}': ${error}`,
                        severity: 'medium'
                    });
                }
            }
            
            // Run custom validation if implemented
            await this.customValidation();
            
            const isValid = this._validationErrors.filter(e => e.severity === 'high').length === 0;
            
            ActionLogger.logPageOperation('page_validate', this.constructor.name, {
                valid: isValid,
                errors: this._validationErrors.length
            });
            
            return isValid;
        } catch (error) {
            logger.error(`${this.constructor.name}: Validation failed`, error as Error);
            throw error;
        }
    }

    /**
     * Get validation errors
     */
    getValidationErrors(): ValidationError[] {
        return [...this._validationErrors];
    }

    /**
     * Custom validation - override in child classes
     */
    protected async customValidation(): Promise<void> {
        // Override in child classes to add custom validation
    }

    /**
     * Get page metrics
     */
    getMetrics(): any {
        return this.context.getMetrics();
    }

    /**
     * Execute action with retry
     */
    protected async executeWithRetry<T>(
        action: () => Promise<T>,
        retries: number = 3,
        delay: number = 1000
    ): Promise<T> {
        let lastError: Error | null = null;
        
        for (let i = 0; i < retries; i++) {
            try {
                return await action();
            } catch (error) {
                lastError = error as Error;
                logger.warn(`${this.constructor.name}: Retry ${i + 1}/${retries} after error:`, { error });
                
                if (i < retries - 1) {
                    await this.page.waitForTimeout(delay);
                }
            }
        }
        
        throw lastError;
    }

    /**
     * Wait for page to be stable (no network activity)
     */
    protected async waitForPageStability(timeout: number = 5000): Promise<void> {
        const startTime = Date.now();
        let lastRequestTime = Date.now();
        
        // Monitor network requests
        const requestHandler = () => {
            lastRequestTime = Date.now();
        };
        
        this.page.on('request', requestHandler);
        
        try {
            // Wait until no requests for specified time
            while (Date.now() - startTime < timeout) {
                if (Date.now() - lastRequestTime > 1000) {
                    // No requests for 1 second, consider stable
                    break;
                }
                await this.page.waitForTimeout(100);
            }
        } finally {
            this.page.off('request', requestHandler);
        }
    }

    // Private methods

    private initializeElements(): void {
        const metadata = ElementMetadata.getAll(this.constructor.name);
        
        metadata.forEach((options, propertyName) => {
            // Create getter for lazy element initialization
            Object.defineProperty(this, propertyName, {
                get: () => {
                    if (!this._elements[propertyName]) {
                        const element = new CSWebElement();
                        element.page = this.page;
                        element.options = options;
                        element.description = options.description;
                        this._elements[propertyName] = element;
                        
                        ActionLogger.logPageOperation('element_init', this.constructor.name, {
                            element: propertyName,
                            description: options.description
                        });
                    }
                    return this._elements[propertyName];
                },
                enumerable: true,
                configurable: true
            });
        });
    }

    /**
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        try {
            this._elements = {};
            this._initialized = false;
            
            ActionLogger.logPageOperation('page_cleanup', this.constructor.name);
        } catch (error) {
            logger.error(`${this.constructor.name}: Cleanup failed`, error as Error);
        }
    }
}