// src/core/ai/healing/HealingStrategies.ts

import { Locator, Page, ElementHandle } from 'playwright';
import { AIElementIdentifier } from '../engine/AIElementIdentifier';
import { SimilarityCalculator } from '../engine/SimilarityCalculator';
import { ElementFeatureExtractor } from '../engine/ElementFeatureExtractor';
import { CSWebElement } from '../../elements/CSWebElement';
import { ElementFeatures } from '../types/ai.types';
import { logger } from '../../utils/Logger';
import { ActionLogger } from '../../logging/ActionLogger';

// BoundingBox interface - matches Playwright's internal type
interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Base class for all healing strategies
 */
export abstract class HealingStrategy {
    protected readonly name: string;
    protected readonly confidenceThreshold: number = 0.7;
    
    constructor(name: string) {
        this.name = name;
    }
    
    /**
     * Attempt to heal the broken element
     */
    abstract heal(element: CSWebElement, page: Page): Promise<HealingResult | null>;
    
    /**
     * Calculate confidence score for the healed element
     */
    abstract calculateConfidence(original: ElementFeatures, healed: ElementFeatures): number;
    
    /**
     * Get last known features for element (from cache or metadata)
     */
    protected async getLastKnownFeatures(element: CSWebElement): Promise<ElementFeatures | null> {
        try {
            // Try to get current element and extract features
            const elementHandle = await element.elementHandle();
            if (elementHandle) {
                const extractor = new ElementFeatureExtractor();
                return await extractor.extractFeatures(elementHandle);
            }
        } catch (error) {
            logger.debug('Could not extract current features for healing');
        }
        return null;
    }
    
    /**
     * Get last known position for element (from cache or metadata)
     */
    protected async getLastKnownPosition(element: CSWebElement): Promise<BoundingBox | null> {
        try {
            // Try to get current element position
            const elementHandle = await element.elementHandle();
            if (elementHandle) {
                return await elementHandle.boundingBox();
            }
        } catch (error) {
            logger.debug('Could not get current position for healing');
        }
        return null;
    }
    
    /**
     * Get strategy name
     */
    getName(): string {
        return this.name;
    }
    
    /**
     * Validate healed element matches expected behavior
     */
    protected async validateHealedElement(
        original: CSWebElement,
        healedLocator: Locator
    ): Promise<boolean> {
        try {
            // Check if element exists
            const count = await healedLocator.count();
            if (count === 0) return false;
            
            // For strict mode, ensure only one element
            if (original.options.strict && count > 1) return false;
            
            // Check visibility if required
            if (original.options.waitForVisible) {
                const isVisible = await healedLocator.isVisible();
                if (!isVisible) return false;
            }
            
            // Check enabled state if required
            if (original.options.waitForEnabled) {
                const isEnabled = await healedLocator.isEnabled();
                if (!isEnabled) return false;
            }
            
            return true;
        } catch (error) {
            logger.error(`Validation failed for healed element: ${(error as Error).message}`);
            return false;
        }
    }
}

/**
 * Strategy 1: Find element near original position
 */
export class NearbyElementStrategy extends HealingStrategy {
    private readonly maxDistance: number = 100; // pixels
    private readonly featureExtractor: ElementFeatureExtractor;
    private readonly similarityCalculator: SimilarityCalculator;
    
    constructor() {
        super('NearbyElement');
        this.featureExtractor = new ElementFeatureExtractor();
        this.similarityCalculator = new SimilarityCalculator();
    }
    
    async heal(element: CSWebElement, page: Page): Promise<HealingResult | null> {
        ActionLogger.logInfo(`Healing attempt: ${this.name}`, {
            strategy: this.name,
            element: element.description,
            type: 'healing_attempt'
        });
        
        try {
            // Get last known position from snapshot
            const originalPos = await this.getLastKnownPosition(element);
            if (!originalPos) {
                logger.debug('No position snapshot available for nearby healing');
                return null;
            }
            
            // Find all elements of similar type near the original position
            const candidates = await this.findNearbyCandidates(
                page,
                originalPos,
                element.options.locatorType
            );
            
            if (candidates.length === 0) {
                logger.debug('No nearby candidates found');
                return null;
            }
            
            // Score each candidate based on similarity and distance
            const originalFeatures = await this.getLastKnownFeatures(element);
            if (!originalFeatures) {
                logger.debug('No original features available for scoring');
                return null;
            }
            
            const scoredCandidates = await this.scoreCandidates(
                candidates,
                originalPos,
                originalFeatures
            );
            
            // Get best match
            const best = scoredCandidates[0];
            if (!best || best.score < this.confidenceThreshold) {
                logger.debug(`Best nearby candidate score ${best?.score || 0} below threshold`);
                return null;
            }
            
            // Create locator for the healed element
            const healedLocator = await this.createLocatorForElement(page, best.element);
            
            // Validate the healed element
            if (!await this.validateHealedElement(element, healedLocator)) {
                logger.debug('Healed element validation failed');
                return null;
            }
            
            ActionLogger.logInfo(`Healing success: ${this.name}`, {
                strategy: this.name,
                element: element.description,
                score: best?.score || 0,
                type: 'healing_success'
            });
            
            return {
                strategy: this.name,
                locator: healedLocator,
                confidence: best?.score || 0,
                selector: best?.selector || '',
                reason: `Found similar element ${Math.round(best?.distance || 0)}px from original position`
            };
            
        } catch (error) {
            logger.error(`Nearby healing failed: ${(error as Error).message}`);
            ActionLogger.logError(`Healing failed: ${this.name}`, error as Error);
            return null;
        }
    }
    
