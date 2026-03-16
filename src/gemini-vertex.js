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
    GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${port}`,
    GEMINI_API_KEY_AUTH_MECHANISM: 'bearer',
    GEMINI_API_KEY: 'proxy-placeholder-key', // Satisfy CLI and SDK without warnings
  });
  
  delete env.GOOGLE_API_KEY; // Ensure GOOGLE_API_KEY is not set to avoid warnings

  if (!env.GOOGLE_CLOUD_LOCATION) {
    env.GOOGLE_CLOUD_LOCATION = 'us-east5';
  }

  const args = process.argv.slice(2);
  
  // Allow users to override the 'gemini' command if it's an alias or not in PATH
  const commandString = process.env.GEMINI_COMMAND || 'gemini';
  const commandParts = commandString.split(' ');
  const cmd = commandParts[0];
  const cmdArgs = commandParts.slice(1).concat(args);
  
  // Pass control to the globally installed gemini CLI
  const geminiProcess = spawn(cmd, cmdArgs, {
    stdio: 'inherit',
    env
  });

  geminiProcess.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error(`\n[gemini-vertex] Error: Could not execute '${cmd}'.`);
      console.error(`If 'gemini' is a shell alias or function, Node.js cannot execute it directly.`);
      console.error(`\nPlease set the GEMINI_COMMAND environment variable to point to the actual binary or an npx command. For example:`);
      console.error(`  export GEMINI_COMMAND="npx @google/gemini-cli"`);
      console.error(`  export GEMINI_COMMAND="node /path/to/gemini/dist/src/index.js"`);
      console.error(`\nThen try running gemini-vertex again.\n`);
    } else {
      console.error(`[gemini-vertex] Failed to start Gemini CLI:`, err);
    }
    process.exit(1);
  });

  geminiProcess.on('exit', (code) => {
    process.exit(code !== null ? code : 1);
  });
}
