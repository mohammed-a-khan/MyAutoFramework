// src/steps/database/StoredProcedureSteps.ts

import { CSBDDStepDef } from '../../bdd/decorators/CSBDDStepDef';
import { CSBDDBaseStepDefinition } from '../../bdd/base/CSBDDBaseStepDefinition';
import { DatabaseContext } from '../../database/context/DatabaseContext';
import { CSDatabase } from '../../database/client/CSDatabase';
import { ActionLogger } from '../../core/logging/ActionLogger';
import { StoredProcedureCall, ProcedureParameter, ResultSet } from '../../database/types/database.types';

export class StoredProcedureSteps extends CSBDDBaseStepDefinition {
    private databaseContext: DatabaseContext;

    constructor() {
        super();
        this.databaseContext = this.context.getDatabaseContext();
    }

    @CSBDDStepDef('user executes stored procedure {string}')
    async executeStoredProcedure(procedureName: string): Promise<void> {
        ActionLogger.logDatabaseAction('execute_stored_procedure', { procedureName });

        try {
            const db = this.getCurrentDatabase();
            const interpolatedName = this.interpolateVariables(procedureName);
            
            const startTime = Date.now();
            const result = await db.executeProcedure(interpolatedName);
            const executionTime = Date.now() - startTime;

            this.handleProcedureResult(result, interpolatedName, executionTime);

            ActionLogger.logDatabaseAction('stored_procedure_executed', {
                procedureName: interpolatedName,
                executionTime,
                resultSets: result.resultSets?.length || 0,
                outputParameters: Object.keys(result.outputParameters || {}).length
            });

        } catch (error) {
            ActionLogger.logDatabaseError('stored_procedure_failed', error);
            throw new Error(`Failed to execute stored procedure '${procedureName}': ${error.message}`);
        }
    }

    @CSBDDStepDef('user executes stored procedure {string} with parameters:')
    async executeStoredProcedureWithParams(procedureName: string, dataTable: any): Promise<void> {
        ActionLogger.logDatabaseAction('execute_stored_procedure_with_params', { procedureName });

        try {
            const db = this.getCurrentDatabase();
            const interpolatedName = this.interpolateVariables(procedureName);
            const parameters = this.parseProcedureParameters(dataTable);
            
            const startTime = Date.now();
            const result = await db.executeProcedureWithParams(interpolatedName, parameters);
            const executionTime = Date.now() - startTime;

            this.handleProcedureResult(result, interpolatedName, executionTime);

            ActionLogger.logDatabaseAction('stored_procedure_with_params_executed', {
                procedureName: interpolatedName,
                executionTime,
                parameterCount: parameters.length,
                resultSets: result.resultSets?.length || 0,
                outputParameters: Object.keys(result.outputParameters || {}).length
            });

        } catch (error) {
            ActionLogger.logDatabaseError('stored_procedure_params_failed', error);
            throw new Error(`Failed to execute stored procedure with parameters: ${error.message}`);
        }
    }

    @CSBDDStepDef('user calls function {string} and stores result as {string}')
    async executeFunctionAndStore(functionName: string, alias: string): Promise<void> {
        ActionLogger.logDatabaseAction('execute_function_store', { functionName, alias });

        try {
            const db = this.getCurrentDatabase();
            const interpolatedName = this.interpolateVariables(functionName);
            
            const result = await db.executeFunction(interpolatedName);
            
            // Store function return value
            this.context.setVariable(alias, result.returnValue);
            this.databaseContext.setLastScalarResult(result.returnValue);

            ActionLogger.logDatabaseAction('function_executed_stored', {
                functionName: interpolatedName,
                alias,
                returnValue: result.returnValue,
                returnType: typeof result.returnValue
            });

        } catch (error) {
            ActionLogger.logDatabaseError('function_execution_failed', error);
            throw new Error(`Failed to execute function '${functionName}': ${error.message}`);
        }
    }

    @CSBDDStepDef('user calls function {string} with parameters:')
    async executeFunctionWithParams(functionName: string, dataTable: any): Promise<void> {
        ActionLogger.logDatabaseAction('execute_function_with_params', { functionName });

        try {
            const db = this.getCurrentDatabase();
            const interpolatedName = this.interpolateVariables(functionName);
            const parameters = this.parseFunctionParameters(dataTable);
            
            const result = await db.executeFunctionWithParams(interpolatedName, parameters);
            
            this.databaseContext.setLastScalarResult(result.returnValue);

            ActionLogger.logDatabaseAction('function_with_params_executed', {
                functionName: interpolatedName,
                parameterCount: parameters.length,
                returnValue: result.returnValue
            });

        } catch (error) {
            ActionLogger.logDatabaseError('function_params_failed', error);
            throw new Error(`Failed to execute function with parameters: ${error.message}`);
        }
    }

