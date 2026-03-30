chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "decodeBase64",
    title: "Decode Base64",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "decodeAllBase64",
    title: "Decode All Base64 on Page",
    contexts: ["page"]
  });

  chrome.contextMenus.create({
    id: "undoAllDecoding",
    title: "Undo All Decoding",
    contexts: ["page"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const actionMap = {
    decodeBase64: { action: "decodeBase64", selectedText: info.selectionText },
    decodeAllBase64: { action: "decodeAllBase64" },
    undoAllDecoding: { action: "undoAllDecoding" }
  };

  const message = actionMap[info.menuItemId];
  if (!message) return;

  if (info.menuItemId === "decodeBase64" && !info.selectionText) return;

  if (!tab?.id) {
    console.error("Base64 Pal: Could not identify the active tab.");
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    console.error(
      "Base64 Pal: Could not connect to content script.",
      `URL: ${tab.url}`,
      error.message
    );
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "decode-selection") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action: "decodeBase64Selection" });
  } catch (error) {
    console.error("Base64 Pal: Keyboard shortcut failed.", error.message);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const senderUrl = sender.tab ? sender.tab.url : "unknown";

  if (request.action === "log") {
    console.log(`[Base64 Pal] (${senderUrl}):`, request.message);
  } else if (request.action === "error") {
    console.error(`[Base64 Pal] (${senderUrl}):`, request.message);
  }
});