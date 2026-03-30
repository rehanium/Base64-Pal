const originalValues = new WeakMap();
let lastContextMenuPosition = { x: 0, y: 0 };
let activeTooltip = null;
let outsideClickHandler = null;

document.addEventListener('contextmenu', (event) => {
  lastContextMenuPosition = { x: event.clientX, y: event.clientY };
}, true);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "decodeBase64") {
    decodeAndReplace(request.selectedText);
  } else if (request.action === "decodeBase64Selection") {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      decodeAndReplace(selection.toString());
    }
  } else if (request.action === "decodeAllBase64") {
    decodeAllBase64OnPage();
  } else if (request.action === "undoAllDecoding") {
    undoAllDecoding();
  }
});

function decodeAndReplace(selectedText) {
  const { x, y } = lastContextMenuPosition;

  try {
    const trimmedText = normalizeBase64(selectedText.trim());

    if (!isValidBase64(trimmedText)) {
      showTooltip('❌ Selected text is not valid Base64', x, y, false, true);
      chrome.runtime.sendMessage({
        action: "error",
        message: "Validation failed. Selected text is not valid Base64."
      });
      return;
    }

    const decodedText = decodeBase64(trimmedText);
    const replacementSuccessful = replaceSelectedText(decodedText);

    if (replacementSuccessful) {
      showTooltip('✅ Base64 decoded successfully!', x, y);
      chrome.runtime.sendMessage({ action: "log", message: "Successfully decoded and replaced text." });
    } else {
      showTooltip(decodedText, x, y, true);
      chrome.runtime.sendMessage({ action: "log", message: "Could not replace text. Displayed result in a tooltip." });
    }

  } catch (error) {
    showTooltip(`❌ Error: ${error.message}`, x, y, false, true);
    chrome.runtime.sendMessage({ action: "error", message: `Decoding failed: ${error.message}` });
  }
}

function decodeAllBase64OnPage() {
  const { x, y } = lastContextMenuPosition;
  let replacementCount = 0;
  let errorCount = 0;

  try {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'NOSCRIPT') {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest('#base64-decoder-tooltip-host')) {
            return NodeFilter.FILTER_REJECT;
          }
          if (node.nodeValue && node.nodeValue.trim().length > 0) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    const textNodes = [];
    let currentNode;
    while (currentNode = walker.nextNode()) {
      textNodes.push(currentNode);
    }

    const BATCH_SIZE = 50;
    let batchIndex = 0;

    function processBatch() {
      const end = Math.min(batchIndex + BATCH_SIZE, textNodes.length);

      for (let i = batchIndex; i < end; i++) {
        const textNode = textNodes[i];
        const originalText = textNode.nodeValue;
        const result = processTextForBase64(originalText);

        if (result.modified) {
          try {
            originalValues.set(textNode, originalText);

            const fragment = document.createDocumentFragment();
            const parts = result.segments;

            parts.forEach(part => {
              if (part.type === 'decoded') {
                const span = createDecodedSpan(part.decoded, part.original);
                fragment.appendChild(span);
              } else {
                fragment.appendChild(document.createTextNode(part.text));
              }
            });

            textNode.parentNode.replaceChild(fragment, textNode);
            replacementCount += result.replacements;
          } catch (error) {
            errorCount++;
          }
        }
      }

      batchIndex = end;

      if (batchIndex < textNodes.length) {
        requestAnimationFrame(processBatch);
      } else {
        finalizeBulkDecode();
      }
    }

    function finalizeBulkDecode() {
      const inputElements = document.querySelectorAll('input[type="text"], input[type="search"], input[type="url"], textarea');
      inputElements.forEach(element => {
        const originalValue = element.value;
        const result = processTextForBase64(originalValue);

        if (result.modified) {
          try {
            originalValues.set(element, originalValue);
            element.value = result.plainText;
            replacementCount += result.replacements;
          } catch (error) {
            errorCount++;
          }
        }
      });

      if (replacementCount > 0) {
        const message = errorCount > 0
          ? `✅ Decoded ${replacementCount} Base64 strings (${errorCount} errors)`
          : `✅ Decoded ${replacementCount} Base64 strings!`;
        showTooltip(message, x, y);
        chrome.runtime.sendMessage({
          action: "log",
          message: `Bulk decode: ${replacementCount} replacements, ${errorCount} errors`
        });
      } else {
        showTooltip('ℹ️ No valid Base64 strings found on this page', x, y, false, true);
        chrome.runtime.sendMessage({ action: "log", message: "No Base64 strings found on page" });
      }
    }

    if (textNodes.length > 0) {
      processBatch();
    } else {
      finalizeBulkDecode();
    }

  } catch (error) {
    showTooltip(`❌ Error during bulk decode: ${error.message}`, x, y, false, true);
    chrome.runtime.sendMessage({ action: "error", message: `Bulk decode failed: ${error.message}` });
  }
}