    @CSBDDStepDef('the output parameter {string} should be {string}')
    async validateOutputParameter(parameterName: string, expectedValue: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_output_parameter', { parameterName, expectedValue });

        const outputParams = this.databaseContext.getLastOutputParameters();
        if (!outputParams) {
            throw new Error('No output parameters available. Execute a stored procedure first');
        }

        const interpolatedExpected = this.interpolateVariables(expectedValue);
        const actualValue = outputParams[parameterName];

        if (actualValue === undefined) {
            const available = Object.keys(outputParams).join(', ');
            throw new Error(
                `Output parameter '${parameterName}' not found. ` +
                `Available parameters: ${available}`
            );
        }

        const convertedExpected = this.convertParameterValue(interpolatedExpected);

        if (!this.valuesEqual(actualValue, convertedExpected)) {
            throw new Error(
                `Output parameter mismatch for '${parameterName}'\n` +
                `Expected: ${interpolatedExpected} (${typeof convertedExpected})\n` +
                `Actual: ${actualValue} (${typeof actualValue})`
            );
        }

        ActionLogger.logDatabaseAction('output_parameter_validated', {
            parameterName,
            expectedValue: convertedExpected,
            actualValue
        });
    }

    @CSBDDStepDef('user stores output parameter {string} as {string}')
    async storeOutputParameter(parameterName: string, variableName: string): Promise<void> {
        ActionLogger.logDatabaseAction('store_output_parameter', { parameterName, variableName });

        const outputParams = this.databaseContext.getLastOutputParameters();
        if (!outputParams) {
            throw new Error('No output parameters available. Execute a stored procedure first');
        }

        const value = outputParams[parameterName];
        if (value === undefined) {
            const available = Object.keys(outputParams).join(', ');
            throw new Error(
                `Output parameter '${parameterName}' not found. ` +
                `Available parameters: ${available}`
            );
        }

        this.context.setVariable(variableName, value);

        ActionLogger.logDatabaseAction('output_parameter_stored', {
            parameterName,
            variableName,
            value,
            valueType: typeof value
        });
    }

    @CSBDDStepDef('the stored procedure should return {int} result sets')
    @CSBDDStepDef('the stored procedure should return {int} result set')
    async validateResultSetCount(expectedCount: number): Promise<void> {
        ActionLogger.logDatabaseAction('validate_result_set_count', { expectedCount });

        const resultSets = this.databaseContext.getLastResultSets();
        if (!resultSets) {
            throw new Error('No result sets available. Execute a stored procedure first');
        }

        const actualCount = resultSets.length;
        if (actualCount !== expectedCount) {
            throw new Error(
                `Result set count mismatch\n` +
                `Expected: ${expectedCount}\n` +
                `Actual: ${actualCount}`
            );
        }

        ActionLogger.logDatabaseAction('result_set_count_validated', {
            expectedCount,
            actualCount
        });
    }

    @CSBDDStepDef('user selects result set {int}')
    async selectResultSet(resultSetIndex: number): Promise<void> {
        ActionLogger.logDatabaseAction('select_result_set', { resultSetIndex });

        const resultSets = this.databaseContext.getLastResultSets();
        if (!resultSets) {
            throw new Error('No result sets available. Execute a stored procedure first');
        }

        const index = resultSetIndex - 1; // Convert to 0-based
        if (index < 0 || index >= resultSets.length) {
            throw new Error(
                `Result set index ${resultSetIndex} out of bounds. ` +
                `Available: 1-${resultSets.length}`
            );
        }

        const selectedResultSet = resultSets[index];
        this.databaseContext.setLastResult(selectedResultSet);

        ActionLogger.logDatabaseAction('result_set_selected', {
            resultSetIndex,
            rowCount: selectedResultSet.rowCount,
            columnCount: selectedResultSet.columns.length
        });
    }

    @CSBDDStepDef('the return value should be {string}')
    async validateReturnValue(expectedValue: string): Promise<void> {
        ActionLogger.logDatabaseAction('validate_return_value', { expectedValue });

        const returnValue = this.databaseContext.getLastReturnValue();
        if (returnValue === undefined) {
            throw new Error('No return value available. Execute a procedure/function first');
        }

        const interpolatedExpected = this.interpolateVariables(expectedValue);
        const convertedExpected = this.convertParameterValue(interpolatedExpected);

        if (!this.valuesEqual(returnValue, convertedExpected)) {
            throw new Error(
                `Return value mismatch\n` +
                `Expected: ${interpolatedExpected} (${typeof convertedExpected})\n` +
                `Actual: ${returnValue} (${typeof returnValue})`
            );
        }

        ActionLogger.logDatabaseAction('return_value_validated', {
            expectedValue: convertedExpected,
            actualValue: returnValue
        });
    }

