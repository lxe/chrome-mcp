import express, { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import cors from "cors";
import * as diff from 'diff';
import { ChromeInterface } from './chrome-interface';

// Type for content items
type ContentItem = {
  type: "text";
  text: string;
};

// Type for tool responses
type ToolResponse = {
  content: ContentItem[];
};

// Helper function for logging
function logToolUsage<T extends Record<string, unknown>>(toolName: string, input: T, output: ToolResponse) {
  console.log(`\n[Tool Used] ${toolName}`);
  console.log('Input:', JSON.stringify(input, null, 2));
  console.log('Output:', JSON.stringify(output, null, 2));
  console.log('----------------------------------------');
}

async function startServer() {
  // Create Chrome interface
  const chrome = new ChromeInterface();
  let lastPageInfo: string | null = null;

  // Create an MCP server
  const server = new McpServer({
    name: "Chrome MCP Server",
    version: "1.0.0",
    description: "Chrome browser automation using MCP. When user is asking to 'navigate' or 'go to' a URL, use the tools provided by this server. If fails, try again."
  });

  // Connect to Chrome
  console.log("Connecting to Chrome...");
  await chrome.connect().catch(error => {
    console.error('Failed to connect to Chrome:', error);
    process.exit(1);
  });

  // Add Chrome tools
  server.tool(
    "navigate",
    "Navigate to a specified URL in the browser. Only use this if you have reasonably inferred the URL from the user's request. When navigation an existing session, prefer the other tools, like click, goBack, goForward, etc.",
    { url: z.string().url() },
    async ({ url }): Promise<ToolResponse> => {
      const result: ToolResponse = { content: [{ type: "text", text: `Navigated to ${url}` }] };
      await chrome.navigate(url);
      logToolUsage("navigate", { url }, result);
      return result;
    }
  );

  server.tool(
    "click",
    "Click at specific x,y coordinates in the browser window. IMPORTANT: Always check the page info after clicking. When interacting with dropdowns, use ArrowUp and ArrowDown keys. Try to figure out what the selected item is when interacting with the dropdowns and use that to navigate.",
    { x: z.number(), y: z.number() },
    async ({ x, y }): Promise<ToolResponse> => {
      await chrome.click(x, y);
      // Delay for 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));
      const result: ToolResponse = { content: [{ type: "text", text: `Clicked at (${x}, ${y})` }] };
      logToolUsage("click", { x, y }, result);
      return result;
    }
  );

  server.tool(
    "clickElementByIndex",
    "Click an interactive element by its index in the page. Indices are returned by getPageInfo. Always check the page info after clicking. For text input fields, prefer using focusElementByIndex instead.",
    { index: z.number() },
    async ({ index }): Promise<ToolResponse> => {
      await chrome.clickElementByIndex(index);
      const result: ToolResponse = { content: [{ type: "text", text: `Clicked element at index: ${index}` }] };
      logToolUsage("clickElementByIndex", { index }, result);
      return result;
    }
  );

  server.tool(
    "focusElementByIndex",
    "Focus an interactive element by its index in the page. Indices are returned by getPageInfo. This is the preferred method for focusing text input fields before typing. Always check the page info after focusing.",
    { index: z.number() },
    async ({ index }): Promise<ToolResponse> => {
      await chrome.focusElementByIndex(index);
      const result: ToolResponse = { content: [{ type: "text", text: `Focused element at index: ${index}` }] };
      logToolUsage("focusElementByIndex", { index }, result);
      return result;
    }
  );

  server.tool(
    "type",
    "Type text into the currently focused element, with support for special keys like {Enter}, {Tab}, etc. Use {Enter} for newlines in textareas or to submit forms. NEVER USE \n\n IN THE TEXT YOU TYPE. Use {Ctrl+A} to select all text in the focused element. If you think you're in a rich text editor, you probably can use {Ctrl+B} to bold, {Ctrl+I} to italic, {Ctrl+U} to underline, etc. IMPORTANT: Always use focusElementByIndex on text input fields before typing. ALSO IMPORTANT. NEVER RELY ON TABS AT ALL TO FOCUS ELEMENTS. EXPLICITLY USE focusElementByIndex ON ELEMENTS BEFORE TYPING. ALSO, ALWAYS CHECK THE PAGE INFO AFTER TYPING. Always check the page info after typing.",
    { text: z.string() },
    async ({ text }): Promise<ToolResponse> => {
      await chrome.type(text);
      const result: ToolResponse = { content: [{ type: "text", text: `Typed: ${text}` }] };
      logToolUsage("type", { text }, result);
      return result;
    }
  );

  server.tool(
    "doubleClick",
    "Double click at specific x,y coordinates in the browser window. Useful for text selection or other double-click specific actions. Always check the page info after double clicking.",
    { x: z.number(), y: z.number() },
    async ({ x, y }): Promise<ToolResponse> => {
      await chrome.doubleClick(x, y);
      const result: ToolResponse = { content: [{ type: "text", text: `Double clicked at (${x}, ${y})` }] };
      logToolUsage("doubleClick", { x, y }, result);
      return result;
    }
  );

  server.tool(
    "tripleClick",
    "Triple click at specific x,y coordinates in the browser window. Useful for selecting entire paragraphs or lines of text. Always check the page info after triple clicking.",
    { x: z.number(), y: z.number() },
    async ({ x, y }): Promise<ToolResponse> => {
      await chrome.tripleClick(x, y);
      const result: ToolResponse = { content: [{ type: "text", text: `Triple clicked at (${x}, ${y})` }] };
      logToolUsage("tripleClick", { x, y }, result);
      return result;
    }
  );

  // server.tool(
  //   "getText",
  //   "Get text content of an element matching the specified CSS selector",
  //   { selector: z.string() },
  //   async ({ selector }) => {
  //     const text = await chrome.getElementText(selector);
  //     return { content: [{ type: "text", text }] };
  //   }
  // );

  server.tool(
    "getPageInfo",
    "Get semantic information about the current page, including interactive elements, their indices, and all the text content on the page. Returns a diff from one of the previous calls if available and if the diff is smaller than the full content. If you're missing context of the element indices, refer to one of your previous pageInfo results. If page info is fully incomplete, or you don't have context of the element indices, or previous page info results, use the force flag to try again. WARNING: don't use the force flag unless you're sure you need it. You can also use the search and percent flags to search for a specific term and navigate to a specific percentage of the page. Use evaluate to execute JavaScript code in order to udnerstand where in the viewport you are and infer the percent if needed. This is useful when navigating anchor links.",
    { 
      force: z.boolean().optional(),
      cursor: z.number().optional(),
      remainingPages: z.number().optional(),
      search: z.string().optional(),
      percent: z.number().optional()
    },
    async ({ force = false, cursor = 0, remainingPages = 1, search, percent }): Promise<ToolResponse> => {
      const PAGE_SIZE = 10 * 1024; // 10KB per page
      const CONTEXT_SIZE = 100; // Characters of context around search matches
      const currentPageInfo = await chrome.getPageInfo();

      // Helper function to get text chunk by percentage
      const getTextByPercent = (text: string, percentage: number) => {
        if (percentage < 0 || percentage > 100) return 0;
        return Math.floor((text.length * percentage) / 100);
      };

      // Helper function to get search results with context
      const getSearchResults = (text: string, searchTerm: string) => {
        if (!searchTerm) return null;

        const results: { start: number; end: number; text: string }[] = [];
        const regex = new RegExp(searchTerm, 'gi');
        let match;

        while ((match = regex.exec(text)) !== null) {
          const start = Math.max(0, match.index - CONTEXT_SIZE);
          const end = Math.min(text.length, match.index + match[0].length + CONTEXT_SIZE);
          
          // Merge with previous section if they overlap
          if (results.length > 0 && start <= results[results.length - 1].end) {
            results[results.length - 1].end = end;
          } else {
            results.push({ start, end, text: text.slice(start, end) });
          }
        }

        if (results.length === 0) return null;

        return results.map(({ start, end, text }) => {
          return `---- Match at position ${start}-${end} ----\n${text}`;
        }).join('\n');
      };

      // Helper function to paginate text
      const paginateText = (text: string, start: number, pageSize: number) => {
        const end = start + pageSize;
        const chunk = text.slice(start, end);
        const hasMore = end < text.length;
        const nextCursor = hasMore ? end : -1;
        const remainingSize = Math.ceil((text.length - end) / pageSize);
        return { chunk, nextCursor, remainingSize };
      };

      // Handle percentage-based navigation
      if (typeof percent === 'number') {
        cursor = getTextByPercent(currentPageInfo, percent);
      }

      // If force is true or there's no previous page info, return the paginated full content
      if (force || !lastPageInfo) {
        lastPageInfo = currentPageInfo;
        
        // If search is specified, return search results
        if (search) {
          const searchResults = getSearchResults(currentPageInfo, search);
          if (!searchResults) {
            return { content: [{ type: "text", text: `No matches found for "${search}"` }] };
          }
          const { chunk, nextCursor, remainingSize } = paginateText(searchResults, cursor, PAGE_SIZE);
          const paginationInfo = nextCursor >= 0 ? 
            `\n[Page info: next_cursor=${nextCursor}, remaining_pages=${remainingSize}]` : 
            '\n[Page info: end of content]';
          
          const result: ToolResponse = { content: [{ type: "text", text: chunk + paginationInfo }] };
          logToolUsage("getPageInfo", { force, cursor, remainingPages, search, percent }, result);
          return result;
        }

        const { chunk, nextCursor, remainingSize } = paginateText(currentPageInfo, cursor, PAGE_SIZE);
        const paginationInfo = nextCursor >= 0 ? 
          `\n[Page info: next_cursor=${nextCursor}, remaining_pages=${remainingSize}]` : 
          '\n[Page info: end of content]';
        
        const result: ToolResponse = { content: [{ type: "text", text: chunk + paginationInfo }] };
        logToolUsage("getPageInfo", { force, cursor, remainingPages, search, percent }, result);
        return result;
      }

      // Calculate the diff between the last and current page info
      const changes = diff.diffWords(lastPageInfo, currentPageInfo);
      const diffText = changes
        .filter(part => part.added || part.removed)
        .map(part => {
          if (part.added) return `[ADDED] ${part.value}`;
          if (part.removed) return `[REMOVED] ${part.value}`;
          return '';
        })
        .join('\n');

      // Helper function to check if diff is meaningful
      const isNonMeaningfulDiff = (diff: string) => {
        // Check if diff is mostly just numbers
        const lines = diff.split('\n');
        const numericLines = lines.filter(line => {
          const value = line.replace(/\[ADDED\]|\[REMOVED\]/, '').trim();
          return /^\d+$/.test(value);
        });
        
        if (numericLines.length / lines.length > 0.5) {
          return true;
        }

        // Check if diff is too fragmented (lots of tiny changes)
        if (lines.length > 10 && lines.every(line => line.length < 10)) {
          return true;
        }

        return false;
      };

      // If the diff is larger than the current content or not meaningful, return the paginated full content
      if (diffText.length > currentPageInfo.length || isNonMeaningfulDiff(diffText)) {
        lastPageInfo = currentPageInfo;

        // If search is specified, return search results
        if (search) {
          const searchResults = getSearchResults(currentPageInfo, search);
          if (!searchResults) {
            return { content: [{ type: "text", text: `No matches found for "${search}"` }] };
          }
          const { chunk, nextCursor, remainingSize } = paginateText(searchResults, cursor, PAGE_SIZE);
          const paginationInfo = nextCursor >= 0 ? 
            `\n[Page info: next_cursor=${nextCursor}, remaining_pages=${remainingSize}]` : 
            '\n[Page info: end of content]';

          const result: ToolResponse = { content: [{ type: "text", text: chunk + paginationInfo }] };
          logToolUsage("getPageInfo", { force, cursor, remainingPages, search, percent }, result);
          return result;
        }

        const { chunk, nextCursor, remainingSize } = paginateText(currentPageInfo, cursor, PAGE_SIZE);
        const paginationInfo = nextCursor >= 0 ? 
          `\n[Page info: next_cursor=${nextCursor}, remaining_pages=${remainingSize}]` : 
          '\n[Page info: end of content]';

        const result: ToolResponse = { content: [{ type: "text", text: chunk + paginationInfo }] };
        logToolUsage("getPageInfo", { force, cursor, remainingPages, search, percent }, result);
        return result;
      }

      // Update the last page info and return the paginated diff
      lastPageInfo = currentPageInfo;
      const baseText = diffText || 'No changes detected';

      // If search is specified, return search results from the diff
      if (search) {
        const searchResults = getSearchResults(baseText, search);
        if (!searchResults) {
          return { content: [{ type: "text", text: `No matches found for "${search}"` }] };
        }
        const { chunk, nextCursor, remainingSize } = paginateText(searchResults, cursor, PAGE_SIZE);
        const paginationInfo = nextCursor >= 0 ? 
          `\n[Page info: next_cursor=${nextCursor}, remaining_pages=${remainingSize}]` : 
          '\n[Page info: end of content]';

        const result: ToolResponse = { content: [{ type: "text", text: chunk + paginationInfo }] };
        logToolUsage("getPageInfo", { force, cursor, remainingPages, search, percent }, result);
        return result;
      }

      const { chunk, nextCursor, remainingSize } = paginateText(baseText, cursor, PAGE_SIZE);
      const paginationInfo = nextCursor >= 0 ? 
        `\n[Page info: next_cursor=${nextCursor}, remaining_pages=${remainingSize}]` : 
        '\n[Page info: end of content]';

      const result: ToolResponse = { content: [{ type: "text", text: chunk + paginationInfo }] };
      logToolUsage("getPageInfo", { force, cursor, remainingPages, search, percent }, result);
      return result;
    }
  );

  // server.tool(
  //   "getPageState",
  //   "Get current page state including URL, title, scroll position, and viewport size",
  //   {},
  //   async () => {
  //     const state = await chrome.getPageState();
  //     return { content: [{ type: "text", text: JSON.stringify(state) }] };
  //   }
  // );

  server.tool(
    "goBack",
    "Navigate back one step in the browser history",
    {},
    async (): Promise<ToolResponse> => {
      await chrome.goBack();
      const result: ToolResponse = { content: [{ type: "text", text: "Navigated back" }] };
      logToolUsage("goBack", {}, result);
      return result;
    }
  );

  server.tool(
    "goForward",
    "Navigate forward one step in the browser history",
    {},
    async (): Promise<ToolResponse> => {
      await chrome.goForward();
      const result: ToolResponse = { content: [{ type: "text", text: "Navigated forward" }] };
      logToolUsage("goForward", {}, result);
      return result;
    }
  );

  server.tool(
    "evaluate",
    "Execute JavaScript code in the context of the current page",
    { expression: z.string() },
    async ({ expression }): Promise<ToolResponse> => {
      const result = await chrome.evaluate(expression);
      const response: ToolResponse = { content: [{ type: "text", text: JSON.stringify(result) }] };
      logToolUsage("evaluate", { expression }, response);
      return response;
    }
  );

  // Create Express app
  const app = express();
  app.use(cors());

  // Store active transports
  const transports: {[sessionId: string]: SSEServerTransport} = {};

  // SSE endpoint for client connectiWons
  app.get("/sse", async (_: Request, res: Response) => {
    const transport = new SSEServerTransport('/messages', res);
    transports[transport.sessionId] = transport;
    
    // Clean up when connection closes
    res.on("close", () => {
      delete transports[transport.sessionId];
    });

    // Connect the transport to our MCP server
    await server.connect(transport);
  });

  // Endpoint for receiving messages from clients
  app.post("/messages", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports[sessionId];

    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(400).send('No transport found for sessionId');
    }
  });

  // Start the server
  const port = 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`MCP Server running at http://localhost:${port}`);
    console.log(`SSE endpoint: http://localhost:${port}/sse`);
    console.log(`Messages endpoint: http://localhost:${port}/messages`);
  });

  // Handle cleanup
  process.on('SIGINT', async () => {
    await chrome.close();
    process.exit(0);
  });
}

// Start the server
startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