function undoAllDecoding() {
  const { x, y } = lastContextMenuPosition;
  let undoCount = 0;

  const decodedSpans = document.querySelectorAll('.base64-decoded-inline');
  decodedSpans.forEach(span => {
    const originalB64 = span.dataset.originalBase64;
    if (originalB64 && span.parentNode) {
      const textNode = document.createTextNode(originalB64);
      span.parentNode.replaceChild(textNode, span);
      undoCount++;
    }
  });

  const inputElements = document.querySelectorAll('input[type="text"], input[type="search"], input[type="url"], textarea');
  inputElements.forEach(element => {
    const original = originalValues.get(element);
    if (original !== undefined) {
      element.value = original;
      originalValues.delete(element);
      undoCount++;
    }
  });

  if (undoCount > 0) {
    showTooltip(`↩️ Reverted ${undoCount} decoded strings`, x, y, false, true);
    chrome.runtime.sendMessage({ action: "log", message: `Undo: reverted ${undoCount} strings` });
  } else {
    showTooltip('ℹ️ Nothing to undo', x, y, false, true);
  }
}

function createDecodedSpan(decodedText, originalBase64) {
  const isUrl = /^https?:\/\/\S+$/i.test(decodedText.trim());

  if (isUrl) {
    const anchor = document.createElement('a');
    anchor.href = decodedText.trim();
    anchor.textContent = decodedText;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.className = 'base64-decoded-inline base64-decoded-link';
    anchor.dataset.originalBase64 = originalBase64;
    anchor.style.cssText = 'color: #4fc3f7; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; cursor: pointer; background: rgba(79,195,247,0.08); padding: 1px 3px; border-radius: 3px; transition: background 0.15s ease;';
    anchor.addEventListener('mouseenter', () => {
      anchor.style.background = 'rgba(79,195,247,0.18)';
    });
    anchor.addEventListener('mouseleave', () => {
      anchor.style.background = 'rgba(79,195,247,0.08)';
    });
    return anchor;
  }

  const span = document.createElement('span');
  span.textContent = decodedText;
  span.className = 'base64-decoded-inline';
  span.dataset.originalBase64 = originalBase64;
  span.style.cssText = 'background: rgba(129,212,250,0.1); border-bottom: 2px solid rgba(129,212,250,0.4); padding: 1px 3px; border-radius: 3px; transition: background 0.15s ease;';
  span.addEventListener('mouseenter', () => {
    span.style.background = 'rgba(129,212,250,0.2)';
  });
  span.addEventListener('mouseleave', () => {
    span.style.background = 'rgba(129,212,250,0.1)';
  });
  return span;
}

function processTextForBase64(text) {
  if (!text || text.trim().length === 0) {
    return { plainText: text, modified: false, replacements: 0, segments: [] };
  }

  let modified = false;
  let replacements = 0;
  const segments = [];
  let lastIndex = 0;

  const base64Pattern = /(?:^|(?<=[^A-Za-z0-9+/=_-]))([A-Za-z0-9+/_-]{12,}={0,2})(?=$|[^A-Za-z0-9+/=_-])/g;

  let match;
  while ((match = base64Pattern.exec(text)) !== null) {
    const candidate = match[1];
    const normalized = normalizeBase64(candidate);

    if (isValidBase64(normalized) && isLikelyBase64String(normalized)) {
      try {
        const decoded = decodeBase64(normalized);
        if (isPrintableString(decoded)) {
          if (match.index > lastIndex) {
            segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
          }
          segments.push({ type: 'decoded', decoded: decoded, original: candidate });
          lastIndex = text.indexOf(candidate, match.index) + candidate.length;
          modified = true;
          replacements++;
        }
      } catch (e) {
      }
    }
  }

  if (modified && lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) });
  }

  let plainText = text;
  if (modified) {
    plainText = segments.map(seg => seg.type === 'decoded' ? seg.decoded : seg.text).join('');
  }

  return { plainText, modified, replacements, segments };
}

