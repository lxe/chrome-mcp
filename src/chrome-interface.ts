import CDP from 'chrome-remote-interface';
import fs from 'fs';
import path from 'path';

// Define return type for navigate method
interface NavigationResult {
  navigation: string;
  pageInfo: string;
  pageState: {
    url: string;
    title: string;
    readyState: string;
    scrollPosition: { x: number; y: number };
    viewportSize: { width: number; height: number };
  };
}

// Function to load template files
function loadTemplate(templateName: string): string {
  const TEMPLATES_DIR = path.join(__dirname, 'runtime-templates');
  try {
    return fs.readFileSync(path.join(TEMPLATES_DIR, `${templateName}.js`), 'utf-8');
  } catch (error) {
    console.error(`Failed to load template ${templateName}:`, error);
    throw error;
  }
}

// Chrome interface class to handle CDP interactions
export class ChromeInterface {
  private client: CDP.Client | null = null;
  private page: any | null = null;
  private templates: Record<string, string> = {};

  constructor() {
    // Load all templates at initialization
    this.loadTemplates();
  }

  private loadTemplates() {
    try {
      this.templates = {
        removeTargetAttributes: loadTemplate('removeTargetAttributes'),
        setupObservers: loadTemplate('setupObservers'),
        checkReadyState: loadTemplate('checkReadyState'),
        clickElement: loadTemplate('clickElement'),
        getPageInfo: loadTemplate('getPageInfo'),
        getPageState: loadTemplate('getPageState')
      };
      console.log('[Templates] Successfully loaded all runtime templates');
    } catch (error) {
      console.error('[Templates] Failed to load templates:', error);
      throw error;
    }
  }

  async connect() {
    try {
      this.client = await CDP();
      const { Page, DOM, Input, Runtime } = this.client;
      this.page = Page;

      // Enable necessary domains
      await Promise.all([
        Page.enable(),
        DOM.enable(),
        // @ts-ignore - CDP types are not complete for Input domain
        // Input.enable(),
        Runtime.enable(),
      ]);

      // Set up listeners for page load events
      Page.loadEventFired(async () => {
        console.log('[Page Load] Load event fired, waiting for network idle...');
        // Wait a short time for any dynamic content
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Ensure all links don't open in new windows/tabs immediately after page load
        await Runtime.evaluate({
          expression: this.templates.removeTargetAttributes
        });
        
        await this.injectMCPElements();
      });

      // Listen for XHR/fetch completion which might update the DOM
      // @ts-ignore - CDP types are not complete
      await this.client.Network.enable();
      // @ts-ignore - CDP types are not complete
      this.client.Network.loadingFinished(async () => {
        console.log('[Network] Loading finished, updating MCP elements...');
        // Wait a short time for DOM updates
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Ensure all links don't open in new windows/tabs after network requests
        await Runtime.evaluate({
          expression: this.templates.removeTargetAttributes
        });
        
        await this.injectMCPElements();
      });

      // Listen for DOM mutations that might add new interactive elements
      await Runtime.evaluate({
        expression: this.templates.setupObservers
      });

      // Periodically check if DOM mutations flagged need for update
      setInterval(async () => {
        const needsUpdate = await Runtime.evaluate({
          expression: 'window._mcp_needs_update === true'
        });
        
        if (needsUpdate.result.value) {
          console.log('[MCP] Updating elements due to DOM mutation');
          await Runtime.evaluate({
            expression: 'window._mcp_needs_update = false'
          });
          await this.injectMCPElements();
        }
      }, 1000);

      return true;
    } catch (error) {
      console.error('Failed to connect to Chrome:', error);
      return false;
    }
  }

