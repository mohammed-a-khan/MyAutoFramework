// src/reporting/exporters/ExcelExporter.ts

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { ExportResult, ExportOptions, ExecutionResult, ScenarioResult, StepResult, FeatureResult } from '../types/reporting.types';
import { Logger } from '../../utils/Logger';
import { DateUtils } from '../../utils/DateUtils';
import { FileUtils } from '../../utils/FileUtils';

interface ExcelExportOptions extends ExportOptions {
  includeCharts?: boolean;
  includeMetrics?: boolean;
  includeScreenshots?: boolean;
  includeLogs?: boolean;
  autoFilter?: boolean;
  freezePanes?: boolean;
  conditionalFormatting?: boolean;
  chartType?: 'bar' | 'line' | 'pie' | 'doughnut' | 'area';
  theme?: 'default' | 'colorful' | 'professional' | 'dark';
  maxRowsPerSheet?: number;
  compression?: boolean;
}

export class ExcelExporter {
  private logger = new Logger('ExcelExporter');
  private workbook: XLSX.WorkBook | null = null;
  private readonly brandColor = '#93186C';
  private readonly maxCellLength = 32767; // Excel cell character limit
  
  async export(
    result: ExecutionResult,
    outputPath: string,
    options: ExcelExportOptions = {}
  ): Promise<ExportResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting Excel export', { outputPath, options });

      // Create workbook with proper settings
      this.workbook = XLSX.utils.book_new();
      this.workbook.Props = {
        Title: 'CS Test Automation Report',
        Subject: 'Test Execution Results',
        Author: 'CS Test Framework',
        Manager: result.environment,
        Company: 'CS',
        Category: 'Test Report',
        Keywords: 'automation,test,report',
        Comments: `Generated on ${new Date().toISOString()}`,
        LastAuthor: 'CS Test Framework',
        CreatedDate: new Date()
      };

      // Add worksheets
      await this.addSummarySheet(result, options);
      await this.addDetailedResultsSheet(result, options);
      await this.addFeatureResultsSheet(result, options);
      await this.addStepDetailsSheet(result, options);
      
      if (options.includeMetrics) {
        await this.addMetricsSheet(result, options);
        await this.addPerformanceSheet(result, options);
      }
      
      if (options.includeLogs) {
        await this.addLogsSheet(result, options);
      }
      
      if (options.includeScreenshots) {
        await this.addScreenshotsSheet(result, options);
      }

      // Add charts sheet if requested
      if (options.includeCharts) {
        await this.addChartsSheet(result, options);
      }

      // Write workbook with compression
      const buffer = XLSX.write(this.workbook, {
        bookType: 'xlsx',
        bookSST: true, // Shared string table for better compression
        type: 'buffer',
        compression: options.compression !== false, // Default true
        Props: this.workbook.Props
      });

      // Ensure directory exists
      await FileUtils.ensureDirectory(path.dirname(outputPath));
      
      // Write file
      await fs.promises.writeFile(outputPath, buffer);

      const fileStats = await fs.promises.stat(outputPath);
      const exportTime = Date.now() - startTime;
      
      this.logger.info('Excel export completed', { 
        exportTime,
        fileSize: fileStats.size,
        sheets: Object.keys(this.workbook.Sheets).length
      });

