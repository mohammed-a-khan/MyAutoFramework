// src/steps/database/DatabaseGenericSteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { CSDatabase } from '../../database/client/CSDatabase';
import { DatabaseContext } from '../../database/context/DatabaseContext';
import { ConnectionManager } from '../../database/client/ConnectionManager';
import { ConfigurationManager } from '../../core/configuration/ConfigurationManager';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { DatabaseConfig } from '../../database/types/database.types';
import { ResultSet } from '../../database/types/database.types';

export class DatabaseGenericSteps extends CSBDDBaseStepDefinition {
    private databaseContext: DatabaseContext;
    private connectionManager: ConnectionManager;
    private currentDatabase: CSDatabase | null = null;

    constructor() {
        super();
        this.databaseContext = this.context.getDatabaseContext();
        this.connectionManager = ConnectionManager.getInstance();
    }

    @CSBDDStepDef('user connects to {string} database')
    @CSBDDStepDef('user connects to database {string}')
    async connectToDatabase(databaseAlias: string): Promise<void> {
        ActionLogger.logDatabaseAction('connect', { databaseAlias });

        try {
            // Get database configuration
            const config = this.getDatabaseConfig(databaseAlias);
            
            // Create and connect to database
            this.currentDatabase = await CSDatabase.create(config);
            await this.currentDatabase.connect(config);

            // Store in context
            this.databaseContext.setCurrentDatabase(databaseAlias, this.currentDatabase);
            this.databaseContext.setCurrentDatabaseAlias(databaseAlias);

            ActionLogger.logDatabaseAction('connected', { 
                databaseAlias,
                host: config.host,
                database: config.database,
                type: config.type
            });

        } catch (error) {
            ActionLogger.logDatabaseError('connection_failed', error);
            throw new Error(`Failed to connect to database '${databaseAlias}': ${error.message}`);
        }
    }

    @CSBDDStepDef('user connects to {string} database with timeout {int} seconds')
    async connectToDatabaseWithTimeout(databaseAlias: string, timeout: number): Promise<void> {
        ActionLogger.logDatabaseAction('connect_with_timeout', { databaseAlias, timeout });

        try {
            const config = this.getDatabaseConfig(databaseAlias);
            config.connectionTimeout = timeout * 1000;

            this.currentDatabase = await CSDatabase.create(config);
            await this.currentDatabase.connect(config);

            this.databaseContext.setCurrentDatabase(databaseAlias, this.currentDatabase);
            this.databaseContext.setCurrentDatabaseAlias(databaseAlias);

            ActionLogger.logDatabaseAction('connected_with_timeout', { databaseAlias, timeout });

        } catch (error) {
            ActionLogger.logDatabaseError('connection_timeout', error);
            throw new Error(`Connection to '${databaseAlias}' timed out after ${timeout} seconds: ${error.message}`);
        }
    }

    @CSBDDStepDef('user sets database timeout to {int} seconds')
    async setDatabaseTimeout(timeout: number): Promise<void> {
        ActionLogger.logDatabaseAction('set_timeout', { timeout });

        const db = this.getCurrentDatabase();
        await db.setQueryTimeout(timeout * 1000);

        this.databaseContext.setTimeout(timeout * 1000);
        ActionLogger.logDatabaseAction('timeout_set', { timeout });
    }

    @CSBDDStepDef('user sets database connection pool size to {int}')
    async setConnectionPoolSize(poolSize: number): Promise<void> {
        ActionLogger.logDatabaseAction('set_pool_size', { poolSize });

        if (poolSize < 1 || poolSize > 100) {
            throw new Error(`Invalid pool size: ${poolSize}. Must be between 1 and 100`);
        }

        const db = this.getCurrentDatabase();
        await db.setPoolSize(poolSize);

        ActionLogger.logDatabaseAction('pool_size_set', { poolSize });
    }

