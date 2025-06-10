// src/steps/database/ConnectionSteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { ConnectionManager } from '../../database/client/ConnectionManager';
import { DatabaseContext } from '../../database/context/DatabaseContext';
import { CSDatabase } from '../../database/client/CSDatabase';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { DatabaseConfig, ConnectionOptions } from '../../database/types/database.types';

export class ConnectionSteps extends CSBDDBaseStepDefinition {
    private databaseContext: DatabaseContext;
    private connectionManager: ConnectionManager;

    constructor() {
        super();
        this.databaseContext = this.context.getDatabaseContext();
        this.connectionManager = ConnectionManager.getInstance();
    }

    @CSBDDStepDef('user connects with connection string {string}')
    @CSBDDStepDef('user connects using connection string {string}')
    async connectWithConnectionString(connectionString: string): Promise<void> {
        ActionLogger.logDatabaseAction('connect_with_string', { 
            connectionString: this.sanitizeConnectionString(connectionString) 
        });

        try {
            const interpolatedString = this.interpolateVariables(connectionString);
            const config = this.parseConnectionString(interpolatedString);
            
            const database = await CSDatabase.create(config);
            await database.connect(config);

            // Generate alias from connection string
            const alias = this.generateAliasFromConfig(config);
            this.databaseContext.setCurrentDatabase(alias, database);
            this.databaseContext.setCurrentDatabaseAlias(alias);

            ActionLogger.logDatabaseAction('connected_with_string', { 
                alias,
                host: config.host,
                database: config.database 
            });

        } catch (error) {
            ActionLogger.logDatabaseError('connection_string_failed', error);
            throw new Error(`Failed to connect with connection string: ${error.message}`);
        }
    }

    @CSBDDStepDef('user connects to database with options:')
    async connectWithOptions(dataTable: any): Promise<void> {
        ActionLogger.logDatabaseAction('connect_with_options');

        try {
            const options = this.parseDataTable(dataTable);
            const config = this.buildDatabaseConfig(options);
            
            const database = await CSDatabase.create(config);
            await database.connect(config);

            const alias = options.alias || this.generateAliasFromConfig(config);
            this.databaseContext.setCurrentDatabase(alias, database);
            this.databaseContext.setCurrentDatabaseAlias(alias);

            ActionLogger.logDatabaseAction('connected_with_options', { 
                alias,
                options: Object.keys(options) 
            });

        } catch (error) {
            ActionLogger.logDatabaseError('connection_options_failed', error);
            throw new Error(`Failed to connect with options: ${error.message}`);
        }
    }

    @CSBDDStepDef('user disconnects from database')
    @CSBDDStepDef('user closes database connection')
    async disconnectFromDatabase(): Promise<void> {
        ActionLogger.logDatabaseAction('disconnect');

        const db = this.getCurrentDatabase();
        const alias = this.databaseContext.getCurrentDatabaseAlias();

        try {
            await db.disconnect();
            this.databaseContext.removeDatabase(alias);
            
            ActionLogger.logDatabaseAction('disconnected', { alias });

        } catch (error) {
            ActionLogger.logDatabaseError('disconnect_failed', error);
            throw new Error(`Failed to disconnect from database: ${error.message}`);
        }
    }

    @CSBDDStepDef('user disconnects from {string} database')
    async disconnectFromSpecificDatabase(alias: string): Promise<void> {
        ActionLogger.logDatabaseAction('disconnect_specific', { alias });

        const db = this.databaseContext.getDatabase(alias);
        if (!db) {
            throw new Error(`Database connection '${alias}' not found`);
        }

        try {
            await db.disconnect();
            this.databaseContext.removeDatabase(alias);
            
            ActionLogger.logDatabaseAction('disconnected_specific', { alias });

        } catch (error) {
            ActionLogger.logDatabaseError('disconnect_specific_failed', error);
            throw new Error(`Failed to disconnect from '${alias}': ${error.message}`);
        }
    }

    @CSBDDStepDef('user switches to {string} database context')
    @CSBDDStepDef('user switches to database {string}')
    async switchToDatabaseContext(alias: string): Promise<void> {
        ActionLogger.logDatabaseAction('switch_context', { alias });

        const db = this.databaseContext.getDatabase(alias);
        if (!db) {
            throw new Error(
                `Database context '${alias}' not found. ` +
                `Available contexts: ${this.databaseContext.getAvailableDatabases().join(', ')}`
            );
        }

        this.databaseContext.setCurrentDatabaseAlias(alias);
        ActionLogger.logDatabaseAction('context_switched', { alias });
    }

