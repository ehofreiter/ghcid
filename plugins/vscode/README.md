# VSCode haskell-ghcid

Shows errors and warnings from [`ghcid`](https://github.com/ndmitchell/ghcid) in the Problems pane and inline as red squiggles in the editor. Updates when files are saved.

## Usage

Simply run `ghcid -o ghcid.txt`! `-o` instructs `ghcid` to write its output to a file every time it recompiles your code. This extension will automatically find and watch that file for updates.

TODO: Add this back in!

## Spawning `ghcid` in VS Code

Alternatively, you can tell VS Code to spawn a `ghcid` process in an embedded terminal:

* Get your project working so typing `ghcid` in the project root works. If you need to pass special flags to `ghcid` you have two options:
  1. Create a `.ghcid` file in the project root with the extra flags, e.g. `--command=cabal repl` or similar.
  2. Edit the extension setting `ghcid.command`, which sets the command line used to invoke `ghcid`.
* Run the VS Code command (`Ctrl+Shift+P`) named "Start Ghcid for given workspace folder" and select the desired workspace folder. Each workspace folder can have a separate `ghcid` process running against it.
* To stop the embedded `ghcid`(s), run the VS Code command "Stop Ghcid terminal and clear problems for given workspace folder" or "Stop all Ghcid terminals and clear problems". You can also run this to clear extraneous problems from previous crashed instances `ghcid`.

## Requirements

Requires [`ghcid`](https://github.com/ndmitchell/ghcid) to be installed and on your `$PATH`.

## Local installation

Run:

    npm install
    npm install @vscode/vsce
    rm haskell-ghcid-*.vsix
    npx @vscode/vsce package
    code --install-extension haskell-ghcid-*.vsix

## Making releases of this extension

* Create a personal token following [the instructions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token), which involves visiting [this page](https://ndmitchell.visualstudio.com/_usersSettings/tokens).
* Run `vsce publish -p <token>`.

## Authors

* [**@ndmitchell**](https://github.com/ndmitchell) Neil Mitchell
* [**@chrismwendt**](https://github.com/chrismwendt) Chris Wendt