    private async findNearbyCandidates(
        page: Page,
        originalPos: BoundingBox,
        elementType: string
    ): Promise<ElementHandle[]> {
        // Get tag name based on element type
        const tagNames = this.getTagNamesForType(elementType);
        const selector = tagNames.join(', ');
        
        // Get all elements of similar type
        const allElements = await page.$$(selector);
        
        // Filter by distance
        const nearby: ElementHandle[] = [];
        
        for (const el of allElements) {
            const box = await el.boundingBox();
            if (!box) continue;
            
            const distance = this.calculateDistance(originalPos, box);
            if (distance <= this.maxDistance) {
                nearby.push(el);
            }
        }
        
        return nearby;
    }
    
    private async scoreCandidates(
        candidates: ElementHandle[],
        originalPos: BoundingBox,
        originalFeatures: ElementFeatures
    ): Promise<ScoredCandidate[]> {
        const scored: ScoredCandidate[] = [];
        
        for (const element of candidates) {
            try {
                const box = await element.boundingBox();
                if (!box) continue;
                
                // Extract features
                const features = await this.featureExtractor.extractFeatures(element);
                
                // Calculate distance score (closer is better)
                const distance = this.calculateDistance(originalPos, box);
                const distanceScore = 1 - (distance / this.maxDistance);
                
                // Calculate feature similarity
                const similarityScore = this.similarityCalculator.calculate(
                    originalFeatures,
                    features
                );
                
                // Combined score (weighted)
                const totalScore = (distanceScore * 0.3) + (similarityScore * 0.7);
                
                // Generate selector
                const selector = await this.generateSelector(element);
                
                scored.push({
                    element,
                    score: totalScore,
                    distance,
                    selector
                });
                
            } catch (error) {
                logger.debug(`Failed to score candidate: ${(error as Error).message}`);
            }
        }
        
        // Sort by score descending
        return scored.sort((a, b) => b.score - a.score);
    }
    
    private calculateDistance(pos1: BoundingBox, pos2: BoundingBox): number {
        const centerX1 = pos1.x + pos1.width / 2;
        const centerY1 = pos1.y + pos1.height / 2;
        const centerX2 = pos2.x + pos2.width / 2;
        const centerY2 = pos2.y + pos2.height / 2;
        
        return Math.sqrt(
            Math.pow(centerX2 - centerX1, 2) + 
            Math.pow(centerY2 - centerY1, 2)
        );
    }
    
    private getTagNamesForType(elementType: string): string[] {
        const typeMap: Record<string, string[]> = {
            'button': ['button', 'input[type="button"]', 'input[type="submit"]', '[role="button"]'],
            'link': ['a', '[role="link"]'],
            'input': ['input', 'textarea'],
            'select': ['select'],
            'checkbox': ['input[type="checkbox"]'],
            'radio': ['input[type="radio"]'],
            'image': ['img'],
            'text': ['p', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']
        };
        
        return typeMap[elementType] || ['*'];
    }
    
    private async createLocatorForElement(page: Page, element: ElementHandle): Promise<Locator> {
        const selector = await this.generateSelector(element);
        return page.locator(selector);
    }
    
    private async generateSelector(element: ElementHandle): Promise<string> {
        return await element.evaluate(el => {
            const elem = el as Element;
            // Try to generate a unique selector
            if (elem.id) return `#${elem.id}`;
            
            const tag = elem.tagName.toLowerCase();
            const classes = Array.from(elem.classList).filter((c: string) => c.length > 0);
            
            if (classes.length > 0) {
                return `${tag}.${classes.join('.')}`;
            }
            
            // Use nth-child as fallback
            const parent = el.parentElement;
            if (parent) {
                const index = Array.from(parent.children).indexOf(el as Element) + 1;
                return `${tag}:nth-child(${index})`;
            }
            
            return tag;
        });
    }
    
    calculateConfidence(original: ElementFeatures, healed: ElementFeatures): number {
        return this.similarityCalculator.calculate(original, healed);
    }
}

/**
 * Strategy 2: Find element with similar text content
 */
export class SimilarTextStrategy extends HealingStrategy {
    private readonly minTextSimilarity: number = 0.8;
    private readonly featureExtractor: ElementFeatureExtractor;
    private readonly similarityCalculator: SimilarityCalculator;
    
