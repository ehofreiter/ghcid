'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto'
import { isUndefined } from 'util';

function pair<a,b>(a : a, b : b) : [a,b] {return [a,b];}

export function parseGhcidOutput(dir : string, s : string) : [vscode.Uri, vscode.Diagnostic][] {
    // standard lines, dealing with \r\n as well
    function lines(s : string) : string[] {
        return s.replace('\r','').split('\n').filter(x => x != "");
    }

    // After the file location, message bodies are indented (perhaps prefixed by a line number)
    function isMessageBody(x : string) {
        if (x.startsWith(" "))
            return true;
        let sep = x.indexOf('|');
        if (sep == -1)
            return false;
        return !isNaN(Number(x.substr(0, sep)));
    }

    // split into separate error messages, which all start at col 0 (no spaces) and are following by message bodies
    function split(xs : string[]) : string[][] {
        var cont = [];
        var res = [];
        for (let x of xs) {
            if (isMessageBody(x))
                cont.push(x);
            else {
                if (cont.length > 0) res.push(cont);
                cont = [x];
            }
        }
        if (cont.length > 0) res.push(cont);
        return res;
    }

    function clean(lines: string[]): string[] {
        const newlines: string[] = []
        for (const line of lines) {
            if (/In the/.test(line)) break

            if (line.match(/\s*\|$/)) break
            if (line.match(/(\d+)?\s*\|/)) break

            newlines.push(line)
        }
        return newlines
    }

    function dedent(lines: string[]): string[] {
        const indentation = Math.min(...lines.filter(line => line !== '').map(line => line.match(/^\s*/)[0].length))
        return lines.map(line => line.slice(indentation))
    }

    function parse(xs : string[]) : [vscode.Uri, vscode.Diagnostic][] {
        let r1 = /(..[^:]+):([0-9]+):([0-9]+):/
        let r2 = /(..[^:]+):([0-9]+):([0-9]+)-([0-9]+):/
        let r3 = /(..[^:]+):\(([0-9]+),([0-9]+)\)-\(([0-9]+),([0-9]+)\):/
        var m : RegExpMatchArray;
        let f = (l1,c1,l2,c2) => {
            let range = new vscode.Range(parseInt(m[l1])-1,parseInt(m[c1])-1,parseInt(m[l2])-1,parseInt(m[c2]));
            let file = vscode.Uri.file(path.isAbsolute(m[1]) ? m[1] : path.join(dir, m[1]));
            var s = xs[0].substring(m[0].length).trim();
            let i = s.indexOf(':');
            var sev = vscode.DiagnosticSeverity.Error;
            if (i !== -1) {
                if (s.substr(0, i).toLowerCase() == 'warning')
                    sev = vscode.DiagnosticSeverity.Warning;
                s = s.substr(i+1).trim();
            }
            let msg = [].concat(/^\s*$/.test(s) ? [] : [s], xs.slice(1));
            return [pair(file, new vscode.Diagnostic(range, dedent(msg).join('\n'), sev))];
        };
        if (xs[0].startsWith("All good"))
            return [];
        if (m = xs[0].match(r1))
            return f(2,3,2,3);
        if (m = xs[0].match(r2))
            return f(2,3,2,4);
        if (m = xs[0].match(r3))
            return f(2,3,4,5);
        return [[vscode.Uri.file(dir), new vscode.Diagnostic(new vscode.Range(0,0,0,0), dedent(xs).join('\n'))]];
    }
    return [].concat(... split(lines(s)).map(clean).map(parse));
}

function groupDiagnostic(xs : [vscode.Uri, vscode.Diagnostic[]][]) : [vscode.Uri, vscode.Diagnostic[]][] {
    let seen = new Map<string, [number, vscode.Uri, vscode.Diagnostic[]]>();
    for (var i = 0; i < xs.length; i++) {
        let key = xs[i][0].path;
        if (seen.has(key)) {
            let v = seen.get(key);
            v[2] = v[2].concat(xs[i][1]);
        }
        else
            seen.set(key, [i, xs[i][0], xs[i][1]]);
    }
    return Array.from(seen.values()).sort((a,b) => a[0] - b[0]).map(x => pair(x[1],x[2]));
}

// async function autoWatchGhcidTxt(context: vscode.ExtensionContext) {
//     // TODO support multiple roots
//     const watcher = vscode.workspace.createFileSystemWatcher('**/ghcid.txt')
//     context.subscriptions.push(watcher);
//     const uri2diags = new Map<string, vscode.DiagnosticCollection>()
//     context.subscriptions.push({ dispose: () => Array.from(uri2diags.values()).forEach(diag => diag.dispose()) });

//     const onUpdate = (uri: vscode.Uri) => {
//         const diags = uri2diags.get(uri.fsPath) || vscode.languages.createDiagnosticCollection()
//         uri2diags.set(uri.fsPath, diags)
//         diags.clear()
//         diags.set(groupDiagnostic(parseGhcidOutput(path.dirname(uri.fsPath), fs.readFileSync(uri.fsPath, "utf8")).map(x => pair(x[0], [x[1]]))));
//     }

//     (await vscode.workspace.findFiles('**/ghcid.txt')).forEach(onUpdate)
//     watcher.onDidCreate(onUpdate)
//     watcher.onDidChange(onUpdate)
//     watcher.onDidDelete(uri => {
//         uri2diags.get(uri.fsPath)?.dispose()
//         uri2diags.delete(uri.fsPath)
//     })
// }

class GhcidProcesses implements vscode.Disposable {
    readonly processes : Map<string, GhcidProcess>;

