// src/steps/database/QueryExecutionSteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { DatabaseContext } from '../../database/context/DatabaseContext';
import { CSDatabase } from '../../database/client/CSDatabase';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { FileUtils } from '../../core/utils/FileUtils';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';
import { ResultSet, QueryOptions } from '../../database/types/database.types';

export class QueryExecutionSteps extends CSBDDBaseStepDefinition {
    private databaseContext: DatabaseContext;

    constructor() {
        super();
        this.databaseContext = this.context.getDatabaseContext();
    }

    @CSBDDStepDef('user executes query from file {string}')
    @CSBDDStepDef('user runs query from file {string}')
    async executeQueryFromFile(filePath: string): Promise<void> {
        ActionLogger.logDatabaseAction('execute_query_from_file', { filePath });

        try {
            const resolvedPath = this.resolveFilePath(filePath);
            const query = await FileUtils.readFile(resolvedPath);
            const interpolatedQuery = this.interpolateVariables(query);

            const db = this.getCurrentDatabase();
            const startTime = Date.now();
            const result = await db.query(interpolatedQuery);
            const executionTime = Date.now() - startTime;

            this.databaseContext.setLastResult(result);
            this.databaseContext.addQueryExecution({
                query: interpolatedQuery,
                executionTime,
                rowCount: result.rowCount,
                timestamp: new Date()
            });

            ActionLogger.logDatabaseAction('query_from_file_executed', {
                filePath,
                rowCount: result.rowCount,
                executionTime
            });

        } catch (error) {
            ActionLogger.logDatabaseError('query_file_execution_failed', error);
            throw new Error(`Failed to execute query from file '${filePath}': ${error.message}`);
        }
    }

    @CSBDDStepDef('user executes parameterized query {string} with parameters:')
    async executeParameterizedQuery(query: string, dataTable: any): Promise<void> {
        ActionLogger.logDatabaseAction('execute_parameterized_query', { 
            query: this.sanitizeQueryForLog(query) 
        });

        try {
            const parameters = this.parseParametersTable(dataTable);
            const interpolatedQuery = this.interpolateVariables(query);

            const db = this.getCurrentDatabase();
            const startTime = Date.now();
            const result = await db.queryWithParams(interpolatedQuery, parameters);
            const executionTime = Date.now() - startTime;

            this.databaseContext.setLastResult(result);
            this.databaseContext.addQueryExecution({
                query: interpolatedQuery,
                executionTime,
                rowCount: result.rowCount,
                timestamp: new Date(),
                parameters
            });

            ActionLogger.logDatabaseAction('parameterized_query_executed', {
                rowCount: result.rowCount,
                executionTime,
                parameterCount: Object.keys(parameters).length
            });

        } catch (error) {
            ActionLogger.logDatabaseError('parameterized_query_failed', error);
            throw new Error(`Failed to execute parameterized query: ${error.message}`);
        }
    }

    @CSBDDStepDef('user executes prepared statement {string}')
    @CSBDDStepDef('user executes predefined query {string}')
    async executePredefinedQuery(queryName: string): Promise<void> {
        ActionLogger.logDatabaseAction('execute_predefined_query', { queryName });

        try {
            // Load predefined query from configuration
            const query = ConfigurationManager.get(`DB_QUERY_${queryName.toUpperCase()}`);
            if (!query) {
                throw new Error(`Predefined query '${queryName}' not found in configuration`);
            }

            const interpolatedQuery = this.interpolateVariables(query);
            const db = this.getCurrentDatabase();
            
            const startTime = Date.now();
            const result = await db.query(interpolatedQuery);
            const executionTime = Date.now() - startTime;

            this.databaseContext.setLastResult(result);
            this.databaseContext.addQueryExecution({
                query: interpolatedQuery,
                executionTime,
                rowCount: result.rowCount,
                timestamp: new Date(),
                queryName
            });

            ActionLogger.logDatabaseAction('predefined_query_executed', {
                queryName,
                rowCount: result.rowCount,
                executionTime
            });

        } catch (error) {
            ActionLogger.logDatabaseError('predefined_query_failed', error);
            throw new Error(`Failed to execute predefined query '${queryName}': ${error.message}`);
        }
    }

