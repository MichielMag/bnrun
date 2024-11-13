# Better NPM Run

A very opinionated script runner that replaces `npm run` scripts.

I grew tired of my package.json script section being a mess, so I created a small utility to keep things organized.

This way you can go from:

```json
{
	"scripts": {
		"prebuild:projectA:production": "some-pre command-for-all-projects",
		"build:projectA:production": "some-build command-for projectA && some-build-other command-for projectA && some-build-final command-for projectA",
		"postbuild:projectA:production": "some-post command-for projectA",
		"prebuild:projectA:production": "some-pre command-for-projects",
		"build:projectA:production": "some-build command-for projectB && some-build-other command-for projectB && some-build-final command-for projectB",
		"postbuild:projectA:production": "some-post command-for projectB",
		"prebuild:projectA:production": "some-pre command-for-projects",
		"build:projectA:production": "some-build command-for projectC && some-build-other command-for projectA && some-build-final command-for projectC",
		"postbuild:projectA:production": "some-post command-for projectC",
		"prebuild:projectA:production": "some-pre command-for-projects",
		"build:projectA:production": "some-build command-for projectD && some-build-other command-for projectA && some-build-final command-for projectD",
		"postbuild:projectA:production": "some-post command-for projectD",
		"build:all:production": "npm run build:projectA:production && npm run build:projectB:production && npm run build:projectC:production && npm run build:projectD:production"
	}
}
```

Which has a lot of duplicates and no control whether a `pre` script should run once or each time for every project, to:

```json
{
	"build:${project}:production": {
		"config": {
			"options": [
				"projectA",
				"projectB",
				"projectC",
				"projectD",
			],
			"pre": "run-once"
		},
		"pre": ["some-pre command-for-projects"],
		"command": [
			"some-build command-for ${project}"
			"some-build-other command-for ${project}"
			"some-build-final command-for ${project}"
		],
		"post": ["some-post command-for ${project}"]
	},
}
```

## Installation

It's on NPM, so:

    > npm install -g bnrun

## Usage

Place a .json script in your projects folder named however you like (tip: use that to organize), and run your scripts using the `bnrun` command.

### Basic example

`.run/scripts.json`

```json
{
	"build": {
		"command": ["ng build"]
	},
	"start": {
		"command": ["ng serve"]
	},
	"test": {
		"command": ["ng test"]
	}
}
```

To run:

    > bnrun build 	#runs ng build
    > bnrun start	#runs ng serve
    > bnrun test	#runs ng test

### Basic substitution

`.run/building.json`

```json
{
	"build:${configuration}": {
		"pre": ["eslint ."],
		"command": ["ng build --configuration ${configuration}"]
	},
	"build": {
		"command": ["bnrun build:production"]
	}
}
```

To run:

    > bnrun build				#runs 'eslint .' and 'ng build --configuration production'
    > bnrun build:development	#runs 'eslint .' and 'ng build --configuration development'
    > bnrun build:production	#runs 'eslint .' and 'ng build --configuration production'