  async navigate(url: string, retryCount = 0): Promise<NavigationResult> {
    if (!this.client) throw new Error('Chrome not connected');
    const MAX_RETRIES = 2;
    const NAVIGATION_TIMEOUT = 5000; // 5 seconds
    const NAVIGATE_CALL_TIMEOUT = 10000; // 10 seconds timeout for the navigate() call itself
    
    console.log(`[Navigation] Starting navigation to ${url} (attempt ${retryCount + 1})`);
    
    try {
      // Start navigation with timeout
      console.log('[Navigation] Initiating page.navigate()');
      
      try {
        // Wrap navigate() in a timeout promise
        await Promise.race([
          this.page.navigate({ url }),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Navigate call timeout')), NAVIGATE_CALL_TIMEOUT);
          })
        ]);
        console.log('[Navigation] page.navigate() completed');
      } catch (navError) {
        console.error('[Navigation] Navigate call failed or timed out:', navError);
        
        // If navigate() hung or failed, create a new page
        console.log('[Navigation] Creating new page...');
        if (this.client) {
          const { Target } = this.client;
          
          // Create a new page
          const { targetId } = await Target.createTarget({ url: 'about:blank' });
          
          // Attach to the new page
          const { sessionId } = await Target.attachToTarget({ targetId, flatten: true });
          
          // Enable necessary domains on new page
          await Promise.all([
            this.client.Page.enable(),
            this.client.DOM.enable(),
            this.client.Runtime.enable(),
            // @ts-ignore - CDP types are not complete
            this.client.Network.enable()
          ]);
          
          // Update page reference
          this.page = this.client.Page;
          
          // Try navigation in new page
          console.log('[Navigation] Retrying navigation in new page');
          await this.page.navigate({ url });
        }
      }

      console.log('[Navigation] Setting up parallel wait conditions...');
      
