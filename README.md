# Gemini Vertex

`gemini-vertex` is a lightweight, drop-in replacement script for the official Gemini CLI that seamlessly routes requests to non-Gemini models hosted on Google Cloud Vertex AI, such as Anthropic's Claude 4.6 Opus and Claude 4.5 Haiku. It achieves this by spinning up an ephemeral, local translation proxy that intercepts the Google GenAI formatted requests emitted by the Gemini CLI, translates them into the Anthropic Messages API format on the fly, and securely authenticates with Vertex AI using your existing Application Default Credentials (ADC).

Whether you prefer the official Gemini CLI's workflow, or your development environment requires its use, you may still want to explore the unique capabilities of other models available on Vertex AI, like Anthropic's Claude. Because these models speak a different API schema, they aren't natively compatible out of the box. By utilizing this tool, you get to keep the CLI's native interface, dynamic `auto` routing logic, and powerful tool integrations, while the actual inference is seamlessly powered by the Vertex AI model of your choice.

## Installation

You can install `gemini-vertex` globally directly from GitHub using `npm`:

```bash
npm install -g github:owahltinez/gemini-vertex
```

Alternatively, you can run it on-the-fly without installing it globally using `npx`:

```bash
npx github:owahltinez/gemini-vertex "Tell me a joke" --model claude-opus-4-6
```

## Getting Started
To use the tool, ensure you are authenticated with Google Cloud:

```bash
gcloud auth application-default login
gcloud config set project <YOUR_PROJECT_ID>
```

Then, simply run `gemini-vertex` exactly as you would run `gemini`.

The proxy intelligently inspects the target model name at the network level:
- If the model name contains `claude` (e.g., `claude-opus-4-6`), the proxy translates the Gemini CLI's internal Google GenAI format into the Anthropic Messages API format and forwards it to the Vertex AI Anthropic endpoint.
- If the model is a native Google model (like the CLI's internal `gemini-2.5-flash-lite` router calls), the proxy passes the request straight through to the standard Vertex AI Google endpoint completely untouched.

```bash
# Explicitly use Claude 4.6 Opus for complex software tasks
./gemini-vertex --model claude-opus-4-6 "Refactor this python script"
```

If the model you want is only available in a specific Google Cloud region (like `us-east5`), set the location before running the tool:

```bash
export GOOGLE_CLOUD_LOCATION="us-east5"
./gemini-vertex "Analyze this data"
```

### Handling Shell Aliases
If your `gemini` command is a shell alias or function rather than a global binary in your `PATH`, Node.js won't be able to execute it directly. You can override the execution command by setting the `GEMINI_COMMAND` environment variable:

```bash
export GEMINI_COMMAND="npx --yes @google/gemini-cli@latest"
# Or
export GEMINI_COMMAND="node /absolute/path/to/gemini/dist/src/index.js"

gemini-vertex "Tell me a joke"
```