      return {
        success: true,
        outputPath,
        format: 'excel',
        exportTime,
        fileSize: fileStats.size,
        metadata: {
          sheets: Object.keys(this.workbook.Sheets).length,
          hasCharts: options.includeCharts || false,
          theme: options.theme || 'default',
          compressed: options.compression !== false
        }
      };

    } catch (error) {
      this.logger.error('Excel export failed', error);
      return {
        success: false,
        outputPath,
        format: 'excel',
        exportTime: Date.now() - startTime,
        error: error.message
      };
    }
  }

  private async addSummarySheet(
    result: ExecutionResult,
    options: ExcelExportOptions
  ): Promise<void> {
    const ws = XLSX.utils.aoa_to_sheet([]);
    const data: any[][] = [];
    
    // Title with merged cells
    data.push(['CS Test Automation Report']);
    data.push(['']); // Empty row
    data.push(['Test Execution Summary']);
    data.push(['']); // Empty row

    // Overview section
    data.push(['Execution Overview']);
    data.push(['Metric', 'Value']);
    data.push(['Execution ID', result.executionId]);
    data.push(['Environment', result.environment]);
    data.push(['Start Time', new Date(result.startTime)]);
    data.push(['End Time', new Date(result.endTime)]);
    data.push(['Duration', this.formatDuration(result.duration)]);
    data.push(['Total Features', result.summary.totalFeatures]);
    data.push(['Total Scenarios', result.summary.totalScenarios]);
    data.push(['Total Steps', result.summary.totalSteps]);
    data.push(['']); // Empty row

    // Results section
    data.push(['Test Results']);
    data.push(['Status', 'Count', 'Percentage']);
    const total = result.summary.totalScenarios || 1; // Avoid division by zero
    data.push(['Passed', result.summary.passed, result.summary.passed / total]);
    data.push(['Failed', result.summary.failed, result.summary.failed / total]);
    data.push(['Skipped', result.summary.skipped, result.summary.skipped / total]);
    data.push(['']); // Empty row

    // Pass rate calculation
    data.push(['Overall Pass Rate', '', result.summary.passed / total]);
    data.push(['']); // Empty row

    // Tags summary if available
    if (result.tags && result.tags.length > 0) {
      data.push(['Tag Summary']);
      data.push(['Tag', 'Count', 'Pass Rate']);
      result.tags.forEach(tag => {
        data.push([tag.name, tag.count, tag.passRate]);
      });
    }

    // Convert array to sheet
    XLSX.utils.sheet_add_aoa(ws, data);

    // Apply cell styles and formatting
    this.applySummaryFormatting(ws, data.length, options);

    // Set column widths
    ws['!cols'] = [
      { wch: 30 }, // Column A
      { wch: 20 }, // Column B
      { wch: 15 }  // Column C
    ];

    // Add to workbook
    XLSX.utils.book_append_sheet(this.workbook!, ws, 'Summary');
  }

  private applySummaryFormatting(ws: XLSX.WorkSheet, rowCount: number, options: ExcelExportOptions): void {
    // Title formatting
    this.setCellStyle(ws, 'A1', {
      font: { bold: true, sz: 18, color: { rgb: this.brandColor.substring(1) } },
      alignment: { horizontal: 'center', vertical: 'center' }
    });
    this.mergeCells(ws, 'A1:C1');

    // Section headers
    this.setCellStyle(ws, 'A3', {
      font: { bold: true, sz: 16, color: { rgb: this.brandColor.substring(1) } },
      alignment: { horizontal: 'center' }
    });
    this.mergeCells(ws, 'A3:C3');

    // Table headers
    ['A5', 'A16'].forEach(cell => {
      if (ws[cell]) {
        this.setCellStyle(ws, cell, {
          font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: this.brandColor.substring(1) } },
          alignment: { horizontal: 'left' }
        });
        
        // Merge header cells
        const row = parseInt(cell.substring(1));
        this.mergeCells(ws, `A${row}:C${row}`);
      }
    });

    // Sub-headers
    this.setRangeStyle(ws, 'A6:B6', {
      font: { bold: true },
      fill: { fgColor: { rgb: 'E0E0E0' } },
      border: {
        top: { style: 'thin', color: { rgb: '000000' } },
        bottom: { style: 'thin', color: { rgb: '000000' } },
        left: { style: 'thin', color: { rgb: '000000' } },
        right: { style: 'thin', color: { rgb: '000000' } }
      }
    });

    this.setRangeStyle(ws, 'A17:C17', {
      font: { bold: true },
      fill: { fgColor: { rgb: 'E0E0E0' } },
      border: {
        top: { style: 'thin', color: { rgb: '000000' } },
        bottom: { style: 'thin', color: { rgb: '000000' } },
        left: { style: 'thin', color: { rgb: '000000' } },
        right: { style: 'thin', color: { rgb: '000000' } }
      }
    });

    // Format dates
    for (let i = 7; i <= rowCount; i++) {
      const cell = ws[`B${i}`];
      if (cell && cell.v instanceof Date) {
        cell.t = 'd';
        cell.z = 'yyyy-mm-dd hh:mm:ss';
      }
    }

    // Format percentages
    for (let i = 18; i <= 20; i++) {
      const cell = ws[`C${i}`];
      if (cell && typeof cell.v === 'number') {
        cell.t = 'n';
        cell.z = '0.00%';
      }
    }

    // Overall pass rate formatting
    const passRateRow = data.findIndex(row => row[0] === 'Overall Pass Rate') + 1;
    if (passRateRow > 0) {
      this.setCellStyle(ws, `A${passRateRow}`, {
        font: { bold: true, sz: 12 }
      });
      this.mergeCells(ws, `A${passRateRow}:B${passRateRow}`);
      
      const passRateCell = ws[`C${passRateRow}`];
      if (passRateCell) {
        passRateCell.t = 'n';
        passRateCell.z = '0.00%';
        
        // Conditional formatting based on pass rate
        const passRate = passRateCell.v as number;
        if (passRate >= 0.95) {
          this.setCellStyle(ws, `C${passRateRow}`, {
            font: { bold: true, color: { rgb: '008000' } },
            fill: { fgColor: { rgb: 'E8F5E9' } }
          });
        } else if (passRate >= 0.80) {
          this.setCellStyle(ws, `C${passRateRow}`, {
            font: { bold: true, color: { rgb: 'FFA500' } },
            fill: { fgColor: { rgb: 'FFF3E0' } }
          });
        } else {
          this.setCellStyle(ws, `C${passRateRow}`, {
            font: { bold: true, color: { rgb: 'FF0000' } },
            fill: { fgColor: { rgb: 'FFEBEE' } }
          });
        }
      }
    }

    // Apply borders to data cells
    for (let row = 7; row <= 14; row++) {
      for (let col = 0; col < 2; col++) {
        const cellAddr = XLSX.utils.encode_cell({ r: row - 1, c: col });
        if (ws[cellAddr]) {
          this.addBorder(ws, cellAddr);
        }
      }
    }

    for (let row = 18; row <= 20; row++) {
      for (let col = 0; col < 3; col++) {
        const cellAddr = XLSX.utils.encode_cell({ r: row - 1, c: col });
        if (ws[cellAddr]) {
          this.addBorder(ws, cellAddr);
        }
      }
    }

    // Add auto filter if requested
    if (options.autoFilter) {
      ws['!autofilter'] = { ref: 'A17:C20' };
    }

    // Freeze panes if requested
    if (options.freezePanes) {
      ws['!freeze'] = { xSplit: 0, ySplit: 6, topLeftCell: 'A7' };
    }
  }

  private async addDetailedResultsSheet(
    result: ExecutionResult,
    options: ExcelExportOptions
  ): Promise<void> {
    const headers = ['Feature', 'Scenario', 'Status', 'Duration', 'Start Time', 'End Time', 'Tags', 'Error Message'];
    const data: any[][] = [headers];

    // Add scenario data
    result.features.forEach(feature => {
      feature.scenarios.forEach(scenario => {
        data.push([
          feature.name,
          scenario.name,
          scenario.status.toUpperCase(),
          this.formatDuration(scenario.duration),
          new Date(scenario.startTime),
          new Date(scenario.endTime),
          scenario.tags.join(', '),
          scenario.error ? this.truncateText(scenario.error, this.maxCellLength) : ''
        ]);
      });
    });

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Apply formatting
    this.applyDetailedResultsFormatting(ws, data.length, options);

    // Set column widths
    ws['!cols'] = [
      { wch: 40 }, // Feature
      { wch: 40 }, // Scenario
      { wch: 10 }, // Status
      { wch: 12 }, // Duration
      { wch: 20 }, // Start Time
      { wch: 20 }, // End Time
      { wch: 30 }, // Tags
      { wch: 50 }  // Error
    ];

    XLSX.utils.book_append_sheet(this.workbook!, ws, 'Detailed Results');
  }

  private applyDetailedResultsFormatting(ws: XLSX.WorkSheet, rowCount: number, options: ExcelExportOptions): void {
    // Header row formatting
    this.setRangeStyle(ws, 'A1:H1', {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: this.brandColor.substring(1) } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'medium', color: { rgb: '000000' } },
        bottom: { style: 'medium', color: { rgb: '000000' } },
        left: { style: 'thin', color: { rgb: '000000' } },
        right: { style: 'thin', color: { rgb: '000000' } }
      }
    });

    // Apply status-based formatting
    for (let row = 2; row <= rowCount; row++) {
      const statusCell = ws[`C${row}`];
      if (statusCell) {
        const status = statusCell.v as string;
        let style: any = {};
        
        switch (status.toUpperCase()) {
          case 'PASSED':
            style = {
              font: { bold: true, color: { rgb: '008000' } },
              fill: { fgColor: { rgb: 'E8F5E9' } }
            };
            break;
          case 'FAILED':
            style = {
              font: { bold: true, color: { rgb: 'FF0000' } },
              fill: { fgColor: { rgb: 'FFEBEE' } }
            };
            break;
          case 'SKIPPED':
            style = {
              font: { bold: true, color: { rgb: 'FFA500' } },
              fill: { fgColor: { rgb: 'FFF3E0' } }
            };
            break;
        }
        
        this.setCellStyle(ws, `C${row}`, style);
      }

      // Format date cells
      ['E', 'F'].forEach(col => {
        const cell = ws[`${col}${row}`];
        if (cell && cell.v instanceof Date) {
          cell.t = 'd';
          cell.z = 'yyyy-mm-dd hh:mm:ss';
        }
      });

      // Add borders to all data cells
      for (let col = 0; col < 8; col++) {
        const cellAddr = XLSX.utils.encode_cell({ r: row - 1, c: col });
        this.addBorder(ws, cellAddr);
      }

      // Wrap text for error messages
      const errorCell = ws[`H${row}`];
      if (errorCell) {
        this.setCellStyle(ws, `H${row}`, {
          alignment: { wrapText: true, vertical: 'top' }
        });
      }
    }

    // Add auto filter
    if (options.autoFilter) {
      ws['!autofilter'] = { ref: `A1:H${rowCount}` };
    }

    // Freeze header row
    if (options.freezePanes) {
      ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2' };
    }

    // Set row heights for wrapped text
    ws['!rows'] = [];
    for (let i = 0; i < rowCount; i++) {
      ws['!rows'][i] = { hpt: i === 0 ? 25 : 20 };
    }
  }

  private async addFeatureResultsSheet(
    result: ExecutionResult,
    options: ExcelExportOptions
  ): Promise<void> {
    const headers = ['Feature', 'Total Scenarios', 'Passed', 'Failed', 'Skipped', 'Pass Rate', 'Avg Duration', 'Total Duration'];
    const data: any[][] = [headers];

    // Calculate feature statistics
    result.features.forEach(feature => {
      const total = feature.scenarios.length;
      const passed = feature.scenarios.filter(s => s.status === 'passed').length;
      const failed = feature.scenarios.filter(s => s.status === 'failed').length;
      const skipped = feature.scenarios.filter(s => s.status === 'skipped').length;
      const passRate = total > 0 ? passed / total : 0;
      const totalDuration = feature.scenarios.reduce((sum, s) => sum + s.duration, 0);
      const avgDuration = total > 0 ? totalDuration / total : 0;

      data.push([
        feature.name,
        total,
        passed,
        failed,
        skipped,
        passRate,
        this.formatDuration(avgDuration),
        this.formatDuration(totalDuration)
      ]);
    });

    // Add totals row
    const totalScenarios = result.summary.totalScenarios;
    const totalPassed = result.summary.passed;
    const totalFailed = result.summary.failed;
    const totalSkipped = result.summary.skipped;
    const overallPassRate = totalScenarios > 0 ? totalPassed / totalScenarios : 0;
    
    data.push([
      'TOTAL',
      totalScenarios,
      totalPassed,
      totalFailed,
      totalSkipped,
      overallPassRate,
      '',
      this.formatDuration(result.duration)
    ]);

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Apply formatting
    this.applyFeatureResultsFormatting(ws, data.length, options);

    // Set column widths
    ws['!cols'] = [
      { wch: 50 }, // Feature
      { wch: 15 }, // Total
      { wch: 10 }, // Passed
      { wch: 10 }, // Failed
      { wch: 10 }, // Skipped
      { wch: 12 }, // Pass Rate
      { wch: 15 }, // Avg Duration
      { wch: 15 }  // Total Duration
    ];

    XLSX.utils.book_append_sheet(this.workbook!, ws, 'Feature Results');
  }

  private applyFeatureResultsFormatting(ws: XLSX.WorkSheet, rowCount: number, options: ExcelExportOptions): void {
    // Header formatting
    this.setRangeStyle(ws, 'A1:H1', {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: this.brandColor.substring(1) } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'medium', color: { rgb: '000000' } },
        bottom: { style: 'medium', color: { rgb: '000000' } },
        left: { style: 'thin', color: { rgb: '000000' } },
        right: { style: 'thin', color: { rgb: '000000' } }
      }
    });

    // Format data rows
    for (let row = 2; row < rowCount; row++) {
      // Format pass rate as percentage
      const passRateCell = ws[`F${row}`];
      if (passRateCell && typeof passRateCell.v === 'number') {
        passRateCell.t = 'n';
        passRateCell.z = '0.00%';
        
        // Apply conditional formatting
        const rate = passRateCell.v as number;
        if (rate >= 0.95) {
          this.setCellStyle(ws, `F${row}`, {
            font: { color: { rgb: '008000' } },
            fill: { fgColor: { rgb: 'E8F5E9' } }
          });
        } else if (rate >= 0.80) {
          this.setCellStyle(ws, `F${row}`, {
            font: { color: { rgb: 'FFA500' } },
            fill: { fgColor: { rgb: 'FFF3E0' } }
          });
        } else {
          this.setCellStyle(ws, `F${row}`, {
            font: { color: { rgb: 'FF0000' } },
            fill: { fgColor: { rgb: 'FFEBEE' } }
          });
        }
      }

      // Center align numeric columns
      ['B', 'C', 'D', 'E'].forEach(col => {
        this.setCellStyle(ws, `${col}${row}`, {
          alignment: { horizontal: 'center' }
        });
      });

      // Add borders
      for (let col = 0; col < 8; col++) {
        const cellAddr = XLSX.utils.encode_cell({ r: row - 1, c: col });
        this.addBorder(ws, cellAddr);
      }
    }

    // Format totals row
    const totalRow = rowCount;
    this.setRangeStyle(ws, `A${totalRow}:H${totalRow}`, {
      font: { bold: true },
      fill: { fgColor: { rgb: 'E0E0E0' } },
      border: {
        top: { style: 'double', color: { rgb: '000000' } },
        bottom: { style: 'medium', color: { rgb: '000000' } },
        left: { style: 'thin', color: { rgb: '000000' } },
        right: { style: 'thin', color: { rgb: '000000' } }
      }
    });

    // Format total pass rate
    const totalPassRateCell = ws[`F${totalRow}`];
    if (totalPassRateCell) {
      totalPassRateCell.t = 'n';
      totalPassRateCell.z = '0.00%';
    }

    // Add data bars for visual comparison
    if (options.conditionalFormatting) {
      // This would require extended Excel formatting which XLSX doesn't fully support
      // But we can add visual indicators using cell colors
      for (let row = 2; row < rowCount; row++) {
        const passedCell = ws[`C${row}`];
        const failedCell = ws[`D${row}`];
        const skippedCell = ws[`E${row}`];
        
        if (passedCell && passedCell.v > 0) {
          this.setCellStyle(ws, `C${row}`, {
            font: { color: { rgb: '008000' } }
          });
        }
        
        if (failedCell && failedCell.v > 0) {
          this.setCellStyle(ws, `D${row}`, {
            font: { color: { rgb: 'FF0000' } }
          });
        }
        
        if (skippedCell && skippedCell.v > 0) {
          this.setCellStyle(ws, `E${row}`, {
            font: { color: { rgb: 'FFA500' } }
          });
        }
      }
    }

    // Add auto filter
    if (options.autoFilter) {
      ws['!autofilter'] = { ref: `A1:H${rowCount - 1}` };
    }

    // Freeze header
    if (options.freezePanes) {
      ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2' };
    }
  }

  private async addStepDetailsSheet(
    result: ExecutionResult,
    options: ExcelExportOptions
  ): Promise<void> {
    const headers = ['Feature', 'Scenario', 'Step #', 'Keyword', 'Step Text', 'Status', 'Duration', 'Error'];
    const data: any[][] = [headers];
    let currentRow = 2;

    // Add step data with proper pagination
    result.features.forEach(feature => {
      feature.scenarios.forEach(scenario => {
        scenario.steps.forEach((step, stepIndex) => {
          // Check if we need to create a new sheet due to row limit
          if (options.maxRowsPerSheet && currentRow > options.maxRowsPerSheet) {
            // Create continuation sheet
            this.createStepDetailsContinuation(data, currentRow - 1);
            data.length = 1; // Keep headers
            currentRow = 2;
          }

          data.push([
            feature.name,
            scenario.name,
            stepIndex + 1,
            step.keyword,
            this.truncateText(step.text, 255),
            step.status.toUpperCase(),
            step.duration ? `${step.duration}ms` : '0ms',
            step.error ? this.truncateText(step.error, this.maxCellLength) : ''
          ]);
          currentRow++;
        });
      });
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    this.applyStepDetailsFormatting(ws, data.length, options);

    ws['!cols'] = [
      { wch: 40 }, // Feature
      { wch: 40 }, // Scenario
      { wch: 8 },  // Step #
      { wch: 10 }, // Keyword
      { wch: 60 }, // Step Text
      { wch: 10 }, // Status
      { wch: 12 }, // Duration
      { wch: 50 }  // Error
    ];

    XLSX.utils.book_append_sheet(this.workbook!, ws, 'Step Details');
  }

  private createStepDetailsContinuation(data: any[][], lastRow: number): void {
    const ws = XLSX.utils.aoa_to_sheet(data);
    this.applyStepDetailsFormatting(ws, lastRow, { autoFilter: false, freezePanes: false });
    
    const sheetCount = Object.keys(this.workbook!.Sheets).filter(name => 
      name.startsWith('Step Details')
    ).length;
    
    XLSX.utils.book_append_sheet(this.workbook!, ws, `Step Details ${sheetCount + 1}`);
  }

  private applyStepDetailsFormatting(ws: XLSX.WorkSheet, rowCount: number, options: ExcelExportOptions): void {
    // Header formatting
    this.setRangeStyle(ws, 'A1:H1', {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: this.brandColor.substring(1) } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'medium', color: { rgb: '000000' } },
        bottom: { style: 'medium', color: { rgb: '000000' } },
        left: { style: 'thin', color: { rgb: '000000' } },
        right: { style: 'thin', color: { rgb: '000000' } }
      }
    });

    // Format data rows
    for (let row = 2; row <= rowCount; row++) {
      // Status formatting
      const statusCell = ws[`F${row}`];
      if (statusCell) {
        const status = statusCell.v as string;
        let style: any = {};
        
        switch (status.toUpperCase()) {
          case 'PASSED':
            style = {
              font: { bold: true, color: { rgb: '008000' } },
              fill: { fgColor: { rgb: 'E8F5E9' } }
            };
            break;
          case 'FAILED':
            style = {
              font: { bold: true, color: { rgb: 'FF0000' } },
              fill: { fgColor: { rgb: 'FFEBEE' } }
            };
            break;
          case 'SKIPPED':
            style = {
              font: { bold: true, color: { rgb: 'FFA500' } },
              fill: { fgColor: { rgb: 'FFF3E0' } }
            };
            break;
          case 'PENDING':
            style = {
              font: { bold: true, color: { rgb: '0000FF' } },
              fill: { fgColor: { rgb: 'E3F2FD' } }
            };
            break;
        }
        
        this.setCellStyle(ws, `F${row}`, style);
      }

      // Center align step number
      this.setCellStyle(ws, `C${row}`, {
        alignment: { horizontal: 'center' }
      });

      // Keyword formatting
      const keywordCell = ws[`D${row}`];
      if (keywordCell) {
        this.setCellStyle(ws, `D${row}`, {
          font: { bold: true, color: { rgb: '4A148C' } }
        });
      }

      // Wrap text for step text and error
      ['E', 'H'].forEach(col => {
        this.setCellStyle(ws, `${col}${row}`, {
          alignment: { wrapText: true, vertical: 'top' }
        });
      });

      // Add borders
      for (let col = 0; col < 8; col++) {
        const cellAddr = XLSX.utils.encode_cell({ r: row - 1, c: col });
        this.addBorder(ws, cellAddr);
      }
    }

    // Add filters
    if (options.autoFilter) {
      ws['!autofilter'] = { ref: `A1:H${rowCount}` };
    }

    // Freeze panes
    if (options.freezePanes) {
      ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2' };
    }

    // Set row heights
    ws['!rows'] = [];
    ws['!rows'][0] = { hpt: 25 }; // Header row
    for (let i = 1; i < rowCount; i++) {
      ws['!rows'][i] = { hpt: 30 }; // Data rows with wrapped text
    }
  }

  private async addMetricsSheet(
    result: ExecutionResult,
    options: ExcelExportOptions
  ): Promise<void> {
    const data: any[][] = [];
    
    // Title
    data.push(['Performance Metrics Analysis']);
    data.push([]);
    
    // System metrics
    if (result.metrics?.system) {
      data.push(['System Metrics']);
      data.push(['Metric', 'Min', 'Max', 'Average', 'P50', 'P90', 'P95', 'P99']);
      
      const sysMetrics = result.metrics.system;
      data.push([
        'CPU Usage (%)',
        sysMetrics.cpu?.min || 0,
        sysMetrics.cpu?.max || 0,
        sysMetrics.cpu?.avg || 0,
        sysMetrics.cpu?.p50 || 0,
        sysMetrics.cpu?.p90 || 0,
        sysMetrics.cpu?.p95 || 0,
        sysMetrics.cpu?.p99 || 0
      ]);
      
      data.push([
        'Memory Usage (MB)',
        Math.round(sysMetrics.memory?.min || 0),
        Math.round(sysMetrics.memory?.max || 0),
        Math.round(sysMetrics.memory?.avg || 0),
        Math.round(sysMetrics.memory?.p50 || 0),
        Math.round(sysMetrics.memory?.p90 || 0),
        Math.round(sysMetrics.memory?.p95 || 0),
        Math.round(sysMetrics.memory?.p99 || 0)
      ]);
      
      data.push([]);
    }
    
    // Performance metrics
    if (result.metrics?.performance) {
      data.push(['Web Performance Metrics']);
      data.push(['Metric', 'Min', 'Max', 'Average', 'P50', 'P90', 'P95', 'P99']);
      
      const perfMetrics = result.metrics.performance;
      const metrics = [
        { name: 'Page Load Time (ms)', data: perfMetrics.pageLoadTime },
        { name: 'First Contentful Paint (ms)', data: perfMetrics.firstContentfulPaint },
        { name: 'Largest Contentful Paint (ms)', data: perfMetrics.largestContentfulPaint },
        { name: 'Time to Interactive (ms)', data: perfMetrics.timeToInteractive },
        { name: 'Total Blocking Time (ms)', data: perfMetrics.totalBlockingTime },
        { name: 'Cumulative Layout Shift', data: perfMetrics.cumulativeLayoutShift }
      ];
      
      metrics.forEach(metric => {
        if (metric.data) {
          data.push([
            metric.name,
            metric.data.min || 0,
            metric.data.max || 0,
            metric.data.avg || 0,
            metric.data.p50 || 0,
            metric.data.p90 || 0,
            metric.data.p95 || 0,
            metric.data.p99 || 0
          ]);
        }
      });
      
      data.push([]);
    }
    
    // Network metrics
    if (result.metrics?.network) {
      data.push(['Network Metrics']);
      data.push(['Metric', 'Value']);
      
      const netMetrics = result.metrics.network;
      data.push(['Total Requests', netMetrics.totalRequests || 0]);
      data.push(['Failed Requests', netMetrics.failedRequests || 0]);
      data.push(['Total Data Downloaded (MB)', Math.round((netMetrics.totalBytes || 0) / 1024 / 1024)]);
      data.push(['Average Response Time (ms)', Math.round(netMetrics.avgResponseTime || 0)]);
      
      data.push([]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    this.applyMetricsFormatting(ws, data, options);

    ws['!cols'] = [
      { wch: 30 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, 
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }
    ];

    XLSX.utils.book_append_sheet(this.workbook!, ws, 'Metrics');
  }

  private applyMetricsFormatting(ws: XLSX.WorkSheet, data: any[][], options: ExcelExportOptions): void {
    let currentRow = 1;
    
    // Title formatting
    this.setCellStyle(ws, 'A1', {
      font: { bold: true, sz: 16, color: { rgb: this.brandColor.substring(1) } },
      alignment: { horizontal: 'center' }
    });
    this.mergeCells(ws, 'A1:H1');
    
    // Find and format section headers
    data.forEach((row, index) => {
      if (row.length === 1 && row[0] && index > 0) {
        // Section header
        const cellAddr = `A${index + 1}`;
        this.setCellStyle(ws, cellAddr, {
          font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: this.brandColor.substring(1) } },
          alignment: { horizontal: 'left' }
        });
        this.mergeCells(ws, `A${index + 1}:H${index + 1}`);
      } else if (row[0] === 'Metric' && row.length > 2) {
        // Table header
        const rowNum = index + 1;
        this.setRangeStyle(ws, `A${rowNum}:H${rowNum}`, {
          font: { bold: true },
          fill: { fgColor: { rgb: 'E0E0E0' } },
          border: {
            bottom: { style: 'thin', color: { rgb: '000000' } }
          }
        });
      } else if (row.length > 1 && typeof row[1] === 'number') {
        // Data rows - format numbers
        const rowNum = index + 1;
        for (let col = 1; col < row.length; col++) {
          const cellAddr = XLSX.utils.encode_cell({ r: index, c: col });
          if (ws[cellAddr] && typeof ws[cellAddr].v === 'number') {
            ws[cellAddr].t = 'n';
            ws[cellAddr].z = '#,##0.00';
            
            // Add conditional formatting for performance thresholds
            if (row[0].includes('Page Load Time') || row[0].includes('FCP') || row[0].includes('LCP')) {
              const value = ws[cellAddr].v as number;
              if (value > 3000) {
                this.setCellStyle(ws, cellAddr, {
                  font: { color: { rgb: 'FF0000' } }
                });
              } else if (value > 1000) {
                this.setCellStyle(ws, cellAddr, {
                  font: { color: { rgb: 'FFA500' } }
                });
              } else {
                this.setCellStyle(ws, cellAddr, {
                  font: { color: { rgb: '008000' } }
                });
              }
            }
          }
        }
      }
    });
  }

  private async addPerformanceSheet(
    result: ExecutionResult,
    options: ExcelExportOptions
  ): Promise<void> {
    const headers = ['Scenario', 'Page URL', 'Load Time', 'FCP', 'LCP', 'TTI', 'TBT', 'CLS', 'Score'];
    const data: any[][] = [headers];

    // Collect performance data from scenarios
    result.features.forEach(feature => {
      feature.scenarios.forEach(scenario => {
        if (scenario.performance && scenario.performance.length > 0) {
          scenario.performance.forEach(perf => {
            const score = this.calculatePerformanceScore(perf.metrics);
            data.push([
              scenario.name,
              perf.url || perf.page || 'N/A',
              perf.metrics.pageLoadTime || 0,
              perf.metrics.firstContentfulPaint || 0,
              perf.metrics.largestContentfulPaint || 0,
              perf.metrics.timeToInteractive || 0,
              perf.metrics.totalBlockingTime || 0,
              perf.metrics.cumulativeLayoutShift || 0,
              score
            ]);
          });
        }
      });
    });

    if (data.length === 1) {
      // No performance data, add placeholder
      data.push(['No performance data available', '', '', '', '', '', '', '', '']);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    this.applyPerformanceFormatting(ws, data.length, options);

    ws['!cols'] = [
      { wch: 40 }, // Scenario
      { wch: 50 }, // URL
      { wch: 12 }, // Load Time
      { wch: 12 }, // FCP
      { wch: 12 }, // LCP
      { wch: 12 }, // TTI
      { wch: 12 }, // TBT
      { wch: 12 }, // CLS
      { wch: 12 }  // Score
    ];

    XLSX.utils.book_append_sheet(this.workbook!, ws, 'Performance');
  }

  private calculatePerformanceScore(metrics: any): number {
    // Simplified Lighthouse-like scoring
    let score = 100;
    
    // FCP scoring (15% weight)
    if (metrics.firstContentfulPaint) {
      if (metrics.firstContentfulPaint > 3000) score -= 15;
      else if (metrics.firstContentfulPaint > 1800) score -= 7;
    }
    
    // LCP scoring (25% weight)
    if (metrics.largestContentfulPaint) {
      if (metrics.largestContentfulPaint > 4000) score -= 25;
      else if (metrics.largestContentfulPaint > 2500) score -= 12;
    }
    
    // TBT scoring (30% weight)
    if (metrics.totalBlockingTime) {
      if (metrics.totalBlockingTime > 600) score -= 30;
      else if (metrics.totalBlockingTime > 300) score -= 15;
    }
    
    // CLS scoring (15% weight)
    if (metrics.cumulativeLayoutShift) {
      if (metrics.cumulativeLayoutShift > 0.25) score -= 15;
      else if (metrics.cumulativeLayoutShift > 0.1) score -= 7;
    }
    
    // TTI scoring (15% weight)
    if (metrics.timeToInteractive) {
      if (metrics.timeToInteractive > 7300) score -= 15;
      else if (metrics.timeToInteractive > 3800) score -= 7;
    }
    
    return Math.max(0, score);
  }

  private applyPerformanceFormatting(ws: XLSX.WorkSheet, rowCount: number, options: ExcelExportOptions): void {
    // Header formatting
    this.setRangeStyle(ws, 'A1:I1', {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: this.brandColor.substring(1) } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'medium', color: { rgb: '000000' } },
        bottom: { style: 'medium', color: { rgb: '000000' } }
      }
    });

    // Format data rows
    for (let row = 2; row <= rowCount; row++) {
      // Format metric values
      for (let col = 2; col <= 7; col++) {
        const cellAddr = XLSX.utils.encode_cell({ r: row - 1, c: col });
        const cell = ws[cellAddr];
        
        if (cell && typeof cell.v === 'number') {
          cell.t = 'n';
          cell.z = '#,##0';
          
          // Apply color coding based on thresholds
          const value = cell.v as number;
          let color = '008000'; // Green
          
          if (col === 2 || col === 3 || col === 4 || col === 5) { // Time metrics
            if (value > 3000) color = 'FF0000'; // Red
            else if (value > 1000) color = 'FFA500'; // Orange
          } else if (col === 6) { // TBT
            if (value > 600) color = 'FF0000';
            else if (value > 300) color = 'FFA500';
          } else if (col === 7) { // CLS
            if (value > 0.25) color = 'FF0000';
            else if (value > 0.1) color = 'FFA500';
          }
          
          this.setCellStyle(ws, cellAddr, {
            font: { color: { rgb: color } }
          });
        }
      }
      
      // Format score
      const scoreCell = ws[`I${row}`];
      if (scoreCell && typeof scoreCell.v === 'number') {
        scoreCell.t = 'n';
        scoreCell.z = '0';
        
        const score = scoreCell.v as number;
        let style: any = {
          font: { bold: true },
          alignment: { horizontal: 'center' }
        };
        
        if (score >= 90) {
          style.font.color = { rgb: '008000' };
          style.fill = { fgColor: { rgb: 'E8F5E9' } };
        } else if (score >= 50) {
          style.font.color = { rgb: 'FFA500' };
          style.fill = { fgColor: { rgb: 'FFF3E0' } };
        } else {
          style.font.color = { rgb: 'FF0000' };
          style.fill = { fgColor: { rgb: 'FFEBEE' } };
        }
        
        this.setCellStyle(ws, `I${row}`, style);
      }
      
      // Wrap URL text
      this.setCellStyle(ws, `B${row}`, {
        alignment: { wrapText: true }
      });
      
      // Add borders
      for (let col = 0; col < 9; col++) {
        const cellAddr = XLSX.utils.encode_cell({ r: row - 1, c: col });
        this.addBorder(ws, cellAddr);
      }
    }

    // Add filters
    if (options.autoFilter) {
      ws['!autofilter'] = { ref: `A1:I${rowCount}` };
    }

    // Freeze header
    if (options.freezePanes) {
      ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2' };
    }
  }

  private async addLogsSheet(
    result: ExecutionResult,
    options: ExcelExportOptions
  ): Promise<void> {
    const headers = ['Timestamp', 'Level', 'Source', 'Category', 'Message'];
    const data: any[][] = [headers];
    
    if (result.logs && result.logs.length > 0) {
      // Limit logs to prevent huge files
      const maxLogs = options.maxRowsPerSheet || 50000;
      const logs = result.logs.slice(0, maxLogs);
      
      logs.forEach(log => {
        data.push([
          new Date(log.timestamp),
          log.level.toUpperCase(),
          log.source || 'Unknown',
          log.category || 'General',
          this.truncateText(log.message, this.maxCellLength)
        ]);
      });
      
      if (result.logs.length > maxLogs) {
        data.push([
          new Date(),
          'INFO',
          'System',
          'Truncation',
          `Log truncated. Showing ${maxLogs} of ${result.logs.length} total entries.`
        ]);
      }
    } else {
      data.push([new Date(), 'INFO', 'System', 'No Data', 'No logs available for this execution']);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    this.applyLogsFormatting(ws, data.length, options);

    ws['!cols'] = [
      { wch: 20 }, // Timestamp
      { wch: 10 }, // Level
      { wch: 25 }, // Source
      { wch: 20 }, // Category
      { wch: 100 } // Message
    ];

    XLSX.utils.book_append_sheet(this.workbook!, ws, 'Logs');
  }

  private applyLogsFormatting(ws: XLSX.WorkSheet, rowCount: number, options: ExcelExportOptions): void {
    // Header formatting
    this.setRangeStyle(ws, 'A1:E1', {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: this.brandColor.substring(1) } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'medium', color: { rgb: '000000' } },
        bottom: { style: 'medium', color: { rgb: '000000' } }
      }
    });

    // Format data rows
    for (let row = 2; row <= rowCount; row++) {
      // Format timestamp
      const timestampCell = ws[`A${row}`];
      if (timestampCell && timestampCell.v instanceof Date) {
        timestampCell.t = 'd';
        timestampCell.z = 'yyyy-mm-dd hh:mm:ss.000';
      }
      
      // Format level with color coding
      const levelCell = ws[`B${row}`];
      if (levelCell) {
        const level = levelCell.v as string;
        let style: any = {
          font: { bold: true },
          alignment: { horizontal: 'center' }
        };
        
        switch (level.toUpperCase()) {
          case 'ERROR':
            style.font.color = { rgb: 'FF0000' };
            style.fill = { fgColor: { rgb: 'FFEBEE' } };
            break;
          case 'WARN':
          case 'WARNING':
            style.font.color = { rgb: 'FFA500' };
            style.fill = { fgColor: { rgb: 'FFF3E0' } };
            break;
          case 'INFO':
            style.font.color = { rgb: '0000FF' };
            break;
          case 'DEBUG':
            style.font.color = { rgb: '666666' };
            break;
        }
        
        this.setCellStyle(ws, `B${row}`, style);
      }
      
      // Wrap message text
      this.setCellStyle(ws, `E${row}`, {
        alignment: { wrapText: true, vertical: 'top' }
      });
      
      // Add borders
      for (let col = 0; col < 5; col++) {
        const cellAddr = XLSX.utils.encode_cell({ r: row - 1, c: col });
        this.addBorder(ws, cellAddr);
      }
    }

    // Add filters
    if (options.autoFilter) {
      ws['!autofilter'] = { ref: `A1:E${rowCount}` };
    }

    // Freeze header
    if (options.freezePanes) {
      ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2' };
    }

    // Set row heights
    ws['!rows'] = [];
    ws['!rows'][0] = { hpt: 25 };
    for (let i = 1; i < rowCount; i++) {
      ws['!rows'][i] = { hpt: 40 }; // Accommodate wrapped text
    }
  }

  private async addScreenshotsSheet(
    result: ExecutionResult,
    options: ExcelExportOptions
  ): Promise<void> {
    const headers = ['Feature', 'Scenario', 'Step', 'Type', 'Status', 'Timestamp', 'File Path', 'Description'];
    const data: any[][] = [headers];

    // Collect screenshot references
    result.features.forEach(feature => {
      feature.scenarios.forEach(scenario => {
        // Scenario screenshots
        if (scenario.screenshots) {
          scenario.screenshots.forEach(screenshot => {
            data.push([
              feature.name,
              scenario.name,
              'Scenario',
              screenshot.type || 'screenshot',
              scenario.status,
              new Date(screenshot.timestamp),
              screenshot.path,
              screenshot.description || 'Scenario screenshot'
            ]);
          });
        }
        
        // Step screenshots
        scenario.steps.forEach((step, stepIndex) => {
          if (step.screenshots && step.screenshots.length > 0) {
            step.screenshots.forEach(screenshot => {
              data.push([
                feature.name,
                scenario.name,
                `Step ${stepIndex + 1}: ${this.truncateText(step.text, 50)}`,
                screenshot.type || 'screenshot',
                step.status,
                new Date(screenshot.timestamp),
                screenshot.path,
                screenshot.description || 'Step screenshot'
              ]);
            });
          }
        });
      });
    });

    if (data.length === 1) {
      data.push(['No screenshots captured', '', '', '', '', '', '', '']);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    this.applyScreenshotsFormatting(ws, data.length, options);

    ws['!cols'] = [
      { wch: 40 }, // Feature
      { wch: 40 }, // Scenario
      { wch: 50 }, // Step
      { wch: 15 }, // Type
      { wch: 10 }, // Status
      { wch: 20 }, // Timestamp
      { wch: 80 }, // File Path
      { wch: 50 }  // Description
    ];

    XLSX.utils.book_append_sheet(this.workbook!, ws, 'Screenshots');
  }

  private applyScreenshotsFormatting(ws: XLSX.WorkSheet, rowCount: number, options: ExcelExportOptions): void {
    // Header formatting
    this.setRangeStyle(ws, 'A1:H1', {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: this.brandColor.substring(1) } },
      alignment: { horizontal: 'center', vertical: 'center' }
    });

    // Format data rows
    for (let row = 2; row <= rowCount; row++) {
      // Format timestamp
      const timestampCell = ws[`F${row}`];
      if (timestampCell && timestampCell.v instanceof Date) {
        timestampCell.t = 'd';
        timestampCell.z = 'yyyy-mm-dd hh:mm:ss';
      }
      
      // Format status
      const statusCell = ws[`E${row}`];
      if (statusCell) {
        const status = statusCell.v as string;
        let style: any = {
          font: { bold: true },
          alignment: { horizontal: 'center' }
        };
        
        switch (status.toLowerCase()) {
          case 'passed':
            style.font.color = { rgb: '008000' };
            break;
          case 'failed':
            style.font.color = { rgb: 'FF0000' };
            break;
          case 'skipped':
            style.font.color = { rgb: 'FFA500' };
            break;
        }
        
        this.setCellStyle(ws, `E${row}`, style);
      }
      
      // Make file path a hyperlink if it's a valid path
      const pathCell = ws[`G${row}`];
      if (pathCell && pathCell.v && typeof pathCell.v === 'string') {
        // Create hyperlink
        ws[`G${row}`] = {
          v: pathCell.v,
          l: { Target: `file:///${pathCell.v.replace(/\\/g, '/')}` },
          s: {
            font: { color: { rgb: '0000FF' }, underline: true }
          }
        };
      }
      
      // Add borders
      for (let col = 0; col < 8; col++) {
        const cellAddr = XLSX.utils.encode_cell({ r: row - 1, c: col });
        this.addBorder(ws, cellAddr);
      }
    }

    // Add filters
    if (options.autoFilter) {
      ws['!autofilter'] = { ref: `A1:H${rowCount}` };
    }

    // Freeze header
    if (options.freezePanes) {
      ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2' };
    }
  }

  private async addChartsSheet(
    result: ExecutionResult,
    options: ExcelExportOptions
  ): Promise<void> {
    // Excel charts require complex XML manipulation that xlsx doesn't support directly
    // Instead, we'll create a data sheet formatted for easy chart creation
    
    const data: any[][] = [];
    
    // Chart 1: Test Results Summary
    data.push(['Test Results Summary']);
    data.push(['Status', 'Count']);
    data.push(['Passed', result.summary.passed]);
    data.push(['Failed', result.summary.failed]);
    data.push(['Skipped', result.summary.skipped]);
    data.push([]);
    
    // Chart 2: Feature Pass Rates
    data.push(['Feature Pass Rates']);
    data.push(['Feature', 'Pass Rate']);
    result.features.forEach(feature => {
      const total = feature.scenarios.length;
      const passed = feature.scenarios.filter(s => s.status === 'passed').length;
      const passRate = total > 0 ? passed / total : 0;
      data.push([feature.name, passRate]);
    });
    data.push([]);
    
    // Chart 3: Execution Time by Feature
    data.push(['Execution Time by Feature']);
    data.push(['Feature', 'Duration (seconds)']);
    result.features.forEach(feature => {
      const totalDuration = feature.scenarios.reduce((sum, s) => sum + s.duration, 0);
      data.push([feature.name, totalDuration / 1000]);
    });
    data.push([]);
    
    // Chart 4: Performance Metrics (if available)
    if (result.metrics?.performance) {
      data.push(['Average Performance Metrics']);
      data.push(['Metric', 'Value (ms)']);
      const perf = result.metrics.performance;
      data.push(['Page Load Time', perf.pageLoadTime?.avg || 0]);
      data.push(['First Contentful Paint', perf.firstContentfulPaint?.avg || 0]);
      data.push(['Largest Contentful Paint', perf.largestContentfulPaint?.avg || 0]);
      data.push(['Time to Interactive', perf.timeToInteractive?.avg || 0]);
      data.push(['Total Blocking Time', perf.totalBlockingTime?.avg || 0]);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    this.applyChartsFormatting(ws, data);

    ws['!cols'] = [
      { wch: 40 },
      { wch: 20 }
    ];

    // Add instructions
    const instructions = 'To create charts: 1) Select data range 2) Insert > Charts 3) Choose chart type';
    ws['!margins'] = { footer: 0.5 };
    ws['!footer'] = { left: instructions };

    XLSX.utils.book_append_sheet(this.workbook!, ws, 'Chart Data');
  }

  private applyChartsFormatting(ws: XLSX.WorkSheet, data: any[][]): void {
    let currentRow = 1;
    
    data.forEach((row, index) => {
      if (row.length === 1) {
        // Section headers
        const cellAddr = `A${index + 1}`;
        this.setCellStyle(ws, cellAddr, {
          font: { bold: true, sz: 14, color: { rgb: this.brandColor.substring(1) } }
        });
        this.mergeCells(ws, `A${index + 1}:B${index + 1}`);
      } else if (row[0] === 'Status' || row[0] === 'Feature' || row[0] === 'Metric') {
        // Table headers
        const rowNum = index + 1;
        this.setRangeStyle(ws, `A${rowNum}:B${rowNum}`, {
          font: { bold: true },
          fill: { fgColor: { rgb: 'E0E0E0' } },
          border: {
            bottom: { style: 'thin', color: { rgb: '000000' } }
          }
        });
      } else if (row.length === 2 && typeof row[1] === 'number') {
        // Format numbers
        const cellAddr = `B${index + 1}`;
        const cell = ws[cellAddr];
        if (cell) {
          // Check if it's a percentage
          if (row[0].includes('Rate') && cell.v <= 1) {
            cell.t = 'n';
            cell.z = '0.00%';
          } else {
            cell.t = 'n';
            cell.z = '#,##0.00';
          }
        }
      }
    });
  }

  // Helper methods
  private setCellStyle(ws: XLSX.WorkSheet, cellAddr: string, style: any): void {
    if (!ws[cellAddr]) {
      ws[cellAddr] = { v: '' };
    }
    
    // XLSX library uses 's' property for styles
    ws[cellAddr].s = {
      font: {
        name: style.font?.name || 'Calibri',
        sz: style.font?.sz || 11,
        bold: style.font?.bold || false,
        italic: style.font?.italic || false,
        color: style.font?.color || { rgb: '000000' }
      },
      fill: style.fill ? {
        patternType: 'solid',
        fgColor: style.fill.fgColor || { rgb: 'FFFFFF' }
      } : undefined,
      alignment: {
        horizontal: style.alignment?.horizontal || 'general',
        vertical: style.alignment?.vertical || 'bottom',
        wrapText: style.alignment?.wrapText || false,
        textRotation: style.alignment?.textRotation || 0
      },
      border: style.border || {},
      numFmt: style.numFmt
    };
  }

  private setRangeStyle(ws: XLSX.WorkSheet, range: string, style: any): void {
    const rangeObj = XLSX.utils.decode_range(range);
    for (let R = rangeObj.s.r; R <= rangeObj.e.r; ++R) {
      for (let C = rangeObj.s.c; C <= rangeObj.e.c; ++C) {
        const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
        this.setCellStyle(ws, cellAddr, style);
      }
    }
  }

  private mergeCells(ws: XLSX.WorkSheet, range: string): void {
    if (!ws['!merges']) {
      ws['!merges'] = [];
    }
    ws['!merges'].push(XLSX.utils.decode_range(range));
  }

  private addBorder(ws: XLSX.WorkSheet, cellAddr: string): void {
    if (!ws[cellAddr]) {
      ws[cellAddr] = { v: '' };
    }
    
    if (!ws[cellAddr].s) {
      ws[cellAddr].s = {};
    }
    
    ws[cellAddr].s.border = {
      top: { style: 'thin', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: '000000' } },
      right: { style: 'thin', color: { rgb: '000000' } }
    };
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)}s`;
    } else if (ms < 3600000) {
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    } else {
      const hours = Math.floor(ms / 3600000);
      const minutes = Math.floor((ms % 3600000) / 60000);
      return `${hours}h ${minutes}m`;
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  async exportStream(
    result: ExecutionResult,
    options: ExcelExportOptions = {}
  ): Promise<Readable> {
    // Generate the Excel file in memory
    const buffer = await this.generateBuffer(result, options);
    
    // Create readable stream from buffer
    const stream = new Readable({
      read() {}
    });
    
    // Push buffer to stream
    stream.push(buffer);
    stream.push(null); // Signal end of stream
    
    return stream;
  }

  private async generateBuffer(
    result: ExecutionResult,
    options: ExcelExportOptions
  ): Promise<Buffer> {
    // Create workbook
    this.workbook = XLSX.utils.book_new();
    this.workbook.Props = {
      Title: 'CS Test Automation Report',
      Subject: 'Test Execution Results',
      Author: 'CS Test Framework',
      Manager: result.environment,
      Company: 'CS',
      Category: 'Test Report',
      Keywords: 'automation,test,report',
      Comments: `Generated on ${new Date().toISOString()}`,
      LastAuthor: 'CS Test Framework',
      CreatedDate: new Date()
    };

    // Add all sheets
    await this.addSummarySheet(result, options);
    await this.addDetailedResultsSheet(result, options);
    await this.addFeatureResultsSheet(result, options);
    await this.addStepDetailsSheet(result, options);
    
    if (options.includeMetrics) {
      await this.addMetricsSheet(result, options);
      await this.addPerformanceSheet(result, options);
    }
    
    if (options.includeLogs) {
      await this.addLogsSheet(result, options);
    }
    
    if (options.includeScreenshots) {
      await this.addScreenshotsSheet(result, options);
    }

    if (options.includeCharts) {
      await this.addChartsSheet(result, options);
    }

    // Generate buffer
    const buffer = XLSX.write(this.workbook, {
      bookType: 'xlsx',
      bookSST: true,
      type: 'buffer',
      compression: options.compression !== false,
      Props: this.workbook.Props
    });

    return Buffer.from(buffer);
  }

  async exportPartial(
    result: ExecutionResult,
    outputPath: string,
    sheetNames: string[],
    options: ExcelExportOptions = {}
  ): Promise<ExportResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting partial Excel export', { outputPath, sheets: sheetNames });

      // Create workbook
      this.workbook = XLSX.utils.book_new();
      this.workbook.Props = {
        Title: 'CS Test Automation Report (Partial)',
        Subject: 'Test Execution Results',
        Author: 'CS Test Framework',
        CreatedDate: new Date()
      };

      // Add only requested sheets
      for (const sheetName of sheetNames) {
        switch (sheetName.toLowerCase()) {
          case 'summary':
            await this.addSummarySheet(result, options);
            break;
          case 'detailed results':
            await this.addDetailedResultsSheet(result, options);
            break;
          case 'feature results':
            await this.addFeatureResultsSheet(result, options);
            break;
          case 'step details':
            await this.addStepDetailsSheet(result, options);
            break;
          case 'metrics':
            if (options.includeMetrics) {
              await this.addMetricsSheet(result, options);
            }
            break;
          case 'performance':
            if (options.includeMetrics) {
              await this.addPerformanceSheet(result, options);
            }
            break;
          case 'logs':
            if (options.includeLogs) {
              await this.addLogsSheet(result, options);
            }
            break;
          case 'screenshots':
            if (options.includeScreenshots) {
              await this.addScreenshotsSheet(result, options);
            }
            break;
          case 'chart data':
            if (options.includeCharts) {
              await this.addChartsSheet(result, options);
            }
            break;
          default:
            this.logger.warn(`Unknown sheet name: ${sheetName}`);
        }
      }

      // Write workbook
      const buffer = XLSX.write(this.workbook, {
        bookType: 'xlsx',
        bookSST: true,
        type: 'buffer',
        compression: options.compression !== false
      });

      await fs.promises.writeFile(outputPath, buffer);
      const fileStats = await fs.promises.stat(outputPath);

      return {
        success: true,
        outputPath,
        format: 'excel',
        exportTime: Date.now() - startTime,
        fileSize: fileStats.size,
        metadata: {
          sheets: Object.keys(this.workbook.Sheets).length,
          partial: true,
          requestedSheets: sheetNames
        }
      };

    } catch (error) {
      this.logger.error('Partial Excel export failed', error);
      return {
        success: false,
        outputPath,
        format: 'excel',
        exportTime: Date.now() - startTime,
        error: error.message
      };
    }
  }
}