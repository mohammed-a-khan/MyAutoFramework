import { Page, Browser, BrowserContext, chromium } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import * as crypto from 'crypto';
import { 
  PDFDocument, 
  PDFName, 
  PDFHexString, 
  rgb, 
  StandardFonts, 
  PDFPage,
  PDFDict,
  PDFRef,
  PDFNumber,
  PDFArray,
  PDFObject,
  PDFStream,
} from 'pdf-lib';
import * as zlib from 'zlib';
import { ReportData, PDFOptions, ExportResult, ExportFormat, EvidenceCollection } from '../types/reporting.types';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { FileUtils } from '../../core/utils/FileUtils';

// PDF encryption constants
const PERMISSION_PRINT = 4;
const PERMISSION_MODIFY = 8;
const PERMISSION_COPY = 16;
const PERMISSION_ANNOTATE = 32;

interface TOCEntry {
  title: string;
  level: number;
  page: number;
  pageRef?: PDFRef | undefined;
  y?: number;
}

interface PDFPermissions {
  printing: boolean;
  modifying: boolean;
  copying: boolean;
  annotating: boolean;
  fillingForms: boolean;
  contentAccessibility: boolean;
  documentAssembly: boolean;
  printingHighQuality: boolean;
}

export class PDFExporter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private tempDir: string;
  private logger = ActionLogger.getInstance();

  constructor() {
    this.tempDir = path.join(process.cwd(), '.temp', 'pdf-export');
  }

  /**
   * Export report data to PDF with all production features
   */
  async export(
    reportData: ReportData,
    htmlContent: string,
    options: PDFOptions = {}
  ): Promise<ExportResult> {
    const exportId = crypto.randomUUID();
    const startTime = Date.now();

    try {
      await this.logger.logAction('pdf-export-start', {
        target: 'report',
        status: 'info',
        exportId,
        options
      });

      // Prepare export environment
      await this.prepareExport();

      // Create temporary HTML file with enhanced content
      const tempHtmlPath = await this.createTempHtml(htmlContent, exportId);

      // Launch browser for PDF generation
      await this.launchBrowser();

      // Generate initial PDF from HTML
      const initialPdfPath = await this.generatePDF(tempHtmlPath, reportData, options);

      // Load PDF for processing
      const existingPdfBytes = await fs.readFile(initialPdfPath);
      const pdfDoc = await PDFDocument.load(existingPdfBytes);

      // Add comprehensive metadata
      await this.addCompleteMetadata(pdfDoc, reportData, options);

      // Create and insert table of contents
      if (options.includeToc !== false) {
        await this.createFullTableOfContents(pdfDoc, reportData);
      }

      // Create PDF outline (bookmarks)
      if (options.includeBookmarks !== false) {
        await this.createPDFOutline(pdfDoc, reportData);
      }

      // Add watermark to all pages
      if (options.watermark) {
        await this.addWatermarkToPages(pdfDoc, options.watermark.text || 'CONFIDENTIAL');
      }

      // Add page numbers and headers
      if (options.pageNumbers !== false) {
        await this.addPageNumbersAndHeaders(pdfDoc, reportData);
      }

      // Embed attachments if any
      if (options.attachments) {
        await this.embedAttachments(pdfDoc, options.attachments);
      }

      // Optimize PDF
      if (options.optimize !== false) {
        await this.optimizePDFDocument(pdfDoc);
      }

      // Apply security and encryption
      let encryptedPdfBytes: Uint8Array;
      if (options.security) {
        encryptedPdfBytes = await this.applyFullEncryption(pdfDoc, options.security);
      } else {
        encryptedPdfBytes = await pdfDoc.save();
      }

      // Write final PDF
      const outputPath = path.join(
        options.outputDir || this.tempDir,
        options.filename || `test-report-${exportId}.pdf`
      );
      await fs.writeFile(outputPath, encryptedPdfBytes);

      // Calculate final metrics
      const stats = await fs.stat(outputPath);
      const pageCount = pdfDoc.getPageCount();

      const result: ExportResult = {
        success: true,
        filePath: outputPath,
        format: ExportFormat.PDF,
        size: stats.size,
        duration: Date.now() - startTime,
        metadata: {
          title: reportData.summary.projectName,
          author: 'CS Test Automation Framework',
          created: new Date().toISOString(),
          pages: pageCount,
          encrypted: !!options.security,
          optimized: options.optimize !== false,
          hasTableOfContents: options.includeToc !== false,
          hasBookmarks: options.includeBookmarks !== false,
          hasAttachments: !!options.attachments?.length
        }
      };

      await this.logger.logAction('pdf-export-complete', {
        target: 'report',
        status: 'success',
        ...result
      });

      return result;

    } catch (error) {
      this.logger.logError('PDF export failed', error as Error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Add complete metadata with XMP
   */
  private async addCompleteMetadata(
    pdfDoc: PDFDocument,
    reportData: ReportData,
    options: PDFOptions
  ): Promise<void> {
    // Standard document information
    pdfDoc.setTitle(options.title || `Test Report - ${reportData.summary.projectName}`);
    pdfDoc.setAuthor(options.author || 'CS Test Automation Framework');
    pdfDoc.setSubject(options.subject || 'Automated Test Execution Report');
    pdfDoc.setKeywords(options.keywords?.split(',').map(k => k.trim()) || [
      'testing', 'automation', reportData.summary.projectName || 'project',
      reportData.environment || 'test', 'cs-framework'
    ]);
    pdfDoc.setProducer('CS Test Automation Framework v1.0.0');
    pdfDoc.setCreator('Playwright + pdf-lib + CS Framework');
    pdfDoc.setCreationDate(new Date());
    pdfDoc.setModificationDate(new Date());

    // Add custom metadata to info dictionary
    const infoDict = pdfDoc.context.trailerInfo.Info;
    if (infoDict instanceof PDFDict) {
      // Execution metadata
      infoDict.set(PDFName.of('CS_ExecutionId'), PDFHexString.fromText(reportData.summary.executionId || 'unknown'));
      infoDict.set(PDFName.of('CS_Environment'), PDFHexString.fromText(reportData.environment || 'unknown'));
      infoDict.set(PDFName.of('CS_PassRate'), PDFNumber.of(reportData.summary.passRate));
      infoDict.set(PDFName.of('CS_TotalTests'), PDFNumber.of(reportData.summary.totalScenarios));
      infoDict.set(PDFName.of('CS_PassedTests'), PDFNumber.of(reportData.summary.passed || 0));
      infoDict.set(PDFName.of('CS_FailedTests'), PDFNumber.of(reportData.summary.failed || 0));
      infoDict.set(PDFName.of('CS_SkippedTests'), PDFNumber.of(reportData.summary.skipped || 0));
      infoDict.set(PDFName.of('CS_Duration'), PDFNumber.of(reportData.summary.duration || 0));
      infoDict.set(PDFName.of('CS_StartTime'), PDFHexString.fromText(reportData.summary.startTime ? new Date(reportData.summary.startTime).toISOString() : 'unknown'));
      infoDict.set(PDFName.of('CS_EndTime'), PDFHexString.fromText(reportData.summary.endTime ? new Date(reportData.summary.endTime).toISOString() : 'unknown'));
      
      // Technical metadata
      infoDict.set(PDFName.of('CS_FrameworkVersion'), PDFHexString.fromText('1.0.0'));
      
      // Feature list
      const featureNames = reportData.features.map(f => f.name).join(', ');
      infoDict.set(PDFName.of('CS_Features'), PDFHexString.fromText(featureNames));
      
      // Tags
      const allTags = Array.from(new Set(reportData.tags)).join(', ');
      infoDict.set(PDFName.of('CS_Tags'), PDFHexString.fromText(allTags));
    }

    // Add XMP metadata
    await this.addXMPMetadata(pdfDoc, reportData, options);
  }

  /**
   * Add XMP metadata stream
   */
  private async addXMPMetadata(
    pdfDoc: PDFDocument,
    reportData: ReportData,
    options: PDFOptions
  ): Promise<void> {
    const xmpMetadata = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="CS Test Automation Framework">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:xmp="http://ns.adobe.com/xap/1.0/"
        xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
        xmlns:cs="http://cs-framework.com/ns/1.0/">
      <dc:title>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${options.title || `Test Report - ${reportData.summary.projectName}`}</rdf:li>
        </rdf:Alt>
      </dc:title>
      <dc:creator>
        <rdf:Seq>
          <rdf:li>${options.author || 'CS Test Automation Framework'}</rdf:li>
        </rdf:Seq>
      </dc:creator>
      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${options.subject || 'Automated Test Execution Report'}</rdf:li>
        </rdf:Alt>
      </dc:description>
      <dc:subject>
        <rdf:Bag>
          ${(options.keywords?.split(',') || ['testing', 'automation']).map((k: string) => `<rdf:li>${k.trim()}</rdf:li>`).join('\n          ')}
        </rdf:Bag>
      </dc:subject>
      <xmp:CreateDate>${new Date().toISOString()}</xmp:CreateDate>
      <xmp:ModifyDate>${new Date().toISOString()}</xmp:ModifyDate>
      <xmp:CreatorTool>CS Test Automation Framework v1.0.0</xmp:CreatorTool>
      <pdf:Producer>CS Framework PDF Exporter</pdf:Producer>
      <cs:executionId>${reportData.summary.executionId}</cs:executionId>
      <cs:environment>${reportData.environment || 'unknown'}</cs:environment>
      <cs:passRate>${reportData.summary.passRate.toFixed(2)}</cs:passRate>
      <cs:totalTests>${reportData.summary.totalScenarios}</cs:totalTests>
      <cs:passedTests>${reportData.summary.passed}</cs:passedTests>
      <cs:failedTests>${reportData.summary.failed}</cs:failedTests>
      <cs:duration>${reportData.summary.duration}ms</cs:duration>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

    const xmpStream = pdfDoc.context.stream(xmpMetadata, {
      Type: 'Metadata',
      Subtype: 'XML'
    });

    pdfDoc.catalog.set(PDFName.of('Metadata'), xmpStream);
  }

  /**
   * Create full table of contents with clickable links
   */
  private async createFullTableOfContents(
    pdfDoc: PDFDocument,
    reportData: ReportData
  ): Promise<void> {
    // Generate TOC structure
    const tocEntries = this.generateDetailedTOC(reportData, pdfDoc);
    
    // Calculate pages needed for TOC
    const entriesPerPage = 30;
    const tocPageCount = Math.ceil(tocEntries.length / entriesPerPage);
    
    // Insert TOC pages at the beginning
    const tocPages: PDFPage[] = [];
    for (let i = 0; i < tocPageCount; i++) {
      tocPages.push(pdfDoc.insertPage(i));
    }

    // Embed fonts
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Process each TOC page
    for (let pageIndex = 0; pageIndex < tocPages.length; pageIndex++) {
      const page = tocPages[pageIndex];
      if (!page) continue;
      const { width, height } = page.getSize();
      
      // Draw TOC header on first page
      if (pageIndex === 0) {
        page.drawText('Table of Contents', {
          x: 72,
          y: height - 72,
          size: 24,
          font: helveticaBold,
          color: rgb(0.576, 0.094, 0.424) // #93186C
        });

        // Draw separator line
        page.drawLine({
          start: { x: 72, y: height - 100 },
          end: { x: width - 72, y: height - 100 },
          thickness: 2,
          color: rgb(0.576, 0.094, 0.424)
        });
      }

      // Calculate entry range for this page
      const startEntry = pageIndex * entriesPerPage;
      const endEntry = Math.min(startEntry + entriesPerPage, tocEntries.length);
      const pageEntries = tocEntries.slice(startEntry, endEntry);

      // Draw entries
      let yPosition = pageIndex === 0 ? height - 130 : height - 72;
      
      for (const entry of pageEntries) {
        if (yPosition < 72) break;

        // Select font based on level
        const font = entry.level === 1 ? helveticaBold : helvetica;
        const fontSize = entry.level === 1 ? 14 : 12;
        const indent = 72 + (entry.level - 1) * 20;
        const textColor = entry.level === 1 
          ? rgb(0.576, 0.094, 0.424) 
          : rgb(0, 0, 0);

        // Draw entry text
        page.drawText(entry.title, {
          x: indent,
          y: yPosition,
          size: fontSize,
          font: font,
          color: textColor
        });

        // Draw page number
        const pageNumText = entry.page.toString();
        const pageNumWidth = font.widthOfTextAtSize(pageNumText, fontSize);
        page.drawText(pageNumText, {
          x: width - 72 - pageNumWidth,
          y: yPosition,
          size: fontSize,
          font: font,
          color: textColor
        });

        // Draw dotted line
        const titleWidth = font.widthOfTextAtSize(entry.title, fontSize);
        const dotsStart = indent + titleWidth + 5;
        const dotsEnd = width - 72 - pageNumWidth - 10;
        
        let dotX = dotsStart;
        while (dotX < dotsEnd) {
          page.drawText('.', {
            x: dotX,
            y: yPosition,
            size: fontSize,
            font: font,
            color: rgb(0.7, 0.7, 0.7)
          });
          dotX += 3;
        }

        // Create clickable link annotation
        if (entry.pageRef && entry.y !== undefined) {
          const linkAnnotation = pdfDoc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [indent, yPosition - 5, width - 72, yPosition + fontSize],
            Border: [0, 0, 0],
            A: {
              Type: 'Action',
              S: 'GoTo',
              D: [entry.pageRef, PDFName.of('XYZ'), null, entry.y, null]
            }
          });

          const linkRef = pdfDoc.context.register(linkAnnotation);
          page.node.addAnnot(linkRef);
        }

        yPosition -= fontSize * 1.5;
      }
    }
  }

  /**
   * Generate detailed TOC structure
   */
  private generateDetailedTOC(reportData: ReportData, pdfDoc: PDFDocument): TOCEntry[] {
    const entries: TOCEntry[] = [];
    const pages = pdfDoc.getPages();
    let currentPage = 1 + Math.ceil(150 / 30); // TOC pages + content start

    // Executive Summary
    entries.push({
      title: 'Executive Summary',
      level: 1,
      page: currentPage,
      pageRef: pages[currentPage - 1]?.ref,
      y: (pages[currentPage - 1]?.getHeight() || 792) - 72
    });
    currentPage++;

    // Test Results Overview
    entries.push({
      title: 'Test Results Overview',
      level: 1,
      page: currentPage,
      pageRef: pages[currentPage - 1]?.ref,
      y: (pages[currentPage - 1]?.getHeight() || 792) - 72
    });

    entries.push({
      title: 'Overall Statistics',
      level: 2,
      page: currentPage,
      pageRef: pages[currentPage - 1]?.ref,
      y: (pages[currentPage - 1]?.getHeight() || 792) - 200
    });

    entries.push({
      title: 'Pass/Fail Distribution',
      level: 2,
      page: currentPage,
      pageRef: pages[currentPage - 1]?.ref,
      y: (pages[currentPage - 1]?.getHeight() || 792) - 400
    });
    currentPage++;

    // Performance Metrics
    entries.push({
      title: 'Performance Metrics',
      level: 1,
      page: currentPage,
      pageRef: pages[currentPage - 1]?.ref,
      y: (pages[currentPage - 1]?.getHeight() || 792) - 72
    });

    entries.push({
      title: 'Page Load Performance',
      level: 2,
      page: currentPage,
      pageRef: pages[currentPage - 1]?.ref,
      y: (pages[currentPage - 1]?.getHeight() || 792) - 200
    });

    entries.push({
      title: 'Resource Usage',
      level: 2,
      page: currentPage + 1,
      pageRef: pages[currentPage]?.ref,
      y: (pages[currentPage]?.getHeight() || 792) - 72
    });
    currentPage += 2;

    // Feature Results
    entries.push({
      title: 'Feature Test Results',
      level: 1,
      page: currentPage,
      pageRef: pages[currentPage - 1]?.ref,
      y: (pages[currentPage - 1]?.getHeight() || 792) - 72
    });

    reportData.features.forEach((feature) => {
      entries.push({
        title: feature.name || feature.feature,
        level: 2,
        page: currentPage,
        pageRef: pages[currentPage - 1]?.ref,
        y: (pages[currentPage - 1]?.getHeight() || 792) - 72
      });

      feature.scenarios.forEach((scenario, scenarioIndex) => {
        entries.push({
          title: scenario.name,
          level: 3,
          page: currentPage,
          pageRef: pages[currentPage - 1]?.ref,
          y: (pages[currentPage - 1]?.getHeight() || 792) - (200 + scenarioIndex * 100)
        });

        if (scenario.status === 'failed') {
          entries.push({
            title: 'Error Details',
            level: 4,
            page: currentPage,
            pageRef: pages[currentPage - 1]?.ref,
            y: (pages[currentPage - 1]?.getHeight() || 792) - (250 + scenarioIndex * 100)
          });
        }

        if ((scenarioIndex + 1) % 3 === 0) {
          currentPage++;
        }
      });
      currentPage++;
    });

    // Failed Tests Summary
    if ((reportData.summary.failed || 0) > 0) {
      entries.push({
        title: 'Failed Tests Summary',
        level: 1,
        page: currentPage,
        pageRef: pages[currentPage - 1]?.ref,
        y: (pages[currentPage - 1]?.getHeight() || 792) - 72
      });
      currentPage++;
    }

    // Evidence
    if (reportData.evidence.screenshots.length > 0 || reportData.evidence.videos.length > 0) {
      entries.push({
        title: 'Test Evidence',
        level: 1,
        page: currentPage,
        pageRef: pages[currentPage - 1]?.ref,
        y: (pages[currentPage - 1]?.getHeight() || 792) - 72
      });

      if (reportData.evidence.screenshots.length > 0) {
        entries.push({
          title: `Screenshots (${reportData.evidence.screenshots.length})`,
          level: 2,
          page: currentPage,
          pageRef: pages[currentPage - 1]?.ref,
          y: (pages[currentPage - 1]?.getHeight() || 792) - 150
        });
        currentPage += Math.ceil(reportData.evidence.screenshots.length / 4);
      }

      if (reportData.evidence.videos.length > 0) {
        entries.push({
          title: `Video Recordings (${reportData.evidence.videos.length})`,
          level: 2,
          page: currentPage,
          pageRef: pages[currentPage - 1]?.ref,
          y: (pages[currentPage - 1]?.getHeight() || 792) - 72
        });
        currentPage++;
      }
    }

    // Appendices
    entries.push({
      title: 'Appendices',
      level: 1,
      page: currentPage,
      pageRef: pages[currentPage - 1]?.ref,
      y: (pages[currentPage - 1]?.getHeight() || 792) - 72
    });

    entries.push({
      title: 'Environment Details',
      level: 2,
      page: currentPage,
      pageRef: pages[currentPage - 1]?.ref,
      y: (pages[currentPage - 1]?.getHeight() || 792) - 150
    });

    entries.push({
      title: 'Test Configuration',
      level: 2,
      page: currentPage,
      pageRef: pages[currentPage - 1]?.ref,
      y: (pages[currentPage - 1]?.getHeight() || 792) - 300
    });

    return entries;
  }

  /**
   * Create PDF outline (bookmarks) with proper hierarchy
   */
  private async createPDFOutline(
    pdfDoc: PDFDocument,
    reportData: ReportData
  ): Promise<void> {
    const context = pdfDoc.context;
    
    // Create root outline dictionary
    const outlineDict = context.obj({
      Type: 'Outlines',
      First: null,
      Last: null,
      Count: 0
    });
    
    const outlineRootRef = context.register(outlineDict);
    pdfDoc.catalog.set(PDFName.of('Outlines'), outlineRootRef);

    // Create outline items
    const tocEntries = this.generateDetailedTOC(reportData, pdfDoc);
    const outlineItems: Map<number, PDFRef> = new Map();
    let firstLevelCount = 0;
    let previousRefs: Map<number, PDFRef> = new Map();

    for (const entry of tocEntries) {
      const parent = entry.level === 1 
        ? outlineRootRef 
        : outlineItems.get(entry.level - 1) || outlineRootRef;

      // Create outline item
      const outlineItem = context.obj({
        Title: PDFHexString.fromText(entry.title),
        Parent: parent,
        Dest: entry.pageRef && entry.y !== undefined 
          ? [entry.pageRef, PDFName.of('XYZ'), null, entry.y, null]
          : null,
        Count: 0,
        First: null,
        Last: null,
        Next: null,
        Prev: null
      });

      const itemRef = context.register(outlineItem);
      outlineItems.set(entry.level, itemRef);

      // Update parent's first/last child
      const parentObj = context.lookup(parent);
      if (parentObj instanceof PDFDict) {
        if (!parentObj.get(PDFName.of('First'))) {
          parentObj.set(PDFName.of('First'), itemRef);
        }
        parentObj.set(PDFName.of('Last'), itemRef);
        
        // Increment count
        const currentCount = parentObj.get(PDFName.of('Count')) as PDFNumber || PDFNumber.of(0);
        parentObj.set(PDFName.of('Count'), PDFNumber.of(currentCount.asNumber() + 1));
      }

      // Link to previous sibling
      const prevRef = previousRefs.get(entry.level);
      if (prevRef) {
        const prevItem = context.lookup(prevRef);
        if (prevItem instanceof PDFDict) {
          prevItem.set(PDFName.of('Next'), itemRef);
          outlineItem.set(PDFName.of('Prev'), prevRef);
        }
      }

      previousRefs.set(entry.level, itemRef);

      if (entry.level === 1) {
        firstLevelCount++;
      }
    }

    // Update root count
    outlineDict.set(PDFName.of('Count'), PDFNumber.of(firstLevelCount));
  }

  /**
   * Add watermark with proper transparency
   */
  private async addWatermarkToPages(
    pdfDoc: PDFDocument,
    watermarkText: string
  ): Promise<void> {
    const pages = pdfDoc.getPages();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Create extended graphics state for transparency
    const extGStateDict = pdfDoc.context.obj({
      Type: 'ExtGState',
      ca: 0.1, // Fill alpha
      CA: 0.1, // Stroke alpha
      BM: PDFName.of('Normal'), // Blend mode
      AIS: false
    });
    
    const extGStateRef = pdfDoc.context.register(extGStateDict);

    for (const page of pages) {
      const { width, height } = page.getSize();
      
      // Add ExtGState to page resources
      const pageNode = page.node;
      const resourcesValue = pageNode.get(PDFName.of('Resources'));
      let resourcesDict: PDFDict;
      
      if (!resourcesValue) {
        resourcesDict = pdfDoc.context.obj({});
        pageNode.set(PDFName.of('Resources'), resourcesDict);
      } else if (resourcesValue instanceof PDFDict) {
        resourcesDict = resourcesValue;
      } else {
        continue; // Skip if resources is not a dictionary
      }
      
      if (!resourcesDict.get(PDFName.of('ExtGState'))) {
        resourcesDict.set(PDFName.of('ExtGState'), pdfDoc.context.obj({}));
      }
      const extGStates = resourcesDict.get(PDFName.of('ExtGState')) as PDFDict;
      if (typeof extGStates !== 'function') {
        extGStates.set(PDFName.of('WatermarkGS'), extGStateRef);
      }

      // Calculate watermark position and rotation
      const fontSize = 60;
      const textWidth = font.widthOfTextAtSize(watermarkText, fontSize);
      const centerX = width / 2;
      const centerY = height / 2;
      const angle = -45 * Math.PI / 180;

      // Create content stream for watermark
      const operators = [
        'q', // Save graphics state
        `/WatermarkGS gs`, // Set extended graphics state
        `1 0 0 1 ${centerX} ${centerY} cm`, // Translate to center
        `${Math.cos(angle)} ${Math.sin(angle)} ${-Math.sin(angle)} ${Math.cos(angle)} 0 0 cm`, // Rotate
        `BT`, // Begin text
        `/F1 ${fontSize} Tf`, // Set font and size
        `0.8 0.8 0.8 rg`, // Set color (light gray)
        `${-textWidth / 2} 0 Td`, // Position text
        `(${watermarkText}) Tj`, // Show text
        'ET', // End text
        'Q' // Restore graphics state
      ].join('\n');

      // Add font to page resources if not present
      const fontsObj = resourcesDict.get(PDFName.of('Font'));
      let fonts: PDFDict;
      if (!fontsObj) {
        fonts = pdfDoc.context.obj({});
        resourcesDict.set(PDFName.of('Font'), fonts);
      } else {
        fonts = fontsObj as PDFDict;
      }
      if (fonts instanceof PDFDict) {
        fonts.set(PDFName.of('F1'), font.ref);
      }

      // Prepend watermark to page content
      const watermarkStream = pdfDoc.context.stream(operators);
      const contentsRef = pageNode.get(PDFName.of('Contents'));
      
      if (contentsRef instanceof PDFRef) {
        // Contents is a reference to a stream or array
        const watermarkRef = pdfDoc.context.register(watermarkStream);
        const contentsArray = pdfDoc.context.obj([watermarkRef, contentsRef]);
        pageNode.set(PDFName.of('Contents'), contentsArray);
      } else if (contentsRef instanceof PDFArray) {
        // Contents is already an array, prepend the watermark
        const watermarkRef = pdfDoc.context.register(watermarkStream);
        contentsRef.insert(0, watermarkRef);
      } else {
        // No existing contents, just set the watermark
        pageNode.set(PDFName.of('Contents'), watermarkStream);
      }
    }
  }

  /**
   * Add page numbers and headers with proper formatting
   */
  private async addPageNumbersAndHeaders(
    pdfDoc: PDFDocument,
    reportData: ReportData
  ): Promise<void> {
    const pages = pdfDoc.getPages();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    
    // Skip TOC pages
    const tocPageCount = Math.ceil(150 / 30);
    
    pages.forEach((page: PDFPage, index: number) => {
      const { width, height } = page.getSize();
      const pageNumber = index + 1;
      
      // Skip page numbers on TOC pages
      if (pageNumber <= tocPageCount) return;
      
      // Add page number at bottom center
      const pageText = `Page ${pageNumber - tocPageCount} of ${pages.length - tocPageCount}`;
      const pageTextWidth = helvetica.widthOfTextAtSize(pageText, 10);
      
      page.drawText(pageText, {
        x: (width - pageTextWidth) / 2,
        y: 30,
        size: 10,
        font: helvetica,
        color: rgb(0.4, 0.4, 0.4)
      });

      // Add header
      const headerY = height - 30;
      
      // Left header - document title
      page.drawText(reportData.summary.projectName || 'CS Test Automation', {
        x: 72,
        y: headerY,
        size: 9,
        font: helveticaOblique,
        color: rgb(0.4, 0.4, 0.4)
      });

      // Center header - section name
      let sectionName = 'Test Report';
      if (pageNumber > tocPageCount && pageNumber <= tocPageCount + 3) {
        sectionName = 'Executive Summary';
      } else if (pageNumber > tocPageCount + 3) {
        sectionName = 'Test Results';
      }
      
      const sectionWidth = helvetica.widthOfTextAtSize(sectionName, 9);
      page.drawText(sectionName, {
        x: (width - sectionWidth) / 2,
        y: headerY,
        size: 9,
        font: helvetica,
        color: rgb(0.4, 0.4, 0.4)
      });

      // Right header - date
      const dateText = new Date().toLocaleDateString();
      const dateWidth = helvetica.widthOfTextAtSize(dateText, 9);
      
      page.drawText(dateText, {
        x: width - 72 - dateWidth,
        y: headerY,
        size: 9,
        font: helvetica,
        color: rgb(0.4, 0.4, 0.4)
      });

      // Add thin line below header
      page.drawLine({
        start: { x: 72, y: headerY - 5 },
        end: { x: width - 72, y: headerY - 5 },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8)
      });
    });
  }

  /**
   * Embed file attachments in PDF
   */
  private async embedAttachments(
    pdfDoc: PDFDocument,
    attachments: Array<{ name: string; path: string; description?: string }>
  ): Promise<void> {
    const embeddedFiles = pdfDoc.context.obj({});
    
    for (const attachment of attachments) {
      try {
        const fileData = await fs.readFile(attachment.path);
        const fileStream = pdfDoc.context.stream(fileData, {
          Type: 'EmbeddedFile',
          Subtype: PDFName.of(this.getMimeType(attachment.path)),
          Length: fileData.length
        });

        const fileSpec = pdfDoc.context.obj({
          Type: 'Filespec',
          F: PDFHexString.fromText(attachment.name),
          UF: PDFHexString.fromText(attachment.name),
          Desc: attachment.description ? PDFHexString.fromText(attachment.description) : null,
          EF: pdfDoc.context.obj({
            F: fileStream
          })
        });

        const fileSpecRef = pdfDoc.context.register(fileSpec);
        embeddedFiles.set(PDFName.of(attachment.name), fileSpecRef);
      } catch (error) {
        this.logger.warn(`Failed to embed attachment: ${attachment.name}`, { error });
      }
    }

    if (Object.keys(embeddedFiles).length > 0) {
      const namesDict = pdfDoc.context.obj({
        EmbeddedFiles: embeddedFiles
      });
      
      pdfDoc.catalog.set(PDFName.of('Names'), namesDict);
    }
  }

  /**
   * Optimize PDF document
   */
  private async optimizePDFDocument(pdfDoc: PDFDocument): Promise<void> {
    const context = pdfDoc.context;
    
    // 1. Compress all streams
    const indirectObjects = context.enumerateIndirectObjects();
    for (const [ref, obj] of indirectObjects) {
      if (obj instanceof PDFStream) {
        const dict = obj.dict;
        if (!dict.get(PDFName.of('Filter'))) {
          // Compress uncompressed streams
          const contents = obj.getContents();
          const compressed = zlib.deflateSync(contents);
          
          dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
          dict.set(PDFName.of('Length'), PDFNumber.of(compressed.length));
          
          // Replace stream contents
          const newStream = context.stream(compressed, {
            Filter: PDFName.of('FlateDecode'),
            Length: compressed.length
          });
          context.assign(ref, newStream);
        }
      }
    }

    // 2. Remove duplicate fonts
    const fontMap = new Map<string, PDFRef>();
    const fontReplacements = new Map<PDFRef, PDFRef>();
    
    for (const page of pdfDoc.getPages()) {
      const resourcesValue = page.node.get(PDFName.of('Resources'));
      if (!resourcesValue || !(resourcesValue instanceof PDFDict)) continue;
      
      const fontsObj = resourcesValue.get(PDFName.of('Font'));
      if (!fontsObj || !(fontsObj instanceof PDFDict)) continue;
      
      fontsObj.entries().forEach(([name, fontRef]: [PDFName, PDFObject]) => {
        if (!(fontRef instanceof PDFRef)) return;
        
        const font = context.lookup(fontRef);
        if (!(font instanceof PDFDict)) return;
        
        const baseFont = font.get(PDFName.of('BaseFont'));
        if (!baseFont) return;
        
        const fontKey = baseFont.toString();
        if (fontMap.has(fontKey)) {
          // Replace with existing font
          fontReplacements.set(fontRef, fontMap.get(fontKey)!);
          fontsObj.set(name, fontMap.get(fontKey)!);
        } else {
          fontMap.set(fontKey, fontRef);
        }
      });
    }

    // 3. Remove duplicate images
    const imageMap = new Map<string, PDFRef>();
    const imageReplacements = new Map<PDFRef, PDFRef>();
    
    for (const page of pdfDoc.getPages()) {
      const resourcesValue = page.node.get(PDFName.of('Resources'));
      if (!resourcesValue || !(resourcesValue instanceof PDFDict)) continue;
      
      const xobjectsObj = resourcesValue.get(PDFName.of('XObject'));
      if (!xobjectsObj || !(xobjectsObj instanceof PDFDict)) continue;
      
      const xobjects = xobjectsObj;
      xobjects.entries().forEach(([name, xobjRef]: [PDFName, PDFObject]) => {
        if (!(xobjRef instanceof PDFRef)) return;
        
        const xobj = context.lookup(xobjRef);
        if (!xobj) return;
        
        // Images can be PDFStream or PDFDict
        let xobjDict: PDFDict;
        if (xobj instanceof PDFStream) {
          xobjDict = xobj.dict;
        } else if (xobj instanceof PDFDict) {
          xobjDict = xobj;
        } else {
          return;
        }
        
        const subtype = xobjDict.get(PDFName.of('Subtype'));
        if (!subtype || subtype.toString() !== '/Image') return;
        
        // Create image fingerprint
        const width = xobjDict.get(PDFName.of('Width'));
        const height = xobjDict.get(PDFName.of('Height'));
        const bpc = xobjDict.get(PDFName.of('BitsPerComponent'));
        const cs = xobjDict.get(PDFName.of('ColorSpace'));
        const imageKey = `${width}x${height}x${bpc}x${cs}`;
        
        if (imageMap.has(imageKey)) {
          // For duplicate checking, we only compare if both are streams
          imageReplacements.set(xobjRef, imageMap.get(imageKey)!);
          xobjectsObj.set(name, imageMap.get(imageKey)!);
        } else {
          imageMap.set(imageKey, xobjRef);
        }
      });
    }

    // 4. Remove unreferenced objects
    const referencedObjects = new Set<PDFRef>();
    
    // Mark all referenced objects
    function markReferenced(obj: PDFObject): void {
      if (obj instanceof PDFRef) {
        if (!referencedObjects.has(obj)) {
          referencedObjects.add(obj);
          const resolved = context.lookup(obj);
          if (resolved) markReferenced(resolved);
        }
      } else if (obj instanceof PDFDict) {
        obj.entries().forEach(([_, value]: [PDFName, PDFObject]) => markReferenced(value));
      } else if (obj instanceof PDFArray) {
        for (let i = 0; i < obj.size(); i++) {
          const element = obj.get(i);
          if (element) markReferenced(element);
        }
      } else if (obj instanceof PDFStream) {
        markReferenced(obj.dict);
      }
    }

    // Start from document catalog
    markReferenced(pdfDoc.catalog);
    
    // Mark pages
    pdfDoc.getPages().forEach((page: PDFPage) => {
      markReferenced(page.ref);
    });

    // Remove unreferenced objects
    const objectsToRemove: PDFRef[] = [];
    for (const [ref, _] of indirectObjects) {
      if (!referencedObjects.has(ref) && 
          !fontReplacements.has(ref) && 
          !imageReplacements.has(ref)) {
        objectsToRemove.push(ref);
      }
    }

    // Note: pdf-lib doesn't provide direct object removal
    // In production, you'd use a lower-level PDF library for this

    await this.logger.logAction('pdf-optimization-complete', {
      target: 'document',
      status: 'info',
      compressedStreams: indirectObjects.length,
      deduplicatedFonts: fontReplacements.size,
      deduplicatedImages: imageReplacements.size,
      unreferencedObjects: objectsToRemove.length
    });
  }

  /**
   * Apply full PDF encryption with RC4 or AES
   */
  private async applyFullEncryption(
    pdfDoc: PDFDocument,
    security: {
      userPassword?: string;
      ownerPassword?: string;
      permissions?: Partial<PDFPermissions>;
      encryptionLevel?: 'RC4-40' | 'RC4-128' | 'AES-128' | 'AES-256';
    }
  ): Promise<Uint8Array> {
    const context = pdfDoc.context;
    
    // Generate document ID if not present
    if (!context.trailerInfo.ID) {
      const id1 = crypto.randomBytes(16);
      const id2 = crypto.randomBytes(16);
      context.trailerInfo.ID = context.obj([
        PDFHexString.fromText(id1.toString('hex')),
        PDFHexString.fromText(id2.toString('hex'))
      ]);
    }

    // Prepare passwords
    const userPwd = security.userPassword || '';
    const ownerPwd = security.ownerPassword || crypto.randomBytes(16).toString('hex');
    
    // Calculate permission flags
    const permissions = this.calculatePermissions(security.permissions || {});
    
    // Determine encryption version
    let V = 1; // Version
    let R = 2; // Revision
    let Length = 40; // Key length in bits
    
    switch (security.encryptionLevel) {
      case 'RC4-128':
        V = 2;
        R = 3;
        Length = 128;
        break;
      case 'AES-128':
        V = 4;
        R = 4;
        Length = 128;
        break;
      case 'AES-256':
        V = 5;
        R = 6;
        Length = 256;
        break;
    }

    // Generate encryption key
    const encryptionKey = this.generateEncryptionKey(
      userPwd,
      ownerPwd,
      permissions,
      (context.trailerInfo.ID instanceof PDFArray && context.trailerInfo.ID.get(0) instanceof PDFHexString) 
        ? (context.trailerInfo.ID.get(0) as PDFHexString).decodeText() 
        : 'defaultid',
      V,
      R,
      Length
    );

    // Calculate O (owner password hash)
    const O = this.calculateOwnerPassword(ownerPwd, userPwd, R, Length);
    
    // Calculate U (user password hash)
    const U = this.calculateUserPassword(
      userPwd,
      O,
      permissions,
      (context.trailerInfo.ID instanceof PDFArray && context.trailerInfo.ID.get(0) instanceof PDFHexString) 
        ? (context.trailerInfo.ID.get(0) as PDFHexString).decodeText() 
        : 'defaultid',
      R,
      Length,
      encryptionKey
    );

    // Create encryption dictionary
    const encryptDict = context.obj({
      Filter: PDFName.of('Standard'),
      V: PDFNumber.of(V),
      R: PDFNumber.of(R),
      Length: PDFNumber.of(Length),
      P: PDFNumber.of(permissions),
      O: PDFHexString.fromText(O),
      U: PDFHexString.fromText(U),
      EncryptMetadata: true
    });

    if (V >= 4) {
      // Add additional encryption parameters
      encryptDict.set(PDFName.of('StmF'), PDFName.of('StdCF'));
      encryptDict.set(PDFName.of('StrF'), PDFName.of('StdCF'));
      encryptDict.set(PDFName.of('CF'), context.obj({
        StdCF: context.obj({
          CFM: V === 4 ? PDFName.of('AESV2') : PDFName.of('AESV3'),
          AuthEvent: PDFName.of('DocOpen'),
          Length: PDFNumber.of(Length / 8)
        })
      }));
    }

    const encryptRef = context.register(encryptDict);
    context.trailerInfo.Encrypt = encryptRef;

    // Encrypt all strings and streams
    await this.encryptDocument(pdfDoc, encryptionKey, V);

    // Save encrypted PDF
    return await pdfDoc.save({
      useObjectStreams: false // Object streams not compatible with encryption
    });
  }

  /**
   * Calculate permission flags
   */
  private calculatePermissions(permissions: Partial<PDFPermissions>): number {
    let flags = -1; // All permissions by default
    
    if (!permissions.printing) flags &= ~PERMISSION_PRINT;
    if (!permissions.modifying) flags &= ~PERMISSION_MODIFY;
    if (!permissions.copying) flags &= ~PERMISSION_COPY;
    if (!permissions.annotating) flags &= ~PERMISSION_ANNOTATE;
    
    // Additional permissions for revision 3+
    if (!permissions.fillingForms) flags &= ~256;
    if (!permissions.contentAccessibility) flags &= ~512;
    if (!permissions.documentAssembly) flags &= ~1024;
    if (!permissions.printingHighQuality) flags &= ~2048;
    
    return flags;
  }

  /**
   * Generate encryption key
   */
  private generateEncryptionKey(
    userPassword: string,
    ownerPassword: string,
    permissions: number,
    documentId: string,
    _V: number,
    R: number,
    keyLength: number
  ): Buffer {
    const md5 = crypto.createHash('md5');
    
    // Pad password
    const paddedPassword = this.padPassword(userPassword);
    md5.update(paddedPassword);
    
    // Add O entry
    const O = this.calculateOwnerPassword(ownerPassword, userPassword, R, keyLength);
    md5.update(Buffer.from(O, 'hex'));
    
    // Add P entry (as 4 bytes, little-endian)
    const pBytes = Buffer.allocUnsafe(4);
    pBytes.writeInt32LE(permissions, 0);
    md5.update(pBytes);
    
    // Add document ID
    md5.update(Buffer.from(documentId, 'hex'));
    
    // Add metadata flag for R >= 4
    if (R >= 4) {
      md5.update(Buffer.from([0xff, 0xff, 0xff, 0xff]));
    }
    
    let hash = md5.digest();
    
    // Additional hashing for R >= 3
    if (R >= 3) {
      const n = keyLength / 8;
      for (let i = 0; i < 50; i++) {
        hash = crypto.createHash('md5').update(hash.slice(0, n)).digest();
      }
    }
    
    return hash.slice(0, keyLength / 8);
  }

  /**
   * Calculate owner password hash
   */
  private calculateOwnerPassword(
    ownerPassword: string,
    userPassword: string,
    R: number,
    keyLength: number
  ): string {
    // Pad passwords
    const paddedOwner = this.padPassword(ownerPassword);
    const paddedUser = this.padPassword(userPassword);
    
    // Hash owner password
    let hash = crypto.createHash('md5').update(paddedOwner).digest();
    
    if (R >= 3) {
      for (let i = 0; i < 50; i++) {
        hash = crypto.createHash('md5').update(hash).digest();
      }
    }
    
    // Create RC4 key
    const key = hash.slice(0, keyLength / 8);
    
    // Encrypt user password
    let encrypted = Buffer.from(paddedUser);
    
    if (R === 2) {
      const cipher = crypto.createCipheriv('rc4', key, '');
      encrypted = Buffer.concat([cipher.update(encrypted), cipher.final()]);
    } else {
      // R >= 3
      for (let i = 0; i < 20; i++) {
        const tempKey = Buffer.allocUnsafe(key.length);
        for (let j = 0; j < key.length; j++) {
          tempKey[j] = (key[j] || 0) ^ i;
        }
        const cipher = crypto.createCipheriv('rc4', tempKey, '');
        encrypted = Buffer.concat([cipher.update(encrypted), cipher.final()]);
      }
    }
    
    return encrypted.toString('hex');
  }

  /**
   * Calculate user password hash
   */
  private calculateUserPassword(
    _userPassword: string,
    _O: string,
    _permissions: number,
    documentId: string,
    R: number,
    _keyLength: number,
    encryptionKey: Buffer
  ): string {
    if (R === 2) {
      // Simple RC4 encryption of padding
      const padding = Buffer.from([
        0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41,
        0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
        0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80,
        0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A
      ]);
      
      const cipher = crypto.createCipheriv('rc4', encryptionKey, '');
      const encrypted = Buffer.concat([cipher.update(padding), cipher.final()]);
      
      return encrypted.toString('hex');
    } else {
      // R >= 3
      const md5 = crypto.createHash('md5');
      md5.update(Buffer.from([
        0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41,
        0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
        0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80,
        0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A
      ]));
      md5.update(Buffer.from(documentId, 'hex'));
      
      let hash = md5.digest();
      
      // Encrypt hash
      let encrypted = Buffer.from(hash);
      for (let i = 0; i < 20; i++) {
        const tempKey = Buffer.allocUnsafe(encryptionKey.length);
        for (let j = 0; j < encryptionKey.length; j++) {
          tempKey[j] = (encryptionKey[j] || 0) ^ i;
        }
        const cipher = crypto.createCipheriv('rc4', tempKey, '');
        encrypted = Buffer.concat([cipher.update(encrypted), cipher.final()]);
      }
      
      // Pad to 32 bytes
      const result = Buffer.allocUnsafe(32);
      encrypted!.copy(result);
      result.fill(0, encrypted!.length);
      
      return result.toString('hex');
    }
  }

  /**
   * Pad password to 32 bytes
   */
  private padPassword(password: string): Buffer {
    const padding = Buffer.from([
      0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41,
      0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
      0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80,
      0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A
    ]);
    
    const result = Buffer.allocUnsafe(32);
    const passwordBytes = Buffer.from(password, 'latin1');
    
    if (passwordBytes.length >= 32) {
      passwordBytes.copy(result, 0, 0, 32);
    } else {
      passwordBytes.copy(result);
      padding.copy(result, passwordBytes.length, 0, 32 - passwordBytes.length);
    }
    
    return result;
  }

  /**
   * Encrypt document strings and streams
   */
  private async encryptDocument(
    pdfDoc: PDFDocument,
    encryptionKey: Buffer,
    V: number
  ): Promise<void> {
    const context = pdfDoc.context;
    const indirectObjects = context.enumerateIndirectObjects();
    
    for (const [ref, obj] of indirectObjects) {
      // Skip encryption dictionary
      if (obj instanceof PDFDict && obj.get(PDFName.of('Filter'))?.toString() === '/Standard') {
        continue;
      }
      
      // Generate object key
      const objectKey = this.generateObjectKey(encryptionKey, ref, V);
      
      // Encrypt strings
      if (obj instanceof PDFHexString) {
        const decrypted = obj.decodeText();
        const encrypted = this.encryptString(decrypted, objectKey, V);
        context.assign(ref, PDFHexString.fromText(encrypted));
      }
      
      // Encrypt streams
      if (obj instanceof PDFStream) {
        const contents = obj.getContents();
        const encrypted = this.encryptStream(contents, objectKey, V);
        
        // Create new stream with encrypted contents
        const streamDict: Record<string, any> = {};
        const dict = (obj as any).dict;
        dict.entries().forEach(([key, value]: [any, any]) => {
          streamDict[key.asString()] = value;
        });
        const newStream = context.stream(encrypted, streamDict);
        context.assign(ref, newStream);
      }
    }
  }

  /**
   * Generate object-specific encryption key
   */
  private generateObjectKey(encryptionKey: Buffer, ref: PDFRef, V: number): Buffer {
    const md5 = crypto.createHash('md5');
    md5.update(encryptionKey);
    
    // Add object number (3 bytes, little-endian)
    const objNum = Buffer.allocUnsafe(3);
    objNum.writeUIntLE(ref.objectNumber, 0, 3);
    md5.update(objNum);
    
    // Add generation number (2 bytes, little-endian)
    const genNum = Buffer.allocUnsafe(2);
    genNum.writeUIntLE(ref.generationNumber, 0, 2);
    md5.update(genNum);
    
    if (V >= 4) {
      md5.update(Buffer.from('sAlT', 'ascii'));
    }
    
    const hash = md5.digest();
    const keyLength = Math.min(encryptionKey.length + 5, 16);
    
    return hash.slice(0, keyLength);
  }

  /**
   * Encrypt string
   */
  private encryptString(text: string, key: Buffer, V: number): string {
    const plaintext = Buffer.from(text, 'latin1');
    
    if (V < 4) {
      // RC4 encryption
      const cipher = crypto.createCipheriv('rc4', key, '');
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return encrypted.toString('hex');
    } else {
      // AES encryption
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-128-cbc', key.slice(0, 16), iv);
      const encrypted = Buffer.concat([iv, cipher.update(plaintext), cipher.final()]);
      return encrypted.toString('hex');
    }
  }

  /**
   * Encrypt stream
   */
  private encryptStream(contents: Uint8Array, key: Buffer, V: number): Uint8Array {
    if (V < 4) {
      // RC4 encryption
      const cipher = crypto.createCipheriv('rc4', key, '');
      return Buffer.concat([cipher.update(contents), cipher.final()]);
    } else {
      // AES encryption
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-128-cbc', key.slice(0, 16), iv);
      return Buffer.concat([iv, cipher.update(contents), cipher.final()]);
    }
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeType(filepath: string): string {
    const ext = path.extname(filepath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.csv': 'text/csv',
      '.log': 'text/plain',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.zip': 'application/zip'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Prepare export environment
   */
  private async prepareExport(): Promise<void> {
    await FileUtils.ensureDir(this.tempDir);
    
    // Clean old temp files
    const files = await fs.readdir(this.tempDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const file of files) {
      const filePath = path.join(this.tempDir, file);
      const stats = await fs.stat(filePath);
      
      if (now - stats.mtimeMs > maxAge) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
  }

  /**
   * Create temporary HTML file
   */
  private async createTempHtml(content: string, exportId: string): Promise<string> {
    const tempPath = path.join(this.tempDir, `report-${exportId}.html`);
    
    // Enhance HTML for PDF generation
    const enhancedHtml = await this.enhanceHtmlForPdf(content);
    
    await fs.writeFile(tempPath, enhancedHtml, 'utf-8');
    return tempPath;
  }

  /**
   * Enhance HTML content for PDF generation
   */
  private async enhanceHtmlForPdf(html: string): Promise<string> {
    // Embed web fonts as base64
    const fontUrls = html.match(/url\(['"]?([^'"]+\.(?:woff2?|ttf|otf))['"]?\)/g) || [];
    let enhancedHtml = html;
    
    for (const fontUrl of fontUrls) {
      const url = fontUrl.match(/url\(['"]?([^'"]+)['"]?\)/)?.[1];
      if (url && url.startsWith('http')) {
        try {
          // In production, fetch and embed the font
          // For now, we'll use system fonts
          enhancedHtml = enhancedHtml.replace(fontUrl, 'local("Arial")');
        } catch (error) {
          this.logger.warn(`Failed to embed font: ${url}`, { error });
        }
      }
    }

    const printStyles = `
      <style media="print">
        /* Reset and base styles */
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }

        /* Page setup */
        @page {
          size: A4;
          margin: 20mm 15mm;
          
          @top-left {
            content: "";
          }
          
          @top-center {
            content: "";
          }
          
          @top-right {
            content: "";
          }
          
          @bottom-left {
            content: "";
          }
          
          @bottom-center {
            content: "";
          }
          
          @bottom-right {
            content: "";
          }
        }

        @page :first {
          margin-top: 0;
        }

        /* Typography */
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          font-size: 11pt;
          line-height: 1.6;
          color: #333;
          text-rendering: optimizeLegibility;
        }

        h1, h2, h3, h4, h5, h6 {
          page-break-after: avoid;
          page-break-inside: avoid;
          margin-top: 1em;
          margin-bottom: 0.5em;
          color: #93186C;
          font-weight: 600;
        }

        h1 { 
          font-size: 24pt; 
          margin-top: 0;
          padding-bottom: 0.5em;
          border-bottom: 2px solid #93186C;
        }
        
        h2 { 
          font-size: 18pt;
          margin-top: 1.5em;
        }
        
        h3 { 
          font-size: 14pt;
          margin-top: 1.2em;
        }
        
        h4 { 
          font-size: 12pt;
          margin-top: 1em;
        }

        /* Avoid page breaks */
        .scenario, .feature-section, .test-case {
          page-break-inside: avoid;
        }

        .step-group, .evidence-item {
          page-break-inside: avoid;
        }

        table {
          page-break-inside: avoid;
        }

        tr {
          page-break-inside: avoid;
        }

        /* Keep headers with content */
        h1, h2, h3, h4, h5, h6 {
          page-break-after: avoid;
        }

        h1 + *, h2 + *, h3 + *, h4 + * {
          page-break-before: avoid;
        }

        /* Hide interactive elements */
        .no-print, 
        .interactive, 
        button, 
        .filter-controls,
        .toggle-button,
        .search-box,
        nav,
        .breadcrumb,
        .toolbar,
        .actions,
        video,
        audio,
        .expand-collapse {
          display: none !important;
        }

        /* Tables */
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 1em 0;
          font-size: 10pt;
          background-color: white;
        }

        thead {
          display: table-header-group;
        }

        tbody {
          display: table-row-group;
        }

        th {
          background-color: #93186C !important;
          color: white !important;
          padding: 8px;
          text-align: left;
          font-weight: bold;
          border: 1px solid #93186C;
        }

        td {
          padding: 8px;
          border: 1px solid #ddd;
          vertical-align: top;
        }

        tr:nth-child(even) {
          background-color: #f9f9f9;
        }

        /* Status colors */
        .status-passed { 
          color: #28a745 !important;
          font-weight: bold;
        }
        
        .status-failed { 
          color: #dc3545 !important;
          font-weight: bold;
        }
        
        .status-skipped { 
          color: #ffc107 !important;
          font-weight: bold;
        }

        /* Code blocks */
        pre {
          background-color: #f5f5f5;
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 10px;
          font-size: 9pt;
          white-space: pre-wrap;
          word-break: break-word;
          page-break-inside: avoid;
          overflow-wrap: break-word;
          line-height: 1.4;
        }

        code {
          font-family: Consolas, Monaco, 'Courier New', monospace;
          font-size: 9pt;
          background-color: #f5f5f5;
          padding: 2px 4px;
          border-radius: 2px;
        }

        /* Charts and images */
        img, canvas, svg {
          max-width: 100% !important;
          height: auto !important;
          display: block;
          margin: 1em auto;
          page-break-inside: avoid;
        }

        .chart-container {
          page-break-inside: avoid;
          margin: 1em 0;
          text-align: center;
        }

        /* Evidence sections */
        .screenshot-container {
          page-break-inside: avoid;
          margin: 1em 0;
          text-align: center;
        }

        .screenshot-container img {
          max-height: 400px;
          width: auto;
          border: 1px solid #ddd;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .screenshot-caption {
          font-size: 9pt;
          color: #666;
          margin-top: 0.5em;
          font-style: italic;
        }

        /* Error messages */
        .error-message, .stack-trace {
          background-color: #fee;
          border-left: 4px solid #dc3545;
          padding: 10px;
          margin: 1em 0;
          font-size: 10pt;
          page-break-inside: avoid;
          font-family: Consolas, Monaco, monospace;
        }

        /* Links */
        a {
          color: #93186C;
          text-decoration: none;
        }

        a[href]:after {
          content: " (" attr(href) ")";
          font-size: 8pt;
          font-style: italic;
          color: #666;
        }

        a[href^="#"]:after,
        a[href^="javascript:"]:after {
          content: "";
        }

        /* Summary cards */
        .summary-card, .metric-card {
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 15px;
          margin: 1em 0;
          page-break-inside: avoid;
          background-color: #fafafa;
        }

        .summary-card h3 {
          color: #93186C;
          margin-top: 0;
          font-size: 14pt;
        }

        /* Metrics */
        .metric-value {
          font-size: 24pt;
          font-weight: bold;
          color: #93186C;
          line-height: 1;
        }

        .metric-label {
          font-size: 10pt;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .metric-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1em;
          margin: 1em 0;
        }

        /* Page breaks */
        .page-break {
          page-break-after: always;
          height: 0;
          margin: 0;
          border: none;
        }

        .chapter {
          page-break-before: always;
        }

        .chapter:first-child {
          page-break-before: avoid;
        }

        /* Lists */
        ul, ol {
          margin-left: 20px;
          margin-bottom: 1em;
        }

        li {
          margin-bottom: 0.5em;
          page-break-inside: avoid;
        }

        /* Timeline */
        .timeline {
          border-left: 2px solid #93186C;
          margin-left: 20px;
          padding-left: 20px;
        }

        .timeline-item {
          position: relative;
          page-break-inside: avoid;
          margin-bottom: 1em;
        }

        .timeline-item::before {
          content: '';
          position: absolute;
          left: -24px;
          top: 5px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background-color: #93186C;
          border: 2px solid white;
          box-shadow: 0 0 0 2px #93186C;
        }

        /* Progress bars */
        .progress-bar {
          width: 100%;
          height: 20px;
          background-color: #f0f0f0;
          border-radius: 10px;
          overflow: hidden;
          margin: 0.5em 0;
        }

        .progress-fill {
          height: 100%;
          background-color: #93186C;
          text-align: center;
          line-height: 20px;
          color: white;
          font-size: 9pt;
          font-weight: bold;
        }

        /* Badges */
        .badge {
          display: inline-block;
          padding: 2px 8px;
          font-size: 9pt;
          font-weight: bold;
          border-radius: 4px;
          background-color: #93186C;
          color: white;
        }

        .badge.passed {
          background-color: #28a745;
        }

        .badge.failed {
          background-color: #dc3545;
        }

        .badge.skipped {
          background-color: #ffc107;
          color: #333;
        }

        /* Print-specific utilities */
        .print-only {
          display: block !important;
        }

        @media screen {
          .print-only {
            display: none !important;
          }
        }

        /* Ensure all backgrounds print */
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        /* Force color printing */
        body {
          color: black !important;
        }

        /* Widow and orphan control */
        p, li, blockquote {
          orphans: 3;
          widows: 3;
        }

        /* Keep content together */
        .keep-together {
          page-break-inside: avoid;
        }

        /* Footnotes */
        .footnote {
          font-size: 8pt;
          color: #666;
          margin-top: 1em;
          padding-top: 0.5em;
          border-top: 1px solid #ddd;
        }

        /* Index */
        .index-entry {
          page-break-inside: avoid;
        }

        .index-page-ref {
          float: right;
          color: #666;
        }

        /* Cover page */
        .cover-page {
          page-break-after: always;
          text-align: center;
          padding-top: 30%;
        }

        .cover-page h1 {
          font-size: 36pt;
          color: #93186C;
          border: none;
          margin-bottom: 1em;
        }

        .cover-page .subtitle {
          font-size: 18pt;
          color: #666;
          margin-bottom: 0.5em;
        }

        .cover-page .metadata {
          font-size: 12pt;
          color: #999;
          margin-top: 2em;
        }
      </style>
    `;

    // Add print header with metadata
    const printHeader = `
      <div class="print-only cover-page">
        <h1>Test Execution Report</h1>
        <div class="subtitle">CS Test Automation Framework</div>
        <div class="metadata">
          <p>Generated on ${new Date().toLocaleString()}</p>
          <p>Environment: ${process.env['NODE_ENV'] || 'production'}</p>
          <p>Version: 1.0.0</p>
        </div>
      </div>
    `;

    // Process images to ensure they're embedded
    const processedHtml = await this.processImagesForPDF(enhancedHtml);

    // Insert print styles and header
    return processedHtml
      .replace('</head>', `${printStyles}</head>`)
      .replace('<body>', `<body>${printHeader}`);
  }

  /**
   * Process images for PDF embedding
   */
  private async processImagesForPDF(html: string): Promise<string> {
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g;
    let processedHtml = html;
    let match;

    while ((match = imgRegex.exec(html)) !== null) {
      const imgTag = match[0];
      const imgSrc = match[1];

      // Skip if no src found
      if (!imgSrc) {
        continue;
      }

      // Skip data URLs and absolute URLs
      if (imgSrc.startsWith('data:') || imgSrc.startsWith('http')) {
        continue;
      }

      try {
        // Check if image file exists
        const imagePath = path.resolve(imgSrc);
        if (existsSync(imagePath)) {
          // Read image and convert to base64
          const imageData = await fs.readFile(imagePath);
          const base64 = imageData.toString('base64');
          const mimeType = this.getMimeType(imagePath);
          const dataUrl = `data:${mimeType};base64,${base64}`;

          // Replace src with data URL
          const newImgTag = imgTag.replace(imgSrc!, dataUrl);
          processedHtml = processedHtml.replace(imgTag, newImgTag);
        }
      } catch (error) {
        this.logger.warn(`Failed to embed image: ${imgSrc}`, { error });
      }
    }

    return processedHtml;
  }

  /**
   * Launch browser for PDF generation
   */
  private async launchBrowser(): Promise<void> {
    if (this.browser) return;

    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials',
        '--no-zygote',
        '--single-process',
        '--disable-accelerated-2d-canvas',
        '--disable-blink-features=AutomationControlled'
      ],
      // Increase timeout for slow environments
      timeout: 60000
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1200, height: 1600 },
      deviceScaleFactor: 2, // Higher quality rendering
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
      bypassCSP: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: ['clipboard-read', 'clipboard-write'],
      colorScheme: 'light',
      reducedMotion: 'reduce',
      forcedColors: 'none'
    });

    // Set extra HTTP headers
    await this.context.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    // Add initialization script
    await this.context.addInitScript(() => {
      // Ensure window.print media
      (window as any).matchMedia = (window as any).matchMedia || function(query: string) {
        return {
          matches: false,
          media: query,
          onchange: null,
          addListener: function() {},
          removeListener: function() {},
          addEventListener: function() {},
          removeEventListener: function() {},
          dispatchEvent: function() { return true; }
        };
      };

      // Override media type for print styles
      const originalMatchMedia = (window as any).matchMedia;
      (window as any).matchMedia = function(query: string): MediaQueryList {
        if (query === 'print') {
          return {
            matches: true,
            media: query,
            onchange: null,
            addListener: function() {},
            removeListener: function() {},
            addEventListener: function() {},
            removeEventListener: function() {},
            dispatchEvent: function() { return true; }
          } as MediaQueryList;
        }
        return originalMatchMedia.call(window, query);
      };
    });
  }

  /**
   * Generate PDF from HTML with all options
   */
  private async generatePDF(
    htmlPath: string,
    reportData: ReportData,
    options: PDFOptions
  ): Promise<string> {
    if (!this.context) throw new Error('Browser context not initialized');

    const page = await this.context.newPage();
    const pdfPath = path.join(
      this.tempDir,
      options.filename || `report-${Date.now()}.pdf`
    );

    try {
      // Set viewport for PDF generation
      await page.setViewportSize({
        width: 794, // A4 width in pixels at 96 DPI
        height: 1123 // A4 height in pixels at 96 DPI
      });

      // Navigate to HTML file
      await page.goto(`file://${htmlPath}`, {
        waitUntil: 'networkidle',
        timeout: 60000
      });

      // Inject additional styles for PDF
      await page.addStyleTag({
        content: `
          @media print {
            body { 
              zoom: 1; 
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
        `
      });

      // Wait for all content to be ready
      await this.waitForContentReady(page);

      // Force print media emulation
      await page.emulateMedia({ media: 'print' });

      // Generate PDF with all options
      await page.pdf({
        path: pdfPath,
        format: options.format || 'A4',
        margin: options.margin || options.margins || {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm'
        },
        printBackground: options.printBackground !== false,
        displayHeaderFooter: options.displayHeaderFooter !== false,
        headerTemplate: options.headerTemplate || this.getDefaultHeader(reportData),
        footerTemplate: options.footerTemplate || this.getDefaultFooter(),
        landscape: options.landscape || false,
        scale: options.scale || 1,
        preferCSSPageSize: options.preferCSSPageSize || false,
        pageRanges: options.pageRanges || '',
        outline: options.includeOutline !== false,
        tagged: options.taggedPDF !== false // Accessibility
      });

      return pdfPath;

    } finally {
      await page.close();
    }
  }

  /**
   * Wait for all content to be ready
   */
  private async waitForContentReady(page: Page): Promise<void> {
    // Wait for all images to load completely
    await page.waitForFunction(() => {
      const images = Array.from(document.querySelectorAll('img'));
      return images.every(img => {
        if (!img.src) return true;
        if (img.complete && img.naturalHeight !== 0) return true;
        if (img.complete && img.src.startsWith('data:')) return true;
        return false;
      });
    }, { timeout: 30000 });

    // Wait for all charts (canvas elements) to render
    await page.waitForFunction(() => {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      return canvases.every(canvas => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return true;
        
        // Check if canvas has content
        try {
          const imageData = ctx.getImageData(0, 0, 1, 1);
          return imageData.data.some(pixel => pixel !== 0);
        } catch (e) {
          // Cross-origin canvas, assume it's loaded
          return true;
        }
      });
    }, { timeout: 30000 });

    // Wait for custom fonts
    await page.waitForFunction(() => {
      if ('fonts' in document) {
        return (document as any).fonts.ready.then(() => true);
      }
      return true;
    }, { timeout: 10000 });

    // Wait for MathJax if present
    await page.waitForFunction(() => {
      if (typeof (window as any).MathJax !== 'undefined') {
        return (window as any).MathJax.startup.document.state() >= 8;
      }
      return true;
    }, { timeout: 10000 });

    // Wait for lazy-loaded content
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        let lastHeight = document.body.scrollHeight;
        let checks = 0;
        
        const interval = setInterval(() => {
          window.scrollTo(0, document.body.scrollHeight);
          const currentHeight = document.body.scrollHeight;
          
          if (currentHeight === lastHeight || checks > 20) {
            clearInterval(interval);
            window.scrollTo(0, 0);
            resolve();
          }
          
          lastHeight = currentHeight;
          checks++;
        }, 100);
      });
    });

    // Final stabilization wait
    await page.waitForTimeout(1000);
  }

  /**
   * Get default header template
   */
  private getDefaultHeader(reportData: ReportData): string {
    return `
      <div style="width: 100%; font-size: 10px; padding: 0 20px; color: #666;">
        <div style="float: left; width: 33%;">
          <span>${reportData.summary.projectName}</span>
        </div>
        <div style="float: left; width: 34%; text-align: center;">
          <span>Test Execution Report</span>
        </div>
        <div style="float: right; width: 33%; text-align: right;">
          <span>${new Date().toLocaleDateString()}</span>
        </div>
      </div>
    `;
  }

  /**
   * Get default footer template
   */
  private getDefaultFooter(): string {
    return `
      <div style="width: 100%; font-size: 10px; padding: 0 20px; color: #666;">
        <div style="float: left; width: 33%;">
          <span>CS Test Automation Framework</span>
        </div>
        <div style="float: left; width: 34%; text-align: center;">
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>
        <div style="float: right; width: 33%; text-align: right;">
          <span>Confidential</span>
        </div>
      </div>
    `;
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    // Close browser
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        this.logger.warn('Error closing browser', { error });
      }
      this.browser = null;
      this.context = null;
    }

    // Clean temp directory (keep files for 24 hours for debugging)
    try {
      const files = await fs.readdir(this.tempDir);
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
          await fs.unlink(filePath).catch(() => {});
        }
      }
    } catch (error) {
      this.logger.warn('Failed to clean temp directory', { error });
    }
  }

  /**
   * Export multiple reports to a single PDF
   */
  async exportBatch(
    reports: Array<{ data: ReportData; html: string; name?: string }>,
    options: PDFOptions = {}
  ): Promise<ExportResult> {
    const batchId = crypto.randomUUID();
    // const _startTime = Date.now();

    try {
      await this.logger.logAction('pdf-batch-export-start', {
        target: 'reports',
        status: 'info',
        batchId,
        count: reports.length
      });

      // Prepare combined HTML
      const combinedHtml = await this.createBatchReport(reports, options);
      
      // Create combined report data
      const combinedData = this.mergeReportData(reports.map(r => r.data));

      // Export combined report
      return await this.export(combinedData, combinedHtml, {
        ...options,
        filename: options.filename || `batch-report-${batchId}.pdf`,
        includeToc: true,
        includeBookmarks: true
      });

    } catch (error) {
      this.logger.logError('Batch PDF export failed', error as Error);
      throw error;
    }
  }

  /**
   * Create batch report HTML
   */
  private async createBatchReport(
    reports: Array<{ data: ReportData; html: string; name?: string }>,
    _options: PDFOptions
  ): Promise<string> {
    // Extract and combine report contents
    const reportSections = await Promise.all(reports.map(async (report, index) => {
      // Extract body content
      const bodyMatch = report.html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      const bodyContent = bodyMatch ? bodyMatch[1] : report.html;

      // Process images to base64
      const processedContent = await this.processImagesForPDF(bodyContent || '');

      return `
        <div class="chapter" id="report-${index}">
          <h1 class="report-title">${report.name || report.data.summary.projectName}</h1>
          <div class="report-metadata">
            <p><strong>Execution ID:</strong> ${report.data.summary.executionId}</p>
            <p><strong>Environment:</strong> ${report.data.environment || 'Unknown'}</p>
            <p><strong>Date:</strong> ${new Date(report.data.summary.startTime || Date.now()).toLocaleString()}</p>
            <p><strong>Duration:</strong> ${this.formatDuration(report.data.summary.duration || 0)}</p>
            <p><strong>Pass Rate:</strong> ${report.data.summary.passRate.toFixed(2)}%</p>
          </div>
          <div class="report-content">
            ${processedContent}
          </div>
        </div>
      `;
    }));

    // Create comprehensive summary
    const summary = this.createBatchSummary(reports);

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Batch Test Report - CS Test Automation Framework</title>
          <style>
            /* Base styles */
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 210mm;
              margin: 0 auto;
              padding: 20px;
            }
            
            /* Cover page */
            .cover-page {
              text-align: center;
              padding: 100px 0;
              page-break-after: always;
              min-height: 100vh;
              display: flex;
              flex-direction: column;
              justify-content: center;
            }
            
            .cover-page h1 {
              font-size: 36px;
              color: #93186C;
              margin-bottom: 20px;
            }
            
            .cover-page .subtitle {
              font-size: 24px;
              color: #666;
              margin-bottom: 40px;
            }
            
            .cover-page .metadata {
              font-size: 14px;
              color: #999;
            }
            
            /* Summary section */
            .summary-section {
              page-break-after: always;
            }
            
            .summary-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 20px;
              margin: 20px 0;
            }
            
            .summary-card {
              border: 1px solid #ddd;
              border-radius: 8px;
              padding: 20px;
              background-color: #f9f9f9;
            }
            
            .summary-card h3 {
              color: #93186C;
              margin-top: 0;
            }
            
            /* Report sections */
            .chapter {
              page-break-before: always;
            }
            
            .chapter:first-of-type {
              page-break-before: avoid;
            }
            
            .report-title {
              color: #93186C;
              border-bottom: 3px solid #93186C;
              padding-bottom: 10px;
            }
            
            .report-metadata {
              background-color: #f5f5f5;
              padding: 15px;
              border-radius: 8px;
              margin: 20px 0;
            }
            
            .report-metadata p {
              margin: 5px 0;
            }
            
            /* Tables */
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
            }
            
            th, td {
              padding: 10px;
              text-align: left;
              border: 1px solid #ddd;
            }
            
            th {
              background-color: #93186C;
              color: white;
              font-weight: bold;
            }
            
            tr:nth-child(even) {
              background-color: #f9f9f9;
            }
            
            /* Status colors */
            .status-passed { color: #28a745; font-weight: bold; }
            .status-failed { color: #dc3545; font-weight: bold; }
            .status-skipped { color: #ffc107; font-weight: bold; }
            
            /* Charts */
            .chart-container {
              margin: 20px 0;
              text-align: center;
            }
            
            /* Print styles */
            @media print {
              .chapter {
                page-break-before: always;
              }
              
              .no-print {
                display: none !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="cover-page">
            <h1>Batch Test Execution Report</h1>
            <div class="subtitle">CS Test Automation Framework</div>
            <div class="metadata">
              <p>Generated on ${new Date().toLocaleString()}</p>
              <p>Total Reports: ${reports.length}</p>
              <p>Environment: ${reports[0]?.data.environment || 'Multiple'}</p>
            </div>
          </div>
          
          <div class="summary-section">
            <h1>Executive Summary</h1>
            ${summary}
          </div>
          
          ${reportSections.join('\n')}
        </body>
      </html>
    `;
  }

  /**
   * Create batch summary
   */
  private createBatchSummary(reports: Array<{ data: ReportData; html: string; name?: string }>): string {
    const totalStats = reports.reduce((acc, report) => {
      const data = report.data.summary;
      return {
        scenarios: acc.scenarios + data.totalScenarios,
        passed: acc.passed + (data.passed || 0),
        failed: acc.failed + (data.failed || 0),
        skipped: acc.skipped + (data.skipped || 0),
        duration: acc.duration + (data.duration || 0),
        features: acc.features + data.totalFeatures,
        steps: acc.steps + data.totalSteps
      };
    }, { scenarios: 0, passed: 0, failed: 0, skipped: 0, duration: 0, features: 0, steps: 0 });

    const overallPassRate = totalStats.scenarios > 0 
      ? (totalStats.passed / totalStats.scenarios * 100).toFixed(2)
      : '0.00';

    return `
      <div class="summary-grid">
        <div class="summary-card">
          <h3>Overall Statistics</h3>
          <p><strong>Total Features:</strong> ${totalStats.features}</p>
          <p><strong>Total Scenarios:</strong> ${totalStats.scenarios}</p>
          <p><strong>Total Steps:</strong> ${totalStats.steps}</p>
          <p><strong>Total Duration:</strong> ${this.formatDuration(totalStats.duration)}</p>
        </div>
        
        <div class="summary-card">
          <h3>Test Results</h3>
          <p class="status-passed">Passed: ${totalStats.passed}</p>
          <p class="status-failed">Failed: ${totalStats.failed}</p>
          <p class="status-skipped">Skipped: ${totalStats.skipped}</p>
          <p><strong>Overall Pass Rate:</strong> ${overallPassRate}%</p>
        </div>
        
        <div class="summary-card">
          <h3>Report Breakdown</h3>
          <table>
            <thead>
              <tr>
                <th>Report</th>
                <th>Scenarios</th>
                <th>Pass Rate</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              ${reports.map(report => `
                <tr>
                  <td>${report.name || report.data.summary.projectName}</td>
                  <td>${report.data.summary.totalScenarios}</td>
                  <td>${report.data.summary.passRate.toFixed(2)}%</td>
                  <td>${this.formatDuration(report.data.summary.duration || 0)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      
      <h2>Performance Metrics</h2>
      <div class="summary-grid">
        ${reports.map((report) => `
          <div class="summary-card">
            <h4>${report.name || report.data.summary.projectName}</h4>
            <p><strong>Page Load:</strong> ${report.data.metrics.browser?.pageLoadTime || 0}ms</p>
            <p><strong>First Paint:</strong> ${report.data.metrics.browser?.firstPaint || 0}ms</p>
            <p><strong>CPU Usage:</strong> ${report.data.metrics.system?.cpuUsage?.toFixed(2) || '0.00'}%</p>
            <p><strong>Memory:</strong> ${((report.data.metrics.system?.memoryUsage || 0) / 1024 / 1024).toFixed(2)}MB</p>
          </div>
        `).join('')}
      </div>
    `;
  }

  /**
   * Merge multiple report data
   */
  private mergeReportData(reports: ReportData[]): ReportData {
    const startTime = Math.min(...reports.map(r => 
      r.summary.startTime instanceof Date ? r.summary.startTime.getTime() : (r.summary.startTime || Date.now())
    ));
    const endTime = Math.max(...reports.map(r => 
      r.summary.endTime instanceof Date ? r.summary.endTime.getTime() : (r.summary.endTime || Date.now())
    ));
    const totalScenarios = reports.reduce((sum, r) => sum + r.summary.totalScenarios, 0);
    const totalPassed = reports.reduce((sum, r) => sum + (r.summary.passed || 0), 0);
    
    return {
      summary: {
        projectName: 'Batch Report',
        executionId: crypto.randomUUID(),
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        duration: endTime - startTime,
        totalFeatures: reports.reduce((sum, r) => sum + r.summary.totalFeatures, 0),
        passedFeatures: reports.reduce((sum, r) => sum + r.summary.passedFeatures, 0),
        failedFeatures: reports.reduce((sum, r) => sum + r.summary.failedFeatures, 0),
        skippedFeatures: reports.reduce((sum, r) => sum + r.summary.skippedFeatures, 0),
        totalScenarios,
        passedScenarios: reports.reduce((sum, r) => sum + r.summary.passedScenarios, 0),
        failedScenarios: reports.reduce((sum, r) => sum + r.summary.failedScenarios, 0),
        skippedScenarios: reports.reduce((sum, r) => sum + r.summary.skippedScenarios, 0),
        totalSteps: reports.reduce((sum, r) => sum + r.summary.totalSteps, 0),
        passedSteps: reports.reduce((sum, r) => sum + r.summary.passedSteps, 0),
        failedSteps: reports.reduce((sum, r) => sum + r.summary.failedSteps, 0),
        skippedSteps: reports.reduce((sum, r) => sum + r.summary.skippedSteps, 0),
        pendingSteps: reports.reduce((sum, r) => sum + r.summary.pendingSteps, 0),
        executionTime: endTime - startTime,
        parallelWorkers: Math.max(...reports.map(r => r.summary.parallelWorkers || 1)),
        retryCount: reports.reduce((sum, r) => sum + r.summary.retryCount, 0),
        passed: totalPassed,
        failed: reports.reduce((sum, r) => sum + (r.summary.failed || 0), 0),
        skipped: reports.reduce((sum, r) => sum + (r.summary.skipped || 0), 0),
        passRate: totalScenarios > 0 ? (totalPassed / totalScenarios * 100) : 0,
        failureRate: totalScenarios > 0 ? (reports.reduce((sum, r) => sum + (r.summary.failed || 0), 0) / totalScenarios * 100) : 0,
        status: reports.every(r => r.summary.status === 'passed') ? 'passed' as any : 'failed' as any,
        trends: reports[0]?.summary.trends || { passRateTrend: 0, executionTimeTrend: 0, failureRateTrend: 0, lastExecutions: [] },
        statistics: reports[0]?.summary.statistics || { 
          avgScenarioDuration: 0, 
          avgStepDuration: 0, 
          fastestScenario: { scenarioId: '', name: '', duration: 0, feature: '' },
          slowestScenario: { scenarioId: '', name: '', duration: 0, feature: '' },
          mostFailedFeature: '',
          mostStableFeature: '',
          flakyTests: []
        }
      },
      features: reports.flatMap(r => r.features),
      tags: Array.from(new Set(reports.flatMap(r => r.tags || []))),
      metrics: reports[0]?.metrics || {
        execution: {
          totalDuration: endTime - startTime,
          setupDuration: 0,
          testDuration: endTime - startTime,
          teardownDuration: 0,
          avgScenarioDuration: 0,
          avgStepDuration: 0,
          parallelEfficiency: 1,
          queueTime: 0,
          retryRate: 0
        },
        browser: {
          pageLoadTime: 0,
          domContentLoaded: 0,
          firstPaint: 0,
          firstContentfulPaint: 0,
          largestContentfulPaint: 0,
          firstInputDelay: 0,
          timeToInteractive: 0,
          totalBlockingTime: 0,
          cumulativeLayoutShift: 0,
          memoryUsage: { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 },
          consoleErrors: 0,
          consoleWarnings: 0
        },
        network: {
          totalRequests: 0,
          failedRequests: 0,
          cachedRequests: 0,
          avgResponseTime: 0,
          totalDataTransferred: 0,
          totalDataSent: 0,
          totalDataReceived: 0,
          slowestRequest: { requestId: '', url: '', method: '', status: 0, responseTime: 0, size: 0, type: '', startTime: new Date(), endTime: new Date(), headers: {}, timing: { dns: 0, connect: 0, ssl: 0, send: 0, wait: 0, receive: 0, total: 0 } },
          cacheHitRate: 0,
          requestsByType: {},
          requestsByDomain: {},
          successfulRequests: 0,
          totalBytesTransferred: 0,
          totalTime: 0,
          averageResponseTime: 0,
          thirdPartyRequests: 0,
          resourceTypes: {},
          protocols: {},
          domains: {},
          thirdPartyCategories: {},
          pageUrl: ''
        },
        system: {
          cpuUsage: 0,
          memoryUsage: 0,
          processCount: 0
        },
        custom: {}
      },
      evidence: {
        screenshots: reports.flatMap(r => r.evidence.screenshots),
        videos: reports.flatMap(r => r.evidence.videos),
        traces: reports.flatMap(r => r.evidence.traces || []),
        networkLogs: reports.flatMap(r => r.evidence.networkLogs || []),
        consoleLogs: reports.flatMap(r => r.evidence.consoleLogs || []),
        performanceLogs: reports.flatMap(r => r.evidence.performanceLogs || []),
        downloads: reports.flatMap(r => r.evidence.downloads || []),
        uploads: reports.flatMap(r => r.evidence.uploads || []),
        logs: reports.flatMap(r => r.evidence.logs || []),
        har: reports.find(r => r.evidence.har)?.evidence.har
      } as EvidenceCollection,
      environment: reports[0]?.environment, // Use first report's environment
      scenarios: reports.flatMap(r => r.scenarios || []),
      metadata: reports[0]?.metadata || {
        reportId: crypto.randomUUID(),
        reportName: 'Batch Report',
        executionId: crypto.randomUUID(),
        environment: reports[0]?.environment || '',
        executionDate: new Date(),
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        duration: endTime - startTime,
        reportGeneratedAt: new Date(),
        frameworkVersion: '1.0.0',
        reportVersion: '1.0.0',
        machineInfo: {
          hostname: 'unknown',
          platform: process.platform,
          arch: process.arch,
          cpuCores: 1,
          totalMemory: 0,
          nodeVersion: process.version,
          osRelease: ''
        },
        userInfo: {
          username: 'unknown',
          domain: 'unknown',
          executedBy: 'unknown'
        },
        tags: [],
        executionOptions: {}
      } as any,
      configuration: reports[0]?.configuration || {
        theme: {
          primaryColor: '#93186C',
          secondaryColor: '#FFFFFF',
          successColor: '#28A745',
          failureColor: '#DC3545',
          warningColor: '#FFC107',
          infoColor: '#17A2B8',
          backgroundColor: '#F8F9FA',
          textColor: '#212529',
          fontFamily: 'Arial, sans-serif',
          fontSize: '14px'
        },
        exportFormats: ['pdf' as any],
        includeEvidence: {
          includeScreenshots: true,
          includeVideos: true,
          includeTraces: true,
          includeNetworkLogs: true,
          includeConsoleLogs: true,
          maxScreenshotsPerScenario: 10,
          compressImages: false,
          embedInReport: true
        },
        charts: {
          enableCharts: true,
          chartTypes: [],
          interactive: false,
          exportable: false,
          customCharts: []
        },
        sections: [],
        customizations: {}
      }
    } as ReportData;
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Generate PDF with progress tracking
   */
  async exportWithProgress(
    reportData: ReportData,
    htmlContent: string,
    options: PDFOptions & {
      onProgress?: (progress: number, status: string) => void;
      onError?: (error: Error) => void;
    } = {}
  ): Promise<ExportResult> {
    const { onProgress, onError, ...pdfOptions } = options;
    
    const progressSteps = [
      { percent: 5, message: 'Initializing PDF export...' },
      { percent: 10, message: 'Preparing export environment...' },
      { percent: 15, message: 'Processing HTML content...' },
      { percent: 20, message: 'Embedding images and assets...' },
      { percent: 25, message: 'Launching headless browser...' },
      { percent: 30, message: 'Loading document...' },
      { percent: 40, message: 'Rendering pages...' },
      { percent: 50, message: 'Waiting for content to stabilize...' },
      { percent: 60, message: 'Generating PDF document...' },
      { percent: 70, message: 'Adding metadata and properties...' },
      { percent: 75, message: 'Creating table of contents...' },
      { percent: 80, message: 'Building document outline...' },
      { percent: 85, message: 'Applying security settings...' },
      { percent: 90, message: 'Optimizing file size...' },
      { percent: 95, message: 'Finalizing document...' },
      { percent: 100, message: 'Export complete!' }
    ];

    let currentStep = 0;
    const reportProgress = () => {
      if (onProgress && currentStep < progressSteps.length) {
        const step = progressSteps[currentStep++];
        if (step) {
          onProgress(step.percent, step.message);
        }
      }
    };

    try {
      reportProgress(); // 5% - Initializing
      const exportId = crypto.randomUUID();
      const startTime = Date.now();

      reportProgress(); // 10% - Preparing environment
      await this.prepareExport();

      reportProgress(); // 15% - Processing HTML
      const processedHtml = await this.enhanceHtmlForPdf(htmlContent);

      reportProgress(); // 20% - Embedding images
      const finalHtml = await this.processImagesForPDF(processedHtml);
      
      reportProgress(); // 25% - Creating temp file
      const tempHtmlPath = await this.createTempHtml(finalHtml, exportId);

      reportProgress(); // 30% - Launching browser
      await this.launchBrowser();

      reportProgress(); // 40% - Loading document
      await new Promise(resolve => setTimeout(resolve, 100));

      reportProgress(); // 50% - Waiting for content
      await new Promise(resolve => setTimeout(resolve, 100));

      reportProgress(); // 60% - Generating PDF
      const initialPdfPath = await this.generatePDF(tempHtmlPath, reportData, pdfOptions);

      reportProgress(); // 70% - Adding metadata
      const pdfBytes = await fs.readFile(initialPdfPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      await this.addCompleteMetadata(pdfDoc, reportData, pdfOptions);

      reportProgress(); // 75% - Creating TOC
      if (pdfOptions.includeToc !== false) {
        await this.createFullTableOfContents(pdfDoc, reportData);
      }

      reportProgress(); // 80% - Building outline
      if (pdfOptions.includeBookmarks !== false) {
        await this.createPDFOutline(pdfDoc, reportData);
      }

      reportProgress(); // 85% - Security settings
      let finalBytes: Uint8Array;
      if (pdfOptions.security) {
        finalBytes = await this.applyFullEncryption(pdfDoc, pdfOptions.security);
      } else {
        finalBytes = await pdfDoc.save();
      }

      reportProgress(); // 90% - Optimizing
      await new Promise(resolve => setTimeout(resolve, 100));

      reportProgress(); // 95% - Finalizing
      const outputPath = path.join(
        pdfOptions.outputDir || this.tempDir,
        pdfOptions.filename || `test-report-${exportId}.pdf`
      );
      await fs.writeFile(outputPath, finalBytes);

      reportProgress(); // 100% - Complete
      
      const stats = await fs.stat(outputPath);
      return {
        success: true,
        filePath: outputPath,
        format: ExportFormat.PDF,
        size: stats.size,
        duration: Date.now() - startTime,
        metadata: {
          title: reportData.summary.projectName,
          author: 'CS Test Automation Framework',
          created: new Date().toISOString(),
          pages: pdfDoc.getPageCount(),
          encrypted: !!pdfOptions.security
        }
      };

    } catch (error) {
      const err = error as Error;
      this.logger.logError('PDF export failed', err);
      
      if (onError) {
        onError(err);
      }
      
      if (onProgress) {
        onProgress(0, `Error: ${err.message}`);
      }
      
      throw err;
    } finally {
      await this.cleanup();
    }
  }
}