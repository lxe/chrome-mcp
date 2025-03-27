import express, { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import cors from "cors";
import * as diff from 'diff';
import { ChromeInterface } from './chrome-interface';

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
    async ({ url }) => {
      await chrome.navigate(url);
      return { content: [{ type: "text", text: `Navigated to ${url}` }] };
    }
  );

  server.tool(
    "click",
    "Click at specific x,y coordinates in the browser window. IMPORTANT: Always check the page info after clicking. When interacting with dropdowns, use ArrowUp and ArrowDown keys. Try to figure out what the selected item is when interacting with the dropdowns and use that to navigate.",
    { x: z.number(), y: z.number() },
    async ({ x, y }) => {
      await chrome.click(x, y);
      // Delay for 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));
      return { content: [{ type: "text", text: `Clicked at (${x}, ${y})` }] };
    }
  );

  server.tool(
    "clickElementByIndex",
    "Click an interactive element by its index in the page. Indices are returned by getPageInfo. Always check the page info after clicking. For text input fields, prefer using focusElementByIndex instead.",
    { index: z.number() },
    async ({ index }) => {
      await chrome.clickElementByIndex(index);
      return { content: [{ type: "text", text: `Clicked element at index: ${index}` }] };
    }
  );

  server.tool(
    "focusElementByIndex",
    "Focus an interactive element by its index in the page. Indices are returned by getPageInfo. This is the preferred method for focusing text input fields before typing. Always check the page info after focusing.",
    { index: z.number() },
    async ({ index }) => {
      await chrome.focusElementByIndex(index);
      return { content: [{ type: "text", text: `Focused element at index: ${index}` }] };
    }
  );

  server.tool(
    "type",
    "Type text into the currently focused element, with support for special keys like {Enter}, {Tab}, etc. Use {Enter} for newlines in textareas or to submit forms. NEVER USE \n\n IN THE TEXT YOU TYPE. Use {Ctrl+A} to select all text in the focused element. If you think you're in a rich text editor, you probably can use {Ctrl+B} to bold, {Ctrl+I} to italic, {Ctrl+U} to underline, etc. IMPORTANT: Always use focusElementByIndex on text input fields before typing. ALSO IMPORTANT. NEVER RELY ON TABS AT ALL TO FOCUS ELEMENTS. EXPLICITLY USE focusElementByIndex ON ELEMENTS BEFORE TYPING. ALSO, ALWAYS CHECK THE PAGE INFO AFTER TYPING. Always check the page info after typing.",
    { text: z.string() },
    async ({ text }) => {
      await chrome.type(text);
      return { content: [{ type: "text", text: `Typed: ${text}` }] };
    }
  );

  server.tool(
    "doubleClick",
    "Double click at specific x,y coordinates in the browser window. Useful for text selection or other double-click specific actions. Always check the page info after double clicking.",
    { x: z.number(), y: z.number() },
    async ({ x, y }) => {
      await chrome.doubleClick(x, y);
      return { content: [{ type: "text", text: `Double clicked at (${x}, ${y})` }] };
    }
  );

  server.tool(
    "tripleClick",
    "Triple click at specific x,y coordinates in the browser window. Useful for selecting entire paragraphs or lines of text. Always check the page info after triple clicking.",
    { x: z.number(), y: z.number() },
    async ({ x, y }) => {
      await chrome.tripleClick(x, y);
      return { content: [{ type: "text", text: `Triple clicked at (${x}, ${y})` }] };
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
    "Get semantic information about the current page, including interactive elements, their indices, and all the text content on the page. Returns a diff from one of the previous calls if available and if the diff is smaller than the full content. If you're missing context of the element indices, refer to one of your previous pageInfo results. If page info is fully incomplete, try again.",
    {},
    async () => {
      const currentPageInfo = await chrome.getPageInfo();

      // If there's no previous page info, return the full content
      if (!lastPageInfo) {
        lastPageInfo = currentPageInfo;
        return { content: [{ type: "text", text: currentPageInfo }] };
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

      // If the diff is larger than the current content or not meaningful, return the full content
      if (diffText.length > currentPageInfo.length || isNonMeaningfulDiff(diffText)) {
        lastPageInfo = currentPageInfo;
        return { content: [{ type: "text", text: currentPageInfo }] };
      }

      // Update the last page info and return the diff
      lastPageInfo = currentPageInfo;
      return { content: [{ type: "text", text: diffText || 'No changes detected' }] };
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
    async () => {
      await chrome.goBack();
      return { content: [{ type: "text", text: "Navigated back" }] };
    }
  );

  server.tool(
    "goForward",
    "Navigate forward one step in the browser history",
    {},
    async () => {
      await chrome.goForward();
      return { content: [{ type: "text", text: "Navigated forward" }] };
    }
  );

  server.tool(
    "evaluate",
    "Execute JavaScript code in the context of the current page",
    { expression: z.string() },
    async ({ expression }) => {
      const result = await chrome.evaluate(expression);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
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
  app.listen(port, () => {
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
