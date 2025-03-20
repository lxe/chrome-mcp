# Chrome MCP Server

A Model Context Protocol (MCP) server that provides fine-grained control over a Chrome browser instance through the Chrome DevTools Protocol (CDP).

## Prerequisites

- [Bun](https://bun.sh/) (recommended) or Node.js (v14 or higher)
- Chrome browser with remote debugging enabled

## Setup

### Installing Bun

1. Install Bun (if not already installed):
```bash
# macOS, Linux, or WSL
curl -fsSL https://bun.sh/install | bash

# Windows (using PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"

# Alternatively, using npm
npm install -g bun
```

2. Start Chrome with remote debugging enabled:

   ```bash
   # macOS
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

   # Windows
   start chrome --remote-debugging-port=9222

   # Linux
   google-chrome --remote-debugging-port=9222
   ```

3. Install dependencies:
```bash
bun install
```

4. Start the server:
```bash
bun start
```

For development with hot reloading:
```bash
bun dev
```

The server will start on port 3000 by default. You can change this by setting the `PORT` environment variable.

## Configuring Roo Code to use this MCP server

To use this Chrome MCP server with Roo Code:

1. Open Roo Code settings
2. Navigate to the MCP settings configuration file at:
   - macOS: `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json`
   - Windows: `%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\cline_mcp_settings.json`
   - Linux: `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json`

3. Add the following configuration to the `mcpServers` object:

```json
{
  "mcpServers": {
    "chrome-control": {
      "url": "http://localhost:3000/sse",
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
```

4. Save the file and restart Roo Code to apply the changes.

5. You can now use the Chrome MCP tools in Roo Code to control the browser.

## Available Tools

The server provides the following tools for browser control:

### navigate
Navigate to a specific URL.

Parameters:
- `url` (string): The URL to navigate to

### click
Click at specific coordinates.

Parameters:
- `x` (number): X coordinate
- `y` (number): Y coordinate

### type
Type text at the current focus.

Parameters:
- `text` (string): Text to type

### clickElement
Click on an element by its index in the page info.

Parameters:
- `selector` (string): Element index (e.g., "0" for the first element)

### getText
Get text content of an element using a CSS selector.

Parameters:
- `selector` (string): CSS selector to find the element

### getPageInfo
Get semantic information about the page including interactive elements and text nodes.

### getPageState
Get current page state including URL, title, scroll position, and viewport size.

## Usage

The server implements the Model Context Protocol with SSE transport. Connect to the server at:
- SSE endpoint: `http://localhost:3000/sse`
- Messages endpoint: `http://localhost:3000/message?sessionId=...`

When using with Roo Code, the configuration in the MCP settings file will handle the connection automatically.

## Development

To run the server in development mode with hot reloading:
```bash
bun dev
```

This uses Bun's built-in watch mode to automatically restart the server when files change.

## License

MIT 