      // Enable network monitoring first
      console.log('[Navigation] Enabling Network domain');
      // @ts-ignore - CDP types are not complete
      await this.client?.Network.enable();

      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Navigation timeout'));
        }, NAVIGATION_TIMEOUT);
      });

      // Wait for both load event and network idle with timeout
      try {
        console.log('[Navigation] Waiting for all conditions to be met...');
        await Promise.race([
          timeoutPromise,
          Promise.all([
            // 1. Load event
            this.page.loadEventFired().then(() => {
              console.log('[Navigation] ✓ Load event fired');
            }),

            // 2. Artificial delay
            new Promise(resolve => {
              console.log('[Navigation] Starting 1s grace period');
              setTimeout(() => {
                console.log('[Navigation] ✓ Grace period completed');
                resolve(true);
              }, 1000);
            }),

            // 3. Network idle
            // @ts-ignore - CDP types are not complete
            new Promise(resolve => {
              console.log('[Navigation] Waiting for network idle');
              // @ts-ignore - CDP types are not complete
              this.client?.Network.loadingFinished(() => {
                console.log('[Navigation] ✓ Network is idle');
                resolve(true);
              });
            })
          ])
        ]);
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'Navigation timeout' && retryCount < MAX_RETRIES) {
          console.log(`[Navigation] Timeout after ${NAVIGATION_TIMEOUT}ms, retrying... (${retryCount + 1}/${MAX_RETRIES})`);
          return this.navigate(url, retryCount + 1);
        }
        throw error;
      }

      console.log('[Navigation] All parallel conditions met, checking readyState...');

      // Additional wait for any dynamic content
      const readyStateResult = await this.client?.Runtime.evaluate({
        expression: this.templates.checkReadyState,
        awaitPromise: true
      });

      console.log('[Navigation] ReadyState check completed:', readyStateResult);
      
      // Wait for DOM mutations to stop firing or timeout after 10 seconds
      console.log('[Navigation] Waiting for DOM mutations to settle...');
      
      // Ensure mutation tracking variables are initialized
      await this.client?.Runtime.evaluate({
        expression: `
          if (window._mcp_last_mutation_time === undefined) {
            window._mcp_last_mutation_time = Date.now();
          }
          window._mcp_mutations_settled = false;
        `
      });
      
      await Promise.race([
        new Promise(async (resolve) => {
          // Set up an interval to check if mutations have stopped
          const checkInterval = setInterval(async () => {
            const result = await this.client?.Runtime.evaluate({
              expression: `
                const timeSinceLastMutation = Date.now() - window._mcp_last_mutation_time;
                if (timeSinceLastMutation > 1000) {
                  window._mcp_mutations_settled = true;
                  console.log('[MCP] DOM mutations have settled (no mutations for 1 second)');
                }
                window._mcp_mutations_settled;
              `
            });
            
            if (result?.result?.value === true) {
              clearInterval(checkInterval);
              resolve(true);
            }
          }, 500);
        }),
        new Promise(resolve => setTimeout(() => {
          console.log('[Navigation] DOM mutation wait timed out after 10 seconds, proceeding anyway');
          resolve(true);
        }, 10000))
      ]);
      
      console.log('[Navigation] Navigation completed successfully');

      // Get page info after navigation is complete
      const pageInfo = await this.getPageInfo();
      const pageState = await this.getPageState();

      return {
        navigation: `Navigated to ${url} (attempt ${retryCount + 1})`,
        pageInfo,
        pageState
      };

    } catch (error) {
      console.error('[Navigation] Error during navigation:', error);
      
      // If we haven't exceeded max retries, try again
      if (retryCount < MAX_RETRIES) {
        console.log(`[Navigation] Retrying navigation... (${retryCount + 1}/${MAX_RETRIES})`);
        return this.navigate(url, retryCount + 1);
      }
      
      throw error;
    }
  }

  async click(x: number, y: number) {
    if (!this.client) throw new Error('Chrome not connected');
    const { Input } = this.client;

    // Helper to dispatch mouse event with consistent parameters
    const dispatchMouseEvent = async (type: string, x: number, y: number, options: any = {}) => {
      // @ts-ignore - CDP types are not complete for Input domain
      await Input.dispatchMouseEvent({
        type,
        x,
        y,
        button: 'left',
        buttons: type === 'mouseMoved' ? 0 : 1,
        clickCount: (type === 'mousePressed' || type === 'mouseReleased' || type === 'mouseClicked') ? 1 : 0,
        ...options
      });
    };

    // 1. Move mouse to starting position (slightly off-target)
    await dispatchMouseEvent('mouseMoved', x - 50, y - 50);
    await new Promise(r => setTimeout(r, 100));

    // 2. Move mouse to target position (natural movement)
    await dispatchMouseEvent('mouseMoved', x, y);
    await new Promise(r => setTimeout(r, 100));

    // 3. Mouse down
    await dispatchMouseEvent('mousePressed', x, y);
    await new Promise(r => setTimeout(r, 50));

    // 4. Mouse up
    await dispatchMouseEvent('mouseReleased', x, y, { buttons: 0 });
    
    // 5. Small delay after click
    await new Promise(r => setTimeout(r, 50));
  }

  async type(text: string) {
    if (!this.client) throw new Error('Chrome not connected');
    const { Input } = this.client;

    // Define the type for special keys
    type SpecialKeyConfig = {
      key: string;
      code: string;
      text?: string;
      unmodifiedText?: string;
      windowsVirtualKeyCode: number;
      nativeVirtualKeyCode: number;
      autoRepeat: boolean;
      isKeypad: boolean;
      isSystemKey: boolean;
    };

    // Special key mapping with their proper key codes and other properties
    const specialKeys: Record<string, SpecialKeyConfig> = {
      Enter: {
        key: 'Enter',
        code: 'Enter',
        text: '\r',
        unmodifiedText: '\r',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        autoRepeat: false,
        isKeypad: false,
        isSystemKey: false,
      },
      Tab: {
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
        autoRepeat: false,
        isKeypad: false,
        isSystemKey: false,
      },
      Backspace: {
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
        nativeVirtualKeyCode: 8,
        autoRepeat: false,
        isKeypad: false,
        isSystemKey: false,
      },
      // Add other special keys as needed
    };

    // Split text into parts by special key patterns
    const parts = text.split(/(\{[^}]+\})/);

    for (const part of parts) {
      if (part.startsWith('{') && part.endsWith('}')) {
        // Handle special key
        const keyName = part.slice(1, -1);
        if (keyName in specialKeys) {
          const keyConfig = specialKeys[keyName];

          // Send keyDown event
          // @ts-ignore - CDP types are not complete for Input domain
          await Input.dispatchKeyEvent({
            type: 'keyDown',
            ...keyConfig,
          });

          // For Enter, also dispatch a char event
          if (keyName === 'Enter') {
            // @ts-ignore - CDP types are not complete for Input domain
            await Input.dispatchKeyEvent({
              type: 'char',
              text: '\r',
              unmodifiedText: '\r',
              windowsVirtualKeyCode: 13,
              nativeVirtualKeyCode: 13,
              autoRepeat: false,
              isKeypad: false,
              isSystemKey: false,
            });
          }

          // Send keyUp event
          // @ts-ignore - CDP types are not complete for Input domain
          await Input.dispatchKeyEvent({
            type: 'keyUp',
            ...keyConfig,
          });

          // Small delay after special keys
          await new Promise((resolve) => setTimeout(resolve, 50));

          // For Enter and Tab, wait longer and update page info since they often trigger changes
          if (keyName === 'Enter' || keyName === 'Tab') {
            await new Promise(resolve => setTimeout(resolve, 500));
            await this.injectMCPElements();
          }
        } else {
          // If not a recognized special key, type it literally
          for (const char of part) {
            // @ts-ignore - CDP types are not complete for Input domain
            await Input.dispatchKeyEvent({
              type: 'keyDown',
              text: char,
              unmodifiedText: char,
              key: char,
              code: `Key${char.toUpperCase()}`,
            });
            // @ts-ignore - CDP types are not complete for Input domain
            await Input.dispatchKeyEvent({
              type: 'keyUp',
              text: char,
              unmodifiedText: char,
              key: char,
              code: `Key${char.toUpperCase()}`,
            });
          }
        }
      } else {
        // Type regular text
        for (const char of part) {
          // @ts-ignore - CDP types are not complete for Input domain
          await Input.dispatchKeyEvent({
            type: 'keyDown',
            text: char,
            unmodifiedText: char,
            key: char,
            code: `Key${char.toUpperCase()}`,
          });
          // @ts-ignore - CDP types are not complete for Input domain
          await Input.dispatchKeyEvent({
            type: 'keyUp',
            text: char,
            unmodifiedText: char,
            key: char,
            code: `Key${char.toUpperCase()}`,
          });
        }
      }
    }

    // Wait a bit after typing and update page info
    await new Promise(resolve => setTimeout(resolve, 200));
    await this.injectMCPElements();
  }

  async getElementText(selector: string): Promise<string> {
    if (!this.client) throw new Error('Chrome not connected');
    const { Runtime } = this.client;

    const result = await Runtime.evaluate({
      expression: `document.querySelector('${selector}')?.textContent || ''`,
    });

    return result.result.value;
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.page = null;
    }
  }

  // Get semantic information about the page
  async getPageInfo() {
    if (!this.client) throw new Error('Chrome not connected');
    const { Runtime } = this.client;

    const result = await Runtime.evaluate({
      expression: this.templates.getPageInfo,
      returnByValue: true
    });

    if (!result.result.value?.success) {
      throw new Error(result.result.value?.error || 'Failed to extract page information');
    }

    return result.result.value.result;
  }

  // Enhanced click method that can use element references
  async clickElement(selector: string) {
    if (!this.client) throw new Error('Chrome not connected');
    const { Runtime } = this.client;

    // Get element position and trigger click and focus events
    const result = await Runtime.evaluate({
      expression: this.templates.clickElement.replace('${selector}', selector),
      awaitPromise: true,
      returnByValue: true
    });

    if (!result.result.value) {
      throw new Error(`Element not found: ${selector}`);
    }

    const { x, y } = result.result.value;
    await this.click(x, y);

    // Wait longer for any dynamic changes
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Update page info after click
    await this.injectMCPElements();
  }

  // Get the current page state (URL, title, etc)
  async getPageState() {
    if (!this.client) throw new Error('Chrome not connected');
    const { Runtime } = this.client;

    const result = await Runtime.evaluate({
      expression: this.templates.getPageState,
      returnByValue: true,
    });

    return result.result.value;
  }

  // Helper method to inject and populate _mcp_elements
  private async injectMCPElements() {
    if (!this.client?.Runtime) return;
    
    console.log('[MCP] Injecting MCP elements...');
    
    // Ensure all links don't open in new windows/tabs
    await this.client.Runtime.evaluate({
      expression: this.templates.removeTargetAttributes
    });
    
    // Get the page info which will populate _mcp_elements
    await this.getPageInfo();
    
    console.log('[MCP] MCP elements updated');
  }
}