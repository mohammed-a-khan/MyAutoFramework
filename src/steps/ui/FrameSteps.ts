// src/steps/ui/FrameSteps.ts
import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { FrameHandler } from '../../core/pages/FrameHandler';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';

export class FrameSteps extends CSBDDBaseStepDefinition {
    private frameHandler: FrameHandler | null = null;

    private getFrameHandler(): FrameHandler {
        if (!this.frameHandler) {
            this.frameHandler = new FrameHandler(this.page);
        }
        return this.frameHandler;
    }

    @CSBDDStepDef('user switches to frame {string}')
    @CSBDDStepDef('I switch to frame {string}')
    @CSBDDStepDef('user enters frame {string}')
    async switchToFrame(frameIdentifier: string): Promise<void> {
        ActionLogger.logStep('Switch to frame', { frame: frameIdentifier });
        
        try {
            const handler = this.getFrameHandler();
            
            // Check if it's a number (frame index)
            const frameIndex = parseInt(frameIdentifier, 10);
            if (!isNaN(frameIndex)) {
                await handler.switchToFrame(frameIndex);
            } else {
                await handler.switchToFrame(frameIdentifier);
            }
            
            ActionLogger.logSuccess('Switched to frame', { frame: frameIdentifier });
        } catch (error) {
            ActionLogger.logError('Switch to frame failed', error as Error);
            throw new Error(`Failed to switch to frame "${frameIdentifier}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user switches to parent frame')
    @CSBDDStepDef('I switch to parent frame')
    @CSBDDStepDef('user exits current frame')
    async switchToParentFrame(): Promise<void> {
        ActionLogger.logStep('Switch to parent frame');
        
        try {
            const handler = this.getFrameHandler();
            await handler.switchToParentFrame();
            
            ActionLogger.logSuccess('Switched to parent frame');
        } catch (error) {
            ActionLogger.logError('Switch to parent frame failed', error as Error);
            throw new Error(`Failed to switch to parent frame: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user switches to main frame')
    @CSBDDStepDef('I switch to main frame')
    @CSBDDStepDef('user returns to main content')
    async switchToMainFrame(): Promise<void> {
        ActionLogger.logStep('Switch to main frame');
        
        try {
            const handler = this.getFrameHandler();
            await handler.switchToMainFrame();
            
            ActionLogger.logSuccess('Switched to main frame');
        } catch (error) {
            ActionLogger.logError('Switch to main frame failed', error as Error);
            throw new Error(`Failed to switch to main frame: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user waits for frame {string} to load')
    @CSBDDStepDef('I wait for frame {string} to be ready')
    async waitForFrame(frameIdentifier: string): Promise<void> {
        ActionLogger.logStep('Wait for frame', { frame: frameIdentifier });
        
        try {
            const handler = this.getFrameHandler();
            const timeout = ConfigurationManager.getInt('FRAME_LOAD_TIMEOUT', 30000);
            
            await handler.waitForFrame(frameIdentifier, { timeout });
            
            ActionLogger.logSuccess('Frame loaded', { frame: frameIdentifier });
        } catch (error) {
            ActionLogger.logError('Wait for frame failed', error as Error);
            throw new Error(`Frame "${frameIdentifier}" did not load within timeout: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('within frame {string}:')
    @CSBDDStepDef('inside frame {string}:')
    async executeWithinFrame(frameIdentifier: string): Promise<void> {
        // This step is handled by the BDD framework
        // It sets up context for subsequent steps to execute within the frame
        ActionLogger.logStep('Execute within frame context', { frame: frameIdentifier });
        
        try {
            await this.switchToFrame(frameIdentifier);
            
            // Store frame context for cleanup
            this.context.set('currentFrameContext', frameIdentifier);
            
            ActionLogger.logSuccess('Frame context established', { frame: frameIdentifier });
        } catch (error) {
            ActionLogger.logError('Frame context setup failed', error as Error);
            throw error;
        }
    }

    @CSBDDStepDef('the page should have {int} frames')
    @CSBDDStepDef('there should be {int} frames on the page')
    async assertFrameCount(expectedCount: number): Promise<void> {
        ActionLogger.logStep('Assert frame count', { expectedCount });
        
        try {
            const handler = this.getFrameHandler();
            const actualCount = handler.getFrameCount();
            
            if (actualCount !== expectedCount) {
                throw new Error(`Frame count mismatch. Expected: ${expectedCount}, Actual: ${actualCount}`);
            }
            
            ActionLogger.logSuccess('Frame count assertion passed', { 
                expectedCount,
                actualCount 
            });
        } catch (error) {
            ActionLogger.logError('Frame count assertion failed', error as Error);
            throw error;
        }
    }

    @CSBDDStepDef('frame {string} should exist')
    @CSBDDStepDef('the frame {string} should be present')
    async assertFrameExists(frameIdentifier: string): Promise<void> {
        ActionLogger.logStep('Assert frame exists', { frame: frameIdentifier });
        
        try {
            const handler = this.getFrameHandler();
            
            // Try to switch to frame to verify it exists
            await handler.executeInFrame(frameIdentifier, async (frame) => {
                // Just being in the frame confirms it exists
                return true;
            });
            
            ActionLogger.logSuccess('Frame exists', { frame: frameIdentifier });
        } catch (error) {
            ActionLogger.logError('Frame existence assertion failed', error as Error);
            throw new Error(`Frame "${frameIdentifier}" does not exist: ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user performs action in frame {string} and returns')
    @CSBDDStepDef('I temporarily switch to frame {string}')
    async executeInFrameTemporarily(frameIdentifier: string): Promise<void> {
        // This is a marker step that indicates the next action should be performed in a frame
        // then automatically return to the previous context
        ActionLogger.logStep('Setup temporary frame context', { frame: frameIdentifier });
        
        this.context.set('temporaryFrameContext', frameIdentifier);
        
        ActionLogger.logSuccess('Temporary frame context set', { frame: frameIdentifier });
    }

    @CSBDDStepDef('the current frame URL should contain {string}')
    async assertFrameURLContains(expectedText: string): Promise<void> {
        ActionLogger.logStep('Assert frame URL contains', { expectedText });
        
        try {
            const handler = this.getFrameHandler();
            const currentFrame = handler.getCurrentFrame();
            const url = currentFrame.url();
            
            if (!url.includes(expectedText)) {
                throw new Error(`Frame URL does not contain "${expectedText}". Actual: "${url}"`);
            }
            
            ActionLogger.logSuccess('Frame URL assertion passed', { 
                expectedText,
                actualUrl: url 
            });
        } catch (error) {
            ActionLogger.logError('Frame URL assertion failed', error as Error);
            throw error;
        }
    }

    @CSBDDStepDef('user switches to nested frame path {string}')
    @CSBDDStepDef('I navigate to nested frames {string}')
    async switchToNestedFrames(framePath: string): Promise<void> {
        ActionLogger.logStep('Switch to nested frames', { path: framePath });
        
        try {
            const handler = this.getFrameHandler();
            const frames = framePath.split('>').map(f => f.trim());
            
            // Start from main frame
            await handler.switchToMainFrame();
            
            // Navigate through each frame in the path
            for (const frame of frames) {
                await handler.switchToFrame(frame);
                ActionLogger.logInfo(`Entered frame: ${frame}`);
            }
            
            ActionLogger.logSuccess('Navigated to nested frames', { 
                path: framePath,
                depth: frames.length 
            });
        } catch (error) {
            ActionLogger.logError('Nested frame navigation failed', error as Error);
            throw new Error(`Failed to navigate nested frames "${framePath}": ${(error as Error).message}`);
        }
    }

    @CSBDDStepDef('user prints frame tree')
    @CSBDDStepDef('I display the frame structure')
    async printFrameTree(): Promise<void> {
        ActionLogger.logStep('Print frame tree');
        
        try {
            const handler = this.getFrameHandler();
            const frameTree = handler.getFrameTree();
            
            const treeString = this.formatFrameTree(frameTree);
            
            ActionLogger.logInfo('Frame tree structure:\n' + treeString);
            
            // Store for potential assertions
            this.context.set('frameTree', frameTree);
            
            ActionLogger.logSuccess('Frame tree printed');
        } catch (error) {
            ActionLogger.logError('Print frame tree failed', error as Error);
            throw new Error(`Failed to print frame tree: ${(error as Error).message}`);
        }
    }

    private formatFrameTree(tree: any, indent: string = ''): string {
        let result = `${indent}Frame: ${tree.name} (${tree.url})\n`;
        
        for (const child of tree.children) {
            result += this.formatFrameTree(child, indent + '  ');
        }
        
        return result;
    }

    // Cleanup method to be called after scenarios
    async cleanup(): Promise<void> {
        if (this.frameHandler) {
            try {
                await this.frameHandler.switchToMainFrame();
            } catch (error) {
                ActionLogger.logWarning('Frame cleanup failed', { error: (error as Error).message });
            }
        }
    }
}