    @CSBDDStepDef('user executes batch queries:')
    async executeBatchQueries(docString: string): Promise<void> {
        ActionLogger.logDatabaseAction('execute_batch_queries');

        const queries = this.parseBatchQueries(docString);
        const db = this.getCurrentDatabase();
        const results: ResultSet[] = [];
        const errors: string[] = [];

        const startTime = Date.now();

        for (let i = 0; i < queries.length; i++) {
            try {
                const interpolatedQuery = this.interpolateVariables(queries[i]);
                const result = await db.query(interpolatedQuery);
                results.push(result);

                ActionLogger.logDatabaseAction('batch_query_executed', {
                    queryIndex: i + 1,
                    rowCount: result.rowCount
                });

            } catch (error) {
                const errorMsg = `Query ${i + 1} failed: ${error.message}`;
                errors.push(errorMsg);
                ActionLogger.logDatabaseError('batch_query_failed', { queryIndex: i + 1, error });
            }
        }

        const totalExecutionTime = Date.now() - startTime;

        if (errors.length > 0) {
            throw new Error(`Batch execution failed:\n${errors.join('\n')}`);
        }

        // Store aggregated results
        const aggregatedResult: ResultSet = {
            rows: results.flatMap(r => r.rows),
            rowCount: results.reduce((sum, r) => sum + r.rowCount, 0),
            affectedRows: results.reduce((sum, r) => sum + (r.affectedRows || 0), 0),
            columns: results[0]?.columns || []
        };

        this.databaseContext.setLastResult(aggregatedResult);
        this.databaseContext.setBatchResults(results);

        ActionLogger.logDatabaseAction('batch_queries_completed', {
            queryCount: queries.length,
            totalRows: aggregatedResult.rowCount,
            totalExecutionTime
        });
    }

    @CSBDDStepDef('user executes query {string} with timeout {int} seconds')
    async executeQueryWithTimeout(query: string, timeout: number): Promise<void> {
        ActionLogger.logDatabaseAction('execute_query_with_timeout', {
            query: this.sanitizeQueryForLog(query),
            timeout
        });

        try {
            const interpolatedQuery = this.interpolateVariables(query);
            const db = this.getCurrentDatabase();

            const options: QueryOptions = {
                timeout: timeout * 1000
            };

            const startTime = Date.now();
            const result = await db.queryWithOptions(interpolatedQuery, options);
            const executionTime = Date.now() - startTime;

            this.databaseContext.setLastResult(result);
            this.databaseContext.addQueryExecution({
                query: interpolatedQuery,
                executionTime,
                rowCount: result.rowCount,
                timestamp: new Date(),
                timeout
            });

            ActionLogger.logDatabaseAction('query_with_timeout_executed', {
                rowCount: result.rowCount,
                executionTime,
                timeout
            });

        } catch (error) {
            if (error.message.includes('timeout')) {
                throw new Error(`Query execution timed out after ${timeout} seconds`);
            }
            ActionLogger.logDatabaseError('query_timeout_failed', error);
            throw new Error(`Failed to execute query with timeout: ${error.message}`);
        }
    }

    @CSBDDStepDef('user executes query and expects error')
    @CSBDDStepDef('user executes invalid query {string}')
    async executeQueryExpectingError(query: string): Promise<void> {
        ActionLogger.logDatabaseAction('execute_query_expect_error', {
            query: this.sanitizeQueryForLog(query)
        });

        const interpolatedQuery = this.interpolateVariables(query);
        const db = this.getCurrentDatabase();
        let errorOccurred = false;
        let errorMessage = '';

        try {
            await db.query(interpolatedQuery);
        } catch (error) {
            errorOccurred = true;
            errorMessage = error.message;
            this.databaseContext.setLastError(error);
            ActionLogger.logDatabaseAction('query_error_expected', { error: errorMessage });
        }

        if (!errorOccurred) {
            throw new Error('Expected query to fail, but it succeeded');
        }

        ActionLogger.logDatabaseAction('query_error_validated', { errorMessage });
    }

