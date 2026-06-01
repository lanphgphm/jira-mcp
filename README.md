# jira-mcp

MCP server that wraps Jira for daily standup assistance. Query your tickets, add comments, and get standup summaries through Claude.

## Tools

| Tool | Description |
|------|-------------|
| `list_my_issues` | List open issues assigned to you |
| `get_issue` | Get issue details with description and comments |
| `add_comment` | Add a comment to an issue |
| `transition_issue` | Move issue to a different status |
| `set_priority` | Change issue priority |
| `standup_summary` | Generate daily standup summary |
| `search_issues` | Run custom JQL queries |

## Setup

### 1. Install dependencies

```bash
npm install
npm run build
```

### 2. Get a Jira API token

Go to https://id.atlassian.com/manage-profile/security/api-tokens and create a token.

### 3. Configure Claude Code

**Option A: Project-level config** (recommended)

Create `.mcp.json` in the jira-mcp directory:

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["build/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://yourco.atlassian.net",
        "JIRA_EMAIL": "you@yourco.com",
        "JIRA_API_TOKEN": "your_token_here"
      }
    }
  }
}
```

**Option B: Global config**

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/absolute/path/to/jira-mcp/build/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://yourco.atlassian.net",
        "JIRA_EMAIL": "you@yourco.com",
        "JIRA_API_TOKEN": "your_token_here"
      }
    }
  }
}
```

### 4. Restart Claude Code

Exit and restart Claude Code, then verify with `/mcp`.

## Usage Examples

- "What are my open tickets?"
- "Give me a standup summary"
- "Show me details for PROJ-123"
- "Add a comment to PROJ-123 saying I'm blocked on code review"
- "Move PROJ-123 to In Progress"
- "Set PROJ-123 priority to High"
- "Search for bugs in the API project"

## Development

I use nix as the main package manager on nixOS. To enter dev environment:

```bash
# Enter dev shell (nix)
nix develop

# Or with direnv
direnv allow
```

If you don't use nix at all, feel free to install everything listed in `flake.nix` and then proceed with: 

``` bash
# Build
npm run build

# Watch mode
npm run dev
```
