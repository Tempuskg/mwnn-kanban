const net = require('node:net');

// VS Code's inspector binds IPv4, while its debugger can resolve localhost to IPv6.

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Expected a nonprivileged TCP port');
}

const server = net.createServer((incoming) => {
  const outgoing = net.connect({ host: '127.0.0.1', port });
  incoming.on('error', () => outgoing.destroy());
  outgoing.on('error', () => incoming.destroy());
  incoming.pipe(outgoing).pipe(incoming);
});

console.log(`IPv6 debug bridge starting on port ${port}`);
server.listen({ host: '::1', port, ipv6Only: true }, () => {
  console.log(`IPv6 debug bridge ready on port ${port}`);
});