    @CSBDDStepDef('user creates new database connection {string}')
    async createNewConnection(alias: string): Promise<void> {
        ActionLogger.logDatabaseAction('create_connection', { alias });

        const currentDb = this.getCurrentDatabase();
        const currentConfig = await currentDb.getConfiguration();

        try {
            // Clone current configuration
            const newConfig = { ...currentConfig };
            const newDatabase = await CSDatabase.create(newConfig);
            await newDatabase.connect(newConfig);

            this.databaseContext.setCurrentDatabase(alias, newDatabase);
            ActionLogger.logDatabaseAction('connection_created', { alias });

        } catch (error) {
            ActionLogger.logDatabaseError('create_connection_failed', error);
            throw new Error(`Failed to create new connection '${alias}': ${error.message}`);
        }
    }

    @CSBDDStepDef('user reconnects to database')
    async reconnectToDatabase(): Promise<void> {
        ActionLogger.logDatabaseAction('reconnect');

        const db = this.getCurrentDatabase();
        const alias = this.databaseContext.getCurrentDatabaseAlias();

        try {
            await db.disconnect();
            await db.reconnect();
            
            ActionLogger.logDatabaseAction('reconnected', { alias });

        } catch (error) {
            ActionLogger.logDatabaseError('reconnect_failed', error);
            throw new Error(`Failed to reconnect to database: ${error.message}`);
        }
    }

    @CSBDDStepDef('user tests database connection')
    @CSBDDStepDef('user pings database')
    async testDatabaseConnection(): Promise<void> {
        ActionLogger.logDatabaseAction('test_connection');

        const db = this.getCurrentDatabase();
        
        try {
            const isAlive = await db.ping();
            
            if (!isAlive) {
                throw new Error('Database connection test failed - connection is not alive');
            }

            ActionLogger.logDatabaseAction('connection_tested', { status: 'alive' });

        } catch (error) {
            ActionLogger.logDatabaseError('connection_test_failed', error);
            throw new Error(`Database connection test failed: ${error.message}`);
        }
    }

    @CSBDDStepDef('user lists available database connections')
    async listAvailableConnections(): Promise<void> {
        ActionLogger.logDatabaseAction('list_connections');

        const connections = this.databaseContext.getAvailableDatabases();
        const current = this.databaseContext.getCurrentDatabaseAlias();

        console.log('\n=== Available Database Connections ===');
        connections.forEach(alias => {
            const isCurrent = alias === current;
            console.log(`${isCurrent ? '→' : ' '} ${alias}${isCurrent ? ' (current)' : ''}`);
        });
        console.log(`Total: ${connections.length} connection(s)\n`);

        ActionLogger.logDatabaseAction('connections_listed', { 
            count: connections.length,
            current 
        });
    }

    @CSBDDStepDef('user closes all database connections')
    async closeAllConnections(): Promise<void> {
        ActionLogger.logDatabaseAction('close_all_connections');

        const connections = this.databaseContext.getAvailableDatabases();
        const errors: string[] = [];

        for (const alias of connections) {
            try {
                const db = this.databaseContext.getDatabase(alias);
                if (db) {
                    await db.disconnect();
                    this.databaseContext.removeDatabase(alias);
                }
            } catch (error) {
                errors.push(`${alias}: ${error.message}`);
            }
        }

        if (errors.length > 0) {
            throw new Error(`Failed to close some connections:\n${errors.join('\n')}`);
        }

        ActionLogger.logDatabaseAction('all_connections_closed', { 
            count: connections.length 
        });
    }

    @CSBDDStepDef('database connection should use SSL')
    @CSBDDStepDef('database connection should be encrypted')
    async validateSSLConnection(): Promise<void> {
        ActionLogger.logDatabaseAction('validate_ssl');

        const db = this.getCurrentDatabase();
        const config = await db.getConfiguration();

        if (!config.options?.encrypt && !config.options?.ssl) {
            throw new Error('Database connection is not using SSL/encryption');
        }

        ActionLogger.logDatabaseAction('ssl_validated', { 
            encrypted: true,
            ssl: config.options?.ssl || config.options?.encrypt 
        });
    }

