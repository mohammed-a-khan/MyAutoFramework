// src/steps/database/DatabaseUtilitySteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { DatabaseContext } from '../../database/context/DatabaseContext';
import { CSDatabase } from '../../database/client/CSDatabase';
import { FileUtils } from '../../core/utils/FileUtils';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { ResultSet } from '../../database/types/database.types';

export class DatabaseUtilitySteps extends CSBDDBaseStepDefinition {
    private databaseContext: DatabaseContext;

    constructor() {
        super();
        this.databaseContext = this.context.getDatabaseContext();
    }

    @CSBDDStepDef('user exports query result to {string}')
    @CSBDDStepDef('user saves query result to {string}')
    async exportQueryResult(filePath: string): Promise<void> {
        ActionLogger.logDatabaseAction('export_query_result', { filePath });

        const result = this.getLastResult();
        const interpolatedPath = this.interpolateVariables(filePath);

        try {
            const resolvedPath = this.resolveOutputPath(interpolatedPath);
            const format = this.detectFormat(resolvedPath);

            switch (format) {
                case 'csv':
                    await this.exportToCSV(result, resolvedPath);
                    break;
                case 'json':
                    await this.exportToJSON(result, resolvedPath);
                    break;
                case 'xml':
                    await this.exportToXML(result, resolvedPath);
                    break;
                case 'excel':
                    await this.exportToExcel(result, resolvedPath);
                    break;
                case 'txt':
                    await this.exportToText(result, resolvedPath);
                    break;
                default:
                    throw new Error(`Unsupported export format: ${format}`);
            }

            ActionLogger.logDatabaseAction('query_result_exported', {
                filePath: resolvedPath,
                format,
                rowCount: result.rowCount,
                fileSize: FileUtils.getFileSize(resolvedPath)
            });

        } catch (error) {
            ActionLogger.logDatabaseError('export_failed', error);
            throw new Error(`Failed to export query result: ${error.message}`);
        }
    }

    @CSBDDStepDef('user exports query result as CSV with delimiter {string}')
    async exportQueryResultAsCSVWithDelimiter(delimiter: string): Promise<void> {
        ActionLogger.logDatabaseAction('export_csv_custom_delimiter', { delimiter });

        const result = this.getLastResult();
        const outputPath = this.generateOutputPath('csv');

        try {
            await this.exportToCSV(result, outputPath, delimiter);

            ActionLogger.logDatabaseAction('csv_exported_custom', {
                filePath: outputPath,
                delimiter,
                rowCount: result.rowCount
            });

        } catch (error) {
            ActionLogger.logDatabaseError('csv_export_failed', error);
            throw new Error(`Failed to export CSV: ${error.message}`);
        }
    }

    @CSBDDStepDef('user logs query execution plan')
    @CSBDDStepDef('user displays query execution plan')
    async logQueryExecutionPlan(): Promise<void> {
        ActionLogger.logDatabaseAction('log_execution_plan');

        const executionPlan = this.databaseContext.getLastExecutionPlan();
        if (!executionPlan) {
            throw new Error('No execution plan available. Use "user profiles query ..." first');
        }

        console.log('\n=== Query Execution Plan ===');
        console.log(executionPlan);
        console.log('===========================\n');

        ActionLogger.logDatabaseAction('execution_plan_logged', {
            planLength: executionPlan.length
        });
    }

    @CSBDDStepDef('user logs database statistics')
    async logDatabaseStatistics(): Promise<void> {
        ActionLogger.logDatabaseAction('log_database_statistics');

        try {
            const db = this.getCurrentDatabase();
            const stats = await db.getDatabaseStatistics();

            console.log('\n=== Database Statistics ===');
            console.log(`Database: ${stats.databaseName}`);
            console.log(`Version: ${stats.version}`);
            console.log(`Size: ${this.formatBytes(stats.size)}`);
            console.log(`Tables: ${stats.tableCount}`);
            console.log(`Active Connections: ${stats.activeConnections}`);
            console.log(`Uptime: ${this.formatDuration(stats.uptime)}`);
            
            if (stats.additionalInfo) {
                console.log('\nAdditional Information:');
                Object.entries(stats.additionalInfo).forEach(([key, value]) => {
                    console.log(`${key}: ${value}`);
                });
            }
            console.log('==========================\n');

            ActionLogger.logDatabaseAction('database_statistics_logged', {
                databaseName: stats.databaseName,
                tableCount: stats.tableCount
            });

        } catch (error) {
            ActionLogger.logDatabaseError('statistics_failed', error);
            throw new Error(`Failed to get database statistics: ${error.message}`);
        }
    }

