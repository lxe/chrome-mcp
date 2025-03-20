import express, { Request, Response, Router, RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import { ChromeInterface } from './chrome-interface';
import { createPatch } from 'diff';

// Types
interface SessionData {
  sseRes: Response;
  initialized: boolean;
  lastPageInfo?: string; // Track last page info for diffing
}

interface PageState {
  url: string;
  title: string;
  readyState: string;
  scrollPosition: { x: number; y: number };
  viewportSize: { width: number; height: number };
}

interface JsonRpcRequest {
  jsonrpc: string;
  id: string | number | null;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

// Utility functions
function formatPageState(state: PageState): string {
  return `URL: ${state.url}
Title: ${state.title}
Ready State: ${state.readyState}
Scroll Position: (${state.scrollPosition.x}, ${state.scrollPosition.y})
Viewport Size: ${state.viewportSize.width}x${state.viewportSize.height}`;
}

function generateDiff(oldText: string, newText: string): string {
  const patch = createPatch('pageInfo', oldText, newText, 'previous', 'current');
  // Remove the file header lines and keep only the chunks
  const lines = patch.split('\n').slice(4);
  return lines.length > 1 ? lines.join('\n') : '# No changes detected';
}

function sendSseMessage(res: Response, message: JsonRpcResponse) {
  res.write(`event: message\n`);
  res.write(`data: ${JSON.stringify(message)}\n\n`);
}

function createJsonRpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message }
  };
}

function createJsonRpcSuccess(id: string | number | null, result: any): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: result }]
    }
  };
}

// Store sessions by sessionId => { sseRes, initialized: boolean }
const sessions = new Map<string, SessionData>();

