#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const serverPath = path.join(__dirname, 'server.js');

// Spawn the proxy server
const proxyProcess = spawn(process.execPath, [serverPath], {
  stdio: ['ignore', 'pipe', 'inherit'] // Pipe stdout so we can read the PORT
});

let proxyPort = null;

// Wait for the proxy to output its assigned port
proxyProcess.stdout.on('data', (data) => {
  const output = data.toString();
  const match = output.match(/PORT=(\d+)/);
  if (match && !proxyPort) {
    proxyPort = match[1];
    startGemini(proxyPort);
  }
});

// Ensure the proxy is killed if the main process exits
process.on('exit', () => {
  if (!proxyProcess.killed) proxyProcess.kill();
});

['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    if (!proxyProcess.killed) proxyProcess.kill();
    process.exit(1);
  });
});

function startGemini(port) {
  // Wait for the health check to pass
  const checkHealth = () => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      if (res.statusCode === 200) {
        runGemini(port);
      } else {
        setTimeout(checkHealth, 100);
      }
    });
    
    req.on('error', () => {
      setTimeout(checkHealth, 100);
    });
  };
  checkHealth();
}

function runGemini(port) {
  // Configure Gemini CLI environment variables for the proxy
  const env = Object.assign({}, process.env, {
    GOOGLE_GENAI_USE_VERTEXAI: 'true',
    GOOGLE_VERTEX_BASE_URL: `http://127.0.0.1:${port}`,
    GEMINI_API_KEY_AUTH_MECHANISM: 'bearer',
    GOOGLE_API_KEY: 'dummy-key-for-proxy', // Prevent SDK crash
  });

  if (!env.GOOGLE_CLOUD_LOCATION) {
    env.GOOGLE_CLOUD_LOCATION = 'us-east5';
  }

  const args = process.argv.slice(2);
  
  // Pass control to the globally installed gemini CLI
  const geminiProcess = spawn('gemini', args, {
    stdio: 'inherit',
    env
  });

  geminiProcess.on('exit', (code) => {
    process.exit(code !== null ? code : 1);
  });
}
