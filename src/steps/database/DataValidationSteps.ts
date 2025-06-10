// src/steps/database/DataValidationSteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { DatabaseContext } from '../../database/context/DatabaseContext';
import { ResultSetValidator } from '../../database/validators/ResultSetValidator';
import { DataTypeValidator } from '../../database/validators/DataTypeValidator';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { ResultSet } from '../../database/types/database.types';

export class DataValidationSteps extends CSBDDBaseStepDefinition {
    private databaseContext: DatabaseContext;
    private resultSetValidator: ResultSetValidator;
    private dataTypeValidator: DataTypeValidator;

    constructor() {
        super();
        this.databaseContext = this.context.getDatabaseContext();
        this.resultSetValidator = new ResultSetValidator();
        this.dataTypeValidator = new DataTypeValidator();
    }

    @CSBDDStepDef('the value in row {int} column {string} should be {string}')
    async validateCellValue(row: number, column: string, expectedValue: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_cell_value', { row, column, expectedValue });

        const result = this.getLastResult();
        const interpolatedExpected = this.interpolateVariables(expectedValue);

        try {
            const validation = this.resultSetValidator.validateValue(
                result, 
                row - 1, // Convert to 0-based index
                column, 
                this.convertExpectedValue(interpolatedExpected)
            );

            if (!validation.valid) {
                throw new Error(validation.error || 'Validation failed');
            }

            ActionLogger.logDatabaseAction('cell_value_validated', { 
                row, 
                column, 
                actualValue: validation.actualValue 
            });

        } catch (error) {
            ActionLogger.logDatabaseError('cell_validation_failed', error);
            throw new Error(
                `Cell validation failed at row ${row}, column '${column}'\n` +
                `Expected: ${interpolatedExpected}\n` +
                `Error: ${error.message}`
            );
        }
    }

