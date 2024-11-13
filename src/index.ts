#!/usr/bin/env node
import yargs from 'yargs';
import fs from 'fs';
import { minimatch } from 'minimatch';
const { execSync } = require('child_process');

type CLIArgs = {
	scriptDir: string;
	verbose: boolean;
	dry: boolean;
	skip?: string[];
	_: string[];
};

type Option = 'run-once';

type Options = {
	[key in keyof ScriptPhases]: Option;
} & {
	options?: string[];
};

type ScriptPhases = {
	pre?: string[];
	command: string[];
	post?: string[];
};

type Script = {
	name: string;
	config?: Options;
} & ScriptPhases;

type ScriptFile = Record<string, Script>;

interface ProcessedScript {
	script: Script;
	substitutions: { param: string; value: string }[];
}

enum Phase {
	PRE,
	COMMAND,
	POST,
}

type PlanStep = {
	script: string;
	phase: Phase;
	command: string;
	skip: boolean;
};
type PlanStepExplained = PlanStep & { explanation: string };
type Plan = PlanStepExplained[];

const argv = yargs
	.option('scriptDir', {
		alias: 's',
		type: 'string',
		description: 'Directory of the scripts',
		demandOption: true,
		default: './.run',
	})
	.option('verbose', {
		alias: 'l',
		type: 'boolean',
		description: 'Run in verbose mode',
		default: false,
	})
	.option('dry', {
		alias: 'd',
		type: 'boolean',
		description: 'Dry run',
		default: false,
	})
	.option('skip', {
		type: 'array',
		description: 'Glob patterns of scripts to skip',
	})
	.help()
	.alias('help', 'h').argv as CLIArgs;

const scripts = loadScripts(argv.scriptDir);
const scriptsRan: string[] = [];

function findMatchingScript(scripts: Script[], param: string): ProcessedScript {
	const completeMatch = scripts.find(s => s.name === param);
	if (completeMatch) {
		return { script: completeMatch, substitutions: [] };
	}
	for (const script of scripts) {
		const substitutions: { param: string; value: string }[] = [];
		const regex = /\$\{(\w+)\}/g;
		let match: RegExpExecArray | null;
		let scriptName = script.name;

		while ((match = regex.exec(script.name)) !== null) {
			const [placeholder, key] = match;
			const value = param.split(':')[1];
			if (value) {
				scriptName = scriptName.replace(placeholder, value);
				substitutions.push({ param: placeholder, value });
			}
		}

		if (scriptName === param) {
			return { script, substitutions };
		}
	}

	throw new Error(`No script found for ${param}`);
}

function loadScripts(scriptDir: string): Script[] {
	const scripts: Script[] = [];
	fs.readdirSync(scriptDir).forEach(file => {
		const scriptFilePath = `${scriptDir}/${file}`;
		const script = loadScriptFile(scriptFilePath);
		Object.keys(script).forEach(key => {
			scripts.push({ ...{ name: key }, ...script[key] });
		});
	});
	return scripts;
}

function loadScriptFile(scriptFilePath: string): ScriptFile {
	const data = fs.readFileSync(scriptFilePath, 'utf8');
	const scripts = JSON.parse(data);
	if (!isScriptsFile(scripts)) {
		throw new Error('Invalid script file');
	}
	return scripts;
}

function isScriptsFile(obj: unknown): obj is ScriptFile {
	return typeof obj === 'object';
}

function log(str: string, level: number) {
	if (!argv.verbose) {
		return;
	}
	console.log(`${'  '.repeat(level)}${str}`);
}

function shouldExecutePre(
	script: Script
): script is Script & { pre: string[] } {
	if (script.pre && script.pre.length > 0) {
		if (script.config && script.config.pre === 'run-once') {
			return !scriptsRan.includes(script.name);
		}
		return true;
	}
	return false;
}

function shouldExecutePost(
	script: Script
): script is Script & { post: string[] } {
	if (script.post && script.post.length > 0) {
		if (script.config && script.config.post === 'run-once') {
			return !scriptsRan.includes(script.name);
		}
		return true;
	}
	return false;
}

function executeScript(
	subbedScript: ProcessedScript,
	phase: Phase = Phase.COMMAND,
	level: number = 0,
	steps: PlanStep[] = []
) {
	let builtSteps = [...steps];
	let name = subbedScript.script.name;
	subbedScript.substitutions.forEach(sub => {
		name = name.replace(sub.param, sub.value);
	});
	let prefix = '[CMD]';
	if (phase === Phase.PRE) {
		prefix = '[PRE]';
	}
	if (phase === Phase.POST) {
		prefix = '[POS]';
	}
	log(`${prefix} ${name}`, level);

	const { script, substitutions } = subbedScript;

	if (shouldExecutePre(script)) {
		const steps = script.pre.map(pre =>
			runCommand(name, pre, substitutions, Phase.PRE, level + 1)
		);
		builtSteps = [...builtSteps, ...steps.flat()];
	}

	if (script.command.length > 0) {
		const steps = script.command.map(cmd =>
			runCommand(name, cmd, substitutions, Phase.COMMAND, level + 1)
		);
		builtSteps = [...builtSteps, ...steps.flat()];
	}

	if (shouldExecutePost(script)) {
		const steps = script.post.map(post =>
			runCommand(name, post, substitutions, Phase.POST, level + 1)
		);
		builtSteps = [...builtSteps, ...steps.flat()];
	}

	scriptsRan.push(subbedScript.script.name);

	return builtSteps;
}

