## [Unreleased]

- Fix: Fix bug where the extension always sets you back to a branch even if you select another one
- Fix: Clean up how the extension triggered reloads to not double reload
- Feat: Improve UX around selected branch and executing commits
- Add: Option to pass in AI guidance message to 'cst commit' command
- Add: Allow relevance filtering, and ask the user to provide the required 'intent' message when enabled

## V0.1.2

- Security: Obfuscate API key when running commands instead of providing API key as a direct console argument
- Fix: The extension now reads your vscode theme instead of having its own fixed theme
- Changed: Update README to be clearer and add a LICENSE
- Changed: Improve 'Run Config' to have a more clean and easy to use interface
- Feat: The extension now tracks what branch you are on and automatically reflects the changes
- Feat: The extension can now pass a '--branch' argument to the codestory executable, that allows you to run changes on a branch you arent on
- Feat: The extension does not allow you to run the 'cst fix' commmand on commits that are a merge commit or have a merge commit downstream, matching what cst expects.

## V0.1.1

- Initial release
- Add: Interactive Git Graph to interact with your commit history
- Add: Auto Download The Latest 'cst' executable at runtime
- Add: Support 'cst fix' and 'cst commit' commands
- Add: Support for configuring all global options that the 'cst' command supports
- Add: Semantic Search across commit history