    // Helper methods
    private parseConnectionString(connectionString: string): DatabaseConfig {
        // Parse different connection string formats
        const config: DatabaseConfig = {
            type: 'sqlserver',
            host: '',
            port: 1433,
            database: '',
            username: '',
            password: '',
            options: {}
        };

        // SQL Server format: Server=host;Database=db;User Id=user;Password=pass
        if (connectionString.includes('Server=')) {
            const params = this.parseKeyValueString(connectionString, ';', '=');
            config.type = 'sqlserver';
            config.host = params['Server'] || params['server'] || '';
            config.database = params['Database'] || params['database'] || '';
            config.username = params['User Id'] || params['user id'] || params['uid'] || '';
            config.password = params['Password'] || params['password'] || params['pwd'] || '';
            config.port = parseInt(params['Port'] || params['port'] || '1433');
            config.options!.encrypt = params['Encrypt'] !== 'false';
        } 
        // PostgreSQL format: postgresql://user:pass@host:port/database
        else if (connectionString.startsWith('postgresql://')) {
            const match = connectionString.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
            if (match) {
                config.type = 'postgresql';
                config.username = match[1];
                config.password = match[2];
                config.host = match[3];
                config.port = parseInt(match[4]);
                config.database = match[5];
            }
        }
        // MySQL format: mysql://user:pass@host:port/database
        else if (connectionString.startsWith('mysql://')) {
            const match = connectionString.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
            if (match) {
                config.type = 'mysql';
                config.username = match[1];
                config.password = match[2];
                config.host = match[3];
                config.port = parseInt(match[4]);
                config.database = match[5];
            }
        }
        // MongoDB format: mongodb://user:pass@host:port/database
        else if (connectionString.startsWith('mongodb://')) {
            config.type = 'mongodb';
            config.connectionString = connectionString;
        }

        return config;
    }

    private parseKeyValueString(str: string, delimiter: string, separator: string): Record<string, string> {
        const result: Record<string, string> = {};
        const pairs = str.split(delimiter);
        
        pairs.forEach(pair => {
            const [key, value] = pair.split(separator);
            if (key && value) {
                result[key.trim()] = value.trim();
            }
        });

        return result;
    }

    private buildDatabaseConfig(options: Record<string, any>): DatabaseConfig {
        const config: DatabaseConfig = {
            type: options.type || 'sqlserver',
            host: options.host || options.server || 'localhost',
            port: parseInt(options.port || this.getDefaultPort(options.type || 'sqlserver')),
            database: options.database || options.db,
            username: options.username || options.user,
            password: options.password || options.pass,
            options: {
                encrypt: options.encrypt !== 'false',
                trustServerCertificate: options.trustServerCertificate === 'true',
                connectionTimeout: parseInt(options.connectionTimeout || '30000'),
                requestTimeout: parseInt(options.requestTimeout || '60000')
            }
        };

        // Add additional options based on database type
        if (config.type === 'mongodb' && options.connectionString) {
            config.connectionString = options.connectionString;
        }

        return config;
    }

    private generateAliasFromConfig(config: DatabaseConfig): string {
        return `${config.type}_${config.host}_${config.database}`.replace(/[^a-zA-Z0-9_]/g, '_');
    }

    private sanitizeConnectionString(connectionString: string): string {
        // Hide password in connection string for logging
        return connectionString
            .replace(/password=([^;]+)/gi, 'password=****')
            .replace(/pwd=([^;]+)/gi, 'pwd=****')
            .replace(/:([^@]+)@/g, ':****@');
    }

    private getCurrentDatabase(): CSDatabase {
        const db = this.databaseContext.getCurrentDatabase();
        if (!db) {
            throw new Error('No database connection established. Use "Given user connects to ... database" first');
        }
        return db;
    }

    private getDefaultPort(type: string): string {
        const ports: Record<string, string> = {
            'sqlserver': '1433',
            'mysql': '3306',
            'postgresql': '5432',
            'oracle': '1521',
            'mongodb': '27017',
            'redis': '6379'
        };
        return ports[type.toLowerCase()] || '1433';
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

    private parseDataTable(dataTable: any): Record<string, any> {
        const result: Record<string, any> = {};
        
        if (dataTable && dataTable.rawTable) {
            dataTable.rawTable.forEach((row: string[]) => {
                if (row.length >= 2) {
                    const key = row[0].trim();
                    const value = this.interpolateVariables(row[1].trim());
                    result[key] = value;
                }
            });
        }

        return result;
    }
}