    constructor() {
        super('SimilarText');
        this.featureExtractor = new ElementFeatureExtractor();
        this.similarityCalculator = new SimilarityCalculator();
    }
    
    async heal(element: CSWebElement, page: Page): Promise<HealingResult | null> {
        ActionLogger.logInfo(`Healing attempt: ${this.name}`, {
            strategy: this.name,
            element: element.description,
            type: 'healing_attempt'
        });
        
        try {
            // Get original text from snapshot
            const originalFeatures = await this.getLastKnownFeatures(element);
            if (!originalFeatures?.text?.content) {
                logger.debug('No text content in snapshot for text-based healing');
                return null;
            }
            
            const originalText = originalFeatures.text.content;
            const originalType = element.options.locatorType;
            
            // Find elements with similar text
            const candidates = await this.findTextCandidates(
                page,
                originalText,
                originalType
            );
            
            if (candidates.length === 0) {
                logger.debug('No text candidates found');
                return null;
            }
            
            // Score candidates
            const scoredCandidates = await this.scoreCandidates(
                candidates,
                originalText,
                originalFeatures
            );
            
            // Get best match
            const best = scoredCandidates[0];
            if (!best || best.score < this.confidenceThreshold) {
                logger.debug(`Best text candidate score ${best?.score || 0} below threshold`);
                return null;
            }
            
            // Create locator
            const healedLocator = page.locator(best.selector);
            
            // Validate
            if (!await this.validateHealedElement(element, healedLocator)) {
                logger.debug('Text-healed element validation failed');
                return null;
            }
            
            ActionLogger.logInfo(`Healing success: ${this.name}`, {
                strategy: this.name,
                element: element.description,
                score: best.score,
                type: 'healing_success'
            });
            
            return {
                strategy: this.name,
                locator: healedLocator,
                confidence: best.score,
                selector: best.selector,
                reason: `Found element with ${Math.round((best as ScoredTextCandidate).textSimilarity * 100)}% text similarity`
            };
            
        } catch (error) {
            logger.error(`Text healing failed: ${(error as Error).message}`);
            ActionLogger.logError(`Healing failed: ${this.name}`, error as Error);
            return null;
        }
    }
    
    private async findTextCandidates(
        page: Page,
        originalText: string,
        elementType: string
    ): Promise<TextCandidate[]> {
        const candidates: TextCandidate[] = [];
        
        // Use XPath for text search
        const normalizedText = this.normalizeText(originalText);
        const words = normalizedText.split(/\s+/).filter(w => w.length > 2);
        
        if (words.length === 0) return candidates;
        
        // Get tag names for element type
        const tagNames = this.getTagNamesForType(elementType);
        
        // Search for elements containing key words
        for (const word of words.slice(0, 3)) { // Use first 3 significant words
            // Build XPath with tag name filter
            const tagFilter = tagNames.length === 1 && tagNames[0] !== '*' 
                ? tagNames[0] 
                : '*';
            const xpath = `//${tagFilter}[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${word.toLowerCase()}')]`;
            
            try {
                const elements = await page.$$(xpath);
                
                for (const element of elements) {
                    const text = await element.textContent();
                    if (!text) continue;
                    
                    const similarity = this.calculateTextSimilarity(originalText, text);
                    if (similarity >= this.minTextSimilarity) {
                        candidates.push({
                            element,
                            text: text.trim(),
                            similarity
                        });
                    }
                }
            } catch (error) {
                logger.debug(`XPath search failed for word '${word}': ${(error as Error).message}`);
            }
        }
        
        // Remove duplicates
        const unique = new Map<string, TextCandidate>();
        for (const candidate of candidates) {
            const key = candidate.text;
            if (!unique.has(key) || unique.get(key)!.similarity < candidate.similarity) {
                unique.set(key, candidate);
            }
        }
        
        return Array.from(unique.values());
    }
    
    private async scoreCandidates(
        candidates: TextCandidate[],
        _originalText: string,
        originalFeatures: ElementFeatures
    ): Promise<ScoredTextCandidate[]> {
        const scored: ScoredTextCandidate[] = [];
        
        for (const candidate of candidates) {
            try {
                // Extract full features
                const features = await this.featureExtractor.extractFeatures(candidate.element);
                
                // Calculate overall similarity
                const featureSimilarity = this.similarityCalculator.calculate(
                    originalFeatures,
                    features
                );
                
                // Combined score
                const totalScore = (candidate.similarity * 0.6) + (featureSimilarity * 0.4);
                
                // Generate selector
                const selector = await this.generateTextSelector(candidate.element, candidate.text);
                
                scored.push({
                    element: candidate.element,
                    score: totalScore,
                    textSimilarity: candidate.similarity,
                    selector
                });
                
            } catch (error) {
                logger.debug(`Failed to score text candidate: ${(error as Error).message}`);
            }
        }
        
        return scored.sort((a, b) => b.score - a.score);
    }
    
