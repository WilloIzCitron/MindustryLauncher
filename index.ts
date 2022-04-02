/******************************
 * 
 * This program is free software: 
 * you can redistribute it and/or modify it under the terms of the GNU General Public License 
 * as published by the Free Software Foundation, either version 3 of the License,
 * or (at your option) any later version.
 * This program is distributed in the hope that it will be useful, 
 * but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 * You should have received a copy of the GNU General Public License along with this program.
 * If not, see <https://www.gnu.org/licenses/>. 
 * 
 */

import * as fs from "fs";
import { spawn, exec, ChildProcess } from "child_process";
import * as readline from "readline";
import * as https from "https";

function askQuestion(query:string): Promise<string> {
	const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
	});

	return new Promise(resolve => rl.question(query, ans => {
		rl.close();
		resolve(ans);
	}))
}

async function askYesOrNo(query:string): Promise<boolean> {
	let response = await askQuestion(query);
	return response == "y" || response == "yes"
}

const pathSeparator = process.platform == "win32" ? "\\" : "/";

process.chdir(process.argv[1].split(pathSeparator).slice(0,-1).join(pathSeparator));

let parsedArgs: {
	[index: string]: string;
};
let mindustryArgs: string[];
[parsedArgs, mindustryArgs] = parseArgs(process.argv.slice(2));

let vars: {
	filePath: string;
	jarName: string;
} = {
	filePath: "AMOGUS",
	jarName: "SUS"
};

if(parsedArgs["help"]){
	console.log(
`Usage: mindustry [--install] [--help] [--version <version>] [--compile] [-- jvmArgs]
--help\tDisplays this help message and exits.
--version\tSpecifies the version to use.
--install\t[WIP] Installs the launcher. Or tries to.
--compile\tCompiles before launching, only works if the version points to a source directory.
--\tTells the launcher to stop parsing args and send remaining arguments to the JVM.`
	);
	process.exit();
}

if(parsedArgs["install"]){
	install()
		.then(() => {
			console.log("Installation completed!");
		})
		.catch((err) => {
			console.log("Installation failed: " + (err as Error).message);
			process.exit(1);
		});
} else {
	try {
		fs.accessSync("config.json", fs.constants.R_OK);
	} catch(err) {
		console.error("Can't find the config.json file!");
		console.error("You may need to create one, try running again with --install.");
		process.exit(1);
	}
}


async function install(){
	console.log("Trying to install.");
	if(/downloads/i.test(process.cwd())){
		console.error("ew why am I in a downloads directory please move me");
		process.exit(1);
	}
	
	if(!await askYesOrNo(`You want to install to ${process.cwd()}, right? [y/n]`))
		throw new Error("Installation aborted.");
	console.log("Installing...");
	try {
		fs.accessSync("config.json", fs.constants.R_OK);
		console.log("config.json file found.");
	} catch(err) {
		console.log("Creating a config.json file...");
		try {
			fs.copyFileSync("template-config.json", "config.json");
			console.log("Done.");
		} catch(err){
			console.error("Failed to create config.json file! " + (err as Error)?.message);
			process.exit(1);
		}
	}
	
	if(await askYesOrNo("The config.json file contains this program's settings. Open it? [y/n]")){
		exec("notepad config.json");
	}
	return true;
}


interface Settings {
	mindustryJars: {
		folderPath: string;
		customVersionNames: {
			[index: string]: string;
		}
	};
	jvmArgs: string[];
	processArgs: string[];
	externalMods: string[];
	restartAutomaticallyOnModUpdate: boolean;
	logging: {
		path: string;
		enabled: boolean;
	};
}

let settings:Settings;

let mindustryProcess:ChildProcess;
let currentLogStream:fs.WriteStream;



function parseArgs(args: string[]): [{[index: string]: string;}, string[]]{
	let parsedArgs: {
		[index: string]: string;
	} = {};
	let argName:string = "null";
	let mindustryArgs = [];
	let mode = 0;
	for (let arg of args) {
		if(arg == "--"){
			//The remaining args need to be sent to the JVM.
			mode = 1;
			continue;
		}
		if(mode == 1){
			mindustryArgs.push(arg);
		}
		if(arg.startsWith("--")){
			argName = arg.slice(2);
			parsedArgs[arg.toLowerCase().slice(2)] = "null";
		} else if(argName){
			parsedArgs[argName] = arg.toLowerCase();
			argName = "null";
		}
	}
	return [parsedArgs, mindustryArgs];
}

function startProcess(_filePath: string, _jvmArgs: string[], _mindustryArgs: string[]){
	copyMods();
	const proc = spawn("java", _jvmArgs.concat(_mindustryArgs).concat([`-jar ${_filePath}`]).concat(settings.processArgs).join(" ").split(" "));
	const d = new Date();
	if(settings.logging.enabled){
		currentLogStream = fs.createWriteStream(
			`${settings.logging.path}${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}--${d.getHours()}-${d.getMinutes()}-${d.getSeconds()}.txt`
		);
		proc.stdout.pipe(currentLogStream);
	}
	proc.stdout.pipe(process.stdout);
	proc.stderr.pipe(process.stderr);
	return proc;
}

function restart(_filePath: string, _jvmArgs: string[]){
	console.log("Restarting!");
	mindustryProcess.removeAllListeners();
	mindustryProcess.kill("SIGTERM");//todo see if this causes issues
	mindustryProcess = startProcess(_filePath, _jvmArgs, mindustryArgs);
	console.log("Started new process.");
}

