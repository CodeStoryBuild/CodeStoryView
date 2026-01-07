## V0.1.9

- Changed: Bump Codestory Cli version to 0.1.10
- Fix: Diff lines in diff viewer have added padding on the left for better readability
- Fix: Search bar footer stays at the bottom of the window now
- Fix: Removed unified/split diff toggle, for now we only support unified view.

## V0.1.8

- Feat: Syntax highlighting for diff viewer
- Changed: Rename some old references from Vibe to Codestory
- Changed: Bump Codestory Cli version to 0.1.9
- Fix: Use canonical path for file names (ie old path for deleted files)

## V0.1.7

- Add: Incremental commit loading for large repositories
- Add: Incremental diff loading for large commits
- Feat: Custom diff viewer instead of diff2html for better performance
- Feat: Simple heuristical syntax highlighting for diffs
- Changed: Bump Codestory Cli version to 0.1.7
- Fix: Repository reloads were not being smoothly animated when triggered due to a file watcher change
- Fix: Minor ui polish

## V0.1.6

- Changed: Remove relevance_filtering_level option as it has been changed to two separate options
  1. relevance_filtering: toggle on and off
  2. relevance_filtering_threshold: how strict relevance filtering should be
- Changed: Bump Codestory Cli version to 0.1.6

## V0.1.5

- Add: Add company logo to extension
- Add: The codestory fix command also now supports a guidance message
- Feat: When using the codestory commit command, you can now select which files you would like to commit
- Feat: Added responsive layout for more robust UI across different window sizes
- Changed: Rename google provider to googlegenai, as the Codestory CLI provider name has changed
- Changed: Add higher fidelity demo video
- Fix: only show repository state change notifications when the extension window is active
- Fix: Improve UI performance through caching heavy operations
- Fix: When running Codestory commands strings are now escaped to avoid console errors

## V0.1.4

- Add: Improved search bar UX
- Add: Zoom In/Out buttons
- Changed: Move branch and file update prompts to be stored as settings not global context options
- Fix: There was a bug where untracked files were showing up as renamed, instead of added.
- Fix: Improve ui loading flow, and ensure smooth animations throught
- Removed: You can no longer specify a custom cst executable path. This allows for a much simpler and less error prone cst executable workflow. The extension automatically downloads required version on first run, with no risk of user proving invalid versioned executable.

## V0.1.3

- Add: Option to pass in AI guidance message to 'cst commit' command
- Add: Allow relevance filtering, and ask the user to provide the required 'intent' message when enabled
- Feat: Improve UX around selected branch and executing commits
- Fix: bug where the extension always sets you back to a branch even if you select another one
- Fix: Clean up how the extension triggered reloads to not double reload

## V0.1.2

- Changed: Update README to be clearer and add a LICENSE
- Changed: Improve 'Run Config' to have a more clean and easy to use interface
- Feat: The extension now tracks what branch you are on and automatically reflects the changes
- Feat: The extension can now pass a '--branch' argument to the codestory executable, that allows you to run changes on a branch you arent on
- Feat: The extension does not allow you to run the 'cst fix' commmand on commits that are a merge commit or have a merge commit downstream, matching what cst expects.
- Fix: The extension now reads your vscode theme instead of having its own fixed theme
- Security: Obfuscate API key when running commands instead of providing API key as a direct console argument

## V0.1.1

- Initial release
- Add: Interactive Git Graph to interact with your commit history
- Add: Auto Download The Latest 'cst' executable at runtime
- Add: Support 'cst fix' and 'cst commit' commands
- Add: Support for configuring all global options that the 'cst' command supports
- Add: Semantic Search across commit history
