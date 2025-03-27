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

      // Then try associated label element
      const label = el.labels ? el.labels[0] : null;
      if (label) return label.textContent.trim();

      // Then try placeholder
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) return placeholder;

      // Then try title
      const title = el.getAttribute('title');
      if (title) return title;

      // For inputs, use value
      if (el.tagName.toLowerCase() === 'input') {
        return el.getAttribute('value') || el.value || '';
      }

      // For other elements, get all text content including from child elements
      let textContent = '';
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          // Skip text in hidden elements
          let parent = node.parentElement;
          while (parent && parent !== el) {
            const style = window.getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden') {
              return NodeFilter.FILTER_REJECT;
            }
            parent = parent.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        if (text) textContent += (textContent ? ' ' : '') + text;
      }
      return textContent || '';
    };


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
        }
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
      const USE_ELEMENT_POSITION_FOR_TEXT_REPRESENTATION = false; // Flag to control text representation method

      if (USE_ELEMENT_POSITION_FOR_TEXT_REPRESENTATION) {
        // Position-based text representation (existing implementation)
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
            let computedStyles = new Map(); // Cache computed styles
            
            while (parent) {
              // Cache and reuse computed styles
              let style = computedStyles.get(parent);
              if (!style) {
                style = window.getComputedStyle(parent);
                computedStyles.set(parent, style);
              }
              
              if (
                style.display === 'none' ||
                style.visibility === 'hidden' ||
                parent.getAttribute('aria-hidden') === 'true'
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

            // Skip if this is just a number inside a highlight element
            if (/^\d+$/.test(text)) {
              parent = node.parentElement;
              while (parent) {
                if (parent.classList && parent.classList.contains('claude-highlight')) {
                  isHidden = true;
                  break;
                }
                parent = parent.parentElement;
              }
              if (isHidden) continue;
            }

            // Check if this text is inside an interactive element
            let isInsideInteractive = false;
            let interactiveParent = null;
            parent = node.parentElement;
            while (parent) {
              if (parent.matches(completeSelector)) {
                isInsideInteractive = true;
                interactiveParent = parent;
                break;
              }
              parent = parent.parentElement;
            }

            // If inside an interactive element, add it to the interactive element's content
            if (isInsideInteractive && interactiveParent) {
              const index = interactiveElements.indexOf(interactiveParent);
              if (index !== -1 && !processedElements.has(interactiveParent)) {
                const role = interactiveParent.getAttribute('role') || interactiveParent.tagName.toLowerCase();
                const name = getAccessibleName(interactiveParent);
                if (name) {
                  const box = getBoundingBox(interactiveParent);
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
                processedElements.add(interactiveParent);
              }
              continue;
            }

            // If not inside an interactive element, add as regular text
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
      } else {
        // DOM-based text representation
        const output = [];
        const processedElements = new Set();

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
        let currentBlock = [];

        const flushBlock = () => {
          if (currentBlock.length > 0) {
            output.push(currentBlock.join(' '));
            currentBlock = [];
          }
        };

        while ((node = walker.nextNode())) {
          // Skip hidden elements
          let parent = node.parentElement;
          let isHidden = false;
          while (parent) {
            const style = window.getComputedStyle(parent);
            if (
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              parent.getAttribute('aria-hidden') === 'true'
            ) {
              isHidden = true;
              break;
            }
            parent = parent.parentElement;
          }
          if (isHidden) continue;

          // Handle text nodes
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (!text) continue;

            // Skip if this is just a number inside a highlight element
            if (/^\d+$/.test(text)) {
              parent = node.parentElement;
              while (parent) {
                if (parent.classList && parent.classList.contains('claude-highlight')) {
                  isHidden = true;
                  break;
                }
                parent = parent.parentElement;
              }
              if (isHidden) continue;
            }

            // Check if this text is inside an interactive element
            let isInsideInteractive = false;
            let interactiveParent = null;
            parent = node.parentElement;
            while (parent) {
              if (parent.matches(completeSelector)) {
                isInsideInteractive = true;
                interactiveParent = parent;
                break;
              }
              parent = parent.parentElement;
            }

            // If inside an interactive element, add it to the interactive element's content
            if (isInsideInteractive && interactiveParent) {
              if (!processedElements.has(interactiveParent)) {
                const index = interactiveElements.indexOf(interactiveParent);
                if (index !== -1) {
                  const role = interactiveParent.getAttribute('role') || interactiveParent.tagName.toLowerCase();
                  const name = getAccessibleName(interactiveParent);
                  if (name) {
                    currentBlock.push(`[${index}]{${role}}(${name})`);
                  }
                  processedElements.add(interactiveParent);
                }
              }
              continue;
            }

            // Add text to current block
            currentBlock.push(text);
          }

          // Handle block-level elements and interactive elements
          if (node.nodeType === Node.ELEMENT_NODE) {
            const style = window.getComputedStyle(node);
            const isBlockLevel = style.display === 'block' || 
                               style.display === 'flex' || 
                               style.display === 'grid' ||
                               node.tagName.toLowerCase() === 'br';

            // Handle interactive elements
            if (node.matches(completeSelector) && !processedElements.has(node)) {
              const index = interactiveElements.indexOf(node);
              if (index !== -1) {
                const role = node.getAttribute('role') || node.tagName.toLowerCase();
                const name = getAccessibleName(node);
                if (name) {
                  currentBlock.push(`[${index}]{${role}}(${name})`);
                }
                processedElements.add(node);
              }
            }

            // Add newline for block-level elements
            if (isBlockLevel) {
              flushBlock();
              output.push('');
            }
          }
        }

        // Flush final block
        flushBlock();

        // Join all text with appropriate spacing
        return output
          .join('\n')
          .replace(/\n\s+/g, '\n') // Clean up newline spacing
          .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines to 2
          .trim();
      }
    };

    // Helper functions for accurate clicking
    const isElementClickable = (element) => {
      if (!element) return false;
      
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      
      return (
        // Element must be visible
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        // Must have non-zero dimensions
        rect.width > 0 &&
        rect.height > 0 &&
        // Must be within viewport bounds
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth) &&
        // Must not be disabled
        !element.hasAttribute('disabled') &&
        !element.hasAttribute('aria-disabled') &&
        element.getAttribute('aria-hidden') !== 'true'
      );
    };

    const getClickableCenter = (element) => {
      const rect = element.getBoundingClientRect();
      // Get the actual visible area accounting for overflow
      const style = window.getComputedStyle(element);
      const overflowX = style.overflowX;
      const overflowY = style.overflowY;
      
      let width = rect.width;
      let height = rect.height;
      
      // Adjust for overflow
      if (overflowX === 'hidden') {
        width = Math.min(width, element.clientWidth);
      }
      if (overflowY === 'hidden') {
        height = Math.min(height, element.clientHeight);
      }
      
      // Calculate center coordinates
      const x = rect.left + (width / 2);
      const y = rect.top + (height / 2);
      
      return {
        x: Math.round(x + window.pageXOffset),
        y: Math.round(y + window.pageYOffset)
      };
    };

    // Expose helper functions to window for use by MCP
    window.isElementClickable = isElementClickable;
    window.getClickableCenter = getClickableCenter;

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

        // Batch DOM operations and reduce reflows
        const fragment = document.createDocumentFragment();
        const pageXOffset = window.pageXOffset;
        const pageYOffset = window.pageYOffset;

        // Create highlights in a batch
        interactiveElements.forEach((el, index) => {
          const rect = el.getBoundingClientRect();

          if (rect.width <= 0 || rect.height <= 0) return;

          const highlight = document.createElement('div');
          highlight.className = 'claude-highlight';
          highlight.style.cssText = `
        position: absolute;
        left: ${pageXOffset + rect.left}px;
        top: ${pageYOffset + rect.top}px;
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
          fragment.appendChild(highlight);
        });

        // Single DOM update
        overlay.appendChild(fragment);
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
