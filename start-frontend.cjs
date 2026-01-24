const { spawn } = require('child_process');
const path = require('path');

// Run vite.js directly with node
const vitePath = path.join(__dirname, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js');

const vite = spawn('node', [vitePath], {
  cwd: path.join(__dirname, 'frontend'),
  stdio: 'inherit',
  shell: false
});

vite.on('error', (err) => {
  console.error('Failed to start vite:', err);
  process.exit(1);
});

vite.on('close', (code) => {
  console.log(`Vite process exited with code ${code}`);
  process.exit(code);
});
