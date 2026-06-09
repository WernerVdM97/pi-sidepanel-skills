# pi-sidepanel-skills

> 🤖 This code is an AI-generated proof-of-concept. Use at your own risk.

Fetched skills tab for [pi-sidepanel](https://github.com/WernerVdM97/pi-sidepanel). Shows only skills explicitly loaded in the current session — not all available skills.

## Detection

Skills are tracked three ways:

| Method | Mark | How |
|--------|------|-----|
| `/skill:name` command | `/` accent | User explicitly invokes a skill |
| LLM reads `SKILL.md` | `~` success | Agent auto-loads a skill by reading its file |
| Session replay | — | Past reads caught on startup/reload |

## Keybindings

| Key | Action |
|-----|--------|
| `j` / `↓` | Scroll down |
| `k` / `↑` | Scroll up |
| `PgDn` | Page down |
| `PgUp` | Page up |
| `g` | Jump to top |
| `G` | Jump to bottom |

## Display

Each fetched skill shows its name (color-coded by invocation type) with a wrapped description below.

```
 ~caveman
   Ultra-compressed communication mode. Cuts token usage ~75% by speaking
   like caveman while keeping full technical accuracy.
 /spec-driven-development
   Creates specs before coding. Use when starting a new project, feature, or
   significant change and no specification exists yet.
```

## License

MIT