function normalizeBase64(str) {
  let normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4 !== 0) {
    normalized += '=';
  }
  return normalized;
}

function isLikelyBase64String(str) {
  if (str.length < 12) return false;

  const stripped = str.replace(/=+$/, '');

  const upperCount = (stripped.match(/[A-Z]/g) || []).length;
  const lowerCount = (stripped.match(/[a-z]/g) || []).length;
  const digitCount = (stripped.match(/[0-9]/g) || []).length;

  const uniqueChars = new Set(stripped).size;
  if (uniqueChars < 5) return false;

  const totalAlpha = upperCount + lowerCount;
  if (totalAlpha > 0 && digitCount === 0 && stripped.length > 20) {
    const ratio = upperCount / totalAlpha;
    if (ratio < 0.05 || ratio > 0.95) return false;
  }

  if (/^[A-Z][a-z]+(?:[A-Z][a-z]+){2,}$/.test(stripped)) return false;
  if (/^[a-z]+(?:-[a-z]+)+$/.test(stripped)) return false;
  if (/^[a-z]+(?:_[a-z]+)+$/.test(stripped)) return false;

  const charFrequency = {};
  for (const ch of stripped) {
    charFrequency[ch] = (charFrequency[ch] || 0) + 1;
  }
  let entropy = 0;
  const len = stripped.length;
  for (const count of Object.values(charFrequency)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  if (entropy < 3.0 && stripped.length > 20) return false;

  return true;
}

function isPrintableString(str) {
  if (!str || str.length === 0) return false;

  let printableCount = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 32 && code <= 126) || code === 9 || code === 10 || code === 13) {
      printableCount++;
    }
  }

  const printableRatio = printableCount / str.length;

  if (/^https?:\/\/\S+$/i.test(str.trim())) return true;
  if (/^[a-zA-Z]:[\\\/]/.test(str.trim()) || /^\/[a-zA-Z]/.test(str.trim())) return true;

  return printableRatio >= 0.85;
}

function isValidBase64(str) {
  if (!str || str.length === 0) return false;

  let padded = str;
  while (padded.length % 4 !== 0) {
    padded += '=';
  }

  const base64Regex = /^[A-Za-z0-9+/]+={0,3}$/;
  if (!base64Regex.test(padded)) return false;

  try {
    atob(padded);
    return true;
  } catch (e) {
    return false;
  }
}

