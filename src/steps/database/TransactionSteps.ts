// src/steps/database/TransactionSteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { DatabaseContext } from '../../database/context/DatabaseContext';
import { CSDatabase } from '../../database/client/CSDatabase';
import { TransactionManager } from '../../database/client/TransactionManager';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { Transaction } from '../../database/types/database.types';

export class TransactionSteps extends CSBDDBaseStepDefinition {
    private databaseContext: DatabaseContext;
    private transactionManager: TransactionManager;

    constructor() {
        super();
        this.databaseContext = this.context.getDatabaseContext();
        this.transactionManager = TransactionManager.getInstance();
    }

    @CSBDDStepDef('user begins database transaction')
    @CSBDDStepDef('user starts database transaction')
    async beginTransaction(): Promise<void> {
        ActionLogger.logDatabaseAction('begin_transaction');

        const db = this.getCurrentDatabase();
        
        try {
            // Check if transaction already active
            if (this.databaseContext.hasActiveTransaction()) {
                throw new Error('A transaction is already active. Commit or rollback before starting a new one');
            }

            const transaction = await this.transactionManager.begin(db.getConnection());
            
            this.databaseContext.setActiveTransaction(transaction);
            this.databaseContext.setTransactionStartTime(new Date());

            ActionLogger.logDatabaseAction('transaction_started', {
                transactionId: transaction.id,
                isolationLevel: transaction.isolationLevel
            });

        } catch (error) {
            ActionLogger.logDatabaseError('transaction_begin_failed', error);
            throw new Error(`Failed to begin transaction: ${error.message}`);
        }
    }

    @CSBDDStepDef('user begins database transaction with isolation level {string}')
    async beginTransactionWithIsolation(isolationLevel: string): Promise<void> {
        ActionLogger.logDatabaseAction('begin_transaction_with_isolation', { isolationLevel });

        const db = this.getCurrentDatabase();
        
        try {
            if (this.databaseContext.hasActiveTransaction()) {
                throw new Error('A transaction is already active');
            }

            const validLevels = ['READ_UNCOMMITTED', 'READ_COMMITTED', 'REPEATABLE_READ', 'SERIALIZABLE'];
            const upperLevel = isolationLevel.toUpperCase().replace(/ /g, '_');
            
            if (!validLevels.includes(upperLevel)) {
                throw new Error(
                    `Invalid isolation level: ${isolationLevel}. ` +
                    `Valid levels: ${validLevels.join(', ')}`
                );
            }

            const transaction = await this.transactionManager.beginWithIsolation(
                db.getConnection(),
                upperLevel as any
            );
            
            this.databaseContext.setActiveTransaction(transaction);
            this.databaseContext.setTransactionStartTime(new Date());

            ActionLogger.logDatabaseAction('transaction_started_with_isolation', {
                transactionId: transaction.id,
                isolationLevel: upperLevel
            });

        } catch (error) {
            ActionLogger.logDatabaseError('transaction_isolation_failed', error);
            throw new Error(`Failed to begin transaction with isolation level: ${error.message}`);
        }
    }

    @CSBDDStepDef('user commits database transaction')
    @CSBDDStepDef('user saves database transaction')
    async commitTransaction(): Promise<void> {
        ActionLogger.logDatabaseAction('commit_transaction');

        try {
            const transaction = this.getActiveTransaction();
            const startTime = this.databaseContext.getTransactionStartTime();
            
            await this.transactionManager.commit(transaction);
            
            const duration = startTime ? Date.now() - startTime.getTime() : 0;
            
            this.databaseContext.clearActiveTransaction();
            this.databaseContext.addTransactionHistory({
                id: transaction.id,
                type: 'commit',
                duration,
                timestamp: new Date()
            });

            ActionLogger.logDatabaseAction('transaction_committed', {
                transactionId: transaction.id,
                duration
            });

        } catch (error) {
            ActionLogger.logDatabaseError('transaction_commit_failed', error);
            throw new Error(`Failed to commit transaction: ${error.message}`);
        }
    }

    @CSBDDStepDef('user rolls back database transaction')
    @CSBDDStepDef('user cancels database transaction')
    async rollbackTransaction(): Promise<void> {
        ActionLogger.logDatabaseAction('rollback_transaction');

        try {
            const transaction = this.getActiveTransaction();
            const startTime = this.databaseContext.getTransactionStartTime();
            
            await this.transactionManager.rollback(transaction);
            
            const duration = startTime ? Date.now() - startTime.getTime() : 0;
            
            this.databaseContext.clearActiveTransaction();
            this.databaseContext.addTransactionHistory({
                id: transaction.id,
                type: 'rollback',
                duration,
                timestamp: new Date()
            });

            ActionLogger.logDatabaseAction('transaction_rolled_back', {
                transactionId: transaction.id,
                duration
            });

        } catch (error) {
            ActionLogger.logDatabaseError('transaction_rollback_failed', error);
            throw new Error(`Failed to rollback transaction: ${error.message}`);
        }
    }

