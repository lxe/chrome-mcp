// Initialize mutation tracking variables if they don't exist
if (window._mcp_last_mutation_time === undefined) {
  window._mcp_last_mutation_time = Date.now();
  window._mcp_mutations_settled = false;
}

if (!window._mcp_observer) {
  window._mcp_observer = new MutationObserver((mutations) => {
    // Update the last mutation time
    window._mcp_last_mutation_time = Date.now();
    window._mcp_mutations_settled = false;
    
    // Check if mutations added any interactive elements
    const hasNewInteractive = mutations.some(mutation =>
      Array.from(mutation.addedNodes).some(node =>
        node.nodeType === 1 &&
        node.matches?.('a, button, input, select, textarea')
      )
    );
    
    if (hasNewInteractive) {
      console.log('[MCP] DOM mutation added interactive elements');
      // Signal that we need to update _mcp_elements
      window._mcp_needs_update = true;
    }
  });

  window._mcp_observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Add a dedicated observer for links to immediately modify any new links
if (!window._mcp_link_observer) {
  window._mcp_link_observer = new MutationObserver((mutations) => {
    // Update the last mutation time
    window._mcp_last_mutation_time = Date.now();
    window._mcp_mutations_settled = false;
    
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        // Check if the added node is an element
        if (node.nodeType === 1) {
          // If it's a link, remove target attribute
          if (node.nodeName === 'A' && node.hasAttribute('target')) {
            node.removeAttribute('target');
          }
          
          // Also check for links within the added node
          if (node.querySelectorAll) {
            node.querySelectorAll('a[target]').forEach(link => {
              link.removeAttribute('target');
            });
          }
        }
      });
    });
  });
  
  window._mcp_link_observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['target']
  });
  
  console.log('[MCP Browser] Link observer installed to prevent opening in new windows/tabs');
}