function decodeBase64(base64String) {
  try {
    let padded = base64String;
    while (padded.length % 4 !== 0) {
      padded += '=';
    }

    const byteString = atob(padded);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch (error) {
    throw new Error('Malformed Base64 string.');
  }
}

function replaceSelectedText(newText) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return false;
  }

  const activeElement = document.activeElement;
  if (activeElement) {
    const tagName = activeElement.tagName.toUpperCase();
    if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
      const start = activeElement.selectionStart;
      const end = activeElement.selectionEnd;
      if (typeof start === 'number' && typeof end === 'number') {
        activeElement.value = activeElement.value.substring(0, start) + newText + activeElement.value.substring(end);
        activeElement.selectionStart = activeElement.selectionEnd = start + newText.length;
        return true;
      }
    }
  }

  const range = selection.getRangeAt(0);
  const isUrl = /^https?:\/\/\S+$/i.test(newText.trim());

  const buildInlineNode = () => {
    if (isUrl) {
      const a = document.createElement('a');
      a.href = newText.trim();
      a.textContent = newText;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'base64-decoded-inline base64-decoded-link';
      a.dataset.originalBase64 = newText;
      a.style.cssText = 'color: #0066cc; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; cursor: pointer; background: rgba(0,102,204,0.08); padding: 1px 3px; border-radius: 3px; transition: background 0.15s ease;';
      a.addEventListener('mouseenter', () => { a.style.background = 'rgba(0,102,204,0.18)'; });
      a.addEventListener('mouseleave', () => { a.style.background = 'rgba(0,102,204,0.08)'; });
      return a;
    }
    const span = document.createElement('span');
    span.textContent = newText;
    span.className = 'base64-decoded-inline';
    span.dataset.originalBase64 = newText;
    span.style.cssText = 'background: rgba(129,212,250,0.1); border-bottom: 2px solid rgba(129,212,250,0.4); padding: 1px 3px; border-radius: 3px; transition: background 0.15s ease;';
    span.addEventListener('mouseenter', () => { span.style.background = 'rgba(129,212,250,0.2)'; });
    span.addEventListener('mouseleave', () => { span.style.background = 'rgba(129,212,250,0.1)'; });
    return span;
  };

  if (
    range.startContainer === range.endContainer &&
    range.startContainer.nodeType === Node.TEXT_NODE &&
    range.startContainer.parentNode
  ) {
    try {
      const textNode = range.startContainer;
      const fullText = textNode.nodeValue;
      const before = fullText.substring(0, range.startOffset);
      const after = fullText.substring(range.endOffset);

      const fragment = document.createDocumentFragment();
      if (before) fragment.appendChild(document.createTextNode(before));
      fragment.appendChild(buildInlineNode());
      if (after) fragment.appendChild(document.createTextNode(after));

      textNode.parentNode.replaceChild(fragment, textNode);
      selection.removeAllRanges();
      return true;
    } catch (e) {}
  }

  return false;
}

