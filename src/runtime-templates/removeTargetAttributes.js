// Find all links and remove target attributes
document.querySelectorAll('a').forEach(link => {
  if (link.hasAttribute('target')) {
    link.removeAttribute('target');
  }
});
console.log('[MCP Browser] Modified all links to prevent opening in new windows/tabs');