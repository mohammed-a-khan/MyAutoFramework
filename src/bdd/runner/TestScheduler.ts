// src/bdd/runner/TestScheduler.ts

import { ActionLogger } from '../../core/logging/ActionLogger';
import {
    Feature,
    Scenario,
    ExecutionPlan,
    RunOptions
} from '../types/bdd.types';
import {
    TestGroup,
    PriorityLevel,
    ResourceRequirement
} from './test-scheduler.types';

/**
 * Schedules test execution order and creates execution plan
 */
export class TestScheduler {
    private readonly priorityMap: Map<string, PriorityLevel> = new Map([
        ['@critical', 'critical'],
        ['@high-priority', 'high'],
        ['@medium-priority', 'medium'],
        ['@low-priority', 'low'],
        ['@smoke', 'critical'],
        ['@regression', 'medium']
    ]);

    private readonly resourceMap: Map<string, ResourceRequirement[]> = new Map([
        ['@database', ['database']],
        ['@api', ['api']],
        ['@heavy', ['memory', 'cpu']],
        ['@external-service', ['network', 'external']]
    ]);

    /**
     * Create execution plan from features
     */
    public async createExecutionPlan(features: Feature[], options: RunOptions): Promise<ExecutionPlan> {
        ActionLogger.logInfo('Test Scheduler', 'Creating execution plan');

        // const startTime = Date.now();
        
        // Flatten all scenarios
        const allScenarios = this.flattenScenarios(features);
        
        // Apply scheduling strategy
        const scheduledScenarios = await this.scheduleScenarios(allScenarios, options);
        
        // Group scenarios for execution
        const groups = this.groupScenarios(scheduledScenarios, options);
        
        // Calculate estimates
        const estimates = this.calculateEstimates(groups);
        
        // Create execution plan
        const plan: ExecutionPlan = {
            features: this.reconstructFeatures(features, scheduledScenarios),
            scenarios: allScenarios.map(s => s.scenario),
            totalTests: allScenarios.length,
            totalFeatures: features.length,
            totalScenarios: allScenarios.length,
            executionOrder: this.createExecutionOrder(scheduledScenarios),
            parallelGroups: this.convertToScenarioGroups(groups),
            estimatedDuration: estimates.totalDuration
        };

        ActionLogger.logInfo('Execution plan created', JSON.stringify({
            scenarios: plan.totalScenarios,
            estimatedDuration: `${plan.estimatedDuration}ms`
        }));

        return plan;
    }

    /**
     * Flatten all scenarios from features
     */
    private flattenScenarios(features: Feature[]): Array<{scenario: Scenario, feature: Feature}> {
        const scenarios: Array<{scenario: Scenario, feature: Feature}> = [];
        
        for (const feature of features) {
            for (const scenario of feature.scenarios) {
                scenarios.push({ scenario, feature });
            }
        }
        
        return scenarios;
    }

