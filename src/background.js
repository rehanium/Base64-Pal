chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "decodeBase64",
    title: "Decode Base64",
    contexts: ["selection"] 
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "decodeBase64") {
    chrome.tabs.sendMessage(tab.id, {
      action: "decodeBase64",
      selectedText: info.selectionText
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "log") {
    console.log("Base64 Decoder:", request.message);
  }
  if (request.action === "error") {
    console.error("Base64 Decoder Error:", request.message);
  }
});