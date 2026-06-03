const KEEPALIVE_INTERVAL = 20000;

function keepAlive() {
  chrome.runtime.sendMessage({
    type: 'offscreen_keepalive',
    ts: Date.now(),
  }).catch(() => {});
}

keepAlive();
setInterval(keepAlive, KEEPALIVE_INTERVAL);
