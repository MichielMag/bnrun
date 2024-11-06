import yargs from 'yargs';
import fs from 'fs';

type CLIArgs = {
	scriptDir: string;
	verbose: boolean;
	_: string[];
};

type Option = 'run-once';

type Options = {
	[key in keyof Script]: Option;
};

type Script = {
	name: string;
	options?: Options;
	pre?: string[];
	command: string[];
	post?: string[];
};

type Scripts = Record<string, Script>;

interface MatchResult {
	script: Script;
	substitutions: { param: string; value: string }[];
}

enum Phase {
	PRE,
	COMMAND,
	POST,
}

type PlanStep = { script: string; phase: Phase; command: string };

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
	.help()
	.alias('help', 'h').argv as CLIArgs;

const scripts = loadScripts(argv.scriptDir);
const scriptsRan: string[] = [];
const plan: PlanStep[] = [];

function findMatchingScript(scripts: Script[], param: string): MatchResult {
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

function loadScriptFile(scriptFilePath: string): Scripts {
	const data = fs.readFileSync(scriptFilePath, 'utf8');
	const scripts = JSON.parse(data);
	if (!isScriptsFile(scripts)) {
		throw new Error('Invalid script file');
	}
	return scripts;
}

function isScriptsFile(obj: unknown): obj is Scripts {
	return typeof obj === 'object';
}

function verbose(str: string, level: number) {
	if (argv.verbose) {
		log(str, level);
	}
}
function log(str: string, level: number) {
	console.log(`${'  '.repeat(level)}${str}`);
}

function shouldExecutePre(
	script: Script
): script is Script & { pre: string[] } {
	if (script.pre && script.pre.length > 0) {
		if (script.options && script.options.pre === 'run-once') {
			return !scriptsRan.includes(script.name);
		}
		return true;
	}
	return false;
}

function executeScript(
	subbedScript: MatchResult,
	phase: Phase = Phase.COMMAND,
	level: number = 0
) {
	let name = subbedScript.script.name;
	subbedScript.substitutions.forEach(sub => {
		name = name.replace(sub.param, sub.value);
	});
	verbose(`#### Executing script: ${name}`, level);
	let prefix = ' #';
	if (phase === Phase.PRE) {
		prefix = ' <';
	}
	if (phase === Phase.POST) {
		prefix = ' >';
	}
	log(`${prefix} ${name}`, level);

	const { script, substitutions } = subbedScript;

	if (shouldExecutePre(script)) {
		verbose(`## Executing pre commands`, level);
		script.pre.forEach(pre => {
			runCommand(name, pre, substitutions, Phase.PRE, level + 1);
		});
		verbose(`## Done with pre commands`, level);
	}

	if (script.command.length > 0) {
		verbose(`## Executing commands`, level);
		script.command.forEach(c => {
			runCommand(name, c, substitutions, Phase.COMMAND, level + 1);
		});
		verbose(`## Done with commands`, level);
	}

	if (script.post && script.post.length > 0) {
		verbose(`## Executing post commands`, level);
		script.post.forEach(post => {
			runCommand(name, post, substitutions, Phase.POST, level + 1);
		});
		verbose(`## Done with post commands`, level);
	}

	verbose(`#### Done with script: ${name}\n`, level);

	verbose(`#### Marking script as ran: ${name}`, level);
	scriptsRan.push(subbedScript.script.name);
}

function runCommand(
	script: string,
	commandToRun: string,
	substitutions: { param: string; value: string }[],
	phase: Phase,
	level: number
) {
	let command = commandToRun;
	substitutions.forEach(sub => {
		command = command.replaceAll(sub.param, sub.value);
	});

	if (commandToRun.startsWith('bnr ')) {
		const runCommand = command.substring(4);
		const found = findMatchingScript(scripts, runCommand);
		executeScript(found, phase, level);
		return;
	}
	let prefix = ' $';
	if (phase === Phase.PRE) {
		prefix = '-$';
	}
	if (phase === Phase.POST) {
		prefix = '+$';
	}
	log(`${prefix}: ${command}`, level);
	plan.push({ script, phase, command });
}

function stepPlanPrefix(step: PlanStep) {
	const { script, phase } = step;
	const p =
		phase === Phase.PRE ? 'pre:' : phase === Phase.POST ? 'post:' : '';
	const str = `> [${p}${script}]  `;
	return str;
}

function logPlanStep(step: PlanStep, minWidth: number) {
	const prefix = stepPlanPrefix(step);
	const spaces = ' '.repeat(minWidth - prefix.length);
	const str = `${prefix}${spaces}$ ${step.command}`;
	return str;
}

function logPlanSteps(steps: PlanStep[]) {
	const minWidth = steps.reduce((max, step) => {
		const str = stepPlanPrefix(step);
		return str.length > max ? str.length : max;
	}, 0);
	return steps.map(step => logPlanStep(step, minWidth)).join('\n');
}

const found = findMatchingScript(scripts, argv._[0]);

executeScript(found);
console.log(logPlanSteps(plan));