    @CSBDDStepDef('user creates savepoint {string}')
    async createSavepoint(savepointName: string): Promise<void> {
        ActionLogger.logDatabaseAction('create_savepoint', { savepointName });

        try {
            const transaction = this.getActiveTransaction();
            
            await this.transactionManager.createSavepoint(transaction, savepointName);
            
            this.databaseContext.addSavepoint(savepointName);

            ActionLogger.logDatabaseAction('savepoint_created', {
                transactionId: transaction.id,
                savepointName
            });

        } catch (error) {
            ActionLogger.logDatabaseError('savepoint_create_failed', error);
            throw new Error(`Failed to create savepoint '${savepointName}': ${error.message}`);
        }
    }

    @CSBDDStepDef('user rolls back to savepoint {string}')
    async rollbackToSavepoint(savepointName: string): Promise<void> {
        ActionLogger.logDatabaseAction('rollback_to_savepoint', { savepointName });

        try {
            const transaction = this.getActiveTransaction();
            
            if (!this.databaseContext.hasSavepoint(savepointName)) {
                throw new Error(`Savepoint '${savepointName}' does not exist`);
            }

            await this.transactionManager.rollbackToSavepoint(transaction, savepointName);
            
            // Remove savepoints created after this one
            this.databaseContext.removeSavepointsAfter(savepointName);

            ActionLogger.logDatabaseAction('savepoint_rolled_back', {
                transactionId: transaction.id,
                savepointName
            });

        } catch (error) {
            ActionLogger.logDatabaseError('savepoint_rollback_failed', error);
            throw new Error(`Failed to rollback to savepoint '${savepointName}': ${error.message}`);
        }
    }

    @CSBDDStepDef('user releases savepoint {string}')
    async releaseSavepoint(savepointName: string): Promise<void> {
        ActionLogger.logDatabaseAction('release_savepoint', { savepointName });

        try {
            const transaction = this.getActiveTransaction();
            
            if (!this.databaseContext.hasSavepoint(savepointName)) {
                throw new Error(`Savepoint '${savepointName}' does not exist`);
            }

            await this.transactionManager.releaseSavepoint(transaction, savepointName);
            
            this.databaseContext.removeSavepoint(savepointName);

            ActionLogger.logDatabaseAction('savepoint_released', {
                transactionId: transaction.id,
                savepointName
            });

        } catch (error) {
            ActionLogger.logDatabaseError('savepoint_release_failed', error);
            throw new Error(`Failed to release savepoint '${savepointName}': ${error.message}`);
        }
    }

    @CSBDDStepDef('database should have active transaction')
    async validateActiveTransaction(): Promise<void> {
        ActionLogger.logDatabaseAction('validate_active_transaction');

        if (!this.databaseContext.hasActiveTransaction()) {
            throw new Error('No active transaction found');
        }

        const transaction = this.databaseContext.getActiveTransaction();
        
        ActionLogger.logDatabaseAction('active_transaction_validated', {
            transactionId: transaction!.id,
            isolationLevel: transaction!.isolationLevel
        });
    }

    @CSBDDStepDef('database should not have active transaction')
    async validateNoActiveTransaction(): Promise<void> {
        ActionLogger.logDatabaseAction('validate_no_active_transaction');

        if (this.databaseContext.hasActiveTransaction()) {
            const transaction = this.databaseContext.getActiveTransaction();
            throw new Error(`Found active transaction: ${transaction!.id}`);
        }

        ActionLogger.logDatabaseAction('no_active_transaction_validated');
    }

    @CSBDDStepDef('user executes query {string} within transaction')
    async executeQueryInTransaction(query: string): Promise<void> {
        ActionLogger.logDatabaseAction('execute_query_in_transaction', {
            query: this.sanitizeQueryForLog(query)
        });

        try {
            const transaction = this.getActiveTransaction();
            const interpolatedQuery = this.interpolateVariables(query);
            
            const db = this.getCurrentDatabase();
            const startTime = Date.now();
            
            // Execute query within transaction context
            const result = await db.queryInTransaction(interpolatedQuery, transaction);
            const executionTime = Date.now() - startTime;

            this.databaseContext.setLastResult(result);
            this.databaseContext.addQueryExecution({
                query: interpolatedQuery,
                executionTime,
                rowCount: result.rowCount,
                timestamp: new Date(),
                transactionId: transaction.id
            });

            ActionLogger.logDatabaseAction('transaction_query_executed', {
                transactionId: transaction.id,
                rowCount: result.rowCount,
                executionTime
            });

        } catch (error) {
            ActionLogger.logDatabaseError('transaction_query_failed', error);
            throw new Error(`Failed to execute query in transaction: ${error.message}`);
        }
    }

    @CSBDDStepDef('user sets transaction timeout to {int} seconds')
    async setTransactionTimeout(timeout: number): Promise<void> {
        ActionLogger.logDatabaseAction('set_transaction_timeout', { timeout });

        try {
            const transaction = this.getActiveTransaction();
            
            await this.transactionManager.setTransactionTimeout(transaction, timeout * 1000);
            
            this.databaseContext.setTransactionTimeout(timeout * 1000);

            ActionLogger.logDatabaseAction('transaction_timeout_set', {
                transactionId: transaction.id,
                timeout
            });

        } catch (error) {
            ActionLogger.logDatabaseError('transaction_timeout_failed', error);
            throw new Error(`Failed to set transaction timeout: ${error.message}`);
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

    private getActiveTransaction(): Transaction {
        const transaction = this.databaseContext.getActiveTransaction();
        if (!transaction) {
            throw new Error('No active transaction. Use "Given user begins database transaction" first');
        }
        return transaction;
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