function showTooltip(message, x, y, isDecodedContent = false, forceHideActions = false) {
  dismissTooltip();

  const host = document.createElement('div');
  host.id = 'base64-decoder-tooltip-host';
  host.style.cssText = 'position: fixed; z-index: 2147483647; pointer-events: auto;';

  const shadow = host.attachShadow({ mode: 'closed' });

  const styles = document.createElement('style');
  styles.textContent = `
    :host {
      --bg-color: rgba(255, 255, 255, 0.95);
      --text-color: #1a1a1a;
      --border-color: rgba(0, 0, 0, 0.08);
      --shadow-color: rgba(0, 0, 0, 0.12);
      --btn-bg: rgba(0, 0, 0, 0.04);
      --btn-bg-hover: rgba(0, 0, 0, 0.08);
      --btn-border: transparent;
      --link-color: #0066cc;
      --link-hover: #004499;
      --scrollbar-thumb: rgba(0, 0, 0, 0.2);
    }

    @media (prefers-color-scheme: dark) {
      :host {
        --bg-color: rgba(28, 28, 30, 0.95);
        --text-color: #e5e5e5;
        --border-color: rgba(255, 255, 255, 0.1);
        --shadow-color: rgba(0, 0, 0, 0.4);
        --btn-bg: rgba(255, 255, 255, 0.08);
        --btn-bg-hover: rgba(255, 255, 255, 0.12);
        --btn-border: transparent;
        --link-color: #5e9cff;
        --link-hover: #82b4ff;
        --scrollbar-thumb: rgba(255, 255, 255, 0.2);
      }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }

    .tooltip-container {
      background: var(--bg-color);
      color: var(--text-color);
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 13px;
      max-width: 480px;
      box-shadow: 0 4px 24px var(--shadow-color), 0 0 0 1px var(--border-color);
      opacity: 0;
      transform: scale(0.95) translateY(4px);
      transition: opacity 0.15s cubic-bezier(0.4,0,0.2,1), transform 0.15s cubic-bezier(0.4,0,0.2,1);
      display: flex;
      flex-direction: column;
      gap: 10px;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }

    .tooltip-container.visible {
      opacity: 1;
      transform: scale(1) translateY(0);
    }

    .tooltip-body {
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
      font-size: 12.5px;
      overflow-y: auto;
      overflow-x: hidden;
      max-height: 220px;
      word-wrap: break-word;
      word-break: break-all;
      white-space: pre-wrap;
      line-height: 1.5;
      scrollbar-width: thin;
      scrollbar-color: var(--scrollbar-thumb) transparent;
    }

    .tooltip-body::-webkit-scrollbar { width: 5px; }
    .tooltip-body::-webkit-scrollbar-track { background: transparent; }
    .tooltip-body::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 3px; }

    .tooltip-body a {
      color: var(--link-color);
      text-decoration: underline;
      text-decoration-style: dotted;
      text-underline-offset: 3px;
      cursor: pointer;
      transition: color 0.15s ease;
      font-family: inherit;
    }
    .tooltip-body a:hover {
      color: var(--link-hover);
    }

    .tooltip-actions {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
      border-top: 1px solid var(--border-color);
      padding-top: 10px;
    }

    .tooltip-btn {
      background: var(--btn-bg);
      color: var(--text-color);
      border: 1px solid var(--btn-border);
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s ease;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .tooltip-btn:hover {
      background: var(--btn-bg-hover);
    }

    .tooltip-btn.copied {
      background: #34c759;
      color: #ffffff;
      border-color: #34c759;
    }
    @media (prefers-color-scheme: dark) {
      .tooltip-btn.copied {
        background: #30d158;
        color: #000000;
      }
    }
  `;

  const container = document.createElement('div');
  container.className = 'tooltip-container';

  const body = document.createElement('div');
  body.className = 'tooltip-body';

  const isUrl = isDecodedContent && /^https?:\/\/\S+$/i.test(message.trim());

  if (isUrl) {
    const link = document.createElement('a');
    link.href = message.trim();
    link.textContent = message;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    body.appendChild(link);
  } else {
    body.textContent = message;
  }

  container.appendChild(body);

  const hasActions = !forceHideActions && (isDecodedContent || message.length > 30);

  if (hasActions) {
    const actions = document.createElement('div');
    actions.className = 'tooltip-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'tooltip-btn';
    copyBtn.innerHTML = '📋 Copy';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const textToCopy = isUrl ? message.trim() : message;
      navigator.clipboard.writeText(textToCopy).then(() => {
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = '✅ Copied';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = '📋 Copy';
        }, 1500);
      });
    });

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'tooltip-btn';
    dismissBtn.innerHTML = '✕ Close';
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissTooltip();
    });

    actions.appendChild(copyBtn);
    actions.appendChild(dismissBtn);
    container.appendChild(actions);
  }

  shadow.appendChild(styles);
  shadow.appendChild(container);
  document.body.appendChild(host);

  const rect = container.getBoundingClientRect();
  const tooltipWidth = rect.width || 300;
  const tooltipHeight = rect.height || 100;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const OFFSET = 12;

  let posX = x + OFFSET;
  let posY = y + OFFSET;

  if (posX + tooltipWidth > viewportW - 8) {
    posX = x - tooltipWidth - OFFSET;
  }
  if (posX < 8) {
    posX = 8;
  }
  if (posY + tooltipHeight > viewportH - 8) {
    posY = y - tooltipHeight - OFFSET;
  }
  if (posY < 8) {
    posY = 8;
  }

  host.style.left = `${posX}px`;
  host.style.top = `${posY}px`;

  requestAnimationFrame(() => {
    container.classList.add('visible');
  });

  activeTooltip = host;

  if (hasActions) {
    setTimeout(() => {
      outsideClickHandler = (e) => {
        if (!host.contains(e.target)) {
          dismissTooltip();
        }
      };
      document.addEventListener('click', outsideClickHandler, true);
    }, 100);
  } else {
    setTimeout(() => {
      container.classList.remove('visible');
      setTimeout(() => {
        if (host.parentNode) host.remove();
      }, 200);
    }, 3000);
  }
}

function dismissTooltip() {
  if (outsideClickHandler) {
    document.removeEventListener('click', outsideClickHandler, true);
    outsideClickHandler = null;
  }
  if (activeTooltip && activeTooltip.parentNode) {
    activeTooltip.remove();
    activeTooltip = null;
  }
  const stale = document.getElementById('base64-decoder-tooltip-host');
  if (stale) stale.remove();
}