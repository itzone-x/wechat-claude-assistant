const args = process.argv.slice(2);

if (args.includes('--resume')) {
  const index = args.indexOf('--resume');
  const sessionId = args[index + 1] || 'unknown';
  console.error(`No conversation found with session ID: ${sessionId}`);
  process.exit(1);
}

console.log(JSON.stringify(args));
process.exit(0);