    @CSBDDStepDef('user executes query {string}')
    @CSBDDStepDef('user runs query {string}')
    async executeQuery(query: string): Promise<void> {
        ActionLogger.logDatabaseAction('execute_query', { query: this.sanitizeQueryForLog(query) });

        try {
            const db = this.getCurrentDatabase();
            const interpolatedQuery = this.interpolateVariables(query);
            
            const startTime = Date.now();
            const result = await db.query(interpolatedQuery);
            const executionTime = Date.now() - startTime;

            // Store result in context
            this.databaseContext.setLastResult(result);
            this.databaseContext.addQueryExecution({
                query: interpolatedQuery,
                executionTime,
                rowCount: result.rowCount,
                timestamp: new Date()
            });

            ActionLogger.logDatabaseAction('query_executed', {
                rowCount: result.rowCount,
                executionTime,
                affectedRows: result.affectedRows
            });

        } catch (error) {
            ActionLogger.logDatabaseError('query_execution_failed', error);
            throw new Error(`Query execution failed: ${error.message}\nQuery: ${this.sanitizeQueryForLog(query)}`);
        }
    }

    @CSBDDStepDef('user executes query {string} and stores result as {string}')
    async executeQueryAndStore(query: string, alias: string): Promise<void> {
        ActionLogger.logDatabaseAction('execute_query_store', { 
            query: this.sanitizeQueryForLog(query), 
            alias 
        });

        try {
            const db = this.getCurrentDatabase();
            const interpolatedQuery = this.interpolateVariables(query);
            
            const result = await db.query(interpolatedQuery);
            
            // Store with alias
            this.databaseContext.storeResult(alias, result);
            this.databaseContext.setLastResult(result);

            ActionLogger.logDatabaseAction('query_result_stored', {
                alias,
                rowCount: result.rowCount
            });

        } catch (error) {
            ActionLogger.logDatabaseError('query_store_failed', error);
            throw new Error(`Failed to execute and store query result: ${error.message}`);
        }
    }

    @CSBDDStepDef('the query result should have {int} rows')
    @CSBDDStepDef('the query result should have {int} row')
    async validateRowCount(expectedCount: number): Promise<void> {
        ActionLogger.logDatabaseAction('validate_row_count', { expectedCount });

        const result = this.getLastResult();
        
        if (result.rowCount !== expectedCount) {
            throw new Error(
                `Expected ${expectedCount} row(s), but got ${result.rowCount}\n` +
                `Query: ${this.databaseContext.getLastQuery()}`
            );
        }

        ActionLogger.logDatabaseAction('row_count_validated', { 
            expected: expectedCount, 
            actual: result.rowCount 
        });
    }

    @CSBDDStepDef('the query result should have at least {int} rows')
    async validateMinRowCount(minCount: number): Promise<void> {
        ActionLogger.logDatabaseAction('validate_min_row_count', { minCount });

        const result = this.getLastResult();
        
        if (result.rowCount < minCount) {
            throw new Error(
                `Expected at least ${minCount} row(s), but got ${result.rowCount}\n` +
                `Query: ${this.databaseContext.getLastQuery()}`
            );
        }

        ActionLogger.logDatabaseAction('min_row_count_validated', { 
            minimum: minCount, 
            actual: result.rowCount 
        });
    }

    @CSBDDStepDef('the query result should have at most {int} rows')
    async validateMaxRowCount(maxCount: number): Promise<void> {
        ActionLogger.logDatabaseAction('validate_max_row_count', { maxCount });

        const result = this.getLastResult();
        
        if (result.rowCount > maxCount) {
            throw new Error(
                `Expected at most ${maxCount} row(s), but got ${result.rowCount}\n` +
                `Query: ${this.databaseContext.getLastQuery()}`
            );
        }

        ActionLogger.logDatabaseAction('max_row_count_validated', { 
            maximum: maxCount, 
            actual: result.rowCount 
        });
    }

    @CSBDDStepDef('the query result should be empty')
    @CSBDDStepDef('the query should return no rows')
    async validateEmptyResult(): Promise<void> {
        ActionLogger.logDatabaseAction('validate_empty_result');

        const result = this.getLastResult();
        
        if (result.rowCount > 0) {
            throw new Error(
                `Expected empty result, but got ${result.rowCount} row(s)\n` +
                `Query: ${this.databaseContext.getLastQuery()}`
            );
        }

        ActionLogger.logDatabaseAction('empty_result_validated');
    }

