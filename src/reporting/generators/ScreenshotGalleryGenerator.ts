// src/reporting/generators/ScreenshotGalleryGenerator.ts

import { Screenshot, ScreenshotGallery, GalleryCategory, ReportTheme } from '../types/reporting.types';
import { Logger } from '../../core/utils/Logger';
import { FileUtils } from '../../core/utils/FileUtils';
import { DateUtils } from '../../core/utils/DateUtils';

export class ScreenshotGalleryGenerator {
  private static readonly logger = new Logger(ScreenshotGalleryGenerator.name);
  private theme: ReportTheme;

  constructor(theme: ReportTheme) {
    this.theme = theme;
  }

  /**
   * Generate interactive screenshot gallery
   */
  async generateGallery(screenshots: Screenshot[]): Promise<string> {
    ScreenshotGalleryGenerator.logger.info(`Generating screenshot gallery with ${screenshots.length} images`);

    const gallery = this.organizeScreenshots(screenshots);
    const html = this.generateGalleryHTML(gallery);
    const css = this.generateGalleryCSS();
    const js = this.generateGalleryJS();

    return `
      <div id="screenshot-gallery" class="cs-screenshot-gallery">
        <style>${css}</style>
        ${html}
        <script>${js}</script>
      </div>
    `;
  }

  /**
   * Organize screenshots into categories
   */
  private organizeScreenshots(screenshots: Screenshot[]): ScreenshotGallery {
    const categories: Map<string, GalleryCategory> = new Map();
    
    // Categorize screenshots
    screenshots.forEach(screenshot => {
      const category = this.determineCategory(screenshot);
      
      if (!categories.has(category)) {
        categories.set(category, {
          name: category,
          count: 0,
          screenshots: [],
          icon: this.getCategoryIcon(category)
        });
      }
      
      const cat = categories.get(category)!;
      cat.screenshots.push(screenshot);
      cat.count++;
    });

    // Sort screenshots within each category
    categories.forEach(category => {
      category.screenshots.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    });

    return {
      totalCount: screenshots.length,
      categories: Array.from(categories.values()),
      failureScreenshots: screenshots.filter(s => s.context.includes('failure')),
      beforeAfterPairs: this.findBeforeAfterPairs(screenshots)
    };
  }

  /**
   * Determine screenshot category
   */
  private determineCategory(screenshot: Screenshot): string {
    if (screenshot.tags?.includes('failure')) return 'Failures';
    if (screenshot.tags?.includes('validation')) return 'Validations';
    if (screenshot.tags?.includes('before')) return 'Before/After';
    if (screenshot.tags?.includes('after')) return 'Before/After';
    if (screenshot.context.includes('step')) return 'Step Evidence';
    if (screenshot.context.includes('debug')) return 'Debug';
    return 'General';
  }

