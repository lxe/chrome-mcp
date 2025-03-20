import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import { ChromeInterface } from './chrome-interface';

// Store sessions by sessionId => { sseRes, initialized: boolean }
interface SessionData {
  sseRes: any;
  initialized: boolean;
}

const sessions = new Map<string, SessionData>();

// MCP Server implementation
async function startMCPServer() {
  const app = express();
  const chrome = new ChromeInterface();

  // Enable CORS and JSON parsing
  app.use(cors());
  app.use(express.json());

  // Connect to Chrome
  const connected = await chrome.connect();
  if (!connected) {
    throw new Error('Failed to connect to Chrome');
  }

  // SSE endpoint
  app.get('/sse-cursor', (req, res) => {
    console.log('[MCP] SSE => /sse-cursor connected');

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Generate sessionId
    const sessionId = uuidv4();
    sessions.set(sessionId, { sseRes: res, initialized: false });
    console.log('[MCP] Created sessionId:', sessionId);

    // Send endpoint event
    res.write(`event: endpoint\n`);
    res.write(`data: /message?sessionId=${sessionId}\n\n`);

    // Heartbeat
    const hb = setInterval(() => {
      res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
    }, 10000);

    // Cleanup
    req.on('close', () => {
      clearInterval(hb);
      sessions.delete(sessionId);
      console.log('[MCP] SSE closed => sessionId=', sessionId);
    });
  });

  // Message endpoint
  app.post('/message', async (req, res) => {
    console.log('[MCP] POST /message => body:', req.body, ' query:', req.query);

    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId in ?sessionId=...' });
    }

    const sessionData = sessions.get(sessionId);
    if (!sessionData) {
      return res.status(404).json({ error: 'No SSE session with that sessionId' });
    }

    const rpc = req.body;
    if (!rpc || rpc.jsonrpc !== '2.0' || !rpc.method) {
      return res.json({
        jsonrpc: '2.0',
        id: rpc?.id ?? null,
        error: {
          code: -32600,
          message: 'Invalid JSON-RPC request',
        },
      });
    }

    // Minimal HTTP ack
    res.json({
      jsonrpc: '2.0',
      id: rpc.id,
      result: { ack: `Received ${rpc.method}` },
    });

    const sseRes = sessionData.sseRes;
    if (!sseRes) {
      console.log('[MCP] No SSE response found => sessionId=', sessionId);
      return;
    }

    switch (rpc.method) {
      case 'initialize': {
        sessionData.initialized = true;
        const initCaps = {
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: { listChanged: true },
              resources: { subscribe: true, listChanged: true },
              prompts: { listChanged: true },
              logging: {},
            },
            serverInfo: {
              name: 'chrome-mcp',
              version: '1.0.0',
            },
          },
        };
        sseRes.write(`event: message\n`);
        sseRes.write(`data: ${JSON.stringify(initCaps)}\n\n`);
        console.log('[MCP] SSE => event: message => init caps => sessionId=', sessionId);
        return;
      }

      case 'tools/list': {
        const toolsMsg = {
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            tools: [
              {
                name: 'navigate',
                description: 'Navigate to a URL',
                inputSchema: {
                  type: 'object',
                  properties: {
                    url: { type: 'string', format: 'url' },
                  },
                  required: ['url'],
                },
              },
              {
                name: 'click',
                description: 'Click at coordinates (x,y)',
                inputSchema: {
                  type: 'object',
                  properties: {
                    x: { type: 'number' },
                    y: { type: 'number' },
                  },
                  required: ['x', 'y'],
                },
              },
              {
                name: 'clickElement',
                description: 'Click an element by CSS selector. IMPORTANT: Element indices will change after page loads, clicks, or form submissions. You MUST call getPageInfo after this command to get updated element indices.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    selector: { type: 'string' },
                  },
                  required: ['selector'],
                },
              },
              {
                name: 'type',
                description: 'Type text into the currently focused element. Before using this tool, ensure you have first clicked/focused the target element and cleared any existing text if needed. You can use {Tab} to move between fields, {Enter} to submit forms, and {Backspace} or {Delete} to clear text. IMPORTANT: Element indices will change after typing {Enter} or form submissions. You MUST call getPageInfo after this command to get updated element indices.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                  },
                  required: ['text'],
                },
              },
              {
                name: 'getText',
                description: 'Get text content of an element',
                inputSchema: {
                  type: 'object',
                  properties: {
                    selector: { type: 'string' },
                  },
                  required: ['selector'],
                },
              },
              {
                name: 'getPageInfo',
                description: 'Get semantic information about the page including interactive elements and text nodes\n\n# How to Interact with Elements\nInteractive elements are marked with [ElementType N: description] where N is the element index.\nTo interact with an element, use its index N with the appropriate command:\n- To click: Use clickElement with selector "N"\n- To type: First click the element, then use the type command\n- Each element shows its position as (x,y) coordinates which can also be used with the click command',
                inputSchema: {
                  type: 'object',
                  properties: {},
                },
              },
              {
                name: 'getPageState',
                description: 'Get current page state including URL, title, scroll position, and viewport size',
                inputSchema: {
                  type: 'object',
                  properties: {},
                },
              },
            ],
            count: 7,
          },
        };
        sseRes.write(`event: message\n`);
        sseRes.write(`data: ${JSON.stringify(toolsMsg)}\n\n`);
        console.log('[MCP] SSE => event: message => tools/list => sessionId=', sessionId);
        return;
      }

      case 'tools/call': {
        const toolName = rpc.params?.name;
        const args = rpc.params?.arguments || {};
        console.log('[MCP] tools/call => name=', toolName, 'args=', args);

        try {
          let result;
          switch (toolName) {
            case 'navigate':
              const navResult = await chrome.navigate(args.url);
              result = `Navigated to ${args.url}\n\n# Page Information\n${navResult.pageInfo}\n\n# Page State\nURL: ${navResult.pageState.url}\nTitle: ${navResult.pageState.title}\nReady State: ${navResult.pageState.readyState}\nScroll Position: (${navResult.pageState.scrollPosition.x}, ${navResult.pageState.scrollPosition.y})\nViewport Size: ${navResult.pageState.viewportSize.width}x${navResult.pageState.viewportSize.height}`;
              break;
            case 'click':
              await chrome.click(args.x, args.y);
              result = `Clicked at (${args.x}, ${args.y})`;
              break;
            case 'clickElement':
              await chrome.clickElement(args.selector);
              result = `Clicked element: ${args.selector}`;
              break;
            case 'type':
              await chrome.type(args.text);
              result = `Typed: ${args.text}`;
              break;
            case 'getText':
              const text = await chrome.getElementText(args.selector);
              result = text;
              break;
            case 'getPageInfo':
              result = await chrome.getPageInfo();
              break;
            case 'getPageState':
              const state = await chrome.getPageState();
              result = `URL: ${state.url}\nTitle: ${state.title}\nReady State: ${state.readyState}\nScroll Position: (${state.scrollPosition.x}, ${state.scrollPosition.y})\nViewport Size: ${state.viewportSize.width}x${state.viewportSize.height}`;
              break;
            default:
              throw new Error(`Unknown tool: ${toolName}`);
          }

          const callMsg = {
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: result
                },
              ],
            },
          };
          sseRes.write(`event: message\n`);
          sseRes.write(`data: ${JSON.stringify(callMsg)}\n\n`);
        } catch (error: any) {
          const callErr = {
            jsonrpc: '2.0',
            id: rpc.id,
            error: {
              code: -32000,
              message: error.message || 'Tool execution failed',
            },
          };
          sseRes.write(`event: message\n`);
          sseRes.write(`data: ${JSON.stringify(callErr)}\n\n`);
        }
        return;
      }

      case 'notifications/initialized': {
        console.log('[MCP] notifications/initialized => sessionId=', sessionId);
        return;
      }

      default: {
        console.log('[MCP] unknown method =>', rpc.method);
        const errObj = {
          jsonrpc: '2.0',
          id: rpc.id,
          error: {
            code: -32601,
            message: `Method '${rpc.method}' not recognized`,
          },
        };
        sseRes.write(`event: message\n`);
        sseRes.write(`data: ${JSON.stringify(errObj)}\n\n`);
        return;
      }
    }
  });

  // Start server
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`[MCP] Chrome MCP Server running on http://localhost:${port}`);
    console.log('GET  /sse-cursor => SSE => endpoint => /message?sessionId=...');
    console.log(
      'POST /message?sessionId=... => initialize => SSE => capabilities, tools/list => SSE => Tools, tools/call => SSE => result'
    );
  });

  // Handle cleanup
  process.on('SIGINT', async () => {
    await chrome.close();
    process.exit(0);
  });
}

// Start the server
startMCPServer().catch(console.error);