function copyMods(){
	for(var file of settings.externalMods){
		console.log(`Copying mod ${file}`);
		let modname = file.match(/(?<=[/\\])[^/\\:*?"<>]+?(?=(Desktop)?\.jar$)/i);//hello regex my old friend
		if(modname == null){
			throw new Error(`Invalid mod filename ${file}!`);
		}
		fs.copyFileSync(file, `${process.env["appdata"]}\\Mindustry\\mods\\${modname[0]}.jar`);
	}
}

function parseJSONC(data:string):Settings {
	return JSON.parse(data.split("\n")
		.filter(line => !/^[ \t]*\/\//.test(line))
		.join("\n")
	);
	//Removes lines that start with any amount of whitespaces or tabs and two forward slashes(comments).
}

function downloadFile(version:string){
	return new Promise((resolve, reject) => {
		https.get(`https://github.com/Anuken/Mindustry/releases/download/${version}/Mindustry.jar`, (res) => {
			if(res.statusCode != 302){
				if(res.statusCode == 404){
					return reject("The specified version was not found.");
				}
				return reject("Expected status 302, got " + res.statusCode);
			}
			if(!res.headers.location) return reject("Redirect location not given");
			https.get(res.headers.location!, (res) => {
				const file = fs.createWriteStream(`${settings.mindustryJars.folderPath}${pathSeparator}${version}.jar`);
				res.pipe(file);
				file.on('finish', () => {
					file.close();
					resolve("File downloaded!");
				});
			})
		});
	});
}

async function handleDownload(){
	if(await askYesOrNo("Would you like to download the file? [y/n]")){
		try {
			console.log("Downloading...");
			console.log("There's no status bar so you just have to trust me.");
			await downloadFile("v"+parsedArgs["version"]);
			console.log("Done!");
			main(true);
		} catch(err){
			console.error("An error occured while downloading the file: ");
			console.error(err);
		}
		return;
	}
}

function main(recursive?:boolean){
	
	try {
		fs.accessSync(vars.filePath, fs.constants.R_OK);
	} catch(err){
		console.error(`Unable to access file ${vars.jarName}.`);
		if(recursive){
			console.error("Wait what? I just downloaded that.");
			console.error("Please contact BalaM314 by filing an issue on Github.");
		} else {
			console.error("If you have this version downloaded, check the config.json file to see if the specified filename is correct.")
			handleDownload();
		}
		return;
	}
	
	console.log(`Launching Mindustry version ${parsedArgs["version"]}`);
	if(mindustryArgs.length > 0){
		console.log(`Arguments: ${mindustryArgs}`);
	}

	mindustryProcess = startProcess(vars.filePath, settings.jvmArgs, mindustryArgs);

	process.stdin.on("data", (data) => {
		switch(data.toString("utf-8").slice(0, -2)){
			case "rs": case "restart":
				restart(vars.filePath, settings.jvmArgs);
			break;
			default:
				console.log("Unknown command.");
				break;
		}
	});

	mindustryProcess.on("exit", (statusCode) => {
		if(statusCode == 0){
			console.log("Process exited.");
		} else {
			console.log(`Process crashed with exit code ${statusCode}!`);
		}
		process.exit();
	});


	for(var file of settings.externalMods){
		fs.watchFile(file, () => {
			console.log(`File change detected! (${file})`);
			copyMods();
			if(settings.restartAutomaticallyOnModUpdate)
				restart(vars.filePath, settings.jvmArgs);
		});
	}
}

function init(){
	settings = parseJSONC(fs.readFileSync("config.json", "utf-8"));

	for(let [version, jarName] of Object.entries(settings.mindustryJars.customVersionNames)){
		if(jarName.includes(" ")){
			throw new Error(`Jar name for version ${version} contains a space.`);
		}
	}

	vars.jarName = settings.mindustryJars.customVersionNames[parsedArgs["version"]] ?? `v${parsedArgs["version"]}.jar`;
	vars.filePath = vars.jarName.match(/[/\\]/gi) ? vars.jarName : settings.mindustryJars.folderPath + vars.jarName;
}

init();

if(vars.filePath.match(/[/\\]$/i)){
	if(parsedArgs["compile"]){
		try {
			fs.accessSync(`${vars.filePath}/desktop/build.gradle`);
		} catch(err){
			console.error(`Unable to find a build.gradle in ${vars.filePath}/desktop/build.gradle. Are you sure this is a Mindustry source directory?`);
			process.exit(1);
		}
		console.log("Compiling...");
		let gradleProcess = spawn(`${vars.filePath}/gradlew.bat`, ["desktop:dist"], {
			cwd: vars.filePath
		});
		gradleProcess.stdout.pipe(process.stdout);
		gradleProcess.stderr.pipe(process.stderr);
		gradleProcess.on("exit", (code) => {
			if(code == 0){
				console.log("Compiled succesfully.");
				vars.jarName = "Mindustry.jar";
				vars.filePath += `desktop${pathSeparator}build${pathSeparator}libs${pathSeparator}Mindustry.jar`;
				main();
			} else {
				console.log("Compiling failed.");
				process.exit(1);
			}
		});
		
	} else {
		try {
			fs.accessSync(`${vars.filePath}/desktop/build/libs/Mindustry.jar`);
		} catch(err){
			console.error(`Unable to find a Mindustry.jar in ${vars.filePath}/desktop/build/libs/Mindustry.jar. Are you sure this is a Mindustry source directory? You may need to compile first.`);
			process.exit(1);
		}
		vars.jarName = "Mindustry.jar";
		vars.filePath += `desktop${pathSeparator}build${pathSeparator}libs${pathSeparator}Mindustry.jar`;
		main();
	}
	
} else {
	if(!parsedArgs["install"])
		main();
}

