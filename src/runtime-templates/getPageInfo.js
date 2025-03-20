(() => {
  try {
    // Helper to truncate text
    const truncateText = (text, maxLength = 100) => {
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength) + '...';
    };

    // Store interactive elements in global array
    if (!window._mcp_elements) window._mcp_elements = [];
    window._mcp_elements = [];

    // Helper to get text content
    const getText = el => {
      const text = el.textContent || el.value || el.placeholder || '';
      return truncateText(text.replace(/\s+/g, ' ').trim());
    };
    
    // Helper to check visibility
    const isVisible = el => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && 
             style.visibility !== 'hidden' && 
             style.opacity !== '0' &&
             rect.width > 0 && rect.height > 0;
    };

    // Helper to get element position info
    const getPosition = el => {
      const rect = el.getBoundingClientRect();
      return {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        bottom: rect.bottom + window.scrollY,
        right: rect.right + window.scrollX
      };
    };

    // Helper to get image info
    const getImageInfo = img => {
      if (!isVisible(img)) return '';
      const alt = img.getAttribute('alt') || '';
      const src = img.getAttribute('src') || '';
      return alt ? truncateText(`[Image: ${alt}]`) : src ? '[Image]' : '';
    };

    // Initialize textNodes array before first pass
    const textNodes = [];

    // First pass: collect interactive elements
    Array.from(document.querySelectorAll('a, button, input, select, textarea'))
      .filter(isVisible)
      .forEach((el, idx) => {
        window._mcp_elements[idx] = el;
        const type = el.tagName.toLowerCase();
        const rect = el.getBoundingClientRect();
        const x = Math.round(rect.left + rect.width/2);
        const y = Math.round(rect.top + rect.height/2);
        
        let interactiveText = '';
        if (type === 'a') {
          const text = getText(el);
          interactiveText = text ? `[a:${idx}](${text})` : `[a:${idx}]{${el.className || 'link'}}`;
        } else if (type === 'button') {
          const text = getText(el);
          interactiveText = text ? `[button:${idx}](${text})` : `[button:${idx}]{${el.className || 'button'}}`;
        } else if (type === 'input') {
          const inputType = el.type || 'text';
          const label = el.labels?.[0]?.textContent?.trim();
          const placeholder = el.placeholder;
          const text = label || placeholder || getText(el);
          interactiveText = text ? `[input:${idx}](${text})` : `[input:${idx}]{${el.className || inputType}}`;
        } else if (type === 'select') {
          const label = el.labels?.[0]?.textContent?.trim();
          const text = label || getText(el);
          interactiveText = text ? `[select:${idx}](${text})` : `[select:${idx}]{${el.className || 'select'}}`;
        } else if (type === 'textarea') {
          const label = el.labels?.[0]?.textContent?.trim();
          const text = label || getText(el);
          interactiveText = text ? `[textarea:${idx}](${text})` : `[textarea:${idx}]{${el.className || 'textarea'}}`;
        }
        
        if (interactiveText) {
          const pos = getPosition(el);
          textNodes.push({
            text: interactiveText,
            pos,
            isInteractive: true
          });
        }
      });

    // Second pass: collect all visible text nodes and their positions
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: node => {
          // Skip script and style elements
          if (node.parentElement?.tagName?.match(/^(SCRIPT|STYLE|NOSCRIPT|META|LINK)$/i)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = truncateText(node.textContent.replace(/\s+/g, ' ').trim());
        if (text && node.parentElement && isVisible(node.parentElement)) {
          const pos = getPosition(node.parentElement);
          textNodes.push({ text, pos, isInteractive: false });
        }
      } else if (node.tagName === 'IMG' && isVisible(node)) {
        const imgText = getImageInfo(node);
        if (imgText) {
          const pos = getPosition(node);
          textNodes.push({ text: imgText, pos, isInteractive: false });
        }
      }
    }

    // Sort nodes by position (top to bottom, left to right)
    textNodes.sort((a, b) => {
      // Use a threshold for considering nodes to be on the same "line"
      const LINE_THRESHOLD = 10;
      const verticalDiff = a.pos.top - b.pos.top;
      
      if (Math.abs(verticalDiff) <= LINE_THRESHOLD) {
        // If nodes are roughly on the same line, sort left to right
        return a.pos.left - b.pos.left;
      }
      // Otherwise sort top to bottom
      return verticalDiff;
    });

    // Group text nodes into lines and sections
    const lines = [];
    let currentLine = [];
    let lastTop = -1;
    const LINE_SPACING = 30; // Threshold for new line detection
    const SECTION_SPACING = 100; // Threshold for new section detection

    textNodes.forEach(node => {
      if (lastTop === -1) {
        currentLine.push(node.text);
      } else {
        const topDiff = node.pos.top - lastTop;
        
        if (topDiff > SECTION_SPACING) {
          // Add double line break for new sections
          if (currentLine.length > 0) {
            lines.push(currentLine.join(' '));
            lines.push('');
            lines.push('');
          }
          currentLine = [node.text];
        } else if (topDiff > LINE_SPACING) {
          // Add single line break for new lines
          if (currentLine.length > 0) {
            lines.push(currentLine.join(' '));
            lines.push('');
          }
          currentLine = [node.text];
        } else {
          // Add to current line with space
          currentLine.push(node.text);
        }
      }
      lastTop = node.pos.top;
    });

    // Add final line if any
    if (currentLine.length > 0) {
      lines.push(currentLine.join(' '));
    }

    // Build the final output
    const output = [
      `# ${document.title}\n`,
      `URL: ${window.location.href}\n`,
      `# Page Content\n`,
      ...lines
    ];

    return { success: true, result: output.join('\n') };
  } catch (error) {
    return { 
      success: false, 
      error: error.message || 'Error extracting page information'
    };
  }
})()