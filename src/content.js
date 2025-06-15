let currentSelection = null;
let currentRange = null;

document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    currentSelection = selection;
    currentRange = selection.getRangeAt(0).cloneRange();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "decodeBase64") {
    decodeAndReplace(request.selectedText);
  }
});

function isValidBase64(str) {
  const cleanStr = str.replace(/\s/g, '');
  if (!cleanStr) return false;
  
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(cleanStr)) return false;
  
  if (cleanStr.length % 4 !== 0) return false;
  
  try {
    const decoded = atob(cleanStr);
    return decoded.length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Decodes base64 string
 * @param {string} base64String - Base64 encoded string
 * @returns {string} - Decoded string
 */
function decodeBase64(base64String) {
  try {
    const cleanString = base64String.replace(/\s/g, '');
    const decoded = atob(cleanString);
    return decoded;
  } catch (error) {
    throw new Error('Failed to decode base64: ' + error.message);
  }
}

/**
 * Creates and shows a tooltip with the decoded text
 * @param {string} decodedText - The decoded text to display
 * @param {number} x - X coordinate for tooltip
 * @param {number} y - Y coordinate for tooltip
 */
function showTooltip(decodedText, x, y) {
  const existingTooltip = document.getElementById('base64-decoder-tooltip');
  if (existingTooltip) {
    existingTooltip.remove();
  }
  
  const tooltip = document.createElement('div');
  tooltip.id = 'base64-decoder-tooltip';
  tooltip.style.cssText = `
    position: fixed;
    z-index: 10000;
    background: #333;
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-family: monospace;
    max-width: 300px;
    word-wrap: break-word;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    border: 1px solid #555;
    left: ${x}px;
    top: ${y}px;
  `;
  
  tooltip.textContent = decodedText;
  
  document.body.appendChild(tooltip);
  
  const rect = tooltip.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    tooltip.style.left = (window.innerWidth - rect.width - 10) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    tooltip.style.top = (y - rect.height - 10) + 'px';
  }
  
  setTimeout(() => {
    if (tooltip.parentNode) {
      tooltip.remove();
    }
  }, 5000);
  
  const removeTooltip = (e) => {
    if (!tooltip.contains(e.target)) {
      tooltip.remove();
      document.removeEventListener('click', removeTooltip);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', removeTooltip);
  }, 100);
}

/**
 * Attempts to replace selected text in the DOM
 * @param {string} originalText - The original selected text
 * @param {string} newText - The text to replace it with
 * @returns {boolean} - True if replacement was successful
 */
function replaceSelectedText(originalText, newText) {
  try {
    if (!currentRange) return false;
    
    const selectedText = currentRange.toString();
    
    if (selectedText.trim() !== originalText.trim()) {
      return false;
    }
    
    const container = currentRange.commonAncestorContainer;
    const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
    
    if (element.isContentEditable || 
        element.tagName === 'INPUT' || 
        element.tagName === 'TEXTAREA') {
      
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        const start = element.selectionStart;
        const end = element.selectionEnd;
        element.value = element.value.substring(0, start) + newText + element.value.substring(end);
        element.selectionStart = start;
        element.selectionEnd = start + newText.length;
      } else {
        currentRange.deleteContents();
        currentRange.insertNode(document.createTextNode(newText));
      }
      return true;
    } else {
      if (container.nodeType === Node.TEXT_NODE) {
        const textNode = container;
        const startOffset = currentRange.startOffset;
        const endOffset = currentRange.endOffset;
        
        const beforeText = textNode.textContent.substring(0, startOffset);
        const afterText = textNode.textContent.substring(endOffset);
        const newContent = beforeText + newText + afterText;
        
        textNode.textContent = newContent;
        
        const newRange = document.createRange();
        newRange.setStart(textNode, startOffset);
        newRange.setEnd(textNode, startOffset + newText.length);
        
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(newRange);
        
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error replacing text:', error);
    return false;
  }
}

/**
 * Main function to decode and replace base64 text
 * @param {string} selectedText 
 */
function decodeAndReplace(selectedText) {
  try {
    if (!isValidBase64(selectedText)) {
      showTooltip('❌ Selected text is not valid base64', 
                 event?.clientX || window.innerWidth / 2, 
                 event?.clientY || 100);
      chrome.runtime.sendMessage({
        action: "error",
        message: "Invalid base64 selected: " + selectedText.substring(0, 50)
      });
      return;
    }
    
    const decodedText = decodeBase64(selectedText);
    
    const mouseX = event?.clientX || window.innerWidth / 2;
    const mouseY = event?.clientY || 100;
    
    const replacementSuccessful = replaceSelectedText(selectedText, decodedText);
    
    if (replacementSuccessful) {
      showTooltip('✅ Base64 decoded successfully!', mouseX, mouseY);
      chrome.runtime.sendMessage({
        action: "log",
        message: "Successfully decoded and replaced base64 text"
      });
    } else {
      showTooltip(`Decoded: ${decodedText}`, mouseX, mouseY);
      chrome.runtime.sendMessage({
        action: "log",
        message: "Showed decoded text in tooltip (replacement not possible)"
      });
    }
    
  } catch (error) {
    showTooltip(`❌ Error: ${error.message}`, 
               event?.clientX || window.innerWidth / 2, 
               event?.clientY || 100);
    chrome.runtime.sendMessage({
      action: "error",
      message: error.message
    });
  }
}