function runCommand(
	script: string,
	commandToRun: string,
	substitutions: { param: string; value: string }[],
	phase: Phase,
	level: number
): PlanStep[] {
	let command = commandToRun;
	substitutions.forEach(sub => {
		command = command.replaceAll(sub.param, sub.value);
	});

	const bnrunPrefix = 'bnrun ';
	if (commandToRun.startsWith(bnrunPrefix)) {
		const runCommand = command.substring(bnrunPrefix.length);
		const found = findMatchingScript(scripts, runCommand);
		return executeScript(found, phase, level);
	}
	let prefix = ' $';
	if (phase === Phase.PRE) {
		prefix = '<$';
	}
	if (phase === Phase.POST) {
		prefix = '>$';
	}

	const skip = matchGlobPatterns([script, command], argv.skip || []);

	log(`${prefix}: ${command}`, level);
	return [{ script, phase, command, skip }];
}

function matchGlobPatterns(items: string[], patterns: string[]): boolean {
	const matchedItems: string[] = [];
	items.forEach(item => {
		patterns.forEach(pattern => {
			if (minimatch(item, pattern)) {
				matchedItems.push(pattern);
			}
		});
	});
	return matchedItems.length > 0;
}

function stepPlanPrefix(step: PlanStep): string {
	const { script, phase } = step;
	const p =
		phase === Phase.PRE ? 'pre:' : phase === Phase.POST ? 'post:' : '';
	const str = `> [${p}${script}]  `;
	return str;
}

function explainPlanStep(step: PlanStep, minWidth: number): string {
	const prefix = stepPlanPrefix(step);
	const spaces = ' '.repeat(minWidth - prefix.length);
	const str = `${prefix}${spaces}$ ${step.command}`;
	return str;
}

function createPlan(steps: PlanStep[]): Plan {
	const minWidth = steps.reduce((max, step) => {
		const str = stepPlanPrefix(step);
		return str.length > max ? str.length : max;
	}, 0);
	return steps.map(step => ({
		...step,
		explanation: explainPlanStep(step, minWidth),
	}));
}

const found = findMatchingScript(scripts, argv._[0]);

const steps = executeScript(found);
const plan = createPlan(steps);

function prettyPrintable(title: string, script: PlanStep) {
	const scriptLabel = 'Script:';
	const phaseLabel = 'Phase:';
	const commandLabel = 'Command:';
	const willSkipLabel = 'Will skip:';

	const maxLength = Math.max(
		scriptLabel.length,
		phaseLabel.length,
		commandLabel.length,
		willSkipLabel.length
	);

	const skip = script.skip ? 'Yes' : 'No';

	const scriptLine = `${scriptLabel.padEnd(maxLength)} ${script.script}`;
	const phaseLine = `${phaseLabel.padEnd(maxLength)} ${Phase[script.phase]}`;
	const commandLine = `${commandLabel.padEnd(maxLength)} ${script.command}`;
	const willSkipLine = `${willSkipLabel.padEnd(maxLength)} ${skip}`;

	const boxWidth =
		Math.max(
			scriptLine.length,
			phaseLine.length,
			commandLine.length,
			title.length,
			willSkipLine.length
		) + 2;

	const topBorder = '┌' + '─'.repeat(boxWidth) + '┐';
	const bottomBorder = '└' + '─'.repeat(boxWidth) + '┘';
	const titleLine = `│ ${title.padEnd(boxWidth - 1)}│`;
	const separatorLine = '├' + '─'.repeat(boxWidth) + '┤';

	const formattedScriptLine = `│ ${scriptLine.padEnd(boxWidth - 1)}│`;
	const formattedPhaseLine = `│ ${phaseLine.padEnd(boxWidth - 1)}│`;
	const formattedCommandLine = `│ ${commandLine.padEnd(boxWidth - 1)}│`;
	const formattedWillSKipLine = script.skip
		? `│ ⚠️ ${willSkipLine.padEnd(boxWidth - 3)}│\n`
		: '';

	return (
		'' +
		topBorder +
		'\n' +
		titleLine +
		'\n' +
		separatorLine +
		'\n' +
		formattedScriptLine +
		'\n' +
		formattedPhaseLine +
		'\n' +
		formattedCommandLine +
		'\n' +
		`${formattedWillSKipLine}` +
		bottomBorder +
		'\n'
	);
}

plan.forEach(step => {
	console.log(prettyPrintable(argv._[0], step));
	if (!argv.dry) {
		// execute
		try {
			if (!step.skip) {
				execSync(step.command, { stdio: 'inherit' });
			} else {
				log(`Skipping ${step.command}`, 0);
			}
		} catch (error) {
			console.error(`Error executing command: ${step.command}`);
			process.exit(1);
		}
	} else {
		if (!step.skip) {
			log(step.explanation, 0);
		} else {
			log(`Skipping ${step.explanation}`, 0);
		}
	}
});