    @CSBDDStepDef('user executes scalar query {string}')
    @CSBDDStepDef('user gets single value from query {string}')
    async executeScalarQuery(query: string): Promise<void> {
        ActionLogger.logDatabaseAction('execute_scalar_query', {
            query: this.sanitizeQueryForLog(query)
        });

        try {
            const interpolatedQuery = this.interpolateVariables(query);
            const db = this.getCurrentDatabase();

            const result = await db.queryScalar(interpolatedQuery);

            // Store scalar result
            this.databaseContext.setLastScalarResult(result);

            ActionLogger.logDatabaseAction('scalar_query_executed', {
                value: result,
                type: typeof result
            });

        } catch (error) {
            ActionLogger.logDatabaseError('scalar_query_failed', error);
            throw new Error(`Failed to execute scalar query: ${error.message}`);
        }
    }

    @CSBDDStepDef('user executes count query {string}')
    async executeCountQuery(query: string): Promise<void> {
        ActionLogger.logDatabaseAction('execute_count_query', {
            query: this.sanitizeQueryForLog(query)
        });

        try {
            const interpolatedQuery = this.interpolateVariables(query);
            const db = this.getCurrentDatabase();

            // Ensure it's a count query
            if (!interpolatedQuery.toLowerCase().includes('count')) {
                throw new Error('Query must contain COUNT function');
            }

            const count = await db.queryScalar(interpolatedQuery);
            const countValue = Number(count);

            if (isNaN(countValue)) {
                throw new Error(`Expected numeric count, got: ${count}`);
            }

            this.databaseContext.setLastScalarResult(countValue);

            ActionLogger.logDatabaseAction('count_query_executed', { count: countValue });

        } catch (error) {
            ActionLogger.logDatabaseError('count_query_failed', error);
            throw new Error(`Failed to execute count query: ${error.message}`);
        }
    }

    @CSBDDStepDef('user executes query {string} and fetches first row')
    async executeQueryFetchFirst(query: string): Promise<void> {
        ActionLogger.logDatabaseAction('execute_query_fetch_first', {
            query: this.sanitizeQueryForLog(query)
        });

        try {
            const interpolatedQuery = this.interpolateVariables(query);
            const db = this.getCurrentDatabase();

            const result = await db.query(interpolatedQuery);

            if (result.rowCount === 0) {
                throw new Error('Query returned no rows');
            }

            // Store only first row
            const firstRowResult: ResultSet = {
                rows: [result.rows[0]],
                rowCount: 1,
                columns: result.columns
            };

            this.databaseContext.setLastResult(firstRowResult);
            this.databaseContext.setLastRow(result.rows[0]);

            ActionLogger.logDatabaseAction('first_row_fetched', {
                totalRows: result.rowCount,
                firstRow: result.rows[0]
            });

        } catch (error) {
            ActionLogger.logDatabaseError('fetch_first_failed', error);
            throw new Error(`Failed to fetch first row: ${error.message}`);
        }
    }

    @CSBDDStepDef('user executes query {string} with limit {int}')
    async executeQueryWithLimit(query: string, limit: number): Promise<void> {
        ActionLogger.logDatabaseAction('execute_query_with_limit', {
            query: this.sanitizeQueryForLog(query),
            limit
        });

        try {
            const interpolatedQuery = this.interpolateVariables(query);
            
            // Add LIMIT clause if not present (database-specific)
            const limitedQuery = this.addLimitToQuery(interpolatedQuery, limit);
            
            const db = this.getCurrentDatabase();
            const result = await db.query(limitedQuery);

            this.databaseContext.setLastResult(result);

            ActionLogger.logDatabaseAction('query_with_limit_executed', {
                requestedLimit: limit,
                actualRows: result.rowCount
            });

        } catch (error) {
            ActionLogger.logDatabaseError('query_limit_failed', error);
            throw new Error(`Failed to execute query with limit: ${error.message}`);
        }
    }