    @CSBDDStepDef('user backs up database to {string}')
    async backupDatabase(backupPath: string): Promise<void> {
        ActionLogger.logDatabaseAction('backup_database', { backupPath });

        try {
            const db = this.getCurrentDatabase();
            const interpolatedPath = this.interpolateVariables(backupPath);
            const resolvedPath = this.resolveOutputPath(interpolatedPath);

            const startTime = Date.now();
            await db.backupDatabase(resolvedPath);
            const duration = Date.now() - startTime;

            ActionLogger.logDatabaseAction('database_backed_up', {
                backupPath: resolvedPath,
                duration,
                fileSize: FileUtils.getFileSize(resolvedPath)
            });

        } catch (error) {
            ActionLogger.logDatabaseError('backup_failed', error);
            throw new Error(`Failed to backup database: ${error.message}`);
        }
    }

    @CSBDDStepDef('user imports data from {string} into table {string}')
    async importDataIntoTable(filePath: string, tableName: string): Promise<void> {
        ActionLogger.logDatabaseAction('import_data', { filePath, tableName });

        try {
            const db = this.getCurrentDatabase();
            const interpolatedPath = this.interpolateVariables(filePath);
            const interpolatedTable = this.interpolateVariables(tableName);
            const resolvedPath = this.resolveInputPath(interpolatedPath);

            const format = this.detectFormat(resolvedPath);
            let data: any[];

            switch (format) {
                case 'csv':
                    data = await this.parseCSV(resolvedPath);
                    break;
                case 'json':
                    data = await this.parseJSON(resolvedPath);
                    break;
                case 'excel':
                    data = await this.parseExcel(resolvedPath);
                    break;
                default:
                    throw new Error(`Unsupported import format: ${format}`);
            }

            const startTime = Date.now();
            const result = await db.bulkInsert(interpolatedTable, data);
            const duration = Date.now() - startTime;

            ActionLogger.logDatabaseAction('data_imported', {
                tableName: interpolatedTable,
                rowCount: result.rowsInserted,
                duration,
                format
            });

        } catch (error) {
            ActionLogger.logDatabaseError('import_failed', error);
            throw new Error(`Failed to import data: ${error.message}`);
        }
    }

    @CSBDDStepDef('user truncates table {string}')
    async truncateTable(tableName: string): Promise<void> {
        ActionLogger.logDatabaseAction('truncate_table', { tableName });

        try {
            const db = this.getCurrentDatabase();
            const interpolatedTable = this.interpolateVariables(tableName);

            await db.truncateTable(interpolatedTable);

            ActionLogger.logDatabaseAction('table_truncated', {
                tableName: interpolatedTable
            });

        } catch (error) {
            ActionLogger.logDatabaseError('truncate_failed', error);
            throw new Error(`Failed to truncate table '${tableName}': ${error.message}`);
        }
    }

    @CSBDDStepDef('user drops table {string} if exists')
    async dropTableIfExists(tableName: string): Promise<void> {
        ActionLogger.logDatabaseAction('drop_table_if_exists', { tableName });

        try {
            const db = this.getCurrentDatabase();
            const interpolatedTable = this.interpolateVariables(tableName);

            const exists = await db.tableExists(interpolatedTable);
            if (exists) {
                await db.dropTable(interpolatedTable);
                ActionLogger.logDatabaseAction('table_dropped', {
                    tableName: interpolatedTable
                });
            } else {
                ActionLogger.logDatabaseAction('table_not_exists', {
                    tableName: interpolatedTable
                });
            }

        } catch (error) {
            ActionLogger.logDatabaseError('drop_table_failed', error);
            throw new Error(`Failed to drop table '${tableName}': ${error.message}`);
        }
    }

    @CSBDDStepDef('user creates index {string} on table {string} column {string}')
    async createIndex(indexName: string, tableName: string, columnName: string): Promise<void> {
        ActionLogger.logDatabaseAction('create_index', { indexName, tableName, columnName });

        try {
            const db = this.getCurrentDatabase();
            const interpolatedIndex = this.interpolateVariables(indexName);
            const interpolatedTable = this.interpolateVariables(tableName);
            const interpolatedColumn = this.interpolateVariables(columnName);

            await db.createIndex(interpolatedIndex, interpolatedTable, interpolatedColumn);

            ActionLogger.logDatabaseAction('index_created', {
                indexName: interpolatedIndex,
                tableName: interpolatedTable,
                columnName: interpolatedColumn
            });

        } catch (error) {
            ActionLogger.logDatabaseError('create_index_failed', error);
            throw new Error(`Failed to create index: ${error.message}`);
        }
    }

