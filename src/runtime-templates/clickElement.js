(() => {
  const idx = parseInt('${selector}');
  const element = window._mcp_elements[idx];
  if (!element) return null;
  
  // Add highlight styles if not already added
  if (!document.getElementById('mcp-highlight-styles')) {
    const style = document.createElement('style');
    style.id = 'mcp-highlight-styles';
    style.textContent = `
      @keyframes mcpHighlight {
        0% { box-shadow: 0 0 0 2px rgba(62, 184, 255, 0); }
        20% { box-shadow: 0 0 0 2px rgba(62, 184, 255, 0.8); }
        100% { box-shadow: 0 0 0 2px rgba(62, 184, 255, 0); }
      }
      .mcp-highlight {
        animation: mcpHighlight 1s ease-out;
        position: relative;
        z-index: 10000;
      }
    `;
    document.head.appendChild(style);
  }

  console.log('[MCP Browser] Starting click sequence for element:', element);
  console.log('[MCP Browser] Element text content:', element.textContent);
  
  // Scroll element into view with some padding
  const rect = element.getBoundingClientRect();
  const padding = 100; // pixels of padding
  const targetY = window.scrollY + rect.top - padding;
  
  console.log('[MCP Browser] Scrolling to position:', targetY);
  window.scrollTo({
    top: targetY,
    behavior: 'smooth'
  });

  // Add highlight class
  element.classList.add('mcp-highlight');

  // Wait for scroll to complete and add delay before click
  return new Promise(resolve => {
    console.log('[MCP Browser] Waiting for scroll and delay...');
    setTimeout(() => {
      const updatedRect = element.getBoundingClientRect();
      const x = Math.round(updatedRect.left + updatedRect.width / 2);
      const y = Math.round(updatedRect.top + updatedRect.height / 2);

      console.log('[MCP Browser] Element position after scroll:', { x, y });

      // Trigger focus events for input elements
      if (element.tagName.toLowerCase().match(/^(input|textarea|select)$/)) {
        console.log('[MCP Browser] Focusing form element');
        element.focus();
        element.click();
        // For text inputs, also select all text
        if (element.type === 'text' || element.type === 'number') {
          element.select();
        }
      }

      // Remove highlight class after animation
      setTimeout(() => {
        element.classList.remove('mcp-highlight');
      }, 1000);
      
      resolve({ x, y });
    }, 1000); // Increased delay to 1 second after scroll
  });
})()