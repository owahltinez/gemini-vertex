const http = require('http');
const https = require('https');
const { GoogleAuth } = require('google-auth-library');

const auth = new GoogleAuth({
  scopes: 'https://www.googleapis.com/auth/cloud-platform'
});

function extractModel(url) {
  const match = url.match(/\/models\/([^:]+):/);
  return match ? match[1] : '';
}

function translateToAnthropic(geminiReq) {
  const messages = (geminiReq.contents || []).map(c => ({
    role: c.role === 'model' ? 'assistant' : 'user',
    content: (c.parts || []).map(p => p.text || '').join('')
  })).filter(m => m.content && m.content.trim() !== '');

  if (messages.length === 0) {
    messages.push({ role: 'user', content: ' ' });
  }

  let system = undefined;
  if (geminiReq.systemInstruction && geminiReq.systemInstruction.parts) {
    system = geminiReq.systemInstruction.parts.map(p => p.text || '').join('');
  }

  if (geminiReq.generationConfig) {
    if (geminiReq.generationConfig.responseMimeType === 'application/json' || geminiReq.generationConfig.responseSchema) {
       const schemaStr = geminiReq.generationConfig.responseSchema ? JSON.stringify(geminiReq.generationConfig.responseSchema) : '';
       const jsonPrompt = `\n\nRespond ONLY with valid JSON${schemaStr ? ` matching this schema: ${schemaStr}` : ''}. Do not include any markdown formatting like \`\`\`json.`;
       system = system ? system + jsonPrompt : jsonPrompt;
    }
  }

  let anthropicReq = {
    anthropic_version: "vertex-2023-10-16",
    messages,
    max_tokens: 8192,
  };

  if (system && system.trim() !== '') {
    anthropicReq.system = system;
  }

  if (geminiReq.generationConfig && geminiReq.generationConfig.temperature !== undefined) {
    anthropicReq.temperature = Math.max(geminiReq.generationConfig.temperature, 0.001);
  }

  return anthropicReq;
}

async function getAuthToken(req) {
  if (process.env.GOOGLE_ACCESS_TOKEN) return `Bearer ${process.env.GOOGLE_ACCESS_TOKEN}`;

  try {
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    if (tokenResponse && tokenResponse.token) {
      return `Bearer ${tokenResponse.token}`;
    }
  } catch (e) {
    // console.error("PROXY: Failed to get token from ADC:", e.message);
  }

  const authHeader = req.headers['authorization'];
  if (authHeader && !authHeader.includes('proxy-placeholder-key') && authHeader.startsWith('Bearer ya29.')) {
    return authHeader;
  }

  return null;
}

async function handleRequest(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200); res.end('OK'); return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405); res.end(); return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const geminiReq = JSON.parse(body);
      const modelId = extractModel(req.url);
      
      let projectId = process.env.GOOGLE_CLOUD_PROJECT;
      if (!projectId) {
        try {
          projectId = await auth.getProjectId();
        } catch(e) {
          // console.error("PROXY ERROR: Failed to get project ID from ADC.", e.message);
        }
      }

      const region = process.env.GOOGLE_CLOUD_LOCATION || 'us-east5';
      const isStream = req.url.includes('streamGenerateContent');
      
      const token = await getAuthToken(req);
      if (!token || !projectId) {
        console.error("\n[gemini-vertex] PROXY ERROR: No valid OAuth token or Project ID found.");
        console.error("Please run: gcloud auth application-default login && gcloud config set project YOUR_PROJECT_ID");
        console.error("Alternatively, set GOOGLE_CLOUD_PROJECT and GOOGLE_ACCESS_TOKEN environment variables.\n");
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: { 
            code: 401, 
            message: "Unauthenticated. Please run 'gcloud auth application-default login' and ensure your default project is set." 
          } 
        }));
        return;
      }

      let apiPath, payload, isAnthropic = false;

      if (modelId.includes('claude')) {
        isAnthropic = true;
        apiPath = `/v1/projects/${projectId}/locations/${region}/publishers/anthropic/models/${modelId}:${isStream ? 'streamRawPredict' : 'rawPredict'}`;
        payload = translateToAnthropic(geminiReq);
        if (isStream) payload.stream = true;
      } else {
        // Assume Google/Gemini natively
        apiPath = `/v1/projects/${projectId}/locations/${region}/publishers/google/models/${modelId}:${isStream ? 'streamGenerateContent' : 'generateContent'}`;
        payload = geminiReq;
      }

      const options = {
        hostname: `${region}-aiplatform.googleapis.com`,
        path: apiPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token,
        }
      };

      const proxyReq = https.request(options, (proxyRes) => {
        if (proxyRes.statusCode !== 200) {
          let errBody = '';
          proxyRes.on('data', c => errBody += c.toString());
          proxyRes.on('end', () => {
            res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
            res.end(errBody);
          });
          return;
        }

        if (isAnthropic) {
          if (isStream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            let buffer = '';
            proxyRes.on('data', (chunk) => {
              buffer += chunk.toString();
              const lines = buffer.split('\n');
              buffer = lines.pop();

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.type === 'content_block_delta' && data.delta && data.delta.text) {
                      res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: data.delta.text }] } }] })}\n\n`);
                    } else if (data.type === 'message_stop') {
                      res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP' }] })}\n\n`);
                    }
                  } catch (e) {}
                }
              }
            });
            proxyRes.on('end', () => res.end());
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            let buffer = '';
            proxyRes.on('data', c => buffer += c.toString());
            proxyRes.on('end', () => {
              try {
                const data = JSON.parse(buffer);
                const text = data.content ? data.content.map(c => c.text).join('') : '';
                res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }));
              } catch (e) {
                res.end(buffer);
              }
            });
          }
        } else {
          // Native Gemini pass-through
          res.writeHead(200, proxyRes.headers);
          proxyRes.pipe(res);
        }
      });

      proxyReq.on('error', (err) => {
        console.error("[gemini-vertex] PROXY ERROR: Failed to connect to upstream:", err.message);
        res.writeHead(500); res.end();
      });

      proxyReq.write(JSON.stringify(payload));
      proxyReq.end();
    } catch (err) {
      console.error("[gemini-vertex] PROXY ERROR:", err.message);
      res.writeHead(500); res.end();
    }
  });
}

if (require.main === module) {
  const server = http.createServer(handleRequest);
  server.listen(0, '127.0.0.1', () => {
    console.log(`PORT=${server.address().port}`);
  });
}

module.exports = {
  extractModel,
  translateToAnthropic,
  handleRequest
};
