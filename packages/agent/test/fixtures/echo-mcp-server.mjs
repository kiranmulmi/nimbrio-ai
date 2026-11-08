// A tiny MCP server over stdio for the offline tests (test/mcp.test.ts).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'echo', version: '1.0.0' });

server.registerTool(
  'echo',
  { description: 'Echo the text back.', inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: 'text', text: `echo: ${text}` }] }),
);

server.registerTool('fail', { description: 'Always fails.', inputSchema: {} }, async () => ({
  isError: true,
  content: [{ type: 'text', text: 'it broke' }],
}));

server.registerTool(
  'whereami',
  { description: 'The working folder and a few environment variables.', inputSchema: {} },
  async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          cwd: process.cwd(),
          secret: process.env.AGENT_API_KEY ?? null,
          extra: process.env.EXTRA ?? null,
          pid: process.pid,
        }),
      },
    ],
  }),
);

await server.connect(new StdioServerTransport());
