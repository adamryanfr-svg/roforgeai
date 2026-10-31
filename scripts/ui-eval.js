// Exécute du JS dans la fenêtre RoForge lancée avec --remote-debugging-port=9333 (tests de l'interface).
// node scripts/ui-eval.js "document.title"
const expression = process.argv[2] || 'document.title';
(async () => {
  const pages = await (await fetch('http://127.0.0.1:9333/json')).json();
  const page = pages.find((p) => p.type === 'page' && p.title === 'RoForge');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  ws.onmessage = (m) => {
    const data = JSON.parse(m.data);
    if (data.id !== 1) return;
    console.log(JSON.stringify(data.result?.result?.value ?? data.result?.exceptionDetails?.exception?.description ?? data.result, null, 1));
    ws.close();
    process.exit(0);
  };
})();