    @CSBDDStepDef('user executes system stored procedure {string}')
    async executeSystemProcedure(procedureName: string): Promise<void> {
        ActionLogger.logDatabaseAction('execute_system_procedure', { procedureName });

        try {
            const db = this.getCurrentDatabase();
            const interpolatedName = this.interpolateVariables(procedureName);
            
            // System procedures might require special handling
            const result = await db.executeSystemProcedure(interpolatedName);
            
            this.handleProcedureResult(result, interpolatedName, 0);

            ActionLogger.logDatabaseAction('system_procedure_executed', {
                procedureName: interpolatedName,
                resultSets: result.resultSets?.length || 0
            });

        } catch (error) {
            ActionLogger.logDatabaseError('system_procedure_failed', error);
            throw new Error(`Failed to execute system procedure '${procedureName}': ${error.message}`);
        }
    }

    @CSBDDStepDef('user lists available stored procedures')
    async listStoredProcedures(): Promise<void> {
        ActionLogger.logDatabaseAction('list_stored_procedures');

        try {
            const db = this.getCurrentDatabase();
            const procedures = await db.listStoredProcedures();

            console.log('\n=== Available Stored Procedures ===');
            procedures.forEach((proc, index) => {
                console.log(`${index + 1}. ${proc.schema}.${proc.name}`);
                if (proc.parameters && proc.parameters.length > 0) {
                    console.log(`   Parameters: ${proc.parameters.map(p => p.name).join(', ')}`);
                }
            });
            console.log(`Total: ${procedures.length} procedure(s)\n`);

            // Store for validation
            this.databaseContext.setAvailableProcedures(procedures);

            ActionLogger.logDatabaseAction('stored_procedures_listed', {
                count: procedures.length
            });

        } catch (error) {
            ActionLogger.logDatabaseError('list_procedures_failed', error);
            throw new Error(`Failed to list stored procedures: ${error.message}`);
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

    private parseProcedureParameters(dataTable: any): ProcedureParameter[] {
        const parameters: ProcedureParameter[] = [];

        if (dataTable && dataTable.rawTable) {
            // Expected format: | name | value | type | direction |
            const headers = dataTable.rawTable[0].map((h: string) => h.toLowerCase().trim());
            
            for (let i = 1; i < dataTable.rawTable.length; i++) {
                const row = dataTable.rawTable[i];
                const param: ProcedureParameter = {
                    name: '',
                    value: null,
                    type: 'VARCHAR',
                    direction: 'IN'
                };

                headers.forEach((header: string, index: number) => {
                    const cellValue = row[index] ? row[index].trim() : '';
                    
                    switch (header) {
                        case 'name':
                        case 'parameter':
                            param.name = cellValue;
                            break;
                        case 'value':
                            param.value = this.convertParameterValue(this.interpolateVariables(cellValue));
                            break;
                        case 'type':
                        case 'datatype':
                            param.type = cellValue.toUpperCase();
                            break;
                        case 'direction':
                        case 'mode':
                            param.direction = cellValue.toUpperCase() as any;
                            break;
                    }
                });

                // Validate parameter
                if (!param.name) {
                    throw new Error(`Parameter name is required at row ${i}`);
                }

                parameters.push(param);
            }
        }

        return parameters;
    }

    private parseFunctionParameters(dataTable: any): any[] {
        const parameters: any[] = [];

        if (dataTable && dataTable.rawTable) {
            dataTable.rawTable.forEach((row: string[]) => {
                if (row.length > 0) {
                    const value = this.interpolateVariables(row[0].trim());
                    parameters.push(this.convertParameterValue(value));
                }
            });
        }

        return parameters;
    }

    private handleProcedureResult(result: StoredProcedureCall, procedureName: string, executionTime: number): void {
        // Store result sets
        if (result.resultSets && result.resultSets.length > 0) {
            this.databaseContext.setLastResultSets(result.resultSets);
            this.databaseContext.setLastResult(result.resultSets[0]); // Default to first result set
        }

        // Store output parameters
        if (result.outputParameters) {
            this.databaseContext.setLastOutputParameters(result.outputParameters);
        }

        // Store return value
        if (result.returnValue !== undefined) {
            this.databaseContext.setLastReturnValue(result.returnValue);
        }

        // Add to execution history
        this.databaseContext.addProcedureExecution({
            procedureName,
            executionTime,
            resultSetCount: result.resultSets?.length || 0,
            outputParameterCount: Object.keys(result.outputParameters || {}).length,
            timestamp: new Date()
        });
    }

    private convertParameterValue(value: string): any {
        // Handle null
        if (value.toLowerCase() === 'null') return null;
        
        // Handle boolean
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
        if (actual === null || actual === undefined) {
            return expected === null || expected === undefined || expected === 'null';
        }

        if (actual instanceof Date && expected instanceof Date) {
            return actual.getTime() === expected.getTime();
        }

        if (typeof actual === 'number' && typeof expected === 'number') {
            return Math.abs(actual - expected) < 0.001;
        }

        return actual === expected;
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