    @CSBDDStepDef('user analyzes table {string}')
    async analyzeTable(tableName: string): Promise<void> {
        ActionLogger.logDatabaseAction('analyze_table', { tableName });

        try {
            const db = this.getCurrentDatabase();
            const interpolatedTable = this.interpolateVariables(tableName);

            const stats = await db.analyzeTable(interpolatedTable);

            console.log(`\n=== Table Analysis: ${interpolatedTable} ===`);
            console.log(`Row Count: ${stats.rowCount}`);
            console.log(`Size: ${this.formatBytes(stats.dataSize)}`);
            console.log(`Index Count: ${stats.indexCount}`);
            console.log(`Last Updated: ${stats.lastUpdated}`);
            console.log('=====================================\n');

            ActionLogger.logDatabaseAction('table_analyzed', {
                tableName: interpolatedTable,
                rowCount: stats.rowCount,
                dataSize: stats.dataSize
            });

        } catch (error) {
            ActionLogger.logDatabaseError('analyze_table_failed', error);
            throw new Error(`Failed to analyze table '${tableName}': ${error.message}`);
        }
    }

    @CSBDDStepDef('user waits for {int} seconds')
    async waitForSeconds(seconds: number): Promise<void> {
        ActionLogger.logDatabaseAction('wait', { seconds });

        await new Promise(resolve => setTimeout(resolve, seconds * 1000));

        ActionLogger.logDatabaseAction('wait_completed', { seconds });
    }

    // Helper methods
    private getCurrentDatabase(): CSDatabase {
        const db = this.databaseContext.getCurrentDatabase();
        if (!db) {
            throw new Error('No database connection established. Use "Given user connects to ... database" first');
        }
        return db;
    }

    private getLastResult(): ResultSet {
        const result = this.databaseContext.getLastResult();
        if (!result) {
            throw new Error('No query result available. Execute a query first');
        }
        return result;
    }

    private resolveOutputPath(filePath: string): string {
        // Ensure output directory exists
        const dir = './output/database/';
        FileUtils.ensureDirectory(dir);
        
        if (filePath.startsWith('/') || filePath.includes(':')) {
            return filePath; // Absolute path
        }
        
        return `${dir}${filePath}`;
    }

    private resolveInputPath(filePath: string): string {
        const paths = [
            filePath,
            `./test-data/${filePath}`,
            `./resources/${filePath}`,
            `./data/${filePath}`
        ];

        for (const path of paths) {
            if (FileUtils.exists(path)) {
                return path;
            }
        }

        throw new Error(`Input file not found: ${filePath}`);
    }