    @CSBDDStepDef('the value in row {int} column {string} should contain {string}')
    async validateCellContains(row: number, column: string, expectedSubstring: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_cell_contains', { row, column, expectedSubstring });

        const result = this.getLastResult();
        const interpolatedExpected = this.interpolateVariables(expectedSubstring);

        try {
            const actualValue = this.getCellValue(result, row - 1, column);
            const actualString = String(actualValue);

            if (!actualString.includes(interpolatedExpected)) {
                throw new Error(
                    `Value '${actualString}' does not contain '${interpolatedExpected}'`
                );
            }

            ActionLogger.logDatabaseAction('cell_contains_validated', { 
                row, 
                column, 
                actualValue: actualString 
            });

        } catch (error) {
            ActionLogger.logDatabaseError('cell_contains_failed', error);
            throw new Error(`Cell contains validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('the value in row {int} column {string} should match pattern {string}')
    async validateCellPattern(row: number, column: string, pattern: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_cell_pattern', { row, column, pattern });

        const result = this.getLastResult();
        const interpolatedPattern = this.interpolateVariables(pattern);

        try {
            const actualValue = this.getCellValue(result, row - 1, column);
            const actualString = String(actualValue);
            const regex = new RegExp(interpolatedPattern);

            if (!regex.test(actualString)) {
                throw new Error(
                    `Value '${actualString}' does not match pattern '${interpolatedPattern}'`
                );
            }

            ActionLogger.logDatabaseAction('cell_pattern_validated', { 
                row, 
                column, 
                actualValue: actualString 
            });

        } catch (error) {
            ActionLogger.logDatabaseError('cell_pattern_failed', error);
            throw new Error(`Cell pattern validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('the value in row {int} column {string} should be null')
    async validateCellNull(row: number, column: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_cell_null', { row, column });

        const result = this.getLastResult();

        try {
            const actualValue = this.getCellValue(result, row - 1, column);

            if (actualValue !== null && actualValue !== undefined) {
                throw new Error(`Expected null, but got: ${actualValue}`);
            }

            ActionLogger.logDatabaseAction('cell_null_validated', { row, column });

        } catch (error) {
            ActionLogger.logDatabaseError('cell_null_failed', error);
            throw new Error(`Cell null validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('the value in row {int} column {string} should not be null')
    async validateCellNotNull(row: number, column: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_cell_not_null', { row, column });

        const result = this.getLastResult();

        try {
            const actualValue = this.getCellValue(result, row - 1, column);

            if (actualValue === null || actualValue === undefined) {
                throw new Error('Expected non-null value, but got null');
            }

            ActionLogger.logDatabaseAction('cell_not_null_validated', { 
                row, 
                column, 
                actualValue 
            });

        } catch (error) {
            ActionLogger.logDatabaseError('cell_not_null_failed', error);
            throw new Error(`Cell not-null validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('all values in column {string} should be unique')
    async validateColumnUnique(column: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_column_unique', { column });

        const result = this.getLastResult();

        try {
            const validation = this.resultSetValidator.validateColumnUnique(result, column);

            if (!validation.valid) {
                throw new Error(validation.error || 'Uniqueness validation failed');
            }

            ActionLogger.logDatabaseAction('column_unique_validated', { 
                column,
                uniqueValues: validation.uniqueCount,
                totalValues: result.rowCount
            });

        } catch (error) {
            ActionLogger.logDatabaseError('column_unique_failed', error);
            throw new Error(`Column uniqueness validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('all values in column {string} should be {string}')
    async validateAllColumnValues(column: string, expectedValue: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_all_column_values', { column, expectedValue });

        const result = this.getLastResult();
        const interpolatedExpected = this.interpolateVariables(expectedValue);
        const expectedConverted = this.convertExpectedValue(interpolatedExpected);

        try {
            const validation = this.resultSetValidator.validateAllColumnValues(
                result, 
                column, 
                expectedConverted
            );

            if (!validation.valid) {
                throw new Error(validation.error || 'Column values validation failed');
            }

            ActionLogger.logDatabaseAction('all_column_values_validated', { 
                column,
                expectedValue: expectedConverted,
                rowCount: result.rowCount
            });

        } catch (error) {
            ActionLogger.logDatabaseError('all_column_values_failed', error);
            throw new Error(`Column values validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('column {string} should contain value {string}')
    async validateColumnContainsValue(column: string, value: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_column_contains_value', { column, value });

        const result = this.getLastResult();
        const interpolatedValue = this.interpolateVariables(value);
        const convertedValue = this.convertExpectedValue(interpolatedValue);

        try {
            const found = result.rows.some(row => {
                const cellValue = row[column];
                return this.valuesEqual(cellValue, convertedValue);
            });

            if (!found) {
                throw new Error(`Value '${interpolatedValue}' not found in column '${column}'`);
            }

            ActionLogger.logDatabaseAction('column_contains_value_validated', { 
                column, 
                value: convertedValue 
            });

        } catch (error) {
            ActionLogger.logDatabaseError('column_contains_value_failed', error);
            throw new Error(`Column contains value validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('column {string} should not contain value {string}')
    async validateColumnNotContainsValue(column: string, value: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_column_not_contains_value', { column, value });

        const result = this.getLastResult();
        const interpolatedValue = this.interpolateVariables(value);
        const convertedValue = this.convertExpectedValue(interpolatedValue);

        try {
            const found = result.rows.some(row => {
                const cellValue = row[column];
                return this.valuesEqual(cellValue, convertedValue);
            });

            if (found) {
                throw new Error(`Value '${interpolatedValue}' found in column '${column}'`);
            }

            ActionLogger.logDatabaseAction('column_not_contains_value_validated', { 
                column, 
                value: convertedValue 
            });

        } catch (error) {
            ActionLogger.logDatabaseError('column_not_contains_value_failed', error);
            throw new Error(`Column not contains value validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('the sum of column {string} should be {float}')
    async validateColumnSum(column: string, expectedSum: number): Promise<void> {
        ActionLogger.logDatabaseAction('validate_column_sum', { column, expectedSum });

        const result = this.getLastResult();

        try {
            const actualSum = result.rows.reduce((sum, row) => {
                const value = row[column];
                const numValue = Number(value);
                
                if (isNaN(numValue)) {
                    throw new Error(`Non-numeric value found in column '${column}': ${value}`);
                }
                
                return sum + numValue;
            }, 0);

            const tolerance = 0.001; // For floating point comparison
            if (Math.abs(actualSum - expectedSum) > tolerance) {
                throw new Error(
                    `Expected sum: ${expectedSum}, but got: ${actualSum}`
                );
            }

            ActionLogger.logDatabaseAction('column_sum_validated', { 
                column, 
                expectedSum, 
                actualSum 
            });

        } catch (error) {
            ActionLogger.logDatabaseError('column_sum_failed', error);
            throw new Error(`Column sum validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('the average of column {string} should be {float}')
    async validateColumnAverage(column: string, expectedAvg: number): Promise<void> {
        ActionLogger.logDatabaseAction('validate_column_average', { column, expectedAvg });

        const result = this.getLastResult();

        try {
            if (result.rowCount === 0) {
                throw new Error('Cannot calculate average of empty result set');
            }

            const sum = result.rows.reduce((total, row) => {
                const value = row[column];
                const numValue = Number(value);
                
                if (isNaN(numValue)) {
                    throw new Error(`Non-numeric value found in column '${column}': ${value}`);
                }
                
                return total + numValue;
            }, 0);

            const actualAvg = sum / result.rowCount;
            const tolerance = 0.001;

            if (Math.abs(actualAvg - expectedAvg) > tolerance) {
                throw new Error(
                    `Expected average: ${expectedAvg}, but got: ${actualAvg.toFixed(3)}`
                );
            }

            ActionLogger.logDatabaseAction('column_average_validated', { 
                column, 
                expectedAvg, 
                actualAvg: actualAvg.toFixed(3) 
            });

        } catch (error) {
            ActionLogger.logDatabaseError('column_average_failed', error);
            throw new Error(`Column average validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('the minimum value in column {string} should be {string}')
    async validateColumnMin(column: string, expectedMin: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_column_min', { column, expectedMin });

        const result = this.getLastResult();
        const interpolatedExpected = this.interpolateVariables(expectedMin);

        try {
            if (result.rowCount === 0) {
                throw new Error('Cannot find minimum in empty result set');
            }

            const values = result.rows.map(row => row[column]);
            const minValue = values.reduce((min, val) => {
                if (val === null || val === undefined) return min;
                
                // Compare based on type
                if (typeof val === 'number' && typeof min === 'number') {
                    return val < min ? val : min;
                } else if (val instanceof Date && min instanceof Date) {
                    return val < min ? val : min;
                } else {
                    return String(val) < String(min) ? val : min;
                }
            }, values[0]);

            const convertedExpected = this.convertExpectedValue(interpolatedExpected);
            
            if (!this.valuesEqual(minValue, convertedExpected)) {
                throw new Error(
                    `Expected minimum: ${interpolatedExpected}, but got: ${minValue}`
                );
            }

            ActionLogger.logDatabaseAction('column_min_validated', { 
                column, 
                expectedMin: convertedExpected, 
                actualMin: minValue 
            });

        } catch (error) {
            ActionLogger.logDatabaseError('column_min_failed', error);
            throw new Error(`Column minimum validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('the maximum value in column {string} should be {string}')
    async validateColumnMax(column: string, expectedMax: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_column_max', { column, expectedMax });

        const result = this.getLastResult();
        const interpolatedExpected = this.interpolateVariables(expectedMax);

        try {
            if (result.rowCount === 0) {
                throw new Error('Cannot find maximum in empty result set');
            }

            const values = result.rows.map(row => row[column]);
            const maxValue = values.reduce((max, val) => {
                if (val === null || val === undefined) return max;
                
                // Compare based on type
                if (typeof val === 'number' && typeof max === 'number') {
                    return val > max ? val : max;
                } else if (val instanceof Date && max instanceof Date) {
                    return val > max ? val : max;
                } else {
                    return String(val) > String(max) ? val : max;
                }
            }, values[0]);

            const convertedExpected = this.convertExpectedValue(interpolatedExpected);
            
            if (!this.valuesEqual(maxValue, convertedExpected)) {
                throw new Error(
                    `Expected maximum: ${interpolatedExpected}, but got: ${maxValue}`
                );
            }

            ActionLogger.logDatabaseAction('column_max_validated', { 
                column, 
                expectedMax: convertedExpected, 
                actualMax: maxValue 
            });

        } catch (error) {
            ActionLogger.logDatabaseError('column_max_failed', error);
            throw new Error(`Column maximum validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('column {string} should have data type {string}')
    async validateColumnDataType(column: string, expectedType: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_column_data_type', { column, expectedType });

        const result = this.getLastResult();

        try {
            // Find column metadata
            const columnMeta = result.columns.find(col => col.name === column);
            if (!columnMeta) {
                throw new Error(`Column '${column}' not found in result set`);
            }

            const validation = this.dataTypeValidator.validateColumnType(
                columnMeta,
                expectedType
            );

            if (!validation.valid) {
                throw new Error(validation.error || 'Data type validation failed');
            }

            ActionLogger.logDatabaseAction('column_data_type_validated', { 
                column, 
                expectedType,
                actualType: columnMeta.type
            });

        } catch (error) {
            ActionLogger.logDatabaseError('column_data_type_failed', error);
            throw new Error(`Column data type validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('values in column {string} should be between {string} and {string}')
    async validateColumnRange(column: string, minValue: string, maxValue: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_column_range', { column, minValue, maxValue });

        const result = this.getLastResult();
        const interpolatedMin = this.interpolateVariables(minValue);
        const interpolatedMax = this.interpolateVariables(maxValue);

        try {
            const minConverted = this.convertExpectedValue(interpolatedMin);
            const maxConverted = this.convertExpectedValue(interpolatedMax);

            const outOfRange = result.rows.filter(row => {
                const value = row[column];
                if (value === null || value === undefined) return false;

                if (typeof value === 'number') {
                    return value < Number(minConverted) || value > Number(maxConverted);
                } else if (value instanceof Date) {
                    const dateValue = value.getTime();
                    const minDate = new Date(minConverted).getTime();
                    const maxDate = new Date(maxConverted).getTime();
                    return dateValue < minDate || dateValue > maxDate;
                } else {
                    const strValue = String(value);
                    return strValue < String(minConverted) || strValue > String(maxConverted);
                }
            });

            if (outOfRange.length > 0) {
                throw new Error(
                    `${outOfRange.length} value(s) out of range [${interpolatedMin}, ${interpolatedMax}]\n` +
                    `First out-of-range value: ${outOfRange[0][column]}`
                );
            }

            ActionLogger.logDatabaseAction('column_range_validated', { 
                column, 
                minValue: minConverted, 
                maxValue: maxConverted,
                checkedRows: result.rowCount
            });

        } catch (error) {
            ActionLogger.logDatabaseError('column_range_failed', error);
            throw new Error(`Column range validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('the result should have columns:')
    async validateResultColumns(dataTable: any): Promise<void> {
        ActionLogger.logDatabaseAction('validate_result_columns');

        const result = this.getLastResult();
        const expectedColumns = this.parseColumnsTable(dataTable);

        try {
            const actualColumns = result.columns.map(col => col.name);
            const missingColumns = expectedColumns.filter(col => !actualColumns.includes(col));
            const extraColumns = actualColumns.filter(col => !expectedColumns.includes(col));

            if (missingColumns.length > 0 || extraColumns.length > 0) {
                let errorMsg = 'Column mismatch:\n';
                if (missingColumns.length > 0) {
                    errorMsg += `Missing columns: ${missingColumns.join(', ')}\n`;
                }
                if (extraColumns.length > 0) {
                    errorMsg += `Extra columns: ${extraColumns.join(', ')}\n`;
                }
                errorMsg += `Expected: ${expectedColumns.join(', ')}\n`;
                errorMsg += `Actual: ${actualColumns.join(', ')}`;
                throw new Error(errorMsg);
            }

            ActionLogger.logDatabaseAction('result_columns_validated', { 
                columnCount: expectedColumns.length,
                columns: expectedColumns
            });

        } catch (error) {
            ActionLogger.logDatabaseError('result_columns_failed', error);
            throw new Error(`Result columns validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('the result should match:')
    async validateResultData(dataTable: any): Promise<void> {
        ActionLogger.logDatabaseAction('validate_result_data');

        const result = this.getLastResult();
        const expectedData = this.parseExpectedData(dataTable);

        try {
            // Validate row count
            if (expectedData.length !== result.rowCount) {
                throw new Error(
                    `Row count mismatch. Expected: ${expectedData.length}, Actual: ${result.rowCount}`
                );
            }

            // Validate each row
            for (let i = 0; i < expectedData.length; i++) {
                const expectedRow = expectedData[i];
                const actualRow = result.rows[i];

                for (const column of Object.keys(expectedRow)) {
                    const expected = expectedRow[column];
                    const actual = actualRow[column];

                    if (!this.valuesEqual(actual, expected)) {
                        throw new Error(
                            `Mismatch at row ${i + 1}, column '${column}'\n` +
                            `Expected: ${expected}\n` +
                            `Actual: ${actual}`
                        );
                    }
                }
            }

            ActionLogger.logDatabaseAction('result_data_validated', { 
                rowCount: expectedData.length,
                columnCount: Object.keys(expectedData[0] || {}).length
            });

        } catch (error) {
            ActionLogger.logDatabaseError('result_data_failed', error);
            throw new Error(`Result data validation failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('the scalar result should be {string}')
    @CSBDDStepDef('the single value result should be {string}')
    async validateScalarResult(expectedValue: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_scalar_result', { expectedValue });

        const scalarResult = this.databaseContext.getLastScalarResult();
        if (scalarResult === undefined) {
            throw new Error('No scalar result available. Execute a scalar query first');
        }

        const interpolatedExpected = this.interpolateVariables(expectedValue);
        const convertedExpected = this.convertExpectedValue(interpolatedExpected);

        try {
            if (!this.valuesEqual(scalarResult, convertedExpected)) {
                throw new Error(
                    `Scalar result mismatch\n` +
                    `Expected: ${interpolatedExpected} (${typeof convertedExpected})\n` +
                    `Actual: ${scalarResult} (${typeof scalarResult})`
                );
            }

            ActionLogger.logDatabaseAction('scalar_result_validated', { 
                expectedValue: convertedExpected,
                actualValue: scalarResult
            });

        } catch (error) {
            ActionLogger.logDatabaseError('scalar_result_failed', error);
            throw new Error(`Scalar result validation failed: ${error.message}`);
        }
    }

    // Helper methods
    private getLastResult(): ResultSet {
        const result = this.databaseContext.getLastResult();
        if (!result) {
            throw new Error('No query result available. Execute a query first');
        }
        return result;
    }

    private getCellValue(result: ResultSet, rowIndex: number, column: string): any {
        if (rowIndex < 0 || rowIndex >= result.rowCount) {
            throw new Error(`Row index ${rowIndex + 1} out of bounds (1-${result.rowCount})`);
        }

        const row = result.rows[rowIndex];
        if (!(column in row)) {
            const availableColumns = Object.keys(row).join(', ');
            throw new Error(
                `Column '${column}' not found. Available columns: ${availableColumns}`
            );
        }

        return row[column];
    }

    private convertExpectedValue(value: string): any {
        // Handle special values
        if (value.toLowerCase() === 'null') return null;
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
        
        // Handle numbers
        if (/^-?\d+$/.test(value)) return parseInt(value);
        if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
        
        // Handle dates
        if (/^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(value);
        
        // Handle empty string
        if (value === "''") return '';
        
        // Default to string
        return value;
    }

    private valuesEqual(actual: any, expected: any): boolean {
        // Handle null/undefined
        if (actual === null || actual === undefined) {
            return expected === null || expected === undefined || expected === 'null';
        }

        // Handle dates
        if (actual instanceof Date && expected instanceof Date) {
            return actual.getTime() === expected.getTime();
        }

        // Handle numbers with tolerance
        if (typeof actual === 'number' && typeof expected === 'number') {
            return Math.abs(actual - expected) < 0.001;
        }

        // Default comparison
        return actual === expected;
    }

    private parseColumnsTable(dataTable: any): string[] {
        const columns: string[] = [];

        if (dataTable && dataTable.rawTable) {
            dataTable.rawTable.forEach((row: string[]) => {
                if (row.length > 0) {
                    columns.push(row[0].trim());
                }
            });
        }

        return columns;
    }

    private parseExpectedData(dataTable: any): Record<string, any>[] {
        const data: Record<string, any>[] = [];

        if (dataTable && dataTable.rawTable) {
            const headers = dataTable.rawTable[0].map((h: string) => h.trim());
            
            for (let i = 1; i < dataTable.rawTable.length; i++) {
                const row = dataTable.rawTable[i];
                const rowData: Record<string, any> = {};
                
                headers.forEach((header: string, index: number) => {
                    const value = row[index] ? row[index].trim() : '';
                    const interpolated = this.interpolateVariables(value);
                    rowData[header] = this.convertExpectedValue(interpolated);
                });
                
                data.push(rowData);
            }
        }

        return data;
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