    private calculateTextSimilarity(text1: string, text2: string): number {
        const norm1 = this.normalizeText(text1);
        const norm2 = this.normalizeText(text2);
        
        // Levenshtein distance
        const distance = this.levenshteinDistance(norm1, norm2);
        const maxLength = Math.max(norm1.length, norm2.length);
        
        if (maxLength === 0) return 1;
        
        return 1 - (distance / maxLength);
    }
    
    private normalizeText(text: string): string {
        return text
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s]/g, '')
            .trim();
    }
    
    private levenshteinDistance(str1: string, str2: string): number {
        const m = str1.length;
        const n = str2.length;
        
        // Create and initialize matrix
        const matrix: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
        
        // Fill first row and column
        for (let i = 0; i <= n; i++) {
            matrix[i]![0] = i;
        }
        for (let j = 0; j <= m; j++) {
            matrix[0]![j] = j;
        }
        
        // Calculate distances
        for (let i = 1; i <= n; i++) {
            for (let j = 1; j <= m; j++) {
                const cost = str2.charAt(i - 1) === str1.charAt(j - 1) ? 0 : 1;
                
                const deletion = matrix[i - 1]![j]! + 1;
                const insertion = matrix[i]![j - 1]! + 1;
                const substitution = matrix[i - 1]![j - 1]! + cost;
                
                matrix[i]![j] = Math.min(deletion, insertion, substitution);
            }
        }
        
        return matrix[n]![m]!;
    }
    
    private getTagNamesForType(elementType: string): string[] {
        const typeMap: Record<string, string[]> = {
            'button': ['button', 'input[type="button"]', 'input[type="submit"]', '[role="button"]'],
            'link': ['a', '[role="link"]'],
            'input': ['input', 'textarea'],
            'select': ['select'],
            'checkbox': ['input[type="checkbox"]'],
            'radio': ['input[type="radio"]'],
            'image': ['img'],
            'text': ['p', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']
        };
        
        return typeMap[elementType] || ['*'];
    }
    
    private async generateTextSelector(element: ElementHandle, text: string): Promise<string> {
        return await element.evaluate((el, txt) => {
            const elem = el as Element;
            const tag = elem.tagName.toLowerCase();
            
            // Try to create a specific text selector
            if (txt.length < 50) {
                return `${tag}:has-text("${txt.replace(/"/g, '\\"')}")`;
            }
            
            // For longer text, use partial match
            const words = txt.split(/\s+/).slice(0, 5).join(' ');
            return `${tag}:has-text("${words.replace(/"/g, '\\"')}")`;
        }, text);
    }
    
    calculateConfidence(original: ElementFeatures, healed: ElementFeatures): number {
        const textSimilarity = this.calculateTextSimilarity(
            original.text?.content || '',
            healed.text?.content || ''
        );
        
        const overallSimilarity = this.similarityCalculator.calculate(original, healed);
        
        return (textSimilarity * 0.6) + (overallSimilarity * 0.4);
    }
}

/**
 * Strategy 3: Find element with similar attributes
 */
export class SimilarAttributesStrategy extends HealingStrategy {
    private readonly minAttributeSimilarity: number = 0.7;
    private readonly featureExtractor: ElementFeatureExtractor;
    private readonly similarityCalculator: SimilarityCalculator;
    private readonly importantAttributes = ['class', 'role', 'type', 'name', 'placeholder', 'aria-label'];
    
    constructor() {
        super('SimilarAttributes');
        this.featureExtractor = new ElementFeatureExtractor();
        this.similarityCalculator = new SimilarityCalculator();
    }
    