// MCP Server implementation
async function startMCPServer() {
  const app = express();
  const router = Router();
  const chrome = new ChromeInterface();

  // Enable CORS and JSON parsing
  app.use(cors());
  app.use(express.json());
  app.use(router);

  // Connect to Chrome
  const connected = await chrome.connect();
  if (!connected) {
    throw new Error('Failed to connect to Chrome');
  }

  // SSE endpoint
  const sseHandler: RequestHandler = (req, res) => {
    console.log('[MCP] SSE => /sse connected');

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
  };

  // Message endpoint
  const messageHandler: RequestHandler = async (req, res) => {
    console.log('[MCP] POST /message => body:', req.body, ' query:', req.query);

    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.status(400).json(createJsonRpcError(null, -32600, 'Missing sessionId in ?sessionId=...'));
      return;
    }

    const sessionData = sessions.get(sessionId);
    if (!sessionData) {
      res.status(404).json(createJsonRpcError(null, -32600, 'No SSE session with that sessionId'));
      return;
    }

    const rpc = req.body as JsonRpcRequest;
    if (!rpc || rpc.jsonrpc !== '2.0' || !rpc.method) {
      res.json(createJsonRpcError(rpc?.id ?? null, -32600, 'Invalid JSON-RPC request'));
      return;
    }

    // Minimal HTTP ack
    res.json({
      jsonrpc: '2.0',
      id: rpc.id,
      result: { ack: `Received ${rpc.method}` }
    });

    const sseRes = sessionData.sseRes;
    if (!sseRes) {
      console.log('[MCP] No SSE response found => sessionId=', sessionId);
      return;
    }

    // Handle different methods
    try {
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
                logging: {}
              },
              serverInfo: {
                name: 'chrome-mcp',
                version: '1.0.0'
              }
            }
          };
          sendSseMessage(sseRes, initCaps);
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
                  description: 'Navigate to a URL. IMPORTANT: You MUST call getPageInfo after this command to get page content and interactive elements.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      url: { type: 'string', format: 'url' }
                    },
                    required: ['url']
                  }
                },
                {
                  name: 'click',
                  description: 'Click at coordinates (x,y). IMPORTANT: You MUST call getPageInfo after this command if the click resulted in page navigation or content changes.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      x: { type: 'number' },
                      y: { type: 'number' }
                    },
                    required: ['x', 'y']
                  }
                },
                {
                  name: 'clickElement',
                  description: 'Click an element by index. For text input fields, this will automatically clear any existing content. IMPORTANT: You MUST call getPageInfo after this command to get updated page content.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      index: { type: 'number' }
                    },
                    required: ['index']
                  }
                },
                {
                  name: 'type',
                  description: 'Type text into the currently focused element. Before using this tool, ensure you have first clicked/focused the target element and cleared any existing text if needed. You can use {Tab} to move between fields, {Enter} to submit forms, and {Backspace} or {Delete} to clear text. IMPORTANT: You MUST call getPageInfo after using {Enter} or form submissions.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      text: { type: 'string' }
                    },
                    required: ['text']
                  }
                },
                {
                  name: 'getText',
                  description: 'Get text content of an element.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      selector: { type: 'string' }
                    },
                    required: ['selector']
                  }
                },
                {
                  name: 'getPageInfo',
                  description: 'Get semantic information about the page including interactive elements and text nodes. This command should be called after every navigate, click, clickElement, type, or getText command that changes page content.\n\n# How to Interact with Elements\nInteractive elements are marked with [ElementType N: description] where N is the element index.\nTo interact with an element, use its index N with the appropriate command:\n- To click: Use clickElement with selector "N"\n- To type: First click the element, then use the type command\n- Each element shows its position as (x,y) coordinates which can also be used with the click command',
                  inputSchema: {
                    type: 'object',
                    properties: {}
                  }
                },
                {
                  name: 'getPageState',
                  description: 'Get current page state including URL, title, scroll position, and viewport size.',
                  inputSchema: {
                    type: 'object',
                    properties: {}
                  }
                },
                {
                  name: 'goBack',
                  description: 'Navigate back in browser history. IMPORTANT: You MUST call getPageInfo after this command.',
                  inputSchema: {
                    type: 'object',
                    properties: {}
                  }
                },
                {
                  name: 'goForward',
                  description: 'Navigate forward in browser history. IMPORTANT: You MUST call getPageInfo after this command.',
                  inputSchema: {
                    type: 'object',
                    properties: {}
                  }
                },
                {
                  name: 'evaluate',
                  description: 'Evaluate JavaScript code in the page context and return the result.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      expression: { type: 'string' }
                    },
                    required: ['expression']
                  }
                }
              ],
              count: 10
            }
          };
          sendSseMessage(sseRes, toolsMsg);
          console.log('[MCP] SSE => event: message => tools/list => sessionId=', sessionId);
          return;
        }

        case 'tools/call': {
          const toolName = rpc.params?.name;
          const args = rpc.params?.arguments || {};
          console.log('[MCP] tools/call => name=', toolName, 'args=', args);

          let result;
          switch (toolName) {
            case 'navigate': {
              const navResult = await chrome.navigate(args.url);
              result = `Navigated to ${args.url}\n\n# Page Information\n${navResult.pageInfo}\n\n# Page State\n${formatPageState(navResult.pageState)}`;
              break;
            }
            case 'click': {
              await chrome.click(args.x, args.y);
              result = `Clicked at (${args.x}, ${args.y})`;
              break;
            }
            case 'clickElement': {
              await chrome.clickElement(args.index);
              result = `Clicked element: ${args.index}`;
              break;
            }
            case 'type': {
              await chrome.type(args.text);
              result = `Typed: ${args.text}`;
              break;
            }
            case 'getText': {
              result = await chrome.getElementText(args.selector);
              break;
            }
            case 'getPageInfo': {
              const newPageInfo = await chrome.getPageInfo();
              const sessionData = sessions.get(sessionId);
              
              if (!sessionData) {
                throw new Error('Session not found');
              }

              if (sessionData.lastPageInfo) {
                // Generate diff and compare its size with new page info
                const diff = generateDiff(sessionData.lastPageInfo, newPageInfo);
                // Use the smaller of the two
                result = diff.length < newPageInfo.length ? diff : newPageInfo;
              } else {
                // First time, show full page info
                result = newPageInfo;
              }
              
              // Update last page info
              sessionData.lastPageInfo = newPageInfo;
              break;
            }
            case 'getPageState': {
              const state = await chrome.getPageState();
              result = formatPageState(state);
              break;
            }
            case 'goBack': {
              const backResult = await chrome.goBack();
              result = `${backResult.navigation}\n\n# Page Information\n${backResult.pageInfo}\n\n# Page State\n${formatPageState(backResult.pageState)}`;
              break;
            }
            case 'goForward': {
              const forwardResult = await chrome.goForward();
              result = `${forwardResult.navigation}\n\n# Page Information\n${forwardResult.pageInfo}\n\n# Page State\n${formatPageState(forwardResult.pageState)}`;
              break;
            }
            case 'evaluate': {
              const evalResult = await chrome.evaluate(args.expression);
              result = typeof evalResult === 'string' ? evalResult : JSON.stringify(evalResult);
              break;
            }
            default:
              throw new Error(`Unknown tool: ${toolName}`);
          }

          sendSseMessage(sseRes, createJsonRpcSuccess(rpc.id, result));
          return;
        }

        case 'notifications/initialized': {
          console.log('[MCP] notifications/initialized => sessionId=', sessionId);
          return;
        }

        default: {
          console.log('[MCP] unknown method =>', rpc.method);
          sendSseMessage(sseRes, createJsonRpcError(rpc.id, -32601, `Method '${rpc.method}' not recognized`));
          return;
        }
      }
    } catch (error: any) {
      sendSseMessage(sseRes, createJsonRpcError(rpc.id, -32000, error.message || 'Tool execution failed'));
    }
  };

  router.get('/sse', sseHandler);
  router.post('/message', messageHandler);

  // Start server
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`[MCP] Chrome MCP Server running on http://localhost:${port}`);
    console.log('GET  /sse => SSE => endpoint => /message?sessionId=...');
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
