# Prevent AI-loop status from covering chat submit

## Summary

Move the running AI-loop indicator from VS Code’s bottom-right notification overlay to status-bar progress. This keeps live progress visible without covering the default chat composer. Stopping remains available through the existing `MWNN Kanban: Stop AI Loop` command.

## Implementation Changes

- In `src/extension.ts`, change the AI-loop `withProgress` location from `ProgressLocation.Notification` to `ProgressLocation.Window`.
- Remove `cancellable: true` and the notification cancellation-token listener because status-bar progress does not support inline cancellation.
- Preserve `activeLoop`, progress event reporting, the stop command, board refresh, and the existing completion/stopped information message.
- Do not change webview code, configuration, command IDs, shared message types, or loop-processing behavior.
- Preserve all unrelated working-tree changes already present in `src/extension.ts`.
- After a green targeted validation, add an `[Unreleased]` fix entry to `CHANGELOG.md`.
- After full verification, complete the card’s acceptance criteria, append an implementation/validation activity entry, assign it to `{ kind: human }`, and move it from Implement to Verify.

## Interfaces

- No public API, command, configuration, persistence, or extension-host/webview protocol changes.
- The existing stop command becomes the sole cancellation path while status-bar progress is visible.

## Test Plan

- Run touched-file diagnostics, then `npm run compile-tests`, `npm run compile`, the focused board-loop tests, `npm test`, and `npm run lint`.
- In a Development Host, open the default chat window and start the AI loop:
  - Confirm the status bar displays the loop title and changing progress messages.
  - Confirm no persistent progress notification overlays the chat composer.
  - Verify the submit button remains fully visible, enabled when appropriate, and clickable at normal and narrow chat widths.
  - Stop the loop through `MWNN Kanban: Stop AI Loop`; confirm progress disappears and the stopped summary remains correct.
  - Run a loop to natural completion; confirm progress disappears, the completion summary appears, and another loop can start normally.

## Assumptions

- The existing command-based stop control is sufficient; no clickable status-bar item will be added.
- The transient completion/stopped information message remains unchanged because the defect concerns the persistent running-progress notification.
- VS Code owns notification placement, so relocating progress to the supported status-bar surface is the intended fix rather than attempting notification CSS or chat-extension integration.
