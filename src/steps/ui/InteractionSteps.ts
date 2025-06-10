// src/steps/ui/InteractionSteps.ts
import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { CSWebElement } from '../../core/elements/CSWebElement';
import { CSGetElementOptions } from '../../core/elements/types/element.types';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';
import { DataTable } from '../../bdd/types/bdd.types';

export class InteractionSteps extends CSBDDBaseStepDefinition {
    
    @CSBDDStepDef('user clicks {string}')
    @CSBDDStepDef('I click {string}')
    @CSBDDStepDef('user clicks on {string}')
    async clickElement(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Click element', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.click();
            
            // Wait for any navigation or changes
            await this.waitForStability();
            
            ActionLogger.logSuccess('Element clicked', { element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Click failed', error as Error);
            throw new Error(`Failed to click "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user double clicks {string}')
    @CSBDDStepDef('I double click {string}')
    async doubleClickElement(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Double click element', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.doubleClick();
            
            await this.waitForStability();
            
            ActionLogger.logSuccess('Element double clicked', { element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Double click failed', error as Error);
            throw new Error(`Failed to double click "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user right clicks {string}')
    @CSBDDStepDef('I right click {string}')
    async rightClickElement(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Right click element', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.rightClick();
            
            await this.waitForStability();
            
            ActionLogger.logSuccess('Element right clicked', { element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Right click failed', error as Error);
            throw new Error(`Failed to right click "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user types {string} in {string}')
    @CSBDDStepDef('I type {string} in {string}')
    @CSBDDStepDef('user enters {string} in {string}')
    async typeInElement(text: string, elementDescription: string): Promise<void> {
        ActionLogger.logStep('Type in element', { 
            text: this.maskSensitiveData(text), 
            element: elementDescription 
        });
        
        try {
            const element = await this.findElement(elementDescription);
            
            // Clear existing text first if configured
            if (ConfigurationManager.getBoolean('CLEAR_BEFORE_TYPE', true)) {
                await element.clear();
            }
            
            await element.type(text, {
                delay: ConfigurationManager.getInt('TYPE_DELAY', 0)
            });
            
            ActionLogger.logSuccess('Text typed', { 
                element: elementDescription,
                textLength: text.length
            });
        } catch (error) {
            ActionLogger.logError('Type failed', error as Error);
            throw new Error(`Failed to type in "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user fills {string} with {string}')
    @CSBDDStepDef('I fill {string} with {string}')
    async fillElement(elementDescription: string, text: string): Promise<void> {
        ActionLogger.logStep('Fill element', { 
            element: elementDescription,
            text: this.maskSensitiveData(text)
        });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.fill(text);
            
            ActionLogger.logSuccess('Element filled', { 
                element: elementDescription,
                textLength: text.length
            });
        } catch (error) {
            ActionLogger.logError('Fill failed', error as Error);
            throw new Error(`Failed to fill "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user clears {string}')
    @CSBDDStepDef('I clear {string}')
    async clearElement(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Clear element', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.clear();
            
            ActionLogger.logSuccess('Element cleared', { element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Clear failed', error as Error);
            throw new Error(`Failed to clear "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user selects {string} from {string}')
    @CSBDDStepDef('I select {string} from {string}')
    @CSBDDStepDef('user chooses {string} from {string}')
    async selectOption(optionValue: string, elementDescription: string): Promise<void> {
        ActionLogger.logStep('Select option', { 
            option: optionValue,
            element: elementDescription 
        });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.selectOption(optionValue);
            
            ActionLogger.logSuccess('Option selected', { 
                option: optionValue,
                element: elementDescription 
            });
        } catch (error) {
            ActionLogger.logError('Select failed', error as Error);
            throw new Error(`Failed to select "${optionValue}" from "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user selects multiple options from {string}:')
    @CSBDDStepDef('I select multiple options from {string}:')
    async selectMultipleOptions(elementDescription: string, dataTable: DataTable): Promise<void> {
        ActionLogger.logStep('Select multiple options', { 
            element: elementDescription,
            optionCount: dataTable.raw().length 
        });
        
        try {
            const element = await this.findElement(elementDescription);
            const options = dataTable.raw().map(row => row[0]);
            
            await element.selectOption(options);
            
            ActionLogger.logSuccess('Multiple options selected', { 
                element: elementDescription,
                options 
            });
        } catch (error) {
            ActionLogger.logError('Multi-select failed', error as Error);
            throw new Error(`Failed to select multiple options from "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user checks {string}')
    @CSBDDStepDef('I check {string}')
    async checkElement(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Check element', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            
            // Only check if not already checked
            if (!await element.isChecked()) {
                await element.check();
                ActionLogger.logSuccess('Element checked', { element: elementDescription });
            } else {
                ActionLogger.logInfo('Element already checked', { element: elementDescription });
            }
        } catch (error) {
            ActionLogger.logError('Check failed', error as Error);
            throw new Error(`Failed to check "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user unchecks {string}')
    @CSBDDStepDef('I uncheck {string}')
    async uncheckElement(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Uncheck element', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            
            // Only uncheck if already checked
            if (await element.isChecked()) {
                await element.uncheck();
                ActionLogger.logSuccess('Element unchecked', { element: elementDescription });
            } else {
                ActionLogger.logInfo('Element already unchecked', { element: elementDescription });
            }
        } catch (error) {
            ActionLogger.logError('Uncheck failed', error as Error);
            throw new Error(`Failed to uncheck "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user hovers over {string}')
    @CSBDDStepDef('I hover over {string}')
    @CSBDDStepDef('user moves mouse over {string}')
    async hoverElement(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Hover over element', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.hover();
            
            // Wait for any hover effects
            await this.page.waitForTimeout(ConfigurationManager.getInt('HOVER_DELAY', 100));
            
            ActionLogger.logSuccess('Element hovered', { element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Hover failed', error as Error);
            throw new Error(`Failed to hover over "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user focuses on {string}')
    @CSBDDStepDef('I focus on {string}')
    async focusElement(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Focus element', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.focus();
            
            ActionLogger.logSuccess('Element focused', { element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Focus failed', error as Error);
            throw new Error(`Failed to focus "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user blurs {string}')
    @CSBDDStepDef('I blur {string}')
    async blurElement(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Blur element', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.blur();
            
            ActionLogger.logSuccess('Element blurred', { element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Blur failed', error as Error);
            throw new Error(`Failed to blur "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user presses {string} key')
    @CSBDDStepDef('I press {string} key')
    @CSBDDStepDef('user presses {string}')
    async pressKey(key: string): Promise<void> {
        ActionLogger.logStep('Press key', { key });
        
        try {
            await this.page.keyboard.press(key);
            
            ActionLogger.logSuccess('Key pressed', { key });
        } catch (error) {
            ActionLogger.logError('Key press failed', error as Error);
            throw new Error(`Failed to press key "${key}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user presses {string} key in {string}')
    @CSBDDStepDef('I press {string} key in {string}')
    async pressKeyInElement(key: string, elementDescription: string): Promise<void> {
        ActionLogger.logStep('Press key in element', { key, element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.press(key);
            
            ActionLogger.logSuccess('Key pressed in element', { key, element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Key press in element failed', error as Error);
            throw new Error(`Failed to press "${key}" in "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user uploads file {string} to {string}')
    @CSBDDStepDef('I upload file {string} to {string}')
    async uploadFile(filePath: string, elementDescription: string): Promise<void> {
        ActionLogger.logStep('Upload file', { 
            file: filePath,
            element: elementDescription 
        });
        
        try {
            const element = await this.findElement(elementDescription);
            
            // Resolve file path relative to test data directory if not absolute
            const resolvedPath = this.resolveFilePath(filePath);
            
            await element.upload(resolvedPath);
            
            ActionLogger.logSuccess('File uploaded', { 
                file: resolvedPath,
                element: elementDescription 
            });
        } catch (error) {
            ActionLogger.logError('Upload failed', error as Error);
            throw new Error(`Failed to upload file to "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user uploads multiple files to {string}:')
    @CSBDDStepDef('I upload multiple files to {string}:')
    async uploadMultipleFiles(elementDescription: string, dataTable: DataTable): Promise<void> {
        ActionLogger.logStep('Upload multiple files', { 
            element: elementDescription,
            fileCount: dataTable.raw().length 
        });
        
        try {
            const element = await this.findElement(elementDescription);
            const filePaths = dataTable.raw().map(row => this.resolveFilePath(row[0]));
            
            await element.upload(filePaths);
            
            ActionLogger.logSuccess('Multiple files uploaded', { 
                element: elementDescription,
                files: filePaths 
            });
        } catch (error) {
            ActionLogger.logError('Multi-upload failed', error as Error);
            throw new Error(`Failed to upload multiple files to "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user scrolls to {string}')
    @CSBDDStepDef('I scroll to {string}')
    async scrollToElement(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Scroll to element', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.scrollIntoView();
            
            // Wait for scroll animation
            await this.page.waitForTimeout(ConfigurationManager.getInt('SCROLL_DELAY', 300));
            
            ActionLogger.logSuccess('Scrolled to element', { element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Scroll failed', error as Error);
            throw new Error(`Failed to scroll to "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user selects all text in {string}')
    @CSBDDStepDef('I select all text in {string}')
    async selectAllText(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Select all text', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.selectText();
            
            ActionLogger.logSuccess('Text selected', { element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Select text failed', error as Error);
            throw new Error(`Failed to select text in "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user waits for {string} to be visible')
    @CSBDDStepDef('I wait for {string} to be visible')
    async waitForVisible(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Wait for element visible', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.waitFor({ 
                state: 'visible',
                timeout: ConfigurationManager.getInt('ELEMENT_TIMEOUT', 30000)
            });
            
            ActionLogger.logSuccess('Element is visible', { element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Wait for visible failed', error as Error);
            throw new Error(`Element "${elementDescription}" did not become visible: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user waits for {string} to be hidden')
    @CSBDDStepDef('I wait for {string} to be hidden')
    async waitForHidden(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Wait for element hidden', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.waitFor({ 
                state: 'hidden',
                timeout: ConfigurationManager.getInt('ELEMENT_TIMEOUT', 30000)
            });
            
            ActionLogger.logSuccess('Element is hidden', { element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Wait for hidden failed', error as Error);
            throw new Error(`Element "${elementDescription}" did not become hidden: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user waits for {string} to be enabled')
    @CSBDDStepDef('I wait for {string} to be enabled')
    async waitForEnabled(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Wait for element enabled', { element: elementDescription });
        
        try {
            const timeout = ConfigurationManager.getInt('ELEMENT_TIMEOUT', 30000);
            const element = await this.findElement(elementDescription);
            
            await this.page.waitForFunction(
                async (el) => {
                    const element = el as any;
                    return await element.isEnabled();
                },
                element,
                { timeout }
            );
            
            ActionLogger.logSuccess('Element is enabled', { element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Wait for enabled failed', error as Error);
            throw new Error(`Element "${elementDescription}" did not become enabled: ${(error as Error).message}`);
        }
    }

    private async findElement(description: string): Promise<CSWebElement> {
        // Check if it's a stored element reference
        const storedElement = this.context.get<CSWebElement>(`element_${description}`);
        if (storedElement) {
            return storedElement;
        }

        // Create element with AI-enabled options
        const options: CSGetElementOptions = {
            description,
            locatorType: 'text',
            locatorValue: description,
            aiEnabled: ConfigurationManager.getBoolean('AI_ENABLED', true),
            aiDescription: description,
            waitForVisible: ConfigurationManager.getBoolean('AUTO_WAIT_VISIBLE', true)
        };

        const element = new CSWebElement();
        element.page = this.page;
        element.options = options;
        element.description = description;

        return element;
    }

    private async waitForStability(): Promise<void> {
        const stabilityDelay = ConfigurationManager.getInt('POST_ACTION_DELAY', 100);
        if (stabilityDelay > 0) {
            await this.page.waitForTimeout(stabilityDelay);
        }
    }

    private maskSensitiveData(text: string): string {
        const sensitivePatterns = ConfigurationManager.getArray('SENSITIVE_DATA_PATTERNS', []);
        let maskedText = text;
        
        for (const pattern of sensitivePatterns) {
            const regex = new RegExp(pattern, 'gi');
            maskedText = maskedText.replace(regex, '***');
        }
        
        return maskedText;
    }

    private resolveFilePath(filePath: string): string {
        const path = require('path');
        
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        
        const testDataDir = ConfigurationManager.get('TEST_DATA_DIR', './test-data');
        return path.resolve(testDataDir, filePath);
    }
}