    async heal(element: CSWebElement, page: Page): Promise<HealingResult | null> {
        ActionLogger.logInfo(`Healing attempt: ${this.name}`, {
            strategy: this.name,
            element: element.description,
            type: 'healing_attempt'
        });
        
        try {
            // Get original attributes from snapshot
            const originalFeatures = await this.getLastKnownFeatures(element);
            if (!originalFeatures?.structural?.attributes) {
                logger.debug('No attributes in snapshot for attribute-based healing');
                return null;
            }
            
            const originalAttrs = originalFeatures.structural.attributes;
            const originalTag = originalFeatures.structural.tagName;
            
            // Find elements with similar attributes
            const candidates = await this.findAttributeCandidates(
                page,
                originalTag,
                originalAttrs
            );
            
            if (candidates.length === 0) {
                logger.debug('No attribute candidates found');
                return null;
            }
            
            // Score candidates
            const scoredCandidates = await this.scoreCandidates(
                candidates,
                originalAttrs,
                originalFeatures
            );
            
            // Get best match
            const best = scoredCandidates[0];
            if (!best || best.score < this.confidenceThreshold) {
                logger.debug(`Best attribute candidate score ${best?.score || 0} below threshold`);
                return null;
            }
            
            // Create locator
            const healedLocator = page.locator(best.selector);
            
            // Validate
            if (!await this.validateHealedElement(element, healedLocator)) {
                logger.debug('Attribute-healed element validation failed');
                return null;
            }
            
            ActionLogger.logInfo(`Healing success: ${this.name}`, {
                strategy: this.name,
                element: element.description,
                score: best.score,
                type: 'healing_success'
            });
            
            return {
                strategy: this.name,
                locator: healedLocator,
                confidence: best.score,
                selector: best.selector,
                reason: `Found element with ${Math.round(best.attributeSimilarity * 100)}% attribute similarity`
            };
            
        } catch (error) {
            logger.error(`Attribute healing failed: ${(error as Error).message}`);
            ActionLogger.logError(`Healing failed: ${this.name}`, error as Error);
            return null;
        }
    }
    
    private async findAttributeCandidates(
        page: Page,
        originalTag: string,
        originalAttrs: Record<string, string>
    ): Promise<AttributeCandidate[]> {
        const candidates: AttributeCandidate[] = [];
        
        // Get all elements of the same tag
        const elements = await page.$$(originalTag);
        
        for (const element of elements) {
            try {
                const attributes = await element.evaluate(el => {
                    const attrs: Record<string, string> = {};
                    for (const attr of Array.from(el.attributes)) {
                        attrs[attr.name] = attr.value;
                    }
                    return attrs;
                });
                
                const similarity = this.calculateAttributeSimilarity(originalAttrs, attributes);
                
                if (similarity >= this.minAttributeSimilarity) {
                    candidates.push({
                        element,
                        attributes,
                        similarity
                    });
                }
            } catch (error) {
                logger.debug(`Failed to get attributes: ${(error as Error).message}`);
            }
        }
        
        return candidates;
    }
    
    private async scoreCandidates(
        candidates: AttributeCandidate[],
        _originalAttrs: Record<string, string>,
        originalFeatures: ElementFeatures
    ): Promise<ScoredAttributeCandidate[]> {
        const scored: ScoredAttributeCandidate[] = [];
        
        for (const candidate of candidates) {
            try {
                // Extract full features
                const features = await this.featureExtractor.extractFeatures(candidate.element);
                
                // Calculate overall similarity
                const featureSimilarity = this.similarityCalculator.calculate(
                    originalFeatures,
                    features
                );
                
                // Combined score
                const totalScore = (candidate.similarity * 0.5) + (featureSimilarity * 0.5);
                
                // Generate selector
                const selector = await this.generateAttributeSelector(
                    candidate.element,
                    candidate.attributes
                );
                
                scored.push({
                    element: candidate.element,
                    score: totalScore,
                    attributeSimilarity: candidate.similarity,
                    selector
                });
                
            } catch (error) {
                logger.debug(`Failed to score attribute candidate: ${(error as Error).message}`);
            }
        }
        
        return scored.sort((a, b) => b.score - a.score);
    }
    
    private calculateAttributeSimilarity(
        attrs1: Record<string, string>,
        attrs2: Record<string, string>
    ): number {
        let matchScore = 0;
        let totalWeight = 0;
        
        // Check important attributes
        for (const attr of this.importantAttributes) {
            const weight = this.getAttributeWeight(attr);
            totalWeight += weight;
            
            if (attrs1[attr] && attrs2[attr]) {
                if (attr === 'class') {
                    // Special handling for classes
                    const classes1 = new Set(attrs1[attr].split(/\s+/));
                    const classes2 = new Set(attrs2[attr].split(/\s+/));
                    
                    const intersection = new Set(Array.from(classes1).filter(x => classes2.has(x)));
                    const union = new Set([...Array.from(classes1), ...Array.from(classes2)]);
                    
                    if (union.size > 0) {
                        matchScore += weight * (intersection.size / union.size);
                    }
                } else {
                    // Exact match for other attributes
                    if (attrs1[attr] === attrs2[attr]) {
                        matchScore += weight;
                    }
                }
            }
        }
        
        // Check other attributes
        const allKeys = new Set([...Object.keys(attrs1), ...Object.keys(attrs2)]);
        const otherKeys = Array.from(allKeys).filter(k => !this.importantAttributes.includes(k));
        
        for (const key of otherKeys) {
            if (attrs1[key] && attrs2[key] && attrs1[key] === attrs2[key]) {
                matchScore += 0.1;
                totalWeight += 0.1;
            }
        }
        
        return totalWeight > 0 ? matchScore / totalWeight : 0;
    }
    
