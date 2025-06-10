// src/database/validators/SchemaValidator.ts

import { DatabaseAdapter } from '../adapters/DatabaseAdapter';
import { ValidationResult, SchemaValidationOptions, DatabaseConnection } from '../types/database.types';
import { ActionLogger } from '../../core/logging/ActionLogger';

export class SchemaValidator {
    private adapter: DatabaseAdapter;
    private connection: DatabaseConnection;
    private adapterType: string;

    constructor(adapter: DatabaseAdapter, connection: DatabaseConnection) {
        this.adapter = adapter;
        this.connection = connection;
        this.adapterType = connection.type || 'unknown';
    }

    /**
     * Validate table exists
     */
    async validateTableExists(tableName: string, schema?: string): Promise<ValidationResult> {
        const startTime = Date.now();
        const actionLogger = ActionLogger.getInstance();
        actionLogger.logValidation('tableExists', tableName, null, true, { tableName, schema });

        try {
            const query = this.getTableExistsQuery(tableName, schema);
            const result = await this.adapter.query(this.connection, query);
            
            const exists = result.rowCount > 0;
            const details = {
                tableName,
                schema,
                exists,
                query
            };

            const validationResult: ValidationResult = {
                passed: exists,
                ruleName: 'Table Exists Validation',
                message: exists ? 
                    `Table '${schema ? schema + '.' : ''}${tableName}' exists` : 
                    `Table '${schema ? schema + '.' : ''}${tableName}' does not exist`,
                details,
                duration: Date.now() - startTime
            };

            if (!exists) {
                const actionLogger = ActionLogger.getInstance();
                actionLogger.logValidation('tableExists', tableName, null, false, details);
            }

            return validationResult;

        } catch (error) {
            const details = {
                tableName,
                schema,
                error: (error as Error).message
            };

            return {
                passed: false,
                ruleName: 'Table Exists Validation',
                message: `Error checking table existence: ${(error as Error).message}`,
                details,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Validate column exists
     */
    async validateColumnExists(
        tableName: string, 
        columnName: string, 
        schema?: string
    ): Promise<ValidationResult> {
        const startTime = Date.now();
        const actionLogger = ActionLogger.getInstance();
        actionLogger.logValidation('columnExists', columnName, null, true, { tableName, columnName, schema });

        try {
            const query = this.getColumnExistsQuery(tableName, columnName, schema);
            const result = await this.adapter.query(this.connection, query);
            
            const exists = result.rowCount > 0;
            const columnInfo = exists ? result.rows[0] : null;
            
            const details = {
                tableName,
                columnName,
                schema,
                exists,
                columnInfo,
                query
            };

            const validationResult: ValidationResult = {
                passed: exists,
                ruleName: 'Column Exists Validation',
                message: exists ? 
                    `Column '${columnName}' exists in table '${tableName}'` : 
                    `Column '${columnName}' does not exist in table '${tableName}'`,
                details,
                duration: Date.now() - startTime
            };

            if (!exists) {
                const actionLogger = ActionLogger.getInstance();
                actionLogger.logValidation('columnExists', columnName, null, false, details);
            }

            return validationResult;

        } catch (error) {
            const details = {
                tableName,
                columnName,
                schema,
                error: (error as Error).message
            };

            return {
                passed: false,
                ruleName: 'Column Exists Validation',
                message: `Error checking column existence: ${(error as Error).message}`,
                details,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Validate table schema
     */
    async validateTableSchema(
        tableName: string,
        expectedColumns: Array<{
            name: string;
            dataType: string;
            nullable?: boolean;
            defaultValue?: any;
            primaryKey?: boolean;
        }>,
        options?: SchemaValidationOptions
    ): Promise<ValidationResult> {
        const startTime = Date.now();
        const actionLogger = ActionLogger.getInstance();
        actionLogger.logValidation('tableSchema', 'schema', expectedColumns, true, { tableName, expectedColumns: expectedColumns.length });

        try {
            const actualColumns = await this.getTableColumns(tableName, options?.schema);
            
            let passed = true;
            const issues: string[] = [];
            const columnComparison: any[] = [];

            // Check each expected column
            for (const expectedCol of expectedColumns) {
                const actualCol = actualColumns.find(col => 
                    col.name.toLowerCase() === expectedCol.name.toLowerCase()
                );

                if (!actualCol) {
                    passed = false;
                    issues.push(`Missing column: ${expectedCol.name}`);
                    columnComparison.push({
                        columnName: expectedCol.name,
                        status: 'missing',
                        expected: expectedCol,
                        actual: null
                    });
                    continue;
                }

                const comparison: any = {
                    columnName: expectedCol.name,
                    status: 'found',
                    expected: expectedCol,
                    actual: actualCol
                };

                // Validate data type
                if (!this.compareDataTypes(actualCol.dataType, expectedCol.dataType)) {
                    passed = false;
                    issues.push(`Column '${expectedCol.name}' type mismatch. Expected: ${expectedCol.dataType}, Actual: ${actualCol.dataType}`);
                    comparison.typeMismatch = true;
                }

                // Validate nullable
                if (expectedCol.nullable !== undefined && actualCol.nullable !== expectedCol.nullable) {
                    passed = false;
                    issues.push(`Column '${expectedCol.name}' nullable mismatch. Expected: ${expectedCol.nullable}, Actual: ${actualCol.nullable}`);
                    comparison.nullableMismatch = true;
                }

                // Validate default value
                if (expectedCol.defaultValue !== undefined && 
                    !this.compareDefaultValues(actualCol.defaultValue, expectedCol.defaultValue)) {
                    passed = false;
                    issues.push(`Column '${expectedCol.name}' default value mismatch`);
                    comparison.defaultMismatch = true;
                }

                // Validate primary key
                if (expectedCol.primaryKey !== undefined && actualCol.primaryKey !== expectedCol.primaryKey) {
                    passed = false;
                    issues.push(`Column '${expectedCol.name}' primary key mismatch`);
                    comparison.primaryKeyMismatch = true;
                }

                columnComparison.push(comparison);
            }

            // Check for unexpected columns if strict mode
            if (options?.strict) {
                for (const actualCol of actualColumns) {
                    if (!expectedColumns.find(col => 
                        col.name.toLowerCase() === actualCol.name.toLowerCase()
                    )) {
                        passed = false;
                        issues.push(`Unexpected column: ${actualCol.name}`);
                        columnComparison.push({
                            columnName: actualCol.name,
                            status: 'unexpected',
                            expected: null,
                            actual: actualCol
                        });
                    }
                }
            }

            const details = {
                tableName,
                schema: options?.schema,
                expectedColumnCount: expectedColumns.length,
                actualColumnCount: actualColumns.length,
                columnComparison,
                issues,
                strict: options?.strict || false
            };

            const validationResult: ValidationResult = {
                passed,
                ruleName: 'Table Schema Validation',
                message: passed ? 
                    `Table schema matches expected schema` : 
                    `Table schema validation failed: ${issues.join('; ')}`,
                details,
                duration: Date.now() - startTime
            };

            if (!passed) {
                const actionLogger = ActionLogger.getInstance();
                actionLogger.logValidation('tableSchema', 'schema', expectedColumns, false, details);
            }

            return validationResult;

        } catch (error) {
            const details = {
                tableName,
                schema: options?.schema,
                error: (error as Error).message
            };

            return {
                passed: false,
                ruleName: 'Table Schema Validation',
                message: `Error validating table schema: ${(error as Error).message}`,
                details,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Validate index exists
     */
    async validateIndexExists(
        tableName: string,
        indexName: string,
        schema?: string
    ): Promise<ValidationResult> {
        const startTime = Date.now();
        const actionLogger = ActionLogger.getInstance();
        actionLogger.logValidation('indexExists', indexName, null, true, { tableName, indexName, schema });

        try {
            const query = this.getIndexExistsQuery(tableName, indexName, schema);
            const result = await this.adapter.query(this.connection, query);
            
            const exists = result.rowCount > 0;
            const indexInfo = exists ? result.rows[0] : null;
            
            const details = {
                tableName,
                indexName,
                schema,
                exists,
                indexInfo,
                query
            };

            const validationResult: ValidationResult = {
                passed: exists,
                ruleName: 'Index Exists Validation',
                message: exists ? 
                    `Index '${indexName}' exists on table '${tableName}'` : 
                    `Index '${indexName}' does not exist on table '${tableName}'`,
                details,
                duration: Date.now() - startTime
            };

            if (!exists) {
                const actionLogger = ActionLogger.getInstance();
                actionLogger.logValidation('indexExists', indexName, null, false, details);
            }

            return validationResult;

        } catch (error) {
            const details = {
                tableName,
                indexName,
                schema,
                error: (error as Error).message
            };

            return {
                passed: false,
                ruleName: 'Index Exists Validation',
                message: `Error checking index existence: ${(error as Error).message}`,
                details,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Validate foreign key exists
     */
    async validateForeignKeyExists(
        tableName: string,
        foreignKeyName: string,
        schema?: string
    ): Promise<ValidationResult> {
        const startTime = Date.now();
        const actionLogger = ActionLogger.getInstance();
        actionLogger.logValidation('foreignKeyExists', foreignKeyName, null, true, { tableName, foreignKeyName, schema });

        try {
            const query = this.getForeignKeyExistsQuery(tableName, foreignKeyName, schema);
            const result = await this.adapter.query(this.connection, query);
            
            const exists = result.rowCount > 0;
            const fkInfo = exists ? result.rows[0] : null;
            
            const details = {
                tableName,
                foreignKeyName,
                schema,
                exists,
                foreignKeyInfo: fkInfo,
                query
            };

            const validationResult: ValidationResult = {
                passed: exists,
                ruleName: 'Foreign Key Exists Validation',
                message: exists ? 
                    `Foreign key '${foreignKeyName}' exists on table '${tableName}'` : 
                    `Foreign key '${foreignKeyName}' does not exist on table '${tableName}'`,
                details,
                duration: Date.now() - startTime
            };

            if (!exists) {
                const actionLogger = ActionLogger.getInstance();
                actionLogger.logValidation('foreignKeyExists', foreignKeyName, null, false, details);
            }

            return validationResult;

        } catch (error) {
            const details = {
                tableName,
                foreignKeyName,
                schema,
                error: (error as Error).message
            };

            return {
                passed: false,
                ruleName: 'Foreign Key Exists Validation',
                message: `Error checking foreign key existence: ${(error as Error).message}`,
                details,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Validate constraint exists
     */
    async validateConstraintExists(
        tableName: string,
        constraintName: string,
        constraintType?: 'PRIMARY KEY' | 'UNIQUE' | 'CHECK' | 'FOREIGN KEY',
        schema?: string
    ): Promise<ValidationResult> {
        const startTime = Date.now();
        const actionLogger = ActionLogger.getInstance();
        actionLogger.logValidation('constraintExists', constraintName, null, true, { 
            tableName, 
            constraintName, 
            constraintType, 
            schema 
        });

        try {
            const query = this.getConstraintExistsQuery(tableName, constraintName, constraintType, schema);
            const result = await this.adapter.query(this.connection, query);
            
            const exists = result.rowCount > 0;
            const constraintInfo = exists ? result.rows[0] : null;
            
            const details = {
                tableName,
                constraintName,
                constraintType,
                schema,
                exists,
                constraintInfo,
                query
            };

            const validationResult: ValidationResult = {
                passed: exists,
                ruleName: 'Constraint Exists Validation',
                message: exists ? 
                    `Constraint '${constraintName}' exists on table '${tableName}'` : 
                    `Constraint '${constraintName}' does not exist on table '${tableName}'`,
                details,
                duration: Date.now() - startTime
            };

            if (!exists) {
                const actionLogger = ActionLogger.getInstance();
                actionLogger.logValidation('constraintExists', constraintName, null, false, details);
            }

            return validationResult;

        } catch (error) {
            const details = {
                tableName,
                constraintName,
                constraintType,
                schema,
                error: (error as Error).message
            };

            return {
                passed: false,
                ruleName: 'Constraint Exists Validation',
                message: `Error checking constraint existence: ${(error as Error).message}`,
                details,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Validate view exists
     */
    async validateViewExists(viewName: string, schema?: string): Promise<ValidationResult> {
        const startTime = Date.now();
        const actionLogger = ActionLogger.getInstance();
        actionLogger.logValidation('viewExists', viewName, null, true, { viewName, schema });

        try {
            const query = this.getViewExistsQuery(viewName, schema);
            const result = await this.adapter.query(this.connection, query);
            
            const exists = result.rowCount > 0;
            const details = {
                viewName,
                schema,
                exists,
                query
            };

            const validationResult: ValidationResult = {
                passed: exists,
                ruleName: 'View Exists Validation',
                message: exists ? 
                    `View '${schema ? schema + '.' : ''}${viewName}' exists` : 
                    `View '${schema ? schema + '.' : ''}${viewName}' does not exist`,
                details,
                duration: Date.now() - startTime
            };

            if (!exists) {
                const actionLogger = ActionLogger.getInstance();
                actionLogger.logValidation('viewExists', viewName, null, false, details);
            }

            return validationResult;

        } catch (error) {
            const details = {
                viewName,
                schema,
                error: (error as Error).message
            };

            return {
                passed: false,
                ruleName: 'View Exists Validation',
                message: `Error checking view existence: ${(error as Error).message}`,
                details,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Validate stored procedure exists
     */
    async validateStoredProcedureExists(
        procedureName: string, 
        schema?: string
    ): Promise<ValidationResult> {
        const startTime = Date.now();
        const actionLogger = ActionLogger.getInstance();
        actionLogger.logValidation('storedProcedureExists', procedureName, null, true, { procedureName, schema });

        try {
            const query = this.getStoredProcedureExistsQuery(procedureName, schema);
            const result = await this.adapter.query(this.connection, query);
            
            const exists = result.rowCount > 0;
            const details = {
                procedureName,
                schema,
                exists,
                query
            };

            const validationResult: ValidationResult = {
                passed: exists,
                ruleName: 'Stored Procedure Exists Validation',
                message: exists ? 
                    `Stored procedure '${schema ? schema + '.' : ''}${procedureName}' exists` : 
                    `Stored procedure '${schema ? schema + '.' : ''}${procedureName}' does not exist`,
                details,
                duration: Date.now() - startTime
            };

            if (!exists) {
                const actionLogger = ActionLogger.getInstance();
                actionLogger.logValidation('storedProcedureExists', procedureName, null, false, details);
            }

            return validationResult;

        } catch (error) {
            const details = {
                procedureName,
                schema,
                error: (error as Error).message
            };

            return {
                passed: false,
                ruleName: 'Stored Procedure Exists Validation',
                message: `Error checking stored procedure existence: ${(error as Error).message}`,
                details,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Validate function exists
     */
    async validateFunctionExists(functionName: string, schema?: string): Promise<ValidationResult> {
        const startTime = Date.now();
        const actionLogger = ActionLogger.getInstance();
        actionLogger.logValidation('functionExists', functionName, null, true, { functionName, schema });

        try {
            const query = this.getFunctionExistsQuery(functionName, schema);
            const result = await this.adapter.query(this.connection, query);
            
            const exists = result.rowCount > 0;
            const details = {
                functionName,
                schema,
                exists,
                query
            };

            const validationResult: ValidationResult = {
                passed: exists,
                ruleName: 'Function Exists Validation',
                message: exists ? 
                    `Function '${schema ? schema + '.' : ''}${functionName}' exists` : 
                    `Function '${schema ? schema + '.' : ''}${functionName}' does not exist`,
                details,
                duration: Date.now() - startTime
            };

            if (!exists) {
                const actionLogger = ActionLogger.getInstance();
                actionLogger.logValidation('functionExists', functionName, null, false, details);
            }

            return validationResult;

        } catch (error) {
            const details = {
                functionName,
                schema,
                error: (error as Error).message
            };

            return {
                passed: false,
                ruleName: 'Function Exists Validation',
                message: `Error checking function existence: ${(error as Error).message}`,
                details,
                duration: Date.now() - startTime
            };
        }
    }

    // Private helper methods

    private getTableExistsQuery(tableName: string, schema?: string): string {
        switch (this.adapterType) {
            case 'sqlserver':
                return `
                    SELECT TABLE_NAME 
                    FROM INFORMATION_SCHEMA.TABLES 
                    WHERE TABLE_NAME = '${tableName}' 
                    ${schema ? `AND TABLE_SCHEMA = '${schema}'` : ''}
                `;
            
            case 'mysql':
                return `
                    SELECT TABLE_NAME 
                    FROM INFORMATION_SCHEMA.TABLES 
                    WHERE TABLE_NAME = '${tableName}' 
                    ${schema ? `AND TABLE_SCHEMA = '${schema}'` : `AND TABLE_SCHEMA = DATABASE()`}
                `;
            
            case 'postgresql':
                return `
                    SELECT tablename 
                    FROM pg_tables 
                    WHERE tablename = '${tableName}' 
                    ${schema ? `AND schemaname = '${schema}'` : `AND schemaname = 'public'`}
                `;
            
            case 'oracle':
                return `
                    SELECT TABLE_NAME 
                    FROM ${schema || 'USER'}_TABLES 
                    WHERE TABLE_NAME = UPPER('${tableName}')
                `;
            
            case 'mongodb':
                return `db.getCollectionNames().filter(name => name === '${tableName}')`;
            
            case 'redis':
                return `EXISTS ${tableName}:*`;
            
            default:
                throw new Error(`Unsupported database type for schema validation: ${this.adapterType}`);
        }
    }

    private getColumnExistsQuery(tableName: string, columnName: string, schema?: string): string {
        switch (this.adapterType) {
            case 'sqlserver':
                return `
                    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
                    FROM INFORMATION_SCHEMA.COLUMNS 
                    WHERE TABLE_NAME = '${tableName}' 
                    AND COLUMN_NAME = '${columnName}'
                    ${schema ? `AND TABLE_SCHEMA = '${schema}'` : ''}
                `;
            
            case 'mysql':
                return `
                    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
                    FROM INFORMATION_SCHEMA.COLUMNS 
                    WHERE TABLE_NAME = '${tableName}' 
                    AND COLUMN_NAME = '${columnName}'
                    ${schema ? `AND TABLE_SCHEMA = '${schema}'` : `AND TABLE_SCHEMA = DATABASE()`}
                `;
            
            case 'postgresql':
                return `
                    SELECT column_name, data_type, is_nullable, column_default
                    FROM information_schema.columns 
                    WHERE table_name = '${tableName}' 
                    AND column_name = '${columnName}'
                    ${schema ? `AND table_schema = '${schema}'` : `AND table_schema = 'public'`}
                `;
            
            case 'oracle':
                return `
                    SELECT COLUMN_NAME, DATA_TYPE, NULLABLE, DATA_DEFAULT
                    FROM ${schema || 'USER'}_TAB_COLUMNS 
                    WHERE TABLE_NAME = UPPER('${tableName}') 
                    AND COLUMN_NAME = UPPER('${columnName}')
                `;
            
            case 'mongodb':
                // MongoDB doesn't have fixed schema, check if field exists in any document
                return `db.${tableName}.findOne({ "${columnName}": { $exists: true } })`;
            
            case 'redis':
                // Redis doesn't have columns, check if hash field exists
                return `HEXISTS ${tableName}:sample ${columnName}`;
            
            default:
                throw new Error(`Unsupported database type for column validation: ${this.adapterType}`);
        }
    }

    private async getTableColumns(tableName: string, schema?: string): Promise<any[]> {
        let query: string;
        
        switch (this.adapterType) {
            case 'sqlserver':
                query = `
                    SELECT 
                        c.COLUMN_NAME as name,
                        c.DATA_TYPE as dataType,
                        CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END as nullable,
                        c.COLUMN_DEFAULT as defaultValue,
                        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as primaryKey
                    FROM INFORMATION_SCHEMA.COLUMNS c
                    LEFT JOIN (
                        SELECT ku.COLUMN_NAME
                        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
                            ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
                        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
                        AND tc.TABLE_NAME = '${tableName}'
                        ${schema ? `AND tc.TABLE_SCHEMA = '${schema}'` : ''}
                    ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
                    WHERE c.TABLE_NAME = '${tableName}'
                    ${schema ? `AND c.TABLE_SCHEMA = '${schema}'` : ''}
                    ORDER BY c.ORDINAL_POSITION
                `;
                break;
            
            case 'mysql':
                query = `
                    SELECT 
                        c.COLUMN_NAME as name,
                        c.DATA_TYPE as dataType,
                        CASE WHEN c.IS_NULLABLE = 'YES' THEN true ELSE false END as nullable,
                        c.COLUMN_DEFAULT as defaultValue,
                        CASE WHEN c.COLUMN_KEY = 'PRI' THEN true ELSE false END as primaryKey
                    FROM INFORMATION_SCHEMA.COLUMNS c
                    WHERE c.TABLE_NAME = '${tableName}'
                    ${schema ? `AND c.TABLE_SCHEMA = '${schema}'` : `AND c.TABLE_SCHEMA = DATABASE()`}
                    ORDER BY c.ORDINAL_POSITION
                `;
                break;
            
            case 'postgresql':
                query = `
                    SELECT 
                        c.column_name as name,
                        c.data_type as dataType,
                        CASE WHEN c.is_nullable = 'YES' THEN true ELSE false END as nullable,
                        c.column_default as defaultValue,
                        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as primaryKey
                    FROM information_schema.columns c
                    LEFT JOIN (
                        SELECT ku.column_name
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage ku
                            ON tc.constraint_name = ku.constraint_name
                        WHERE tc.constraint_type = 'PRIMARY KEY'
                        AND tc.table_name = '${tableName}'
                        ${schema ? `AND tc.table_schema = '${schema}'` : `AND tc.table_schema = 'public'`}
                    ) pk ON c.column_name = pk.column_name
                    WHERE c.table_name = '${tableName}'
                    ${schema ? `AND c.table_schema = '${schema}'` : `AND c.table_schema = 'public'`}
                    ORDER BY c.ordinal_position
                `;
                break;
            
            case 'oracle':
                query = `
                    SELECT 
                        c.COLUMN_NAME as name,
                        c.DATA_TYPE as dataType,
                        CASE WHEN c.NULLABLE = 'Y' THEN 1 ELSE 0 END as nullable,
                        c.DATA_DEFAULT as defaultValue,
                        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as primaryKey
                    FROM ${schema || 'USER'}_TAB_COLUMNS c
                    LEFT JOIN (
                        SELECT cc.COLUMN_NAME
                        FROM ${schema || 'USER'}_CONSTRAINTS con
                        JOIN ${schema || 'USER'}_CONS_COLUMNS cc
                            ON con.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
                        WHERE con.CONSTRAINT_TYPE = 'P'
                        AND con.TABLE_NAME = UPPER('${tableName}')
                    ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
                    WHERE c.TABLE_NAME = UPPER('${tableName}')
                    ORDER BY c.COLUMN_ID
                `;
                break;
            
            default:
                return [];
        }
        
        const result = await this.adapter.query(this.connection, query);
        return result.rows;
    }

    private compareDataTypes(actual: string, expected: string): boolean {
        // Normalize data types for comparison
        const normalizeType = (type: string): string => {
            return type.toLowerCase()
                .replace(/\s+/g, '')
                .replace(/int\d+/, 'integer')
                .replace(/varchar\(\d+\)/, 'varchar')
                .replace(/char\(\d+\)/, 'char')
                .replace(/decimal\(\d+,\d+\)/, 'decimal')
                .replace(/numeric\(\d+,\d+\)/, 'numeric')
                .replace(/float\(\d+\)/, 'float');
        };
        
        const normalizedActual = normalizeType(actual);
        const normalizedExpected = normalizeType(expected);
        
        // Handle type aliases
        const typeAliases: Record<string, string[]> = {
            'integer': ['int', 'integer', 'int4', 'int32'],
            'bigint': ['bigint', 'int8', 'int64'],
            'smallint': ['smallint', 'int2', 'int16'],
            'boolean': ['boolean', 'bool', 'bit'],
            'varchar': ['varchar', 'string', 'text'],
            'timestamp': ['timestamp', 'datetime', 'datetime2'],
            'decimal': ['decimal', 'numeric', 'number']
        };
        
        // Check direct match
        if (normalizedActual === normalizedExpected) {
            return true;
        }
        
        // Check aliases
        for (const [_key, aliases] of Object.entries(typeAliases)) {
            if (aliases.includes(normalizedActual) && aliases.includes(normalizedExpected)) {
                return true;
            }
        }
        
        return false;
    }

    private compareDefaultValues(actual: any, expected: any): boolean {
        // Handle null/undefined
        if (actual === null || actual === undefined) {
            return expected === null || expected === undefined;
        }
        
        // Normalize default value expressions
        const normalizeDefault = (value: any): string => {
            if (value === null || value === undefined) return '';
            
            return String(value)
                .replace(/^'|'$/g, '')  // Remove quotes
                .replace(/\(\)/g, '')   // Remove parentheses
                .replace(/::[\w\s]+/g, '') // Remove PostgreSQL type casts
                .toLowerCase()
                .trim();
        };
        
        return normalizeDefault(actual) === normalizeDefault(expected);
    }

    private getIndexExistsQuery(tableName: string, indexName: string, schema?: string): string {
        switch (this.adapterType) {
            case 'sqlserver':
                return `
                    SELECT i.name 
                    FROM sys.indexes i
                    JOIN sys.tables t ON i.object_id = t.object_id
                    ${schema ? `JOIN sys.schemas s ON t.schema_id = s.schema_id` : ''}
                    WHERE t.name = '${tableName}' 
                    AND i.name = '${indexName}'
                    ${schema ? `AND s.name = '${schema}'` : ''}
                `;
            
            case 'mysql':
                return `
                    SELECT INDEX_NAME 
                    FROM INFORMATION_SCHEMA.STATISTICS 
                    WHERE TABLE_NAME = '${tableName}' 
                    AND INDEX_NAME = '${indexName}'
                    ${schema ? `AND TABLE_SCHEMA = '${schema}'` : `AND TABLE_SCHEMA = DATABASE()`}
                `;
            
            case 'postgresql':
                return `
                    SELECT indexname 
                    FROM pg_indexes 
                    WHERE tablename = '${tableName}' 
                    AND indexname = '${indexName}'
                    ${schema ? `AND schemaname = '${schema}'` : `AND schemaname = 'public'`}
                `;
            
            case 'oracle':
                return `
                    SELECT INDEX_NAME 
                    FROM ${schema || 'USER'}_INDEXES 
                    WHERE TABLE_NAME = UPPER('${tableName}') 
                    AND INDEX_NAME = UPPER('${indexName}')
                `;
            
            default:
                return '';
        }
    }

    private getForeignKeyExistsQuery(tableName: string, foreignKeyName: string, schema?: string): string {
        switch (this.adapterType) {
            case 'sqlserver':
                return `
                    SELECT CONSTRAINT_NAME 
                    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
                    WHERE TABLE_NAME = '${tableName}' 
                    AND CONSTRAINT_NAME = '${foreignKeyName}'
                    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
                    ${schema ? `AND TABLE_SCHEMA = '${schema}'` : ''}
                `;
            
            case 'mysql':
                return `
                    SELECT CONSTRAINT_NAME 
                    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
                    WHERE TABLE_NAME = '${tableName}' 
                    AND CONSTRAINT_NAME = '${foreignKeyName}'
                    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
                    ${schema ? `AND TABLE_SCHEMA = '${schema}'` : `AND TABLE_SCHEMA = DATABASE()`}
                `;
            
            case 'postgresql':
                return `
                    SELECT conname 
                    FROM pg_constraint c
                    JOIN pg_class t ON c.conrelid = t.oid
                    JOIN pg_namespace n ON t.relnamespace = n.oid
                    WHERE t.relname = '${tableName}' 
                    AND c.conname = '${foreignKeyName}'
                    AND c.contype = 'f'
                    ${schema ? `AND n.nspname = '${schema}'` : `AND n.nspname = 'public'`}
                `;
            
            case 'oracle':
                return `
                    SELECT CONSTRAINT_NAME 
                    FROM ${schema || 'USER'}_CONSTRAINTS 
                    WHERE TABLE_NAME = UPPER('${tableName}') 
                    AND CONSTRAINT_NAME = UPPER('${foreignKeyName}')
                    AND CONSTRAINT_TYPE = 'R'
                `;
            
            default:
                return '';
        }
    }

    private getConstraintExistsQuery(
        tableName: string, 
        constraintName: string, 
        constraintType?: string,
        schema?: string
    ): string {
        const typeFilter = constraintType ? 
            `AND CONSTRAINT_TYPE = '${constraintType}'` : '';
        
        switch (this.adapterType) {
            case 'sqlserver':
            case 'mysql':
                return `
                    SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE 
                    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
                    WHERE TABLE_NAME = '${tableName}' 
                    AND CONSTRAINT_NAME = '${constraintName}'
                    ${typeFilter}
                    ${schema ? `AND TABLE_SCHEMA = '${schema}'` : ''}
                `;
            
            case 'postgresql':
                const pgTypeMap: Record<string, string> = {
                    'PRIMARY KEY': 'p',
                    'FOREIGN KEY': 'f',
                    'UNIQUE': 'u',
                    'CHECK': 'c'
                };
                const pgTypeFilter = constraintType && pgTypeMap[constraintType] ? 
                    `AND c.contype = '${pgTypeMap[constraintType]}'` : '';
                
                return `
                    SELECT c.conname, 
                           CASE c.contype 
                               WHEN 'p' THEN 'PRIMARY KEY'
                               WHEN 'f' THEN 'FOREIGN KEY'
                               WHEN 'u' THEN 'UNIQUE'
                               WHEN 'c' THEN 'CHECK'
                           END as constraint_type
                    FROM pg_constraint c
                    JOIN pg_class t ON c.conrelid = t.oid
                    JOIN pg_namespace n ON t.relnamespace = n.oid
                    WHERE t.relname = '${tableName}' 
                    AND c.conname = '${constraintName}'
                    ${pgTypeFilter}
                    ${schema ? `AND n.nspname = '${schema}'` : `AND n.nspname = 'public'`}
                `;
            
            case 'oracle':
                const oraTypeMap: Record<string, string> = {
                    'PRIMARY KEY': 'P',
                    'FOREIGN KEY': 'R',
                    'UNIQUE': 'U',
                    'CHECK': 'C'
                };
                const oraTypeFilter = constraintType && oraTypeMap[constraintType] ? 
                    `AND CONSTRAINT_TYPE = '${oraTypeMap[constraintType]}'` : '';
                
                return `
                    SELECT CONSTRAINT_NAME, 
                           CASE CONSTRAINT_TYPE 
                               WHEN 'P' THEN 'PRIMARY KEY'
                               WHEN 'R' THEN 'FOREIGN KEY'
                               WHEN 'U' THEN 'UNIQUE'
                               WHEN 'C' THEN 'CHECK'
                           END as CONSTRAINT_TYPE
                    FROM ${schema || 'USER'}_CONSTRAINTS 
                    WHERE TABLE_NAME = UPPER('${tableName}') 
                    AND CONSTRAINT_NAME = UPPER('${constraintName}')
                    ${oraTypeFilter}
                `;
            
            default:
                return '';
        }
    }

    private getViewExistsQuery(viewName: string, schema?: string): string {
        switch (this.adapterType) {
            case 'sqlserver':
                return `
                    SELECT TABLE_NAME 
                    FROM INFORMATION_SCHEMA.VIEWS 
                    WHERE TABLE_NAME = '${viewName}' 
                    ${schema ? `AND TABLE_SCHEMA = '${schema}'` : ''}
                `;
            
            case 'mysql':
                return `
                    SELECT TABLE_NAME 
                    FROM INFORMATION_SCHEMA.VIEWS 
                    WHERE TABLE_NAME = '${viewName}' 
                    ${schema ? `AND TABLE_SCHEMA = '${schema}'` : `AND TABLE_SCHEMA = DATABASE()`}
                `;
            
            case 'postgresql':
                return `
                    SELECT viewname 
                    FROM pg_views 
                    WHERE viewname = '${viewName}' 
                    ${schema ? `AND schemaname = '${schema}'` : `AND schemaname = 'public'`}
                `;
            
            case 'oracle':
                return `
                    SELECT VIEW_NAME 
                    FROM ${schema || 'USER'}_VIEWS 
                    WHERE VIEW_NAME = UPPER('${viewName}')
                `;
            
            default:
                return '';
        }
    }

    private getStoredProcedureExistsQuery(procedureName: string, schema?: string): string {
        switch (this.adapterType) {
            case 'sqlserver':
                return `
                    SELECT ROUTINE_NAME 
                    FROM INFORMATION_SCHEMA.ROUTINES 
                    WHERE ROUTINE_NAME = '${procedureName}' 
                    AND ROUTINE_TYPE = 'PROCEDURE'
                    ${schema ? `AND ROUTINE_SCHEMA = '${schema}'` : ''}
                `;
            
            case 'mysql':
                return `
                    SELECT ROUTINE_NAME 
                    FROM INFORMATION_SCHEMA.ROUTINES 
                    WHERE ROUTINE_NAME = '${procedureName}' 
                    AND ROUTINE_TYPE = 'PROCEDURE'
                    ${schema ? `AND ROUTINE_SCHEMA = '${schema}'` : `AND ROUTINE_SCHEMA = DATABASE()`}
                `;
            
            case 'postgresql':
                return `
                    SELECT proname 
                    FROM pg_proc p
                    JOIN pg_namespace n ON p.pronamespace = n.oid
                    WHERE p.proname = '${procedureName}' 
                    AND p.prokind = 'p'
                    ${schema ? `AND n.nspname = '${schema}'` : `AND n.nspname = 'public'`}
                `;
            
            case 'oracle':
                return `
                    SELECT OBJECT_NAME 
                    FROM ${schema || 'USER'}_OBJECTS 
                    WHERE OBJECT_NAME = UPPER('${procedureName}') 
                    AND OBJECT_TYPE = 'PROCEDURE'
                `;
            
            default:
                return '';
        }
    }

    private getFunctionExistsQuery(functionName: string, schema?: string): string {
        switch (this.adapterType) {
            case 'sqlserver':
                return `
                    SELECT ROUTINE_NAME 
                    FROM INFORMATION_SCHEMA.ROUTINES 
                    WHERE ROUTINE_NAME = '${functionName}' 
                    AND ROUTINE_TYPE = 'FUNCTION'
                    ${schema ? `AND ROUTINE_SCHEMA = '${schema}'` : ''}
                `;
            
            case 'mysql':
                return `
                    SELECT ROUTINE_NAME 
                    FROM INFORMATION_SCHEMA.ROUTINES 
                    WHERE ROUTINE_NAME = '${functionName}' 
                    AND ROUTINE_TYPE = 'FUNCTION'
                    ${schema ? `AND ROUTINE_SCHEMA = '${schema}'` : `AND ROUTINE_SCHEMA = DATABASE()`}
                `;
            
            case 'postgresql':
                return `
                    SELECT proname 
                    FROM pg_proc p
                    JOIN pg_namespace n ON p.pronamespace = n.oid
                    WHERE p.proname = '${functionName}' 
                    AND p.prokind = 'f'
                    ${schema ? `AND n.nspname = '${schema}'` : `AND n.nspname = 'public'`}
                `;
            
            case 'oracle':
                return `
                    SELECT OBJECT_NAME 
                    FROM ${schema || 'USER'}_OBJECTS 
                    WHERE OBJECT_NAME = UPPER('${functionName}') 
                    AND OBJECT_TYPE = 'FUNCTION'
                `;
            
            default:
                return '';
        }
    }
}