    @CSBDDStepDef('user profiles query {string}')
    @CSBDDStepDef('user explains query {string}')
    async profileQuery(query: string): Promise<void> {
        ActionLogger.logDatabaseAction('profile_query', {
            query: this.sanitizeQueryForLog(query)
        });

        try {
            const interpolatedQuery = this.interpolateVariables(query);
            const db = this.getCurrentDatabase();

            const executionPlan = await db.explainQuery(interpolatedQuery);

            console.log('\n=== Query Execution Plan ===');
            console.log(executionPlan);
            console.log('===========================\n');

            this.databaseContext.setLastExecutionPlan(executionPlan);

            ActionLogger.logDatabaseAction('query_profiled', {
                planLength: executionPlan.length
            });

        } catch (error) {
            ActionLogger.logDatabaseError('query_profile_failed', error);
            throw new Error(`Failed to profile query: ${error.message}`);
        }
    }

    @CSBDDStepDef('user cancels running query')
    async cancelRunningQuery(): Promise<void> {
        ActionLogger.logDatabaseAction('cancel_query');

        try {
            const db = this.getCurrentDatabase();
            await db.cancelCurrentQuery();

            ActionLogger.logDatabaseAction('query_cancelled');

        } catch (error) {
            ActionLogger.logDatabaseError('query_cancel_failed', error);
            throw new Error(`Failed to cancel query: ${error.message}`);
        }
    }

    // Helper methods
    private getCurrentDatabase(): CSDatabase {
        const db = this.databaseContext.getCurrentDatabase();
        if (!db) {
            throw new Error('No database connection established. Use "Given user connects to ... database" first');
        }
        return db;
    }

    private resolveFilePath(filePath: string): string {
        // Try multiple paths
        const paths = [
            filePath,
            `./test-data/queries/${filePath}`,
            `./resources/queries/${filePath}`,
            `./queries/${filePath}`
        ];

        for (const path of paths) {
            if (FileUtils.exists(path)) {
                return path;
            }
        }

        throw new Error(`Query file not found: ${filePath}`);
    }

    private parseParametersTable(dataTable: any): Record<string, any> {
        const parameters: Record<string, any> = {};

        if (dataTable && dataTable.rawTable) {
            dataTable.rawTable.forEach((row: string[]) => {
                if (row.length >= 2) {
                    const paramName = row[0].trim();
                    const paramValue = this.interpolateVariables(row[1].trim());
                    
                    // Convert to appropriate type
                    parameters[paramName] = this.convertParameterValue(paramValue);
                }
            });
        }

        return parameters;
    }

    private convertParameterValue(value: string): any {
        // Handle null
        if (value.toLowerCase() === 'null') return null;
        
        // Handle boolean
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
        
        // Handle numbers
        if (/^\d+$/.test(value)) return parseInt(value);
        if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
        
        // Handle dates (ISO format)
        if (/^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(value);
        
        // Default to string
        return value;
    }

    private parseBatchQueries(docString: string): string[] {
        // Split by semicolon and filter empty queries
        return docString
            .split(';')
            .map(q => q.trim())
            .filter(q => q.length > 0);
    }

    private addLimitToQuery(query: string, limit: number): string {
        const lowerQuery = query.toLowerCase();
        
        // Check if LIMIT/TOP already exists
        if (lowerQuery.includes(' limit ') || lowerQuery.includes(' top ')) {
            return query;
        }

        // Add limit based on detected database type
        const dbType = this.databaseContext.getCurrentDatabaseType();
        
        switch (dbType) {
            case 'mysql':
            case 'postgresql':
                return `${query} LIMIT ${limit}`;
            
            case 'sqlserver':
                // Add TOP after SELECT
                return query.replace(/select/i, `SELECT TOP ${limit}`);
            
            case 'oracle':
                // Use ROWNUM
                return `SELECT * FROM (${query}) WHERE ROWNUM <= ${limit}`;
            
            default:
                return `${query} LIMIT ${limit}`;
        }
    }

    private sanitizeQueryForLog(query: string): string {
        const maxLength = 200;
        if (query.length > maxLength) {
            return query.substring(0, maxLength) + '...';
        }
        return query;
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