    private generateOutputPath(extension: string): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return this.resolveOutputPath(`query_result_${timestamp}.${extension}`);
    }

    private detectFormat(filePath: string): string {
        const extension = filePath.split('.').pop()?.toLowerCase();
        return extension || 'txt';
    }

    private async exportToCSV(result: ResultSet, filePath: string, delimiter: string = ','): Promise<void> {
        const lines: string[] = [];
        
        // Header
        const headers = result.columns.map(col => this.escapeCSV(col.name, delimiter));
        lines.push(headers.join(delimiter));
        
        // Data
        for (const row of result.rows) {
            const values = result.columns.map(col => {
                const value = row[col.name];
                return this.escapeCSV(this.formatValue(value), delimiter);
            });
            lines.push(values.join(delimiter));
        }
        
        await FileUtils.writeFile(filePath, lines.join('\n'));
    }

    private async exportToJSON(result: ResultSet, filePath: string): Promise<void> {
        const data = {
            metadata: {
                columns: result.columns,
                rowCount: result.rowCount,
                exportDate: new Date().toISOString()
            },
            data: result.rows
        };
        
        await FileUtils.writeFile(filePath, JSON.stringify(data, null, 2));
    }

    private async exportToXML(result: ResultSet, filePath: string): Promise<void> {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<QueryResult>\n';
        xml += `  <RowCount>${result.rowCount}</RowCount>\n`;
        xml += '  <Data>\n';
        
        for (const row of result.rows) {
            xml += '    <Row>\n';
            for (const col of result.columns) {
                const value = this.escapeXML(this.formatValue(row[col.name]));
                xml += `      <${col.name}>${value}</${col.name}>\n`;
            }
            xml += '    </Row>\n';
        }
        
        xml += '  </Data>\n';
        xml += '</QueryResult>';
        
        await FileUtils.writeFile(filePath, xml);
    }

    private async exportToExcel(result: ResultSet, filePath: string): Promise<void> {
        // This would require xlsx package in real implementation
        // For now, export as CSV with .xlsx extension
        await this.exportToCSV(result, filePath.replace('.xlsx', '.csv'));
        console.warn('Excel export currently saves as CSV format');
    }

    private async exportToText(result: ResultSet, filePath: string): Promise<void> {
        const lines: string[] = [];
        
        // Calculate column widths
        const widths: number[] = result.columns.map(col => col.name.length);
        
        for (const row of result.rows) {
            result.columns.forEach((col, i) => {
                const value = this.formatValue(row[col.name]);
                widths[i] = Math.max(widths[i], value.length);
            });
        }
        
        // Header
        const headerLine = result.columns
            .map((col, i) => col.name.padEnd(widths[i]))
            .join(' | ');
        lines.push(headerLine);
        lines.push('-'.repeat(headerLine.length));
        
        // Data
        for (const row of result.rows) {
            const rowLine = result.columns
                .map((col, i) => this.formatValue(row[col.name]).padEnd(widths[i]))
                .join(' | ');
            lines.push(rowLine);
        }
        
        // Footer
        lines.push('-'.repeat(headerLine.length));
        lines.push(`Total Rows: ${result.rowCount}`);
        
        await FileUtils.writeFile(filePath, lines.join('\n'));
    }

    private async parseCSV(filePath: string): Promise<any[]> {
        const content = await FileUtils.readFile(filePath);
        const lines = content.split('\n').filter(line => line.trim());
        
        if (lines.length === 0) {
            return [];
        }
        
        const headers = lines[0].split(',').map(h => h.trim());
        const data: any[] = [];
        
        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            const row: Record<string, any> = {};
            
            headers.forEach((header, index) => {
                row[header] = this.parseValue(values[index] || '');
            });
            
            data.push(row);
        }
        
        return data;
    }

    private parseCSVLine(line: string): string[] {
        const values: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        values.push(current.trim());
        return values;
    }

    private async parseJSON(filePath: string): Promise<any[]> {
        const content = await FileUtils.readFile(filePath);
        const parsed = JSON.parse(content);
        
        // Handle different JSON structures
        if (Array.isArray(parsed)) {
            return parsed;
        } else if (parsed.data && Array.isArray(parsed.data)) {
            return parsed.data;
        } else if (parsed.rows && Array.isArray(parsed.rows)) {
            return parsed.rows;
        } else {
            throw new Error('JSON file does not contain an array of data');
        }
    }

    private async parseExcel(filePath: string): Promise<any[]> {
        // This would require xlsx package in real implementation
        throw new Error('Excel import requires xlsx package. Please use CSV format instead');
    }

    private escapeCSV(value: string, delimiter: string): string {
        if (value.includes(delimiter) || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    }

    private escapeXML(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    private formatValue(value: any): string {
        if (value === null || value === undefined) {
            return 'NULL';
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (typeof value === 'boolean') {
            return value ? 'TRUE' : 'FALSE';
        }
        return String(value);
    }

    private parseValue(value: string): any {
        if (value === 'NULL' || value === '') {
            return null;
        }
        if (value === 'TRUE') {
            return true;
        }
        if (value === 'FALSE') {
            return false;
        }
        if (/^-?\d+$/.test(value)) {
            return parseInt(value);
        }
        if (/^-?\d+\.\d+$/.test(value)) {
            return parseFloat(value);
        }
        if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
            return new Date(value);
        }
        return value;
    }

    private formatBytes(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    private formatDuration(milliseconds: number): string {
        const seconds = Math.floor(milliseconds / 1000);
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

    private interpolateVariables(text: string): string {
        return text.replace(/\{\{(\w+)\}\}/g, (match, variable) => {
            const value = this.context.getVariable(variable);
            if (value === undefined) {
                throw new Error(`Variable '${variable}' is not defined in context`);
            }
            return String(value);
        });
    }
}