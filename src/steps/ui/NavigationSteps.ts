// src/steps/ui/NavigationSteps.ts
import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { PageFactory } from '../../core/pages/PageFactory';
import { CSBasePage } from '../../core/pages/CSBasePage';

export class NavigationSteps extends CSBDDBaseStepDefinition {
    private baseUrl: string;
    private currentPage: CSBasePage | null = null;

    constructor() {
        super();
        this.baseUrl = ConfigurationManager.get('BASE_URL', '');
    }

    @CSBDDStepDef('user navigates to {string}')
    @CSBDDStepDef('I navigate to {string}')
    @CSBDDStepDef('the user navigates to {string}')
    async navigateToUrl(url: string): Promise<void> {
        ActionLogger.logStep('Navigate to URL', { url });
        
        try {
            // Handle relative and absolute URLs
            const fullUrl = this.resolveUrl(url);
            
            await this.page.goto(fullUrl, {
                waitUntil: ConfigurationManager.get('NAVIGATION_WAIT_UNTIL', 'networkidle') as any,
                timeout: ConfigurationManager.getInt('NAVIGATION_TIMEOUT', 30000)
            });

            // Wait for any custom page load conditions
            const waitSelector = ConfigurationManager.get('PAGE_LOAD_SELECTOR', '');
            if (waitSelector) {
                await this.page.waitForSelector(waitSelector, {
                    state: 'visible',
                    timeout: ConfigurationManager.getInt('PAGE_LOAD_TIMEOUT', 10000)
                });
            }

            // Clear current page object as we've navigated
            this.currentPage = null;

            ActionLogger.logSuccess('Navigation completed', { 
                url: fullUrl, 
                currentUrl: this.page.url() 
            });
        } catch (error) {
            ActionLogger.logError('Navigation failed', error as Error);
            throw new Error(`Failed to navigate to ${url}: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user navigates to {string} page')
    @CSBDDStepDef('I navigate to {string} page')
    @CSBDDStepDef('the user navigates to {string} page')
    async navigateToPageByName(pageName: string): Promise<void> {
        ActionLogger.logStep('Navigate to page by name', { pageName });
        
        try {
            // Get page URL from configuration
            const pageUrlKey = `${pageName.toUpperCase().replace(/\s+/g, '_')}_PAGE_URL`;
            let pageUrl = ConfigurationManager.get(pageUrlKey, '');
            
            if (!pageUrl) {
                // Try alternate key format
                pageUrl = ConfigurationManager.get(`PAGE_${pageName.toUpperCase()}`, '');
            }
            
            if (!pageUrl) {
                throw new Error(`Page URL not found for ${pageName}. Please define ${pageUrlKey} in configuration.`);
            }

            await this.navigateToUrl(pageUrl);

            // Try to create page object if registered
            try {
                this.currentPage = await PageFactory.createPageByName(pageName, this.page);
                this.context.set('currentPage', this.currentPage);
                ActionLogger.logInfo(`Page object created for ${pageName}`);
            } catch (error) {
                ActionLogger.logDebug(`No page object registered for ${pageName}`);
            }
        } catch (error) {
            ActionLogger.logError('Navigation to page failed', error as Error);
            throw error;
        }
    }

    @CSBDDStepDef('user refreshes the page')
    @CSBDDStepDef('I refresh the page')
    @CSBDDStepDef('the page is refreshed')
    async refreshPage(): Promise<void> {
        ActionLogger.logStep('Refresh page');
        
        try {
            const currentUrl = this.page.url();
            
            await this.page.reload({
                waitUntil: ConfigurationManager.get('NAVIGATION_WAIT_UNTIL', 'networkidle') as any,
                timeout: ConfigurationManager.getInt('NAVIGATION_TIMEOUT', 30000)
            });

            // Wait for page to be ready after refresh
            await this.page.waitForLoadState('domcontentloaded');

            ActionLogger.logSuccess('Page refreshed', { url: currentUrl });
        } catch (error) {
            ActionLogger.logError('Page refresh failed', error as Error);
            throw new Error(`Failed to refresh page: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user goes back')
    @CSBDDStepDef('I go back')
    @CSBDDStepDef('the user navigates back')
    async goBack(): Promise<void> {
        ActionLogger.logStep('Navigate back');
        
        try {
            const currentUrl = this.page.url();
            
            await this.page.goBack({
                waitUntil: ConfigurationManager.get('NAVIGATION_WAIT_UNTIL', 'networkidle') as any,
                timeout: ConfigurationManager.getInt('NAVIGATION_TIMEOUT', 30000)
            });

            const newUrl = this.page.url();
            
            if (currentUrl === newUrl) {
                ActionLogger.logWarning('Navigation back had no effect (possibly at first page in history)');
            }

            // Clear current page object as we've navigated
            this.currentPage = null;

            ActionLogger.logSuccess('Navigated back', { 
                from: currentUrl, 
                to: newUrl 
            });
        } catch (error) {
            ActionLogger.logError('Navigate back failed', error as Error);
            throw new Error(`Failed to navigate back: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user goes forward')
    @CSBDDStepDef('I go forward')
    @CSBDDStepDef('the user navigates forward')
    async goForward(): Promise<void> {
        ActionLogger.logStep('Navigate forward');
        
        try {
            const currentUrl = this.page.url();
            
            await this.page.goForward({
                waitUntil: ConfigurationManager.get('NAVIGATION_WAIT_UNTIL', 'networkidle') as any,
                timeout: ConfigurationManager.getInt('NAVIGATION_TIMEOUT', 30000)
            });

            const newUrl = this.page.url();
            
            if (currentUrl === newUrl) {
                ActionLogger.logWarning('Navigation forward had no effect (possibly at last page in history)');
            }

            // Clear current page object as we've navigated
            this.currentPage = null;

            ActionLogger.logSuccess('Navigated forward', { 
                from: currentUrl, 
                to: newUrl 
            });
        } catch (error) {
            ActionLogger.logError('Navigate forward failed', error as Error);
            throw new Error(`Failed to navigate forward: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user waits for navigation')
    @CSBDDStepDef('I wait for navigation')
    @CSBDDStepDef('the navigation completes')
    async waitForNavigation(): Promise<void> {
        ActionLogger.logStep('Wait for navigation');
        
        try {
            await this.page.waitForNavigation({
                waitUntil: ConfigurationManager.get('NAVIGATION_WAIT_UNTIL', 'networkidle') as any,
                timeout: ConfigurationManager.getInt('NAVIGATION_TIMEOUT', 30000)
            });

            ActionLogger.logSuccess('Navigation completed', { 
                url: this.page.url() 
            });
        } catch (error) {
            ActionLogger.logError('Wait for navigation failed', error as Error);
            throw new Error(`Failed to wait for navigation: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user waits for page to load')
    @CSBDDStepDef('I wait for page to load')
    @CSBDDStepDef('the page finishes loading')
    async waitForPageLoad(): Promise<void> {
        ActionLogger.logStep('Wait for page load');
        
        try {
            await this.page.waitForLoadState('networkidle', {
                timeout: ConfigurationManager.getInt('PAGE_LOAD_TIMEOUT', 30000)
            });

            ActionLogger.logSuccess('Page loaded', { 
                url: this.page.url() 
            });
        } catch (error) {
            ActionLogger.logError('Wait for page load failed', error as Error);
            throw new Error(`Failed to wait for page load: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user navigates to {string} in new tab')
    @CSBDDStepDef('I open {string} in new tab')
    async navigateToUrlInNewTab(url: string): Promise<void> {
        ActionLogger.logStep('Navigate to URL in new tab', { url });
        
        try {
            const fullUrl = this.resolveUrl(url);
            
            // Create new page (tab)
            const newPage = await this.context.newPage();
            
            // Navigate in new tab
            await newPage.goto(fullUrl, {
                waitUntil: ConfigurationManager.get('NAVIGATION_WAIT_UNTIL', 'networkidle') as any,
                timeout: ConfigurationManager.getInt('NAVIGATION_TIMEOUT', 30000)
            });

            // Switch context to new page
            this.page = newPage;
            this.context.set('currentPage', newPage);

            ActionLogger.logSuccess('Opened in new tab', { 
                url: fullUrl,
                tabCount: this.context.pages().length
            });
        } catch (error) {
            ActionLogger.logError('Navigate to URL in new tab failed', error as Error);
            throw new Error(`Failed to navigate to ${url} in new tab: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user closes current tab')
    @CSBDDStepDef('I close current tab')
    async closeCurrentTab(): Promise<void> {
        ActionLogger.logStep('Close current tab');
        
        try {
            const pages = this.context.pages();
            
            if (pages.length <= 1) {
                throw new Error('Cannot close the last tab');
            }

            const currentPageIndex = pages.indexOf(this.page);
            await this.page.close();

            // Switch to previous tab
            const newIndex = currentPageIndex > 0 ? currentPageIndex - 1 : 0;
            this.page = pages[newIndex];
            this.context.set('currentPage', this.page);

            ActionLogger.logSuccess('Tab closed', { 
                remainingTabs: pages.length - 1
            });
        } catch (error) {
            ActionLogger.logError('Close tab failed', error as Error);
            throw error;
        }
    }

    @CSBDDStepDef('user switches to tab {int}')
    @CSBDDStepDef('I switch to tab {int}')
    async switchToTab(tabIndex: number): Promise<void> {
        ActionLogger.logStep('Switch to tab', { tabIndex });
        
        try {
            const pages = this.context.pages();
            const actualIndex = tabIndex - 1; // Convert to 0-based index
            
            if (actualIndex < 0 || actualIndex >= pages.length) {
                throw new Error(`Tab ${tabIndex} does not exist. Available tabs: 1-${pages.length}`);
            }

            this.page = pages[actualIndex];
            this.context.set('currentPage', this.page);
            await this.page.bringToFront();

            ActionLogger.logSuccess('Switched to tab', { 
                tabIndex,
                url: this.page.url()
            });
        } catch (error) {
            ActionLogger.logError('Switch tab failed', error as Error);
            throw error;
        }
    }

    private resolveUrl(url: string): string {
        // If URL is already absolute, return as is
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }

        // If URL starts with /, it's root-relative
        if (url.startsWith('/')) {
            return `${this.baseUrl}${url}`;
        }

        // Otherwise, append to base URL with /
        return `${this.baseUrl}/${url}`;
    }
}