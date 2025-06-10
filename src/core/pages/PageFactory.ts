import { Page } from 'playwright';
import { logger } from '../utils/Logger';
import { ActionLogger } from '../logging/ActionLogger';
import { CSBasePage } from './CSBasePage';
import { PageRegistry } from './PageRegistry';
import { PageCreationOptions, PageCacheEntry } from './types/page.types';

/**
 * PageFactory - Create and manage page object instances
 * Implements caching and lifecycle management
 */
export class PageFactory {
    private static pageCache: Map<string, PageCacheEntry> = new Map();
    private static pageLocks: Map<string, Promise<CSBasePage>> = new Map();
    private static cacheTimeout: number = 300000; // 5 minutes default
    private static maxCacheSize: number = 50;

    /**
     * Create a page object instance
     */
    static async createPage<T extends CSBasePage>(
        PageClass: new(...args: any[]) => T, 
        page: Page,
        options?: PageCreationOptions
    ): Promise<T> {
        const className = PageClass.name;
        const cacheKey = this.getCacheKey(className, page.url(), options);
        
        try {
            // Check cache first if enabled
            if (options?.useCache !== false) {
                const cached = this.getFromCache<T>(cacheKey);
                if (cached) {
                    ActionLogger.logPageOperation('page_factory_cache_hit', className, {
                        cacheKey
                    });
                    return cached;
                }
            }

            // Check if page is already being created (prevent race conditions)
            if (this.pageLocks.has(cacheKey)) {
                ActionLogger.logPageOperation('page_factory_wait_lock', className);
                return await this.pageLocks.get(cacheKey) as T;
            }

            // Create page with lock
            const createPromise = this.createPageInternal<T>(PageClass, page, options);
            this.pageLocks.set(cacheKey, createPromise);

            try {
                const pageObject = await createPromise;
                
                // Add to cache if enabled
                if (options?.useCache !== false) {
                    this.addToCache(cacheKey, pageObject, options?.cacheTTL);
                }

                return pageObject;
            } finally {
                this.pageLocks.delete(cacheKey);
            }
        } catch (error) {
            logger.error(`PageFactory: Failed to create ${className}`, error as Error);
            throw error;
        }
    }

    /**
     * Get or create a page object
     */
    static async getPage<T extends CSBasePage>(
        PageClass: new(...args: any[]) => T, 
        page: Page,
        options?: PageCreationOptions
    ): Promise<T> {
        return this.createPage(PageClass, page, { ...options, useCache: true });
    }

    /**
     * Create page by name from registry
     */
    static async createPageByName(
        name: string, 
        page: Page,
        options?: PageCreationOptions
    ): Promise<CSBasePage> {
        try {
            const PageClass = PageRegistry.get(name);
            
            if (!PageClass) {
                throw new Error(`Page class '${name}' not found in registry`);
            }

            return await this.createPage(PageClass as new(...args: any[]) => CSBasePage, page, options) as CSBasePage;
        } catch (error) {
            logger.error(`PageFactory: Failed to create page by name '${name}'`, error as Error);
            throw error;
        }
    }

    /**
     * Create multiple pages
     */
    static async createPages<T extends CSBasePage>(
        pageClasses: Array<new(...args: any[]) => T>,
        page: Page,
        options?: PageCreationOptions
    ): Promise<T[]> {
        try {
            const pages = await Promise.all(
                pageClasses.map(PageClass => 
                    this.createPage(PageClass, page, options)
                )
            );
            
            ActionLogger.logPageOperation('page_factory_batch_create', 'PageFactory', {
                count: pages.length
            });
            
            return pages;
        } catch (error) {
            logger.error('PageFactory: Failed to create multiple pages', error as Error);
            throw error;
        }
    }

    /**
     * Check if page is cached
     */
    static isCached(PageClass: new(...args: any[]) => CSBasePage, page: Page): boolean {
        const cacheKey = this.getCacheKey(PageClass.name, page.url());
        return this.pageCache.has(cacheKey);
    }

    /**
     * Clear cache for specific page
     */
    static clearPageCache(PageClass: new(...args: any[]) => CSBasePage, page?: Page): void {
        if (page) {
            const cacheKey = this.getCacheKey(PageClass.name, page.url());
            this.removeFromCache(cacheKey);
        } else {
            // Clear all instances of this page class
            const className = PageClass.name;
            const keysToRemove: string[] = [];
            
            this.pageCache.forEach((_, key) => {
                if (key.startsWith(className)) {
                    keysToRemove.push(key);
                }
            });
            
            keysToRemove.forEach(key => this.removeFromCache(key));
        }
        
        ActionLogger.logPageOperation('page_factory_cache_clear', PageClass.name);
    }

    /**
     * Clear entire cache
     */
    static clearCache(): void {
        const cacheSize = this.pageCache.size;
        
        // Cleanup all pages
        this.pageCache.forEach(entry => {
            if (entry.instance.cleanup) {
                entry.instance.cleanup().catch((error: Error) => {
                    logger.error('PageFactory: Error during cleanup', error);
                });
            }
        });
        
        this.pageCache.clear();
        this.pageLocks.clear();
        
        ActionLogger.logPageOperation('page_factory_cache_clear_all', 'PageFactory', {
            cleared: cacheSize
        });
    }

    /**
     * Dispose a page object
     */
    static async disposePage(pageObject: CSBasePage): Promise<void> {
        try {
            // Find and remove from cache
            const cacheKey = Array.from(this.pageCache.entries())
                .find(([_, entry]) => entry.instance === pageObject)?.[0];
            
            if (cacheKey) {
                this.removeFromCache(cacheKey);
            }
            
            // Cleanup page resources
            if (pageObject.cleanup) {
                await pageObject.cleanup();
            }
            
            ActionLogger.logPageOperation('page_factory_dispose', pageObject.constructor.name);
        } catch (error) {
            logger.error('PageFactory: Error disposing page', error as Error);
        }
    }