    private getAttributeWeight(attribute: string): number {
        const weights: Record<string, number> = {
            'class': 0.3,
            'role': 0.25,
            'type': 0.2,
            'name': 0.15,
            'placeholder': 0.1,
            'aria-label': 0.15
        };
        
        return weights[attribute] || 0.05;
    }
    
    private async generateAttributeSelector(
        element: ElementHandle,
        attributes: Record<string, string>
    ): Promise<string> {
        const tag = await element.evaluate(el => (el as Element).tagName.toLowerCase());
        
        // Build selector from most specific attributes
        const parts = [tag];
        
        if (attributes['id']) {
            return `#${attributes['id']}`;
        }
        
        if (attributes['class']) {
            const classes = attributes['class']
                .split(/\s+/)
                .filter(c => c.length > 0 && !c.match(/^js-/)) // Skip JS hook classes
                .slice(0, 2); // Use first 2 classes
            
            if (classes.length > 0) {
                parts.push(`.${classes.join('.')}`);
            }
        }
        
        // Add other unique attributes
        for (const [key, value] of Object.entries(attributes)) {
            if (['id', 'class', 'style'].includes(key)) continue;
            if (value && value.length < 50) {
                parts.push(`[${key}="${value.replace(/"/g, '\\"')}"]`);
            }
        }
        
        return parts.join('');
    }
    
    calculateConfidence(original: ElementFeatures, healed: ElementFeatures): number {
        const attrSimilarity = this.calculateAttributeSimilarity(
            original.structural?.attributes || {},
            healed.structural?.attributes || {}
        );
        
        const overallSimilarity = this.similarityCalculator.calculate(original, healed);
        
        return (attrSimilarity * 0.5) + (overallSimilarity * 0.5);
    }
}

/**
 * Strategy 4: Find element by parent/child relationship
 */
export class ParentChildStrategy extends HealingStrategy {
    private readonly featureExtractor: ElementFeatureExtractor;
    private readonly similarityCalculator: SimilarityCalculator;
    
    constructor() {
        super('ParentChild');
        this.featureExtractor = new ElementFeatureExtractor();
        this.similarityCalculator = new SimilarityCalculator();
    }
    
    async heal(element: CSWebElement, page: Page): Promise<HealingResult | null> {
        ActionLogger.logInfo(`Healing attempt: ${this.name}`, {
            strategy: this.name,
            element: element.description,
            type: 'healing_attempt'
        });
        
        try {
            // Get structural information from snapshot
            const originalFeatures = await this.getLastKnownFeatures(element);
            if (!originalFeatures?.structural) {
                logger.debug('No structural information in snapshot for parent-child healing');
                return null;
            }
            
            const structural = originalFeatures.structural;
            
            // Try healing by parent relationship first
            const parentResult = await this.healByParent(
                element,
                page,
                structural,
                originalFeatures
            );
            if (parentResult) return parentResult;
            
            // Try healing by children structure
            const childrenResult = await this.healByChildren(
                element,
                page,
                structural,
                originalFeatures
            );
            if (childrenResult) return childrenResult;
            
            // Try healing by siblings
            const siblingsResult = await this.healBySiblings(
                element,
                page,
                structural,
                originalFeatures
            );
            if (siblingsResult) return siblingsResult;
            
            logger.debug('No parent-child relationships found for healing');
            return null;
            
        } catch (error) {
            logger.error(`Parent-child healing failed: ${(error as Error).message}`);
            ActionLogger.logError(`Healing failed: ${this.name}`, error as Error);
            return null;
        }
    }
    
    private async healByParent(
        element: CSWebElement,
        page: Page,
        structural: any,
        originalFeatures: ElementFeatures
    ): Promise<HealingResult | null> {
        // Use context features for parent information
        const parentTag = originalFeatures.context?.parentTag;
        if (!parentTag) return null;
        
        const parentInfo = {
            tagName: parentTag,
            attributes: {}
        };
        
        // Find parent elements matching the description
        const parentSelector = this.buildSelectorFromInfo(parentInfo);
        const parentElements = await page.$$(parentSelector);
        
        for (const parent of parentElements) {
            // Look for child matching original element
            const children = await parent.$$(`> ${structural.tagName}`);
            
            for (const child of children) {
                const features = await this.featureExtractor.extractFeatures(child);
                const similarity = this.similarityCalculator.calculate(originalFeatures, features);
                
                if (similarity >= this.confidenceThreshold) {
                    const selector = await this.generateParentChildSelector(parent, child);
                    const healedLocator = page.locator(selector);
                    
                    if (await this.validateHealedElement(element, healedLocator)) {
                        ActionLogger.logInfo(`Healing success: ${this.name}`, {
                            strategy: this.name,
                            element: element.description,
                            score: similarity,
                            type: 'healing_success'
                        });
                        
                        return {
                            strategy: this.name,
                            locator: healedLocator,
                            confidence: similarity,
                            selector,
                            reason: 'Found element by parent relationship'
                        };
                    }
                }
            }
        }
        
        return null;
    }
    
