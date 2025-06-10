// src/steps/ui/PopupSteps.ts
import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { PopupHandler } from '../../core/pages/PopupHandler';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';
import { CSWebElement } from '../../core/elements/CSWebElement';
import { CSGetElementOptions } from '../../core/elements/types/element.types';

export class PopupSteps extends CSBDDBaseStepDefinition {
   private popupHandler: PopupHandler | null = null;

   private getPopupHandler(): PopupHandler {
       if (!this.popupHandler) {
           this.popupHandler = new PopupHandler(this.page);
       }
       return this.popupHandler;
   }

   @CSBDDStepDef('user clicks {string} which opens popup')
   @CSBDDStepDef('I click {string} that opens a new window')
   async clickElementThatOpensPopup(elementDescription: string): Promise<void> {
       ActionLogger.logStep('Click element that opens popup', { element: elementDescription });
       
       try {
           const handler = this.getPopupHandler();
           const element = await this.findElement(elementDescription);
           
           const popup = await handler.waitForPopup(async () => {
               await element.click();
           });
           
           // Store popup reference
           this.context.set('lastPopup', popup);
           
           ActionLogger.logSuccess('Clicked element and popup opened', { 
               element: elementDescription,
               popupUrl: popup.url(),
               popupCount: handler.getPopupCount()
           });
       } catch (error) {
           ActionLogger.logError('Click with popup failed', error as Error);
           throw new Error(`Failed to click "${elementDescription}" and wait for popup: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user switches to popup window')
   @CSBDDStepDef('I switch to the popup')
   @CSBDDStepDef('user focuses on popup window')
   async switchToPopup(): Promise<void> {
       ActionLogger.logStep('Switch to popup window');
       
       try {
           const handler = this.getPopupHandler();
           const popups = handler.getPopups();
           
           if (popups.length === 0) {
               throw new Error('No popup windows found');
           }
           
           // Switch to the most recent popup
           const popup = await handler.switchToPopup(popups.length - 1);
           
           // Update page reference
           this.page = popup;
           this.context.set('currentPage', popup);
           
           ActionLogger.logSuccess('Switched to popup', { 
               url: popup.url(),
               title: await popup.title()
           });
       } catch (error) {
           ActionLogger.logError('Switch to popup failed', error as Error);
           throw new Error(`Failed to switch to popup: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user switches to popup window {int}')
   @CSBDDStepDef('I switch to popup number {int}')
   async switchToPopupByIndex(popupIndex: number): Promise<void> {
       ActionLogger.logStep('Switch to popup by index', { popupIndex });
       
       try {
           const handler = this.getPopupHandler();
           const popup = await handler.switchToPopup(popupIndex - 1); // Convert to 0-based
           
           // Update page reference
           this.page = popup;
           this.context.set('currentPage', popup);
           
           ActionLogger.logSuccess('Switched to popup', { 
               popupIndex,
               url: popup.url(),
               title: await popup.title()
           });
       } catch (error) {
           ActionLogger.logError('Switch to popup by index failed', error as Error);
           throw new Error(`Failed to switch to popup ${popupIndex}: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user switches to main window')
   @CSBDDStepDef('I switch back to main window')
   @CSBDDStepDef('user returns to parent window')
   async switchToMainWindow(): Promise<void> {
       ActionLogger.logStep('Switch to main window');
       
       try {
           const handler = this.getPopupHandler();
           const mainWindow = await handler.switchToMainWindow();
           
           // Update page reference
           this.page = mainWindow;
           this.context.set('currentPage', mainWindow);
           
           ActionLogger.logSuccess('Switched to main window', { 
               url: mainWindow.url(),
               title: await mainWindow.title()
           });
       } catch (error) {
           ActionLogger.logError('Switch to main window failed', error as Error);
           throw new Error(`Failed to switch to main window: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user closes current popup')
   @CSBDDStepDef('I close the popup')
   @CSBDDStepDef('user closes current window')
   async closeCurrentPopup(): Promise<void> {
       ActionLogger.logStep('Close current popup');
       
       try {
           const handler = this.getPopupHandler();
           const currentPage = handler.getCurrentPage();
           
           await handler.closePopup(currentPage);
           
           // Switch back to main window
           const mainWindow = await handler.switchToMainWindow();
           this.page = mainWindow;
           this.context.set('currentPage', mainWindow);
           
           ActionLogger.logSuccess('Popup closed', { 
               remainingPopups: handler.getPopupCount()
           });
       } catch (error) {
           ActionLogger.logError('Close popup failed', error as Error);
           throw new Error(`Failed to close popup: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user closes all popups')
   @CSBDDStepDef('I close all popup windows')
   async closeAllPopups(): Promise<void> {
       ActionLogger.logStep('Close all popups');
       
       try {
           const handler = this.getPopupHandler();
           const popupCount = handler.getPopupCount();
           
           await handler.closeAllPopups();
           
           // Ensure we're on main window
           this.page = handler.getCurrentPage();
           this.context.set('currentPage', this.page);
           
           ActionLogger.logSuccess('All popups closed', { 
               closedCount: popupCount
           });
       } catch (error) {
           ActionLogger.logError('Close all popups failed', error as Error);
           throw new Error(`Failed to close all popups: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user handles alert dialog with {string}')
   @CSBDDStepDef('I {string} the alert')
   async handleAlert(action: string): Promise<void> {
       ActionLogger.logStep('Handle alert dialog', { action });
       
       try {
           const handler = this.getPopupHandler();
           const dialogAction = action.toLowerCase() === 'accept' ? 'accept' : 'dismiss';
           
           await handler.handleDialog('alert', dialogAction);
           
           // Trigger action that will show alert
           this.context.set('dialogHandled', true);
           
           ActionLogger.logSuccess('Alert handler registered', { action: dialogAction });
       } catch (error) {
           ActionLogger.logError('Handle alert failed', error as Error);
           throw new Error(`Failed to handle alert: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user handles confirm dialog with {string}')
   @CSBDDStepDef('I {string} the confirmation')
   async handleConfirm(action: string): Promise<void> {
       ActionLogger.logStep('Handle confirm dialog', { action });
       
       try {
           const handler = this.getPopupHandler();
           const dialogAction = action.toLowerCase() === 'accept' ? 'accept' : 'dismiss';
           
           await handler.handleDialog('confirm', dialogAction);
           
           this.context.set('dialogHandled', true);
           
           ActionLogger.logSuccess('Confirm handler registered', { action: dialogAction });
       } catch (error) {
           ActionLogger.logError('Handle confirm failed', error as Error);
           throw new Error(`Failed to handle confirm dialog: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user handles prompt dialog with {string} and enters {string}')
   @CSBDDStepDef('I {string} the prompt with text {string}')
   async handlePrompt(action: string, text: string): Promise<void> {
       ActionLogger.logStep('Handle prompt dialog', { action, text });
       
       try {
           const handler = this.getPopupHandler();
           const dialogAction = action.toLowerCase() === 'accept' ? 'accept' : 'dismiss';
           
           await handler.handleDialog('prompt', dialogAction, text);
           
           this.context.set('dialogHandled', true);
           
           ActionLogger.logSuccess('Prompt handler registered', { 
               action: dialogAction,
               text: text
           });
       } catch (error) {
           ActionLogger.logError('Handle prompt failed', error as Error);
           throw new Error(`Failed to handle prompt dialog: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('the number of popup windows should be {int}')
   @CSBDDStepDef('there should be {int} popup windows')
   async assertPopupCount(expectedCount: number): Promise<void> {
       ActionLogger.logStep('Assert popup count', { expectedCount });
       
       try {
           const handler = this.getPopupHandler();
           const actualCount = handler.getPopupCount();
           
           if (actualCount !== expectedCount) {
               throw new Error(`Popup count mismatch. Expected: ${expectedCount}, Actual: ${actualCount}`);
           }
           
           ActionLogger.logSuccess('Popup count assertion passed', { 
               expectedCount,
               actualCount 
           });
       } catch (error) {
           ActionLogger.logError('Popup count assertion failed', error as Error);
           throw error;
       }
   }

   @CSBDDStepDef('popup window should have title {string}')
   @CSBDDStepDef('the popup title should be {string}')
   async assertPopupTitle(expectedTitle: string): Promise<void> {
       ActionLogger.logStep('Assert popup title', { expectedTitle });
       
       try {
           const handler = this.getPopupHandler();
           const currentPage = handler.getCurrentPage();
           const actualTitle = await currentPage.title();
           
           if (actualTitle !== expectedTitle) {
               throw new Error(`Popup title mismatch. Expected: "${expectedTitle}", Actual: "${actualTitle}"`);
           }
           
           ActionLogger.logSuccess('Popup title assertion passed', { 
               expectedTitle,
               actualTitle 
           });
       } catch (error) {
           ActionLogger.logError('Popup title assertion failed', error as Error);
           throw error;
       }
   }

   @CSBDDStepDef('popup window URL should contain {string}')
   @CSBDDStepDef('the popup URL should contain {string}')
   async assertPopupURLContains(expectedText: string): Promise<void> {
       ActionLogger.logStep('Assert popup URL contains', { expectedText });
       
       try {
           const handler = this.getPopupHandler();
           const currentPage = handler.getCurrentPage();
           const actualURL = currentPage.url();
           
           if (!actualURL.includes(expectedText)) {
               throw new Error(`Popup URL does not contain "${expectedText}". Actual: "${actualURL}"`);
           }
           
           ActionLogger.logSuccess('Popup URL assertion passed', { 
               expectedText,
               actualURL 
           });
       } catch (error) {
           ActionLogger.logError('Popup URL assertion failed', error as Error);
           throw error;
       }
   }

   @CSBDDStepDef('user waits for popup to open')
   @CSBDDStepDef('I wait for a new window')
   async waitForPopup(): Promise<void> {
       ActionLogger.logStep('Wait for popup to open');
       
       try {
           const timeout = ConfigurationManager.getInt('POPUP_TIMEOUT', 10000);
           
           const popupPromise = this.page.context().waitForEvent('page', { timeout });
           const popup = await popupPromise;
           
           // Store popup reference
           this.context.set('lastPopup', popup);
           
           ActionLogger.logSuccess('Popup opened', { 
               url: popup.url(),
               title: await popup.title()
           });
       } catch (error) {
           ActionLogger.logError('Wait for popup failed', error as Error);
           throw new Error(`No popup opened within timeout: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user opens link {string} in new window')
   @CSBDDStepDef('I open {string} in a new window')
   async openLinkInNewWindow(elementDescription: string): Promise<void> {
       ActionLogger.logStep('Open link in new window', { element: elementDescription });
       
       try {
           const element = await this.findElement(elementDescription);
           
           // Get href attribute
           const href = await element.getAttribute('href');
           if (!href) {
               throw new Error('Element does not have href attribute');
           }
           
           // Open in new window
           const newPage = await this.context.newPage();
           await newPage.goto(href);
           
           // Register with popup handler
           const handler = this.getPopupHandler();
           handler.getPopups().push(newPage);
           
           ActionLogger.logSuccess('Link opened in new window', { 
               element: elementDescription,
               url: href
           });
       } catch (error) {
           ActionLogger.logError('Open link in new window failed', error as Error);
           throw new Error(`Failed to open "${elementDescription}" in new window: ${(error as Error).message}`);
       }
   }

   private async findElement(description: string): Promise<CSWebElement> {
       const storedElement = this.context.get<CSWebElement>(`element_${description}`);
       if (storedElement) {
           return storedElement;
       }

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

   // Cleanup method to be called after scenarios
   async cleanup(): Promise<void> {
       if (this.popupHandler) {
           try {
               await this.popupHandler.closeAllPopups();
           } catch (error) {
               ActionLogger.logWarning('Popup cleanup failed', { error: (error as Error).message });
           }
       }
   }
}