# Prettier Pre-Lint Hook Setup

Add the following `PreToolUse` block to `.claude/settings.local.json` inside the `"hooks"` object,
before the existing `"UserPromptSubmit"` key.

## JSON to add

```json
"PreToolUse": [
  {
    "matcher": "Bash",
    "hooks": [
      {
        "type": "command",
        "command": "cmd=$(jq -r '.tool_input.command'); if echo \"$cmd\" | grep -qE 'npm run lint'; then files=$(git diff --name-only HEAD 2>/dev/null | grep -E '\\.(ts|tsx)$'); if [ -n \"$files\" ]; then echo \"$files\" | xargs npx prettier --write 2>/dev/null; fi; fi",
        "shell": "bash",
        "statusMessage": "Formatting TypeScript files..."
      }
    ]
  }
],
```

## Full `hooks` section after the change

```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [
        {
          "type": "command",
          "command": "cmd=$(jq -r '.tool_input.command'); if echo \"$cmd\" | grep -qE 'npm run lint'; then files=$(git diff --name-only HEAD 2>/dev/null | grep -E '\\.(ts|tsx)$'); if [ -n \"$files\" ]; then echo \"$files\" | xargs npx prettier --write 2>/dev/null; fi; fi",
          "shell": "bash",
          "statusMessage": "Formatting TypeScript files..."
        }
      ]
    }
  ],
  "UserPromptSubmit": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "jq -r '.prompt // \"\"' | grep -iEq '(accepted|merged)' && (cd \"C:/code/RPGClubBotTs\" && git checkout main && git pull) || true",
          "shell": "bash"
        }
      ]
    }
  ]
}
```

## What the hook does

- Fires before every `Bash` tool call
- Checks if the command matches `npm run lint` (silently skips everything else)
- Gets all `.ts` and `.tsx` files changed relative to HEAD via `git diff --name-only HEAD`
- Runs `npx prettier --write` on them before lint sees the files

## After applying

Open `/hooks` once to reload the config in the current session, or restart Claude Code.