    private async healByChildren(
        element: CSWebElement,
        page: Page,
        structural: any,
        originalFeatures: ElementFeatures
    ): Promise<HealingResult | null> {
        // Use structural features for children information
        if (!structural.hasChildren || !structural.tagName) return null;
        
        const childrenInfo: Array<{ tagName: string }> = [];
        
        // Build query to find elements with similar children
        const candidateElements = await page.$$(structural.tagName);
        
        for (const candidate of candidateElements) {
            const childrenMatch = await this.checkChildrenMatch(candidate, childrenInfo);
            
            if (childrenMatch > 0.7) {
                const features = await this.featureExtractor.extractFeatures(candidate);
                const similarity = this.similarityCalculator.calculate(originalFeatures, features);
                
                const combinedScore = (childrenMatch * 0.4) + (similarity * 0.6);
                
                if (combinedScore >= this.confidenceThreshold) {
                    const selector = await this.generateUniqueSelector(candidate);
                    const healedLocator = page.locator(selector);
                    
                    if (await this.validateHealedElement(element, healedLocator)) {
                        ActionLogger.logInfo(`Healing success: ${this.name}`, {
                            strategy: this.name,
                            element: element.description,
                            score: combinedScore,
                            type: 'healing_success'
                        });
                        
                        return {
                            strategy: this.name,
                            locator: healedLocator,
                            confidence: combinedScore,
                            selector,
                            reason: 'Found element by children structure'
                        };
                    }
                }
            }
        }
        
        return null;
    }
    
    private async healBySiblings(
        element: CSWebElement,
        page: Page,
        _structural: any,
        originalFeatures: ElementFeatures
    ): Promise<HealingResult | null> {
        // Use context features for sibling information
        const siblingTexts = originalFeatures.context?.siblingTexts;
        if (!siblingTexts || siblingTexts.length === 0) return null;
        
        const siblingInfo = {
            previous: siblingTexts.length > 0 ? { tagName: '*', text: siblingTexts[0] } : null
        };
        
        // Find elements with similar siblings
        if (siblingInfo.previous) {
            const prevSelector = this.buildSelectorFromInfo(siblingInfo.previous);
            const prevElements = await page.$$(prevSelector);
            
            for (const prev of prevElements) {
                const nextSibling = await prev.evaluateHandle(el => el.nextElementSibling);
                
                if (nextSibling && nextSibling.asElement()) {
                    const elementHandle = nextSibling.asElement();
                    if (!elementHandle) continue;
                    
                    const features = await this.featureExtractor.extractFeatures(elementHandle);
                    const similarity = this.similarityCalculator.calculate(originalFeatures, features);
                    
                    if (similarity >= this.confidenceThreshold) {
                        const selector = await this.generateSiblingSelector(prev, elementHandle);
                        const healedLocator = page.locator(selector);
                        
                        if (await this.validateHealedElement(element, healedLocator)) {
                            ActionLogger.logInfo(`Healing success: ${this.name}`, {
                            strategy: this.name,
                            element: element.description,
                            score: similarity,
                            type: 'healing_success'
                        });
                            
                            return {
                                strategy: this.name,
                                locator: healedLocator,
                                confidence: similarity,
                                selector,
                                reason: 'Found element by sibling relationship'
                            };
                        }
                    }
                }
            }
        }
        
        return null;
    }
    
    private buildSelectorFromInfo(info: any): string {
        if (!info) return '*';
        
        const parts = [info.tagName || '*'];
        
        if (info.classes && info.classes.length > 0) {
            parts.push(`.${info.classes[0]}`);
        }
        
        if (info.attributes) {
            for (const [key, value] of Object.entries(info.attributes)) {
                if (value && typeof value === 'string' && value.length < 50) {
                    parts.push(`[${key}="${value}"]`);
                }
            }
        }
        
        // Add text selector if available
        if (info.text && typeof info.text === 'string') {
            parts.push(`:has-text("${info.text.substring(0, 30)}")`);
        }
        
        return parts.join('');
    }
    
    private async checkChildrenMatch(element: ElementHandle, expectedChildren: any[]): Promise<number> {
        const actualChildren = await element.$$(':scope > *');
        
        if (actualChildren.length !== expectedChildren.length) {
            return 0;
        }
        
        let matches = 0;
        
        for (let i = 0; i < actualChildren.length; i++) {
            const actual = actualChildren[i];
            const expected = expectedChildren[i];
            
            if (!actual || !expected) continue;
            
            const tagName = await actual.evaluate(el => (el as Element).tagName.toLowerCase());
            
            if (tagName === expected.tagName) {
                matches++;
            }
        }
        
        return matches / expectedChildren.length;
    }
    
