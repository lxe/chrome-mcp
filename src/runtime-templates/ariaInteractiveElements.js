(function () {
  function createTextRepresentation() {
    // Native interactive HTML elements that are inherently focusable/clickable
    const INTERACTIVE_ELEMENTS = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      'summary',
      'video[controls]',
      'audio[controls]',
    ];

    // Interactive ARIA roles that make elements programmatically interactive
    const INTERACTIVE_ROLES = [
      'button',
      'checkbox',
      'combobox',
      'gridcell',
      'link',
      'listbox',
      'menuitem',
      'menuitemcheckbox',
      'menuitemradio',
      'option',
      'radio',
      'searchbox',
      'slider',
      'spinbutton',
      'switch',
      'tab',
      'textbox',
      'treeitem',
    ];

    // Build complete selector for all interactive elements
    const completeSelector = [...INTERACTIVE_ELEMENTS, ...INTERACTIVE_ROLES.map((role) => `[role="${role}"]`)].join(
      ','
    );

    // Helper to get accessible name of an element following ARIA naming specs
    const getAccessibleName = (el) => {
      // First try explicit labels
      const explicitLabel = el.getAttribute('aria-label');
      if (explicitLabel) return explicitLabel;

      // Then try labelledby
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const labelElements = labelledBy.split(' ').map((id) => document.getElementById(id));
        const labelText = labelElements.map((labelEl) => (labelEl ? labelEl.textContent.trim() : '')).join(' ');
        if (labelText) return labelText;
      }

      // Then try title
      const title = el.getAttribute('title');
      if (title) return title;

      // For inputs, use value
      if (el.tagName.toLowerCase() === 'input') {
        return el.getAttribute('value') || el.value || '';
      }

      // For other elements, get direct text content only (not nested element text)
      let textContent = '';
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.trim();
          if (text) textContent += (textContent ? ' ' : '') + text;
        }
      }
      return textContent || '';
    };

    // Constants for text representation layout
    const CHAR_WIDTH = 8;
    const LINE_HEIGHT = 20;

    const interactiveElements = [];

    // Find all interactive elements in DOM order
    const findInteractiveElements = () => {
      // Clear existing elements
      interactiveElements.length = 0;
      
      // First find all native buttons and interactive elements
      document.querySelectorAll(completeSelector).forEach(node => {
        if (
          node.getAttribute('aria-hidden') !== 'true' &&
          !node.hasAttribute('disabled') &&
          !node.hasAttribute('inert') &&
          window.getComputedStyle(node).display !== 'none' &&
          window.getComputedStyle(node).visibility !== 'hidden'
        ) {
          interactiveElements.push(node);
        }
      });

      // Then use TreeWalker for any we might have missed
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (node) => {
          if (
            !interactiveElements.includes(node) && // Skip if already found
            node.matches(completeSelector) &&
            node.getAttribute('aria-hidden') !== 'true' &&
            !node.hasAttribute('disabled') &&
            !node.hasAttribute('inert') &&
            window.getComputedStyle(node).display !== 'none' &&
            window.getComputedStyle(node).visibility !== 'hidden'
          ) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        },
      });

      let node;
      while ((node = walker.nextNode())) {
        if (!interactiveElements.includes(node)) {
          interactiveElements.push(node);
        }
      }
    };

    // Create text representation of the page with interactive elements
    const createTextRepresentation = () => {
      const output = [];
      const processedElements = new Set();
      const LINE_HEIGHT = 20; // Base line height
      const MIN_GAP_FOR_NEWLINE = LINE_HEIGHT * 1.2; // Gap threshold for newline
      const HORIZONTAL_GAP = 50; // Minimum horizontal gap to consider elements on different lines

      // Helper to get element's bounding box
      const getBoundingBox = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getBoundingClientRect();
        }
        return node.getBoundingClientRect();
      };

      // Store nodes with their positions for sorting
      const nodePositions = [];

      // Process all nodes in DOM order
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          // Skip script/style elements and their contents
          if (
            node.nodeType === Node.ELEMENT_NODE &&
            (node.tagName.toLowerCase() === 'script' || 
             node.tagName.toLowerCase() === 'style' ||
             node.tagName.toLowerCase() === 'head' ||
             node.tagName.toLowerCase() === 'meta' ||
             node.tagName.toLowerCase() === 'link')
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      let node;
      while ((node = walker.nextNode())) {
        // Handle text nodes
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.trim();
          if (!text) continue;

          // Skip text in hidden elements
          let parent = node.parentElement;
          let isHidden = false;
          let isInsideProcessedInteractive = false;
          while (parent) {
            const style = window.getComputedStyle(parent);
            if (
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              parent.getAttribute('aria-hidden') === 'true' ||
              style.position === 'fixed' || // Skip fixed position elements like headers
              style.position === 'absolute' // Skip absolute positioned elements that might overlap
            ) {
              isHidden = true;
              break;
            }
            if (processedElements.has(parent)) {
              isInsideProcessedInteractive = true;
              break;
            }
            parent = parent.parentElement;
          }
          if (isHidden || isInsideProcessedInteractive) continue;

          // Skip text that's inside an interactive element
          let isInsideInteractive = false;
          parent = node.parentElement;
          while (parent) {
            if (parent.matches(completeSelector)) {
              isInsideInteractive = true;
              break;
            }
            parent = parent.parentElement;
          }
          if (isInsideInteractive) continue;

          const box = getBoundingBox(node);
          if (box.width > 0 && box.height > 0) {
            nodePositions.push({
              type: 'text',
              content: text,
              box,
              y: box.top + window.pageYOffset,
              x: box.left + window.pageXOffset
            });
          }
        }

        // Handle interactive elements
        if (node.nodeType === Node.ELEMENT_NODE && node.matches(completeSelector)) {
          const index = interactiveElements.indexOf(node);
          if (index !== -1 && !processedElements.has(node)) {
            const role = node.getAttribute('role') || node.tagName.toLowerCase();
            const name = getAccessibleName(node);
            if (name) {
              const box = getBoundingBox(node);
              if (box.width > 0 && box.height > 0) {
                nodePositions.push({
                  type: 'interactive',
                  content: `[${index}]{${role}}(${name})`,
                  box,
                  y: box.top + window.pageYOffset,
                  x: box.left + window.pageXOffset
                });
              }
            }
            processedElements.add(node);
          }
        }
      }

      // Sort nodes by vertical position first, then horizontal
      nodePositions.sort((a, b) => {
        const yDiff = a.y - b.y;
        if (Math.abs(yDiff) < MIN_GAP_FOR_NEWLINE) {
          return a.x - b.x;
        }
        return yDiff;
      });

      // Group nodes into lines
      let currentLine = [];
      let lastY = 0;
      let lastX = 0;

      const flushLine = () => {
        if (currentLine.length > 0) {
          // Sort line by x position
          currentLine.sort((a, b) => a.x - b.x);
          output.push(currentLine.map(node => node.content).join(' '));
          currentLine = [];
        }
      };

      for (const node of nodePositions) {
        // Start new line if significant vertical gap or if horizontal position is before previous element
        if (currentLine.length > 0 && 
            (Math.abs(node.y - lastY) > MIN_GAP_FOR_NEWLINE || 
             node.x < lastX - HORIZONTAL_GAP)) {
          flushLine();
          output.push('\n');
        }

        currentLine.push(node);
        lastY = node.y;
        lastX = node.x + node.box.width;
      }

      // Flush final line
      flushLine();

      // Join all text with appropriate spacing
      return output
        .join('\n')
        .replace(/\n\s+/g, '\n') // Clean up newline spacing
        .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines to 2
        .trim();
    };

    // Main execution
    findInteractiveElements();
    const textRepresentation = createTextRepresentation();

    if (false)
      requestAnimationFrame(() => {
        // Clear existing highlights
        document.querySelectorAll('.claude-highlight').forEach((el) => el.remove());

        // Create main overlay container
        const overlay = document.createElement('div');
        overlay.className = 'claude-highlight';
        overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: ${Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)}px;
      pointer-events: none;
      z-index: 2147483647;
    `;
        document.body.appendChild(overlay);

        // Create a highlight for each interactive element
        interactiveElements.forEach((el, index) => {
          const rect = el.getBoundingClientRect();

          if (rect.width <= 0 || rect.height <= 0) return;

          const highlight = document.createElement('div');
          highlight.className = 'claude-highlight';
          highlight.style.cssText = `
        position: absolute;
        left: ${window.pageXOffset + rect.left}px;
        top: ${window.pageYOffset + rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        background-color: hsla(${(index * 30) % 360}, 80%, 50%, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: bold;
        color: #000;
        pointer-events: none;
        border: none;
        z-index: 2147483647;
      `;

          highlight.textContent = index;
          overlay.appendChild(highlight);
        });
      });

    // Return the results
    const result = {
      interactiveElements,
      textRepresentation,
    };

    window.interactiveElements = interactiveElements;
    window.textRepresentation = textRepresentation;

    console.log(`Gerenated ${interactiveElements.length} interactive elements`);
    console.log(`Text representation size: ${textRepresentation.length} characters`);

    return result;
  }

  // // Debounce helper function
  // function debounce(func, wait) {
  //   let timeout;
  //   return function executedFunction(...args) {
  //     const later = () => {
  //       clearTimeout(timeout);
  //       func(...args);
  //     };
  //     clearTimeout(timeout);
  //     timeout = setTimeout(later, wait);
  //   };
  // }

  // // Create a debounced version of the text representation creation
  // const debouncedCreateTextRepresentation = debounce(() => {
  //   const result = createTextRepresentation();
  //   // Dispatch a custom event with the new text representation
  //   const event = new CustomEvent('textRepresentationUpdated', {
  //     detail: result,
  //   });
  //   document.dispatchEvent(event);
  // }, 250); // 250ms debounce time

  // // Set up mutation observer to watch for DOM changes
  // const observer = new MutationObserver((mutations) => {
  //   // Check if any mutation is relevant (affects visibility, attributes, or structure)
  //   const isRelevantMutation = mutations.some((mutation) => {
  //     // Check if the mutation affects visibility or attributes
  //     if (
  //       mutation.type === 'attributes' &&
  //       (mutation.attributeName === 'aria-hidden' ||
  //         mutation.attributeName === 'disabled' ||
  //         mutation.attributeName === 'inert' ||
  //         mutation.attributeName === 'style' ||
  //         mutation.attributeName === 'class')
  //     ) {
  //       return true;
  //     }

  //     // Check if the mutation affects the DOM structure
  //     if (mutation.type === 'childList') {
  //       return true;
  //     }

  //     return false;
  //   });

  //   if (isRelevantMutation) {
  //     debouncedCreateTextRepresentation();
  //   }
  // });

  // // Start observing the document with the configured parameters
  // observer.observe(document.body, {
  //   childList: true,
  //   subtree: true,
  //   attributes: true,
  //   characterData: true,
  //   attributeFilter: ['aria-hidden', 'disabled', 'inert', 'style', 'class', 'role', 'aria-label', 'aria-labelledby'],
  // });

  window.createTextRepresentation = createTextRepresentation;

  // Initial creation
  createTextRepresentation();

  // // Also rerun when dynamic content might be loaded
  // window.addEventListener('load', createTextRepresentation);
  // document.addEventListener('DOMContentLoaded', createTextRepresentation);

  // // Handle dynamic updates like dialogs
  // const dynamicUpdateEvents = ['dialog', 'popstate', 'pushstate', 'replacestate'];
  // dynamicUpdateEvents.forEach(event => {
  //   window.addEventListener(event, () => {
  //     setTimeout(createTextRepresentation, 100); // Small delay to let content settle
  //   });
  // });

  console.log('Aria Interactive Elements script loaded');
})();
