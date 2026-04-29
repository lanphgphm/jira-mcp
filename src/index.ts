#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const JIRA_BASE_URL = process.env.JIRA_BASE_URL!;
const JIRA_EMAIL = process.env.JIRA_EMAIL!;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN!;

const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");

async function jiraFetch(endpoint: string, options: RequestInit = {}) {
  const url = `${JIRA_BASE_URL}/rest/api/3${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API error ${res.status}: ${text}`);
  }
  return res.json();
}

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    priority?: { name: string };
    assignee?: { displayName: string };
    updated: string;
    description?: unknown;
    comment?: { comments: JiraComment[] };
  };
}

interface JiraComment {
  author: { displayName: string };
  created: string;
  body: unknown;
}

function extractText(adf: unknown): string {
  if (!adf || typeof adf !== "object") return "";
  const node = adf as { type?: string; text?: string; content?: unknown[] };
  if (node.type === "text" && node.text) return node.text;
  if (Array.isArray(node.content)) {
    return node.content.map(extractText).join("");
  }
  return "";
}

function formatIssue(issue: JiraIssue, includeDescription = false): string {
  const lines = [
    `[${issue.key}] ${issue.fields.summary}`,
    `  Status: ${issue.fields.status.name}`,
    `  Priority: ${issue.fields.priority?.name ?? "None"}`,
    `  Updated: ${issue.fields.updated}`,
  ];
  if (includeDescription && issue.fields.description) {
    lines.push(`  Description: ${extractText(issue.fields.description)}`);
  }
  return lines.join("\n");
}

const server = new McpServer({
  name: "jira-mcp",
  version: "1.0.0",
});

// Tool: list my open issues
server.tool(
  "list_my_issues",
  "List open Jira issues assigned to me",
  {
    maxResults: z.number().optional().describe("Max issues to return (default 20)"),
    status: z.string().optional().describe("Filter by status (e.g. 'In Progress')"),
  },
  async ({ maxResults = 20, status }) => {
    let jql = "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC";
    if (status) {
      jql = `assignee = currentUser() AND status = "${status}" ORDER BY updated DESC`;
    }
    const data = await jiraFetch("/search/jql", {
      method: "POST",
      body: JSON.stringify({
        jql,
        maxResults,
        fields: ["summary", "status", "priority", "updated"],
      }),
    });
    const issues = (data.issues as JiraIssue[]).map((i) => formatIssue(i)).join("\n\n");
    return { content: [{ type: "text", text: issues || "No issues found." }] };
  }
);

// Tool: get issue details
server.tool(
  "get_issue",
  "Get details of a specific Jira issue including description and recent comments",
  {
    issueKey: z.string().describe("Issue key (e.g. PROJ-123)"),
  },
  async ({ issueKey }) => {
    const issue: JiraIssue = await jiraFetch(
      `/issue/${issueKey}?fields=summary,status,priority,assignee,updated,description,comment`
    );
    const lines = [formatIssue(issue, true)];

    const comments = issue.fields.comment?.comments ?? [];
    if (comments.length > 0) {
      lines.push("\n  Recent comments:");
      for (const c of comments.slice(-5)) {
        lines.push(`    [${c.created}] ${c.author.displayName}: ${extractText(c.body)}`);
      }
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// Tool: add comment
server.tool(
  "add_comment",
  "Add a comment to a Jira issue",
  {
    issueKey: z.string().describe("Issue key (e.g. PROJ-123)"),
    comment: z.string().describe("Comment text to add"),
  },
  async ({ issueKey, comment }) => {
    await jiraFetch(`/issue/${issueKey}/comment`, {
      method: "POST",
      body: JSON.stringify({
        body: {
          type: "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: comment }] }],
        },
      }),
    });
    return { content: [{ type: "text", text: `Comment added to ${issueKey}` }] };
  }
);

// Tool: transition issue
server.tool(
  "transition_issue",
  "Move a Jira issue to a different status",
  {
    issueKey: z.string().describe("Issue key (e.g. PROJ-123)"),
    status: z.string().describe("Target status name (e.g. 'In Progress', 'Done')"),
  },
  async ({ issueKey, status }) => {
    const transitions = await jiraFetch(`/issue/${issueKey}/transitions`);
    const target = (transitions.transitions as { id: string; name: string }[]).find(
      (t) => t.name.toLowerCase() === status.toLowerCase()
    );
    if (!target) {
      const available = (transitions.transitions as { name: string }[]).map((t) => t.name).join(", ");
      return { content: [{ type: "text", text: `Status "${status}" not available. Options: ${available}` }] };
    }
    await jiraFetch(`/issue/${issueKey}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: { id: target.id } }),
    });
    return { content: [{ type: "text", text: `${issueKey} moved to ${status}` }] };
  }
);

// Tool: standup summary
server.tool(
  "standup_summary",
  "Generate a daily standup summary of my recent Jira activity",
  {},
  async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    // Issues updated recently
    const recentJql = `assignee = currentUser() AND updated >= "${yesterday}" ORDER BY updated DESC`;
    const recentData = await jiraFetch("/search/jql", {
      method: "POST",
      body: JSON.stringify({
        jql: recentJql,
        maxResults: 10,
        fields: ["summary", "status", "priority", "updated"],
      }),
    });

    // Open issues
    const openJql = "assignee = currentUser() AND resolution = Unresolved ORDER BY priority DESC";
    const openData = await jiraFetch("/search/jql", {
      method: "POST",
      body: JSON.stringify({
        jql: openJql,
        maxResults: 10,
        fields: ["summary", "status", "priority", "updated"],
      }),
    });

    const lines = ["## Standup Summary\n"];

    lines.push("### Recently Updated (last 24h):");
    if (recentData.issues.length === 0) {
      lines.push("  No issues updated recently.\n");
    } else {
      for (const issue of recentData.issues as JiraIssue[]) {
        lines.push(`  - [${issue.key}] ${issue.fields.summary} (${issue.fields.status.name})`);
      }
      lines.push("");
    }

    lines.push("### Open Issues:");
    if (openData.issues.length === 0) {
      lines.push("  No open issues.\n");
    } else {
      for (const issue of openData.issues as JiraIssue[]) {
        lines.push(`  - [${issue.key}] ${issue.fields.summary} (${issue.fields.status.name})`);
      }
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// Tool: search issues
server.tool(
  "search_issues",
  "Search Jira issues with a custom JQL query",
  {
    jql: z.string().describe("JQL query string"),
    maxResults: z.number().optional().describe("Max results (default 20)"),
  },
  async ({ jql, maxResults = 20 }) => {
    const data = await jiraFetch("/search/jql", {
      method: "POST",
      body: JSON.stringify({
        jql,
        maxResults,
        fields: ["summary", "status", "priority", "assignee", "updated"],
      }),
    });
    const issues = (data.issues as JiraIssue[]).map((i) => formatIssue(i)).join("\n\n");
    return { content: [{ type: "text", text: issues || "No issues found." }] };
  }
);

async function main() {
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    console.error("Missing required env vars: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN");
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