    @CSBDDStepDef('user logs database query result')
    @CSBDDStepDef('user prints database query result')
    async logQueryResult(): Promise<void> {
        const result = this.getLastResult();
        
        ActionLogger.logDatabaseAction('log_result', {
            rowCount: result.rowCount,
            columnCount: result.columns.length,
            columns: result.columns.map(col => col.name)
        });

        // Log first 10 rows for visibility
        const rowsToLog = Math.min(10, result.rows.length);
        if (rowsToLog > 0) {
            console.log('\n=== Query Result ===');
            console.log(`Columns: ${result.columns.map(col => col.name).join(', ')}`);
            console.log(`Total Rows: ${result.rowCount}`);
            console.log('\nFirst ${rowsToLog} rows:');
            
            result.rows.slice(0, rowsToLog).forEach((row, index) => {
                console.log(`Row ${index + 1}:`, row);
            });

            if (result.rowCount > rowsToLog) {
                console.log(`... and ${result.rowCount - rowsToLog} more rows`);
            }
            console.log('==================\n');
        }
    }

    @CSBDDStepDef('user clears database cache')
    async clearDatabaseCache(): Promise<void> {
        ActionLogger.logDatabaseAction('clear_cache');

        const db = this.getCurrentDatabase();
        await db.clearCache();
        
        this.databaseContext.clearCache();
        ActionLogger.logDatabaseAction('cache_cleared');
    }

    @CSBDDStepDef('user enables database query logging')
    async enableQueryLogging(): Promise<void> {
        ActionLogger.logDatabaseAction('enable_query_logging');

        const db = this.getCurrentDatabase();
        await db.enableQueryLogging(true);
        
        this.databaseContext.setQueryLogging(true);
        ActionLogger.logDatabaseAction('query_logging_enabled');
    }

    @CSBDDStepDef('user disables database query logging')
    async disableQueryLogging(): Promise<void> {
        ActionLogger.logDatabaseAction('disable_query_logging');

        const db = this.getCurrentDatabase();
        await db.enableQueryLogging(false);
        
        this.databaseContext.setQueryLogging(false);
        ActionLogger.logDatabaseAction('query_logging_disabled');
    }

    @CSBDDStepDef('user validates database connection')
    @CSBDDStepDef('database connection should be active')
    async validateConnection(): Promise<void> {
        ActionLogger.logDatabaseAction('validate_connection');

        const db = this.getCurrentDatabase();
        const isConnected = await db.isConnected();
        
        if (!isConnected) {
            throw new Error('Database connection is not active');
        }

        ActionLogger.logDatabaseAction('connection_validated', { status: 'active' });
    }

    // Helper methods
    private getDatabaseConfig(alias: string): DatabaseConfig {
        const envPrefix = `DB_${alias.toUpperCase()}_`;
        
        // Check for predefined database configs
        const type = ConfigurationManager.get(`${envPrefix}TYPE`) || 
                    ConfigurationManager.get('DB_TYPE', 'sqlserver');
        
        const config: DatabaseConfig = {
            type: type as any,
            host: ConfigurationManager.getRequired(`${envPrefix}HOST`),
            port: ConfigurationManager.getInt(`${envPrefix}PORT`, this.getDefaultPort(type)),
            database: ConfigurationManager.getRequired(`${envPrefix}DATABASE`),
            username: ConfigurationManager.getRequired(`${envPrefix}USERNAME`),
            password: ConfigurationManager.getRequired(`${envPrefix}PASSWORD`),
            options: {
                encrypt: ConfigurationManager.getBoolean(`${envPrefix}ENCRYPT`, true),
                trustServerCertificate: ConfigurationManager.getBoolean(`${envPrefix}TRUST_CERT`, false),
                connectionTimeout: ConfigurationManager.getInt(`${envPrefix}CONNECTION_TIMEOUT`, 30000),
                requestTimeout: ConfigurationManager.getInt(`${envPrefix}REQUEST_TIMEOUT`, 60000),
                pool: {
                    min: ConfigurationManager.getInt(`${envPrefix}POOL_MIN`, 2),
                    max: ConfigurationManager.getInt(`${envPrefix}POOL_MAX`, 10),
                    idleTimeoutMillis: ConfigurationManager.getInt(`${envPrefix}POOL_IDLE_TIMEOUT`, 30000)
                }
            }
        };

        return config;
    }

    private getDefaultPort(type: string): number {
        const ports: Record<string, number> = {
            'sqlserver': 1433,
            'mysql': 3306,
            'postgresql': 5432,
            'oracle': 1521,
            'mongodb': 27017,
            'redis': 6379
        };
        return ports[type.toLowerCase()] || 1433;
    }

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

    private sanitizeQueryForLog(query: string): string {
        // Truncate long queries for logging
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