  /**
   * Get category icon
   */
  private getCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
      'Failures': '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/></svg>',
      'Validations': '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/></svg>',
      'Before/After': '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8z"/></svg>',
      'Step Evidence': '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M12.354 4.354a.5.5 0 0 0-.708-.708L5 10.293 1.854 7.146a.5.5 0 1 0-.708.708l3.5 3.5a.5.5 0 0 0 .708 0l7-7zm-4.208 7-.896-.897.707-.707.543.543 6.646-6.647a.5.5 0 0 1 .708.708l-7 7a.5.5 0 0 1-.708 0z"/></svg>',
      'Debug': '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 15c4.418 0 8-3.134 8-7s-3.582-7-8-7-8 3.134-8 7c0 1.76.743 3.37 1.97 4.6-.097 1.016-.417 2.13-.771 2.966-.079.186.074.394.273.362 2.256-.37 3.597-.938 4.18-1.234A9.06 9.06 0 0 0 8 15z"/></svg>',
      'General': '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/><path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2h-12zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1h12z"/></svg>'
    };
    return icons[category] || icons['General'];
  }

  /**
   * Find before/after screenshot pairs
   */
  private findBeforeAfterPairs(screenshots: Screenshot[]): Array<{before: Screenshot; after: Screenshot}> {
    const pairs: Array<{before: Screenshot; after: Screenshot}> = [];
    const beforeScreenshots = screenshots.filter(s => s.tags?.includes('before'));
    
    beforeScreenshots.forEach(before => {
      const after = screenshots.find(s => 
        s.tags?.includes('after') && 
        s.scenario === before.scenario &&
        s.step === before.step
      );
      
      if (after) {
        pairs.push({ before, after });
      }
    });
    
    return pairs;
  }

  /**
   * Generate gallery HTML
   */
  private generateGalleryHTML(gallery: ScreenshotGallery): string {
    return `
      <div class="gallery-header">
        <h2>Screenshot Gallery</h2>
        <div class="gallery-stats">
          <span class="stat-item">
            <span class="stat-value">${gallery.totalCount}</span>
            <span class="stat-label">Total Screenshots</span>
          </span>
          <span class="stat-item">
            <span class="stat-value">${gallery.failureScreenshots.length}</span>
            <span class="stat-label">Failure Screenshots</span>
          </span>
          <span class="stat-item">
            <span class="stat-value">${gallery.categories.length}</span>
            <span class="stat-label">Categories</span>
          </span>
        </div>
      </div>

      <div class="gallery-controls">
        <div class="view-toggle">
          <button class="view-btn active" data-view="grid" onclick="setGalleryView('grid')">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zM2.5 2a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zm6.5.5A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zm6.5.5A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3z"/>
            </svg>
            Grid
          </button>
          <button class="view-btn" data-view="list" onclick="setGalleryView('list')">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"/>
            </svg>
            List
          </button>
          <button class="view-btn" data-view="compare" onclick="setGalleryView('compare')">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M0 0h8v8H0V0zm0 8h8v8H0V8zm8-8h8v8H8V0zm0 8h8v8H8V8z"/>
            </svg>
            Compare
          </button>
        </div>
        
        <div class="filter-controls">
          <select class="category-filter" onchange="filterByCategory(this.value)">
            <option value="">All Categories</option>
            ${gallery.categories.map(cat => `
              <option value="${cat.name}">${cat.name} (${cat.count})</option>
            `).join('')}
          </select>
          
          <input type="text" class="search-input" placeholder="Search screenshots..." onkeyup="searchScreenshots(this.value)">
          
          <button class="filter-btn" onclick="toggleFilterPanel()">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 10.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/>
            </svg>
            Filters
          </button>
        </div>
      </div>

      <div class="filter-panel" id="filterPanel" style="display: none;">
        <div class="filter-section">
          <h4>Time Range</h4>
          <input type="datetime-local" id="startTime" onchange="applyTimeFilter()">
          <span>to</span>
          <input type="datetime-local" id="endTime" onchange="applyTimeFilter()">
        </div>
        <div class="filter-section">
          <h4>Status</h4>
          <label><input type="checkbox" value="passed" onchange="applyStatusFilter()"> Passed</label>
          <label><input type="checkbox" value="failed" onchange="applyStatusFilter()"> Failed</label>
          <label><input type="checkbox" value="skipped" onchange="applyStatusFilter()"> Skipped</label>
        </div>
      </div>

      <div class="gallery-container" data-view="grid">
        ${gallery.categories.map(category => `
          <div class="category-section" data-category="${category.name}">
            <div class="category-header">
              <span class="category-icon">${category.icon}</span>
              <h3>${category.name}</h3>
              <span class="category-count">${category.count} screenshots</span>
            </div>
            
            <div class="screenshots-grid">
              ${category.screenshots.map((screenshot, index) => `
                <div class="screenshot-item" 
                     data-id="${screenshot.id}"
                     data-category="${category.name}"
                     data-timestamp="${screenshot.timestamp}"
                     data-status="${screenshot.tags?.includes('failure') ? 'failed' : 'passed'}"
                     data-search="${screenshot.name.toLowerCase()} ${screenshot.scenario.toLowerCase()} ${screenshot.step?.toLowerCase() || ''}">
                  <div class="screenshot-thumbnail" onclick="openLightbox('${screenshot.id}')">
                    <img src="${screenshot.base64 ? 'data:image/png;base64,' + screenshot.base64 : screenshot.path}" 
                         alt="${screenshot.name}"
                         loading="lazy">
                    ${screenshot.tags?.includes('failure') ? '<div class="failure-badge">FAIL</div>' : ''}
                    <div class="screenshot-overlay">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                        <path d="M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z"/>
                        <path d="M12 3.5c4.687 0 8.5 3.813 8.5 8.5 0 4.687-3.813 8.5-8.5 8.5-4.687 0-8.5-3.813-8.5-8.5 0-4.687 3.813-8.5 8.5-8.5zM12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z"/>
                      </svg>
                    </div>
                  </div>
                  <div class="screenshot-info">
                    <div class="screenshot-name">${screenshot.name}</div>
                    <div class="screenshot-meta">
                      <span class="meta-item">${screenshot.scenario}</span>
                      ${screenshot.step ? `<span class="meta-item">${screenshot.step}</span>` : ''}
                    </div>
                    <div class="screenshot-time">${DateUtils.formatTime(new Date(screenshot.timestamp))}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
        
        ${gallery.beforeAfterPairs.length > 0 ? `
          <div class="category-section" data-category="comparisons">
            <div class="category-header">
              <span class="category-icon">${this.getCategoryIcon('Before/After')}</span>
              <h3>Before/After Comparisons</h3>
              <span class="category-count">${gallery.beforeAfterPairs.length} pairs</span>
            </div>
            
            <div class="comparison-grid">
              ${gallery.beforeAfterPairs.map((pair, index) => `
                <div class="comparison-item">
                  <div class="comparison-header">
                    <h4>${pair.before.scenario}</h4>
                    <span>${pair.before.step || ''}</span>
                  </div>
                  <div class="comparison-images">
                    <div class="before-image">
                      <div class="image-label">Before</div>
                      <img src="${pair.before.base64 ? 'data:image/png;base64,' + pair.before.base64 : pair.before.path}" 
                           alt="Before"
                           onclick="openComparisonLightbox('${pair.before.id}', '${pair.after.id}')">
                    </div>
                    <div class="comparison-slider" data-pair="${index}">
                      <input type="range" min="0" max="100" value="50" 
                             oninput="updateComparison(${index}, this.value)">
                    </div>
                    <div class="after-image">
                      <div class="image-label">After</div>
                      <img src="${pair.after.base64 ? 'data:image/png;base64,' + pair.after.base64 : pair.after.path}" 
                           alt="After"
                           onclick="openComparisonLightbox('${pair.before.id}', '${pair.after.id}')">
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <!-- Lightbox -->
      <div class="screenshot-lightbox" id="screenshotLightbox" style="display: none;">
        <div class="lightbox-backdrop" onclick="closeLightbox()"></div>
        <div class="lightbox-content">
          <button class="lightbox-close" onclick="closeLightbox()">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <path d="M18.3 5.71a.996.996 0 0 0-1.41 0L12 10.59 7.11 5.7A.996.996 0 1 0 5.7 7.11L10.59 12 5.7 16.89a.996.996 0 1 0 1.41 1.41L12 13.41l4.89 4.89a.996.996 0 1 0 1.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z"/>
            </svg>
          </button>
          
          <div class="lightbox-navigation">
            <button class="nav-btn prev" onclick="navigateLightbox(-1)">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
              </svg>
            </button>
            <button class="nav-btn next" onclick="navigateLightbox(1)">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
              </svg>
            </button>
          </div>
          
          <div class="lightbox-image-container">
            <img id="lightboxImage" src="" alt="">
          </div>
          
          <div class="lightbox-info">
            <h3 id="lightboxTitle"></h3>
            <div id="lightboxMeta"></div>
            <div class="lightbox-actions">
              <button onclick="downloadScreenshot()">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                  <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
                </svg>
                Download
              </button>
              <button onclick="copyScreenshotPath()">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>
                  <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>
                </svg>
                Copy Path
              </button>
            </div>
          </div>
        </div>
      </div>

      <script>
        window.screenshotGalleryData = ${JSON.stringify(gallery)};
      </script>
    `;
  }

  /**
   * Generate gallery CSS
   */
  private generateGalleryCSS(): string {
    return `
      .cs-screenshot-gallery {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        padding: 24px;
        margin-bottom: 24px;
      }

      .gallery-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;
      }

      .gallery-header h2 {
        color: ${this.theme.colors.text.primary};
        font-size: 20px;
        font-weight: 600;
        margin: 0;
      }

      .gallery-stats {
        display: flex;
        gap: 24px;
      }

      .stat-item {
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .stat-value {
        font-size: 24px;
        font-weight: 600;
        color: ${this.theme.colors.primary};
      }

      .stat-label {
        font-size: 12px;
        color: ${this.theme.colors.text.secondary};
        margin-top: 4px;
      }

      .gallery-controls {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;
        gap: 16px;
      }

      .view-toggle {
        display: flex;
        gap: 8px;
        padding: 4px;
        background: ${this.theme.colors.background.secondary};
        border-radius: 6px;
      }

      .view-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: transparent;
        border: none;
        border-radius: 4px;
        font-size: 13px;
        color: ${this.theme.colors.text.secondary};
        cursor: pointer;
        transition: all 0.2s;
      }

      .view-btn:hover {
        background: ${this.theme.colors.background.primary};
      }

      .view-btn.active {
        background: white;
        color: ${this.theme.colors.primary};
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .filter-controls {
        display: flex;
        gap: 12px;
        align-items: center;
      }

      .category-filter,
      .search-input {
        padding: 8px 12px;
        border: 1px solid ${this.theme.colors.border};
        border-radius: 6px;
        font-size: 13px;
        color: ${this.theme.colors.text.primary};
        background: white;
      }

      .search-input {
        width: 200px;
      }

      .filter-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: white;
        border: 1px solid ${this.theme.colors.border};
        border-radius: 6px;
        font-size: 13px;
        color: ${this.theme.colors.text.primary};
        cursor: pointer;
        transition: all 0.2s;
      }

      .filter-btn:hover {
        background: ${this.theme.colors.background.secondary};
      }

      .filter-panel {
        background: ${this.theme.colors.background.secondary};
        border: 1px solid ${this.theme.colors.border};
        border-radius: 6px;
        padding: 16px;
        margin-bottom: 16px;
      }

      .filter-section {
        margin-bottom: 16px;
      }

      .filter-section h4 {
        font-size: 13px;
        font-weight: 600;
        color: ${this.theme.colors.text.primary};
        margin-bottom: 8px;
      }

      .filter-section label {
        display: block;
        margin-bottom: 4px;
        font-size: 13px;
        color: ${this.theme.colors.text.secondary};
      }

      .gallery-container {
        position: relative;
      }

      .category-section {
        margin-bottom: 32px;
      }

      .category-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }

      .category-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        background: ${this.theme.colors.primary}10;
        color: ${this.theme.colors.primary};
        border-radius: 6px;
      }

      .category-header h3 {
        font-size: 16px;
        font-weight: 600;
        color: ${this.theme.colors.text.primary};
        margin: 0;
        flex: 1;
      }

      .category-count {
        font-size: 13px;
        color: ${this.theme.colors.text.secondary};
      }

      /* Grid View */
      .gallery-container[data-view="grid"] .screenshots-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
      }

      .screenshot-item {
        background: ${this.theme.colors.background.secondary};
        border-radius: 8px;
        overflow: hidden;
        transition: all 0.2s;
        cursor: pointer;
      }

      .screenshot-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      .screenshot-thumbnail {
        position: relative;
        aspect-ratio: 16/9;
        overflow: hidden;
        background: ${this.theme.colors.background.primary};
      }

      .screenshot-thumbnail img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .failure-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        padding: 4px 8px;
        background: ${this.theme.colors.error};
        color: white;
        font-size: 11px;
        font-weight: 600;
        border-radius: 4px;
        text-transform: uppercase;
      }

      .screenshot-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s;
      }

      .screenshot-item:hover .screenshot-overlay {
        opacity: 1;
      }

      .screenshot-info {
        padding: 12px;
      }

      .screenshot-name {
        font-size: 14px;
        font-weight: 500;
        color: ${this.theme.colors.text.primary};
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .screenshot-meta {
        display: flex;
        gap: 8px;
        margin-bottom: 4px;
      }

      .meta-item {
        font-size: 12px;
        color: ${this.theme.colors.text.secondary};
        padding: 2px 6px;
        background: ${this.theme.colors.background.primary};
        border-radius: 3px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 120px;
      }

      .screenshot-time {
        font-size: 11px;
        color: ${this.theme.colors.text.tertiary};
      }

      /* List View */
      .gallery-container[data-view="list"] .screenshots-grid {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .gallery-container[data-view="list"] .screenshot-item {
        display: flex;
        align-items: center;
        padding: 12px;
      }

      .gallery-container[data-view="list"] .screenshot-thumbnail {
        width: 120px;
        height: 68px;
        margin-right: 16px;
        flex-shrink: 0;
      }

      .gallery-container[data-view="list"] .screenshot-info {
        flex: 1;
        padding: 0;
      }

      /* Compare View */
      .comparison-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(500px, 1fr));
        gap: 24px;
      }

      .comparison-item {
        background: ${this.theme.colors.background.secondary};
        border-radius: 8px;
        padding: 16px;
      }

      .comparison-header {
        margin-bottom: 12px;
      }

      .comparison-header h4 {
        font-size: 14px;
        font-weight: 600;
        color: ${this.theme.colors.text.primary};
        margin: 0 0 4px 0;
      }

      .comparison-header span {
        font-size: 12px;
        color: ${this.theme.colors.text.secondary};
      }

      .comparison-images {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        gap: 16px;
        align-items: center;
      }

      .before-image,
      .after-image {
        position: relative;
      }

      .image-label {
        position: absolute;
        top: 8px;
        left: 8px;
        padding: 4px 8px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        font-size: 11px;
        font-weight: 600;
        border-radius: 4px;
        text-transform: uppercase;
      }

      .before-image img,
      .after-image img {
        width: 100%;
        height: auto;
        border-radius: 4px;
        cursor: pointer;
      }

      .comparison-slider {
        display: flex;
        align-items: center;
        transform: rotate(-90deg);
        width: 60px;
      }

      .comparison-slider input[type="range"] {
        width: 60px;
        -webkit-appearance: none;
        appearance: none;
        background: transparent;
        cursor: pointer;
      }

      .comparison-slider input[type="range"]::-webkit-slider-track {
        background: ${this.theme.colors.border};
        height: 4px;
        border-radius: 2px;
      }

      .comparison-slider input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        background: ${this.theme.colors.primary};
        border-radius: 50%;
        cursor: pointer;
      }

      /* Lightbox */
      .screenshot-lightbox {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 10000;
      }

      .lightbox-backdrop {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.9);
        cursor: pointer;
      }

      .lightbox-content {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px;
        pointer-events: none;
      }

      .lightbox-content > * {
        pointer-events: auto;
      }

      .lightbox-close {
        position: absolute;
        top: 20px;
        right: 20px;
        width: 40px;
        height: 40px;
        background: rgba(255, 255, 255, 0.1);
        border: none;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
      }

      .lightbox-close:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .lightbox-navigation {
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        transform: translateY(-50%);
        display: flex;
        justify-content: space-between;
        padding: 0 20px;
      }

      .nav-btn {
        width: 48px;
        height: 48px;
        background: rgba(255, 255, 255, 0.1);
        border: none;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
      }

      .nav-btn:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .nav-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }

      .lightbox-image-container {
        max-width: 90%;
        max-height: 70%;
        position: relative;
      }

      .lightbox-image-container img {
        max-width: 100%;
        max-height: 100%;
        border-radius: 8px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
      }

      .lightbox-info {
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(10px);
        border-radius: 8px;
        padding: 16px 24px;
        text-align: center;
        color: white;
      }

      .lightbox-info h3 {
        font-size: 16px;
        font-weight: 600;
        margin: 0 0 8px 0;
      }

      #lightboxMeta {
        font-size: 13px;
        color: rgba(255, 255, 255, 0.8);
        margin-bottom: 12px;
      }

      .lightbox-actions {
        display: flex;
        gap: 12px;
        justify-content: center;
      }

      .lightbox-actions button {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        color: white;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .lightbox-actions button:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      /* Responsive */
      @media (max-width: 768px) {
        .gallery-header {
          flex-direction: column;
          align-items: flex-start;
          gap: 16px;
        }

        .gallery-controls {
          flex-wrap: wrap;
        }

        .filter-controls {
          width: 100%;
          flex-wrap: wrap;
        }

        .search-input {
          width: 100%;
        }

        .gallery-container[data-view="grid"] .screenshots-grid {
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        }

        .comparison-grid {
          grid-template-columns: 1fr;
        }

        .comparison-images {
          grid-template-columns: 1fr;
          gap: 8px;
        }

        .comparison-slider {
          transform: none;
          width: 100%;
          margin: 8px 0;
        }

        .comparison-slider input[type="range"] {
          width: 100%;
        }
      }

      /* Hide elements for filtering */
      .screenshot-item.hidden {
        display: none;
      }

      .category-section.hidden {
        display: none;
      }
    `;
  }

  /**
   * Generate gallery JavaScript
   */
  private generateGalleryJS(): string {
    return `
      (function() {
        let currentLightboxIndex = 0;
        let allScreenshots = [];
        let currentView = 'grid';

        // Initialize all screenshots array
        function initializeScreenshots() {
          allScreenshots = [];
          window.screenshotGalleryData.categories.forEach(category => {
            category.screenshots.forEach(screenshot => {
              allScreenshots.push(screenshot);
            });
          });
        }

        // Set gallery view
        window.setGalleryView = function(view) {
          currentView = view;
          const container = document.querySelector('.gallery-container');
          container.setAttribute('data-view', view);
          
          // Update active button
          document.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-view') === view);
          });

          // Show/hide comparison section based on view
          const comparisonSection = document.querySelector('[data-category="comparisons"]');
          if (comparisonSection) {
            comparisonSection.style.display = view === 'compare' ? 'block' : 'none';
          }
        };

        // Filter by category
        window.filterByCategory = function(category) {
          const sections = document.querySelectorAll('.category-section');
          sections.forEach(section => {
            if (!category || section.getAttribute('data-category') === category) {
              section.classList.remove('hidden');
            } else {
              section.classList.add('hidden');
            }
          });
        };

        // Search screenshots
        window.searchScreenshots = function(query) {
          const lowerQuery = query.toLowerCase();
          const items = document.querySelectorAll('.screenshot-item');
          
          items.forEach(item => {
            const searchText = item.getAttribute('data-search');
            if (!query || searchText.includes(lowerQuery)) {
              item.classList.remove('hidden');
            } else {
              item.classList.add('hidden');
            }
          });

          // Hide empty categories
          document.querySelectorAll('.category-section').forEach(section => {
            const visibleItems = section.querySelectorAll('.screenshot-item:not(.hidden)');
            section.classList.toggle('hidden', visibleItems.length === 0);
          });
        };

        // Toggle filter panel
        window.toggleFilterPanel = function() {
          const panel = document.getElementById('filterPanel');
          panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        };

        // Apply time filter
        window.applyTimeFilter = function() {
          const startTime = document.getElementById('startTime').value;
          const endTime = document.getElementById('endTime').value;
          
          if (!startTime && !endTime) return;
          
          const items = document.querySelectorAll('.screenshot-item');
          items.forEach(item => {
            const timestamp = new Date(item.getAttribute('data-timestamp'));
            let show = true;
            
            if (startTime && timestamp < new Date(startTime)) show = false;
            if (endTime && timestamp > new Date(endTime)) show = false;
            
            item.classList.toggle('hidden', !show);
          });

          updateCategoriesVisibility();
        };

        // Apply status filter
        window.applyStatusFilter = function() {
          const checkedStatuses = Array.from(
            document.querySelectorAll('.filter-section input[type="checkbox"]:checked')
          ).map(cb => cb.value);
          
          if (checkedStatuses.length === 0) {
            document.querySelectorAll('.screenshot-item').forEach(item => {
              item.classList.remove('hidden');
            });
          } else {
            document.querySelectorAll('.screenshot-item').forEach(item => {
              const status = item.getAttribute('data-status');
              item.classList.toggle('hidden', !checkedStatuses.includes(status));
            });
          }

          updateCategoriesVisibility();
        };

        // Update categories visibility
        function updateCategoriesVisibility() {
          document.querySelectorAll('.category-section').forEach(section => {
            const visibleItems = section.querySelectorAll('.screenshot-item:not(.hidden)');
            section.classList.toggle('hidden', visibleItems.length === 0);
          });
        }

        // Open lightbox
        window.openLightbox = function(screenshotId) {
          const screenshot = allScreenshots.find(s => s.id === screenshotId);
          if (!screenshot) return;
          
          currentLightboxIndex = allScreenshots.findIndex(s => s.id === screenshotId);
          showLightboxImage(screenshot);
          
          document.getElementById('screenshotLightbox').style.display = 'block';
          document.body.style.overflow = 'hidden';
        };

        // Close lightbox
        window.closeLightbox = function() {
          document.getElementById('screenshotLightbox').style.display = 'none';
          document.body.style.overflow = '';
        };

        // Navigate lightbox
        window.navigateLightbox = function(direction) {
          currentLightboxIndex += direction;
          
          if (currentLightboxIndex < 0) {
            currentLightboxIndex = allScreenshots.length - 1;
          } else if (currentLightboxIndex >= allScreenshots.length) {
            currentLightboxIndex = 0;
          }
          
          showLightboxImage(allScreenshots[currentLightboxIndex]);
        };

        // Show lightbox image
        function showLightboxImage(screenshot) {
          const img = document.getElementById('lightboxImage');
          const title = document.getElementById('lightboxTitle');
          const meta = document.getElementById('lightboxMeta');
          
          img.src = screenshot.base64 
            ? 'data:image/png;base64,' + screenshot.base64 
            : screenshot.path;
          img.alt = screenshot.name;
          
          title.textContent = screenshot.name;
          meta.innerHTML = \`
            <div>\${screenshot.scenario}</div>
            \${screenshot.step ? '<div>' + screenshot.step + '</div>' : ''}
            <div>\${new Date(screenshot.timestamp).toLocaleString()}</div>
          \`;
          
          // Store current screenshot data
          window.currentLightboxScreenshot = screenshot;
        }

        // Open comparison lightbox
        window.openComparisonLightbox = function(beforeId, afterId) {
          // For now, just open the before image
          openLightbox(beforeId);
        };

        // Update comparison slider
        window.updateComparison = function(pairIndex, value) {
          // This would implement image comparison logic
          // For now, it's just a visual indicator
        };

        // Download screenshot
        window.downloadScreenshot = function() {
          const screenshot = window.currentLightboxScreenshot;
          if (!screenshot) return;
          
          const link = document.createElement('a');
          link.download = screenshot.name + '.png';
          
          if (screenshot.base64) {
            link.href = 'data:image/png;base64,' + screenshot.base64;
          } else {
            link.href = screenshot.path;
          }
          
          link.click();
        };

        // Copy screenshot path
        window.copyScreenshotPath = function() {
          const screenshot = window.currentLightboxScreenshot;
          if (!screenshot || !screenshot.path) return;
          
          navigator.clipboard.writeText(screenshot.path).then(() => {
            // Show success notification
            const btn = event.target.closest('button');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.647-6.647a.5.5 0 0 1 .708 0z"/></svg> Copied!';
            setTimeout(() => {
              btn.innerHTML = originalText;
            }, 2000);
          });
        };

        // Keyboard navigation
        document.addEventListener('keydown', function(e) {
          const lightbox = document.getElementById('screenshotLightbox');
          if (lightbox.style.display === 'none') return;
          
          switch(e.key) {
            case 'Escape':
              closeLightbox();
              break;
            case 'ArrowLeft':
              navigateLightbox(-1);
              break;
            case 'ArrowRight':
              navigateLightbox(1);
              break;
          }
        });

        // Initialize
        initializeScreenshots();
      })();
    `;
  }
}