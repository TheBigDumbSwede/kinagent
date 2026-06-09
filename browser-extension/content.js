const NOTICE_ID = "kinagent-local-notice";

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === "kinagent-show-notice") {
    showNotice(typeof message.text === "string" ? message.text : "Kinagent is connected.");
  } else if (message.type === "kinagent-reload-kindroid") {
    showNotice("Kinagent is reloading this Kindroid tab.");
    setTimeout(() => {
      window.location.reload();
    }, 500);
  }
});

function showNotice(text) {
  let notice = document.getElementById(NOTICE_ID);
  if (!notice) {
    notice = document.createElement("div");
    notice.id = NOTICE_ID;
    notice.setAttribute("role", "status");
    notice.style.position = "fixed";
    notice.style.right = "16px";
    notice.style.bottom = "16px";
    notice.style.zIndex = "2147483647";
    notice.style.maxWidth = "320px";
    notice.style.padding = "10px 12px";
    notice.style.borderRadius = "8px";
    notice.style.background = "#111827";
    notice.style.color = "#ffffff";
    notice.style.boxShadow = "0 10px 32px rgba(0, 0, 0, 0.28)";
    notice.style.font = "13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    document.documentElement.append(notice);
  }

  notice.textContent = text;
  window.clearTimeout(notice.removeTimer);
  notice.removeTimer = window.setTimeout(() => {
    notice.remove();
  }, 5000);
}