    /**
     * Get cache statistics
     */
    static getCacheStats(): any {
        const stats = {
            size: this.pageCache.size,
            entries: [] as any[],
            totalAge: 0,
            oldestEntry: null as any,
            newestEntry: null as any
        };
        
        const now = Date.now();
        let oldestTime = now;
        let newestTime = 0;
        
        this.pageCache.forEach((entry, key) => {
            const age = now - entry.createdAt;
            stats.totalAge += age;
            
            const entryInfo = {
                key,
                className: entry.instance.constructor.name,
                age,
                lastAccessed: now - entry.lastAccessed
            };
            
            stats.entries.push(entryInfo);
            
            if (entry.createdAt < oldestTime) {
                oldestTime = entry.createdAt;
                stats.oldestEntry = entryInfo;
            }
            
            if (entry.createdAt > newestTime) {
                newestTime = entry.createdAt;
                stats.newestEntry = entryInfo;
            }
        });
        
        return {
            ...stats,
            averageAge: stats.size > 0 ? stats.totalAge / stats.size : 0
        };
    }

    /**
     * Configure cache settings
     */
    static configureCaching(options: {
        defaultTTL?: number;
        maxCacheSize?: number;
        cleanupInterval?: number;
    }): void {
        if (options.defaultTTL !== undefined) {
            this.cacheTimeout = options.defaultTTL;
        }
        
        if (options.maxCacheSize !== undefined) {
            this.maxCacheSize = options.maxCacheSize;
        }
        
        if (options.cleanupInterval !== undefined) {
            this.startCacheCleanup(options.cleanupInterval);
        }
        
        ActionLogger.logPageOperation('page_factory_configure', 'PageFactory', options);
    }

    // Private methods

    private static async createPageInternal<T extends CSBasePage>(
        PageClass: new(...args: any[]) => T,
        page: Page,
        options?: PageCreationOptions
    ): Promise<T> {
        const startTime = Date.now();
        
        // Create instance
        const pageObject = new PageClass();
        
        // Initialize with options
        if (!options?.skipInitialization) {
            await pageObject.initialize(page);
        }
        
        // Wait for custom ready state if provided
        if (options?.waitForReady) {
            await options.waitForReady(pageObject);
        }
        
        const creationTime = Date.now() - startTime;
        
        ActionLogger.logPageOperation('page_factory_create', PageClass.name, {
            creationTime,
            initialized: !options?.skipInitialization
        });
        
        return pageObject;
    }

    private static getCacheKey(
        className: string, 
        url: string, 
        options?: PageCreationOptions
    ): string {
        const baseKey = `${className}_${url}`;
        
        if (options?.cacheKey) {
            return `${baseKey}_${options.cacheKey}`;
        }
        
        return baseKey;
    }

    private static getFromCache<T extends CSBasePage>(cacheKey: string): T | null {
        const entry = this.pageCache.get(cacheKey);
        
        if (!entry) {
            return null;
        }
        
        // Check if expired
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            this.removeFromCache(cacheKey);
            return null;
        }
        
        // Update last accessed
        entry.lastAccessed = Date.now();
        
        return entry.instance as T;
    }

    private static addToCache(
        cacheKey: string, 
        instance: CSBasePage, 
        ttl?: number
    ): void {
        // Check cache size limit
        if (this.pageCache.size >= this.maxCacheSize) {
            this.evictOldestEntry();
        }
        
        const now = Date.now();
        const timeout = ttl || this.cacheTimeout;
        
        this.pageCache.set(cacheKey, {
            instance,
            createdAt: now,
            lastAccessed: now,
            expiresAt: timeout > 0 ? now + timeout : null
        });
    }

    private static removeFromCache(cacheKey: string): void {
        const entry = this.pageCache.get(cacheKey);
        
        if (entry) {
            // Cleanup if needed
            if (entry.instance.cleanup) {
                entry.instance.cleanup().catch((error: Error) => {
                    logger.error('PageFactory: Error during cache removal cleanup', error);
                });
            }
            
            this.pageCache.delete(cacheKey);
        }
    }

    private static evictOldestEntry(): void {
        let oldestKey: string | null = null;
        let oldestTime = Date.now();
        
        // Find least recently accessed
        this.pageCache.forEach((entry, key) => {
            if (entry.lastAccessed < oldestTime) {
                oldestTime = entry.lastAccessed;
                oldestKey = key;
            }
        });
        
        if (oldestKey) {
            this.removeFromCache(oldestKey);
            
            ActionLogger.logPageOperation('page_factory_cache_evict', 'PageFactory', {
                evictedKey: oldestKey
            });
        }
    }

    private static cacheCleanupInterval: NodeJS.Timeout | null = null;

    private static startCacheCleanup(interval: number): void {
        // Clear existing interval
        if (this.cacheCleanupInterval) {
            clearInterval(this.cacheCleanupInterval);
        }
        
        // Start new interval
        this.cacheCleanupInterval = setInterval(() => {
            this.cleanupExpiredEntries();
        }, interval);
    }

    private static cleanupExpiredEntries(): void {
        const now = Date.now();
        const expiredKeys: string[] = [];
        
        this.pageCache.forEach((entry, key) => {
            if (entry.expiresAt && now > entry.expiresAt) {
                expiredKeys.push(key);
            }
        });
        
        expiredKeys.forEach(key => this.removeFromCache(key));
        
        if (expiredKeys.length > 0) {
            ActionLogger.logPageOperation('page_factory_cache_cleanup', 'PageFactory', {
                expired: expiredKeys.length
            });
        }
    }
}