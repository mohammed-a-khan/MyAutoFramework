// src/steps/ui/AdvancedInteractionSteps.ts
import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { CSWebElement } from '../../core/elements/CSWebElement';
import { CSGetElementOptions } from '../../core/elements/types/element.types';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';
import { DragDropHandler } from '../../core/interactions/DragDropHandler';
import { MouseHandler } from '../../core/interactions/MouseHandler';
import { TouchHandler } from '../../core/interactions/TouchHandler';
import { KeyboardHandler } from '../../core/interactions/KeyboardHandler';

export class AdvancedInteractionSteps extends CSBDDBaseStepDefinition {
    private dragDropHandler: DragDropHandler;
    private mouseHandler: MouseHandler;
    private touchHandler: TouchHandler;
    private keyboardHandler: KeyboardHandler;

    constructor() {
        super();
        this.dragDropHandler = new DragDropHandler();
        this.mouseHandler = new MouseHandler();
        this.touchHandler = new TouchHandler();
        this.keyboardHandler = new KeyboardHandler();
    }

    @CSBDDStepDef('user drags {string} to {string}')
    @CSBDDStepDef('I drag {string} to {string}')
    @CSBDDStepDef('user drags and drops {string} on {string}')
    async dragAndDrop(sourceDescription: string, targetDescription: string): Promise<void> {
        ActionLogger.logStep('Drag and drop', { 
            source: sourceDescription,
            target: targetDescription 
        });
        
        try {
            const sourceElement = await this.findElement(sourceDescription);
            const targetElement = await this.findElement(targetDescription);
            
            await this.dragDropHandler.dragAndDrop(sourceElement, targetElement, {
                steps: ConfigurationManager.getInt('DRAG_STEPS', 10),
                delay: ConfigurationManager.getInt('DRAG_DELAY', 0)
            });
            
            ActionLogger.logSuccess('Drag and drop completed', { 
                source: sourceDescription,
                target: targetDescription 
            });
        } catch (error) {
            ActionLogger.logError('Drag and drop failed', error as Error);
            throw new Error(`Failed to drag "${sourceDescription}" to "${targetDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user drags {string} by offset {int},{int}')
    @CSBDDStepDef('I drag {string} by {int} pixels horizontally and {int} pixels vertically')
    async dragByOffset(elementDescription: string, offsetX: number, offsetY: number): Promise<void> {
        ActionLogger.logStep('Drag by offset', { 
            element: elementDescription,
            offsetX,
            offsetY 
        });
        
        try {
            const element = await this.findElement(elementDescription);
            
            await this.dragDropHandler.dragByOffset(element, offsetX, offsetY);
            
            ActionLogger.logSuccess('Drag by offset completed', { 
                element: elementDescription,
                offset: { x: offsetX, y: offsetY }
            });
        } catch (error) {
            ActionLogger.logError('Drag by offset failed', error as Error);
            throw new Error(`Failed to drag "${elementDescription}" by offset: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user triple clicks {string}')
    @CSBDDStepDef('I triple click {string}')
    async tripleClick(elementDescription: string): Promise<void> {
        ActionLogger.logStep('Triple click', { element: elementDescription });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.tripleClick();
            
            ActionLogger.logSuccess('Triple click completed', { element: elementDescription });
        } catch (error) {
            ActionLogger.logError('Triple click failed', error as Error);
            throw new Error(`Failed to triple click "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user clicks {string} while holding {string}')
    @CSBDDStepDef('I click {string} with {string} key pressed')
    async clickWithModifier(elementDescription: string, modifier: string): Promise<void> {
        ActionLogger.logStep('Click with modifier', { 
            element: elementDescription,
            modifier 
        });
        
        try {
            const element = await this.findElement(elementDescription);
            const modifiers = this.parseModifiers(modifier);
            
            await element.click({ modifiers });
            
            ActionLogger.logSuccess('Click with modifier completed', { 
                element: elementDescription,
                modifiers 
            });
        } catch (error) {
            ActionLogger.logError('Click with modifier failed', error as Error);
            throw new Error(`Failed to click "${elementDescription}" with ${modifier}: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user performs mouse wheel on {string} with delta {int},{int}')
    @CSBDDStepDef('I scroll mouse wheel on {string} by {int} horizontally and {int} vertically')
    async mouseWheel(elementDescription: string, deltaX: number, deltaY: number): Promise<void> {
        ActionLogger.logStep('Mouse wheel', { 
            element: elementDescription,
            deltaX,
            deltaY 
        });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.mouseWheel(deltaX, deltaY);
            
            ActionLogger.logSuccess('Mouse wheel completed', { 
                element: elementDescription,
                delta: { x: deltaX, y: deltaY }
            });
        } catch (error) {
            ActionLogger.logError('Mouse wheel failed', error as Error);
            throw new Error(`Failed to perform mouse wheel on "${elementDescription}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user swipes {string} {string}')
    @CSBDDStepDef('I swipe {string} in {string} direction')
    async swipe(elementDescription: string, direction: string): Promise<void> {
        ActionLogger.logStep('Swipe', { 
            element: elementDescription,
            direction 
        });
        
        try {
            const element = await this.findElement(elementDescription);
            const swipeDirection = direction.toLowerCase() as 'up' | 'down' | 'left' | 'right';
            const distance = ConfigurationManager.getInt('SWIPE_DISTANCE', 100);
            
            await this.touchHandler.swipe(element, swipeDirection, distance);
            
            ActionLogger.logSuccess('Swipe completed', { 
                element: elementDescription,
                direction: swipeDirection,
                distance 
            });
        } catch (error) {
            ActionLogger.logError('Swipe failed', error as Error);
            throw new Error(`Failed to swipe "${elementDescription}" ${direction}: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user pinches {string} with scale {float}')
    @CSBDDStepDef('I pinch {string} to {float} scale')
    async pinch(elementDescription: string, scale: number): Promise<void> {
        ActionLogger.logStep('Pinch', { 
            element: elementDescription,
            scale 
        });
        
        try {
            const element = await this.findElement(elementDescription);
            await element.pinch(scale);
           
           ActionLogger.logSuccess('Pinch completed', { 
               element: elementDescription,
               scale 
           });
       } catch (error) {
           ActionLogger.logError('Pinch failed', error as Error);
           throw new Error(`Failed to pinch "${elementDescription}": ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user taps {string}')
   @CSBDDStepDef('I tap {string}')
   async tap(elementDescription: string): Promise<void> {
       ActionLogger.logStep('Tap', { element: elementDescription });
       
       try {
           const element = await this.findElement(elementDescription);
           await element.tap();
           
           ActionLogger.logSuccess('Tap completed', { element: elementDescription });
       } catch (error) {
           ActionLogger.logError('Tap failed', error as Error);
           throw new Error(`Failed to tap "${elementDescription}": ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user double taps {string}')
   @CSBDDStepDef('I double tap {string}')
   async doubleTap(elementDescription: string): Promise<void> {
       ActionLogger.logStep('Double tap', { element: elementDescription });
       
       try {
           const element = await this.findElement(elementDescription);
           await this.touchHandler.doubleTap(element);
           
           ActionLogger.logSuccess('Double tap completed', { element: elementDescription });
       } catch (error) {
           ActionLogger.logError('Double tap failed', error as Error);
           throw new Error(`Failed to double tap "${elementDescription}": ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user long presses {string} for {int} milliseconds')
   @CSBDDStepDef('I long press {string} for {int} ms')
   async longPress(elementDescription: string, duration: number): Promise<void> {
       ActionLogger.logStep('Long press', { 
           element: elementDescription,
           duration 
       });
       
       try {
           const element = await this.findElement(elementDescription);
           await this.touchHandler.longPress(element, duration);
           
           ActionLogger.logSuccess('Long press completed', { 
               element: elementDescription,
               duration 
           });
       } catch (error) {
           ActionLogger.logError('Long press failed', error as Error);
           throw new Error(`Failed to long press "${elementDescription}": ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user rotates {string} by {int} degrees')
   @CSBDDStepDef('I rotate {string} {int} degrees')
   async rotate(elementDescription: string, degrees: number): Promise<void> {
       ActionLogger.logStep('Rotate', { 
           element: elementDescription,
           degrees 
       });
       
       try {
           const element = await this.findElement(elementDescription);
           await this.touchHandler.rotate(element, degrees);
           
           ActionLogger.logSuccess('Rotate completed', { 
               element: elementDescription,
               degrees 
           });
       } catch (error) {
           ActionLogger.logError('Rotate failed', error as Error);
           throw new Error(`Failed to rotate "${elementDescription}": ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user scrolls {string} to top')
   @CSBDDStepDef('I scroll {string} to the top')
   async scrollToTop(elementDescription: string): Promise<void> {
       ActionLogger.logStep('Scroll to top', { element: elementDescription });
       
       try {
           const element = await this.findElement(elementDescription);
           await this.page.evaluate((el) => {
               (el as HTMLElement).scrollTop = 0;
           }, await element.elementHandle());
           
           ActionLogger.logSuccess('Scrolled to top', { element: elementDescription });
       } catch (error) {
           ActionLogger.logError('Scroll to top failed', error as Error);
           throw new Error(`Failed to scroll "${elementDescription}" to top: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user scrolls {string} to bottom')
   @CSBDDStepDef('I scroll {string} to the bottom')
   async scrollToBottom(elementDescription: string): Promise<void> {
       ActionLogger.logStep('Scroll to bottom', { element: elementDescription });
       
       try {
           const element = await this.findElement(elementDescription);
           await this.page.evaluate((el) => {
               const htmlElement = el as HTMLElement;
               htmlElement.scrollTop = htmlElement.scrollHeight;
           }, await element.elementHandle());
           
           ActionLogger.logSuccess('Scrolled to bottom', { element: elementDescription });
       } catch (error) {
           ActionLogger.logError('Scroll to bottom failed', error as Error);
           throw new Error(`Failed to scroll "${elementDescription}" to bottom: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user scrolls page by {int} pixels')
   @CSBDDStepDef('I scroll the page by {int} pixels')
   async scrollPageBy(pixels: number): Promise<void> {
       ActionLogger.logStep('Scroll page by pixels', { pixels });
       
       try {
           await this.page.evaluate((scrollAmount) => {
               window.scrollBy(0, scrollAmount);
           }, pixels);
           
           // Wait for scroll to complete
           await this.page.waitForTimeout(ConfigurationManager.getInt('SCROLL_DELAY', 300));
           
           ActionLogger.logSuccess('Page scrolled', { pixels });
       } catch (error) {
           ActionLogger.logError('Page scroll failed', error as Error);
           throw new Error(`Failed to scroll page by ${pixels} pixels: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user draws on {string} from {int},{int} to {int},{int}')
   @CSBDDStepDef('I draw on {string} from point {int},{int} to point {int},{int}')
   async drawOnCanvas(elementDescription: string, startX: number, startY: number, endX: number, endY: number): Promise<void> {
       ActionLogger.logStep('Draw on canvas', { 
           element: elementDescription,
           start: { x: startX, y: startY },
           end: { x: endX, y: endY }
       });
       
       try {
           const element = await this.findElement(elementDescription);
           const box = await element.getBoundingBox();
           
           if (!box) {
               throw new Error('Element bounding box not found');
           }
           
           const absoluteStartX = box.x + startX;
           const absoluteStartY = box.y + startY;
           const absoluteEndX = box.x + endX;
           const absoluteEndY = box.y + endY;
           
           // Create path for drawing
           const path = await this.mouseHandler.createMousePath(
               { x: absoluteStartX, y: absoluteStartY },
               { x: absoluteEndX, y: absoluteEndY },
               ConfigurationManager.getInt('DRAW_STEPS', 20)
           );
           
           await this.mouseHandler.drawOnCanvas(this.page, path);
           
           ActionLogger.logSuccess('Drawing completed', { 
               element: elementDescription,
               pathLength: path.length 
           });
       } catch (error) {
           ActionLogger.logError('Drawing failed', error as Error);
           throw new Error(`Failed to draw on "${elementDescription}": ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user performs key combination {string}')
   @CSBDDStepDef('I press key combination {string}')
   async pressKeyCombo(keyCombo: string): Promise<void> {
       ActionLogger.logStep('Press key combination', { keyCombo });
       
       try {
           await this.keyboardHandler.pressKeyCombo(this.page, keyCombo);
           
           ActionLogger.logSuccess('Key combination pressed', { keyCombo });
       } catch (error) {
           ActionLogger.logError('Key combination failed', error as Error);
           throw new Error(`Failed to press key combination "${keyCombo}": ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user types naturally {string} in {string}')
   @CSBDDStepDef('I type {string} naturally in {string}')
   async typeNaturally(text: string, elementDescription: string): Promise<void> {
       ActionLogger.logStep('Type naturally', { 
           text: this.maskSensitiveData(text),
           element: elementDescription 
       });
       
       try {
           const element = await this.findElement(elementDescription);
           await this.keyboardHandler.typeNaturally(element, text);
           
           ActionLogger.logSuccess('Natural typing completed', { 
               element: elementDescription,
               textLength: text.length 
           });
       } catch (error) {
           ActionLogger.logError('Natural typing failed', error as Error);
           throw new Error(`Failed to type naturally in "${elementDescription}": ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user selects all')
   @CSBDDStepDef('I select all')
   async selectAll(): Promise<void> {
       ActionLogger.logStep('Select all');
       
       try {
           await this.keyboardHandler.selectAll(this.page);
           
           ActionLogger.logSuccess('Select all completed');
       } catch (error) {
           ActionLogger.logError('Select all failed', error as Error);
           throw new Error(`Failed to select all: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user copies selection')
   @CSBDDStepDef('I copy')
   async copy(): Promise<void> {
       ActionLogger.logStep('Copy');
       
       try {
           await this.keyboardHandler.copy(this.page);
           
           ActionLogger.logSuccess('Copy completed');
       } catch (error) {
           ActionLogger.logError('Copy failed', error as Error);
           throw new Error(`Failed to copy: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user pastes')
   @CSBDDStepDef('I paste')
   async paste(): Promise<void> {
       ActionLogger.logStep('Paste');
       
       try {
           await this.keyboardHandler.paste(this.page);
           
           ActionLogger.logSuccess('Paste completed');
       } catch (error) {
           ActionLogger.logError('Paste failed', error as Error);
           throw new Error(`Failed to paste: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user cuts selection')
   @CSBDDStepDef('I cut')
   async cut(): Promise<void> {
       ActionLogger.logStep('Cut');
       
       try {
           await this.keyboardHandler.cut(this.page);
           
           ActionLogger.logSuccess('Cut completed');
       } catch (error) {
           ActionLogger.logError('Cut failed', error as Error);
           throw new Error(`Failed to cut: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user performs undo')
   @CSBDDStepDef('I undo')
   async undo(): Promise<void> {
       ActionLogger.logStep('Undo');
       
       try {
           await this.keyboardHandler.undo(this.page);
           
           ActionLogger.logSuccess('Undo completed');
       } catch (error) {
           ActionLogger.logError('Undo failed', error as Error);
           throw new Error(`Failed to undo: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user performs redo')
   @CSBDDStepDef('I redo')
   async redo(): Promise<void> {
       ActionLogger.logStep('Redo');
       
       try {
           await this.keyboardHandler.redo(this.page);
           
           ActionLogger.logSuccess('Redo completed');
       } catch (error) {
           ActionLogger.logError('Redo failed', error as Error);
           throw new Error(`Failed to redo: ${(error as Error).message}`);
       }
   }

   @CSBDDStepDef('user simulates human-like mouse movement from {string} to {string}')
   @CSBDDStepDef('I move mouse naturally from {string} to {string}')
   async humanMouseMove(fromElement: string, toElement: string): Promise<void> {
       ActionLogger.logStep('Human-like mouse movement', { 
           from: fromElement,
           to: toElement 
       });
       
       try {
           const fromEl = await this.findElement(fromElement);
           const toEl = await this.findElement(toElement);
           
           const fromBox = await fromEl.getBoundingBox();
           const toBox = await toEl.getBoundingBox();
           
           if (!fromBox || !toBox) {
               throw new Error('Element bounding box not found');
           }
           
           await this.mouseHandler.simulateHumanMovement(
               this.page,
               { x: fromBox.x + fromBox.width / 2, y: fromBox.y + fromBox.height / 2 },
               { x: toBox.x + toBox.width / 2, y: toBox.y + toBox.height / 2 }
           );
           
           ActionLogger.logSuccess('Human-like mouse movement completed');
       } catch (error) {
           ActionLogger.logError('Human mouse movement failed', error as Error);
           throw new Error(`Failed to move mouse naturally: ${(error as Error).message}`);
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

   private parseModifiers(modifierString: string): Array<'Alt' | 'Control' | 'Meta' | 'Shift'> {
       const modifiers: Array<'Alt' | 'Control' | 'Meta' | 'Shift'> = [];
       const lowerModifier = modifierString.toLowerCase();
       
       if (lowerModifier.includes('alt')) modifiers.push('Alt');
       if (lowerModifier.includes('ctrl') || lowerModifier.includes('control')) modifiers.push('Control');
       if (lowerModifier.includes('cmd') || lowerModifier.includes('meta') || lowerModifier.includes('command')) modifiers.push('Meta');
       if (lowerModifier.includes('shift')) modifiers.push('Shift');
       
       return modifiers;
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
}