    constructor () {
        this.processes = new Map<string, GhcidProcess>();
    }

    static getKey(wsFolder: vscode.WorkspaceFolder): string {
        return wsFolder.uri.toString();
    }

    addNewProcess(context: vscode.ExtensionContext, wsFolder: vscode.WorkspaceFolder) {
        this.deleteProcess(wsFolder);

        let ghcidFile = new GhcidFile(context.storagePath, wsFolder);

        let ghcidCommand : string = vscode.workspace.getConfiguration('ghcid', ghcidFile.workspaceFolder.uri).get('command');
        let opts : vscode.TerminalOptions =
            os.type().startsWith("Windows") ?
                {shellPath: "cmd.exe", shellArgs: ["/k", ghcidCommand]} :
                {shellPath: ghcidCommand, shellArgs: []};
        opts.name = "ghcid";
        opts.shellArgs = ["--outputfile=" + ghcidFile.path];

        let terminal = vscode.window.createTerminal(opts);
        terminal.show();

        let diagnosticCollection = vscode.languages.createDiagnosticCollection('ghcid');
        let go = () => {
            diagnosticCollection.clear()
            diagnosticCollection.set(groupDiagnostic(parseGhcidOutput(ghcidFile.workspaceFolder.uri.toString(), fs.readFileSync(ghcidFile.path, "utf8")).map(x => pair(x[0], [x[1]]))));
        };
        let watcher = fs.watch(ghcidFile.path, go);
        go();
        let process = new GhcidProcess(ghcidFile, watcher, terminal, diagnosticCollection);

        this.processes.set(GhcidProcesses.getKey(wsFolder), process);
    }

    deleteProcess(wsFolder: vscode.WorkspaceFolder) {
        let key = GhcidProcesses.getKey(wsFolder);
        let process = this.processes.get(key)
        if (isUndefined(process))
            return;
        process.dispose();
        this.processes.delete(key);
    }

    dispose() {
        this.processes.forEach((value : GhcidProcess) => value.dispose());
        this.processes.clear();
    }
}

class GhcidProcess implements vscode.Disposable {
    readonly ghcidFile : GhcidFile;
    readonly watcher : fs.FSWatcher;
    readonly terminal : vscode.Terminal;
    readonly diagnosticCollection : vscode.DiagnosticCollection;

    constructor(ghcidFile: GhcidFile, watcher: fs.FSWatcher, terminal: vscode.Terminal, diagnosticCollection: vscode.DiagnosticCollection) {
        this.ghcidFile = ghcidFile;
        this.watcher = watcher;
        this.terminal = terminal;
        this.diagnosticCollection = diagnosticCollection
    }

    dispose() {
        this.ghcidFile.dispose();
        this.watcher.close();
        this.terminal.dispose();
        this.diagnosticCollection.dispose();
    }
}

class GhcidFile implements vscode.Disposable {
    readonly workspaceFolder: vscode.WorkspaceFolder;
    readonly path: string;

    constructor (storagePath: string, folder: vscode.WorkspaceFolder) {
        this.workspaceFolder = folder;

        // Create temp file "<storagePath>/ghcid-<workspaceFolder-hash>.txt".
        var hash = crypto.createHash('sha256').update(this.workspaceFolder.uri.toString()).digest('hex').substring(0, 20);
        this.path = path.join(storagePath, "ghcid-" + hash + ".txt");

        // Initialize to empty file.
        fs.writeFileSync(this.path, "");
    }

    dispose() {
        try {
            // Delete ghcid file on the filesystem.
            fs.unlinkSync(this.path);
        } catch (e) {
        };
    }
}

async function getWorkspaceFolder(context: vscode.ExtensionContext) : Promise<vscode.WorkspaceFolder> {
    if (!vscode.workspace.workspaceFolders.length) {
        vscode.window.showWarningMessage("You must open a workspace.")
        return undefined;
    }

    let wsFolder = await vscode.window.showWorkspaceFolderPick({ placeHolder: "Run ghcid on which folder?" });

    if (isUndefined(wsFolder)) {
        vscode.window.showWarningMessage("You must choose a workspace folder.")
        return undefined;
    }

    return wsFolder;
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json

    // Create storage path if it doesn't exist.
    if (!fs.existsSync(context.storagePath))
        fs.mkdirSync(context.storagePath);

    // References to managed processes so we can cleanup on demand.
    var ghcidProcesses = new GhcidProcesses();
    context.subscriptions.push(ghcidProcesses);

    context.subscriptions.push(vscode.commands.registerCommand("extension.ghcid.start", async () => {
        try {
            let wsFolder = await getWorkspaceFolder(context);
            if (isUndefined(wsFolder))
                return;
            ghcidProcesses.addNewProcess(context, wsFolder);
        }
        catch (e) {
            console.error("ghcid extension failed:" + e);
            throw e;
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand("extension.ghcid.stop", async () => {
        let wsFolder = await getWorkspaceFolder(context);
        if (isUndefined(wsFolder))
            return;
        vscode.window.showInformationMessage("Stopping ghcid process for workspace folder: " + wsFolder.name);
        ghcidProcesses.deleteProcess(wsFolder);
    }))

    context.subscriptions.push(vscode.commands.registerCommand("extension.ghcid.stopAll", async () => {
        vscode.window.showInformationMessage("Stopping all ghcid processes");
        ghcidProcesses.dispose();
    }))

    // TODO: Re-enable this!
    // Setup watching for ghcid.txt files for when an external process writes a
    // ghcid.txt file into the workspace.
    // await autoWatchGhcidTxt(context)
}

// this method is called when your extension is deactivated
export function deactivate() {
}