    /**
     * Schedule scenarios based on strategy
     */
    private async scheduleScenarios(
        scenarios: Array<{scenario: Scenario, feature: Feature}>,
        options: RunOptions
    ): Promise<Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}>> {
        const strategy = options['schedulingStrategy'] || 'priority';
        
        switch (strategy) {
            case 'priority':
                return this.schedulePriorityBased(scenarios);
            case 'resource':
                return this.scheduleResourceBased(scenarios);
            case 'dependency':
                return this.scheduleDependencyBased(scenarios);
            case 'time-optimal':
                return this.scheduleTimeOptimal(scenarios);
            case 'random':
                return this.scheduleRandom(scenarios);
            default:
                return this.schedulePriorityBased(scenarios);
        }
    }

    /**
     * Priority-based scheduling
     */
    private schedulePriorityBased(
        scenarios: Array<{scenario: Scenario, feature: Feature}>
    ): Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}> {
        // Assign priorities
        const withPriority = scenarios.map(item => ({
            ...item,
            priority: this.determinePriority(item.scenario, item.feature)
        }));

        // Sort by priority
        return withPriority.sort((a, b) => {
            const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
            return (priorityOrder as any)[a.priority] - (priorityOrder as any)[b.priority];
        });
    }

    /**
     * Resource-based scheduling
     */
    private scheduleResourceBased(
        scenarios: Array<{scenario: Scenario, feature: Feature}>
    ): Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}> {
        // Group by resource requirements
        const resourceGroups = new Map<string, typeof scenarios>();
        
        scenarios.forEach(item => {
            const resources = this.getResourceRequirements(item.scenario);
            const key = resources.sort().join(',') || 'none';
            
            if (!resourceGroups.has(key)) {
                resourceGroups.set(key, []);
            }
            resourceGroups.get(key)!.push(item);
        });

        // Schedule groups to minimize resource conflicts
        const scheduled: Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}> = [];
        
        // First: scenarios with no resource requirements
        if (resourceGroups.has('none')) {
            resourceGroups.get('none')!.forEach(item => {
                scheduled.push({ ...item, priority: 'medium' });
            });
        }

        // Then: group by resource to run similar tests together
        const sortedKeys = Array.from(resourceGroups.keys())
            .filter(k => k !== 'none')
            .sort((a, b) => a.split(',').length - b.split(',').length);

        sortedKeys.forEach(key => {
            resourceGroups.get(key)!.forEach(item => {
                scheduled.push({ ...item, priority: 'medium' });
            });
        });

        return scheduled;
    }

    /**
     * Dependency-based scheduling
     */
    private scheduleDependencyBased(
        scenarios: Array<{scenario: Scenario, feature: Feature}>
    ): Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}> {
        const scheduled: Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}> = [];
        const processed = new Set<string>();
        const processing = new Set<string>();

        const visit = (item: typeof scenarios[0]) => {
            const id = this.getScenarioId(item);
            
            if (processed.has(id)) return;
            if (processing.has(id)) {
                throw new Error(`Circular dependency detected: ${id}`);
            }

            processing.add(id);

            // Process dependencies first
            const deps = this.getDependencies(item.scenario);
            deps.forEach(depId => {
                const dep = scenarios.find(s => this.getScenarioId(s) === depId);
                if (dep) visit(dep);
            });

            scheduled.push({ ...item, priority: 'medium' });
            processing.delete(id);
            processed.add(id);
        };

        // Process all scenarios
        scenarios.forEach(visit);

        return scheduled;
    }

    /**
     * Time-optimal scheduling
     */
    private scheduleTimeOptimal(
        scenarios: Array<{scenario: Scenario, feature: Feature}>
    ): Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}> {
        // Estimate execution times
        const withEstimates = scenarios.map(item => ({
            ...item,
            estimatedTime: this.estimateScenarioTime(item.scenario),
            priority: 'medium' as PriorityLevel
        }));

        // Sort by execution time (shortest first for better parallelization)
        return withEstimates.sort((a, b) => a.estimatedTime - b.estimatedTime);
    }

    /**
     * Random scheduling
     */
    private scheduleRandom(
        scenarios: Array<{scenario: Scenario, feature: Feature}>
    ): Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}> {
        // Fisher-Yates shuffle
        const shuffled = [...scenarios];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            if (shuffled[i] !== undefined && shuffled[j] !== undefined) {
                [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
            }
        }
        
        return shuffled.map(item => ({ ...item, priority: 'medium' as PriorityLevel }));
    }

    /**
     * Group scenarios for execution
     */
    private groupScenarios(
        scenarios: Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}>,
        options: RunOptions
    ): TestGroup[] {
        const groups: TestGroup[] = [];

        const workers = options.workers || 1;
        if (!options.parallel || workers <= 1) {
            // Single group for sequential execution
            groups.push({
                id: 'sequential-group-1',
                scenarios: scenarios.map(s => s.scenario),
                parallel: false,
                maxWorkers: 1,
                priority: 'medium',
                resourceRequirements: []
            });
        } else {
            // Create parallel groups
            const parallelizableGroups = this.createParallelGroups(scenarios, workers);
            groups.push(...parallelizableGroups);
        }

        return groups;
    }

    /**
     * Create groups for parallel execution
     */
    private createParallelGroups(
        scenarios: Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}>,
        maxWorkers: number
    ): TestGroup[] {
        const groups: TestGroup[] = [];
        
        // Group by parallelization constraints
        const cannotParallelize = scenarios.filter(s => 
            s.scenario.tags.includes('@serial') || 
            s.scenario.tags.includes('@no-parallel')
        );
        
        const canParallelize = scenarios.filter(s => 
            !s.scenario.tags.includes('@serial') && 
            !s.scenario.tags.includes('@no-parallel')
        );

        // Create serial group if needed
        if (cannotParallelize.length > 0) {
            groups.push({
                id: 'serial-group',
                scenarios: cannotParallelize.map(s => s.scenario),
                parallel: false,
                maxWorkers: 1,
                priority: 'high',
                resourceRequirements: []
            });
        }

        // Distribute parallel scenarios across workers
        if (canParallelize.length > 0) {
            const workerGroups = this.distributeAcrossWorkers(canParallelize, maxWorkers);
            groups.push(...workerGroups);
        }

        return groups;
    }

    /**
     * Distribute scenarios across workers
     */
    private distributeAcrossWorkers(
        scenarios: Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}>,
        maxWorkers: number
    ): TestGroup[] {
        const groups: TestGroup[] = [];
        const scenariosPerWorker = Math.ceil(scenarios.length / maxWorkers);

        for (let i = 0; i < maxWorkers && i * scenariosPerWorker < scenarios.length; i++) {
            const start = i * scenariosPerWorker;
            const end = Math.min(start + scenariosPerWorker, scenarios.length);
            const workerScenarios = scenarios.slice(start, end);

            if (workerScenarios.length > 0) {
                groups.push({
                    id: `parallel-group-${i + 1}`,
                    scenarios: workerScenarios.map(s => s.scenario),
                    parallel: true,
                    maxWorkers: 1,
                    priority: this.getGroupPriority(workerScenarios),
                    resourceRequirements: this.getGroupResources(workerScenarios)
                });
            }
        }

        return groups;
    }

    /**
     * Calculate execution estimates
     */
    private calculateEstimates(groups: TestGroup[]): any {
        const scenarioEstimates = groups.flatMap(g => 
            g.scenarios.map((s: Scenario) => ({
                scenario: s.name,
                estimatedTime: this.estimateScenarioTime(s)
            }))
        );

        const totalSequentialTime = scenarioEstimates.reduce((sum: number, e: any) => sum + e.estimatedTime, 0);
        
        // Calculate parallel execution time
        let parallelTime = 0;
        const parallelGroups = groups.filter(g => g.parallel);
        
        if (parallelGroups.length > 0) {
            // Time is the maximum of all parallel group times
            const groupTimes = parallelGroups.map(g => 
                g.scenarios.reduce((sum: number, s: Scenario) => sum + this.estimateScenarioTime(s), 0)
            );
            parallelTime = Math.max(...groupTimes);
        }

        const serialTime = groups
            .filter(g => !g.parallel)
            .reduce((sum, g) => 
                sum + g.scenarios.reduce((sum2: number, s: Scenario) => sum2 + this.estimateScenarioTime(s), 0), 0
            );

        return {
            totalDuration: serialTime + parallelTime,
            sequentialDuration: totalSequentialTime,
            parallelSpeedup: totalSequentialTime / (serialTime + parallelTime),
            scenarioEstimates,
            groupEstimates: groups.map(g => ({
                groupId: g.id,
                estimatedTime: g.scenarios.reduce((sum: number, s: Scenario) => sum + this.estimateScenarioTime(s), 0)
            }))
        };
    }

    /**
     * Reconstruct features with scheduled scenarios
     */
    private reconstructFeatures(
        originalFeatures: Feature[],
        scheduledScenarios: Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}>
    ): Feature[] {
        const featureMap = new Map<string, Feature>();

        // Initialize with empty features
        originalFeatures.forEach(f => {
            const featureUri = f.uri || `feature_${f.name}`;
            featureMap.set(featureUri, {
                ...f,
                scenarios: []
            });
        });

        // Add scheduled scenarios back
        scheduledScenarios.forEach(item => {
            const featureUri = item.feature.uri || `feature_${item.feature.name}`;
            const feature = featureMap.get(featureUri);
            if (feature) {
                feature.scenarios.push(item.scenario);
            }
        });

        return Array.from(featureMap.values()).filter(f => f.scenarios.length > 0);
    }

    /**
     * Helper methods
     */
    private determinePriority(scenario: Scenario, feature: Feature): PriorityLevel {
        const allTags = [...feature.tags, ...scenario.tags];
        
        for (const [tag, priority] of this.priorityMap) {
            if (allTags.includes(tag)) {
                return priority;
            }
        }
        
        return 'medium';
    }

    private getResourceRequirements(scenario: Scenario): ResourceRequirement[] {
        const requirements: ResourceRequirement[] = [];
        
        for (const [tag, resources] of this.resourceMap) {
            if (scenario.tags.includes(tag)) {
                requirements.push(...resources);
            }
        }
        
        return [...new Set(requirements)]; // Remove duplicates
    }

    private getDependencies(scenario: Scenario): string[] {
        const dependencies: string[] = [];
        
        const depTag = scenario.tags.find(t => t.startsWith('@depends-on'));
        if (depTag) {
            const match = depTag.match(/@depends-on\((.*)\)/);
            if (match) {
                const deps = match[1];
                if (deps) {
                    dependencies.push(...deps.split(',').map(d => d.trim()));
                }
            }
        }
        
        return dependencies;
    }

    private getScenarioId(item: {scenario: Scenario, feature: Feature}): string {
        return `${item.feature.name}::${item.scenario.name}`;
    }

    private estimateScenarioTime(scenario: Scenario): number {
        // Base estimate
        let estimate = scenario.steps.length * 1000; // 1 second per step
        
        // Adjust based on tags
        if (scenario.tags.includes('@slow')) estimate *= 3;
        if (scenario.tags.includes('@api')) estimate *= 1.5;
        if (scenario.tags.includes('@database')) estimate *= 2;
        if (scenario.tags.includes('@ui-heavy')) estimate *= 2.5;
        
        // Check for explicit timing tag
        const timingTag = scenario.tags.find(t => t.match(/@time\(\d+\)/));
        if (timingTag) {
            const match = timingTag.match(/@time\((\d+)\)/);
            if (match) {
                const time = match[1];
                if (time) {
                    estimate = parseInt(time, 10) * 1000;
                }
            }
        }
        
        return estimate;
    }

    private getGroupPriority(
        scenarios: Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}>
    ): PriorityLevel {
        // Group priority is the highest priority of its scenarios
        const priorities = scenarios.map(s => s.priority);
        if (priorities.includes('critical')) return 'critical';
        if (priorities.includes('high')) return 'high';
        if (priorities.includes('medium')) return 'medium';
        return 'low';
    }

    private getGroupResources(
        scenarios: Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}>
    ): ResourceRequirement[] {
        const resources = scenarios.flatMap(s => this.getResourceRequirements(s.scenario));
        return [...new Set(resources)];
    }

    // private generatePlanId(): string {
    //     return `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    // }
    
    /**
     * Create execution order array
     */
    private createExecutionOrder(scenarios: Array<{scenario: Scenario, feature: Feature, priority: PriorityLevel}>): string[] {
        return scenarios.map(s => s.scenario.name);
    }
    
    /**
     * Convert TestGroups to ScenarioGroups
     */
    private convertToScenarioGroups(groups: TestGroup[]): any[] {
        return groups.map(group => ({
            id: group.id,
            scenarios: group.scenarios,
            priority: group.maxWorkers,
            estimatedDuration: group.estimatedDuration || 0
        }));
    }
}