    private async generateParentChildSelector(parent: ElementHandle, child: ElementHandle): Promise<string> {
        const parentSelector = await this.generateUniqueSelector(parent);
        const childIndex = await child.evaluate((el, parentSel) => {
            const parent = document.querySelector(parentSel);
            if (!parent) return 1;
            
            const children = Array.from(parent.children);
            return children.indexOf(el as Element) + 1;
        }, parentSelector);
        
        const childTag = await child.evaluate(el => (el as Element).tagName.toLowerCase());
        
        return `${parentSelector} > ${childTag}:nth-child(${childIndex})`;
    }
    
    private async generateSiblingSelector(sibling: ElementHandle, target: ElementHandle): Promise<string> {
        const siblingSelector = await this.generateUniqueSelector(sibling);
        const targetTag = await target.evaluate(el => (el as Element).tagName.toLowerCase());
        
        return `${siblingSelector} + ${targetTag}`;
    }
    
    private async generateUniqueSelector(element: ElementHandle): Promise<string> {
        return await element.evaluate(el => {
            const elem = el as Element;
            if (elem.id) return `#${elem.id}`;
            
            const path: string[] = [];
            let current: Element | null = elem;
            
            while (current && current !== document.body) {
                let selector = current.tagName.toLowerCase();
                
                if (current.id) {
                    selector = `#${current.id}`;
                    path.unshift(selector);
                    break;
                } else if (current.className) {
                    const classes = Array.from(current.classList).slice(0, 2);
                    if (classes.length > 0) {
                        selector += `.${classes.join('.')}`;
                    }
                }
                
                path.unshift(selector);
                current = current.parentElement;
            }
            
            return path.join(' > ');
        });
    }
    
    calculateConfidence(original: ElementFeatures, healed: ElementFeatures): number {
        return this.similarityCalculator.calculate(original, healed);
    }
}

/**
 * Strategy 5: Use AI to identify element
 */
export class AIIdentificationStrategy extends HealingStrategy {
    private readonly aiIdentifier: AIElementIdentifier;
    private readonly similarityCalculator: SimilarityCalculator;
    
    constructor() {
        super('AIIdentification');
        this.aiIdentifier = AIElementIdentifier.getInstance();
        this.similarityCalculator = new SimilarityCalculator();
    }
    
    async heal(element: CSWebElement, page: Page): Promise<HealingResult | null> {
        ActionLogger.logInfo(`Healing attempt: ${this.name}`, {
            strategy: this.name,
            element: element.description,
            type: 'healing_attempt'
        });
        
        try {
            // Use element description for AI identification
            const description = element.options.aiDescription || element.description;
            
            if (!description) {
                logger.debug('No description available for AI healing');
                return null;
            }
            
            // Let AI find the element
            const aiLocator = await this.aiIdentifier.identifyByDescription(description, page);
            
            if (!aiLocator) {
                logger.debug('AI could not identify element');
                return null;
            }
            
            // Validate the found element
            if (!await this.validateHealedElement(element, aiLocator)) {
                logger.debug('AI-identified element validation failed');
                return null;
            }
            
            // Since identifyByDescription returns a Locator directly, we'll use a default confidence
            const confidence = 0.8; // Default high confidence for AI
            
            ActionLogger.logInfo(`Healing success: ${this.name}`, {
                strategy: this.name,
                element: element.description,
                score: confidence,
                type: 'healing_success'
            });
            
            return {
                strategy: this.name,
                locator: aiLocator,
                confidence: confidence,
                selector: '',  // AI result doesn't provide selector
                reason: `AI identified element with ${Math.round(confidence * 100)}% confidence`
            };
            
        } catch (error) {
            logger.error(`AI healing failed: ${(error as Error).message}`);
            ActionLogger.logError(`Healing failed: ${this.name}`, error as Error);
            return null;
        }
    }
    
    calculateConfidence(original: ElementFeatures, healed: ElementFeatures): number {
        // Calculate confidence based on similarity between original and healed
        if (!original || !healed) return 0.8; // Default high confidence for AI
        
        // Use similarity calculator to compare features
        try {
            return this.similarityCalculator.calculate(original, healed);
        } catch (error) {
            // If similarity calculation fails, return default AI confidence
            return 0.8;
        }
    }
}

// Type definitions for healing
interface HealingResult {
    strategy: string;
    locator: Locator;
    confidence: number;
    selector: string;
    reason: string;
}

interface ScoredCandidate {
    element: ElementHandle;
    score: number;
    distance: number;
    selector: string;
}

interface TextCandidate {
    element: ElementHandle;
    text: string;
    similarity: number;
}

interface ScoredTextCandidate {
    element: ElementHandle;
    score: number;
    textSimilarity: number;
    selector: string;
}

interface AttributeCandidate {
    element: ElementHandle;
    attributes: Record<string, string>;
    similarity: number;
}

interface ScoredAttributeCandidate {
    element: ElementHandle;
    score: number;
    attributeSimilarity: number;
    selector: string;
}