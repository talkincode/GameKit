/**
 * Studio tools, defined once for the built-in assistant and WebMCP.
 *
 * Permission levels match docs/ai-rules.md §8. "Anonymous" means the page can
 * offer the action before login. The external MCP channel still requires a
 * token, because that channel is an account session. Write tools only create
 * a candidate; the child adopts it on the page.
 */

export type ToolLevel = "read" | "run" | "write" | "ai";

export type StudioTool = {
  name: string;
  level: ToolLevel;
  /** The page may offer this before login. */
  anonymous: boolean;
  /** A person must accept the result before the project changes. */
  confirm: boolean;
  description: string;
};

export const STUDIO_TOOLS: readonly StudioTool[] = [
  {
    name: "list_files",
    level: "read",
    anonymous: true,
    confirm: false,
    description: "List the files of the project the child shared for collaboration (paths only).",
  },
  {
    name: "read_file",
    level: "read",
    anonymous: true,
    confirm: false,
    description: "Read one text file of the shared project.",
  },
  {
    name: "read_activity",
    level: "read",
    anonymous: true,
    confirm: false,
    description: "Read what has happened in this collaboration session so far.",
  },
  {
    name: "search_assets",
    level: "read",
    anonymous: true,
    confirm: false,
    description:
      "Search the built-in asset catalog by title, tag, or category. Read-only: it does not copy files and does not change the project.",
  },
  {
    name: "propose_files",
    level: "write",
    anonymous: true,
    confirm: true,
    description:
      "Propose text files for the project. This only creates a candidate the child sees and adopts; it never writes the project directly. Send whole files, up to 6.",
  },
  {
    name: "propose_asset",
    level: "write",
    anonymous: true,
    confirm: true,
    description:
      "Propose one catalog asset. This only creates a candidate. It cannot overwrite a binary file already in the project. The child adopts it on the page.",
  },
];

export function studioTool(name: string): StudioTool {
  const tool = STUDIO_TOOLS.find((item) => item.name === name);
  if (!tool) throw new Error(`Unknown studio tool: ${name}`);
  return tool;
}
