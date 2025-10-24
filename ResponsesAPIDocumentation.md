# Migrate to the Responses API

The [Responses API](/docs/api-reference/responses) is our new API primitive, an evolution of [Chat Completions](/docs/api-reference/chat) which brings added simplicity and powerful agentic primitives to your integrations.

**While Chat Completions remains supported, Responses is recommended for all new projects.**

## About the Responses API

The Responses API is a unified interface for building powerful, agent-like applications. It contains:

- Built-in tools like [web search](/docs/guides/tools-web-search), [file search](/docs/guides/tools-file-search) , [computer use](/docs/guides/tools-computer-use), [code interpreter](/docs/guides/tools-code-interpreter), and [remote MCPs](/docs/guides/tools-remote-mcp).
- Seamless multi-turn interactions that allow you to pass previous responses for higher accuracy reasoning results.
- Native multimodal support for text and images.

## Responses benefits

The Responses API contains several benefits over Chat Completions:

- **Better performance**: Using reasoning models, like GPT-5, with Responses will result in better model intelligence when compared to Chat Completions. Our internal evals reveal a 3% improvement in SWE-bench with same prompt and setup.
- **Agentic by default**: The Responses API is an agentic loop, allowing the model to call multiple tools, like `web_search`, `image_generation`, `file_search`, `code_interpreter`, remote MCP servers, as well as your own custom functions, within the span of one API request.
- **Lower costs**: Results in lower costs due to improved cache utilization (40% to 80% improvement when compared to Chat Completions in internal tests).
- **Stateful context**: Use `store: true` to maintain state from turn to turn, preserving reasoning and tool context from turn-to-turn.
- **Flexible inputs**: Pass a string with input or a list of messages; use instructions for system-level guidance.
- **Encrypted reasoning**: Opt-out of statefulness while still benefiting from advanced reasoning.
- **Future-proof**: Future-proofed for upcoming models.

| Capabilities        | Chat Completions API | Responses API |
| ------------------- | -------------------- | ------------- |
| Text generation     |                      |               |
| Audio               |                      | Coming soon   |
| Vision              |                      |               |
| Structured Outputs  |                      |               |
| Function calling    |                      |               |
| Web search          |                      |               |
| File search         |                      |               |
| Computer use        |                      |               |
| Code interpreter    |                      |               |
| MCP                 |                      |               |
| Image generation    |                      |               |
| Reasoning summaries |                      |               |

### Examples

See how the Responses API compares to the Chat Completions API in specific scenarios.

#### Messages vs. Items

Both APIs make it easy to generate output from our models. The input to, and result of, a call to Chat completions is an array of _Messages_, while the Responses API uses _Items_. An Item is a union of many types, representing the range of possibilities of model actions. A `message` is a type of Item, as is a `function_call` or `function_call_output`. Unlike a Chat Completions Message, where many concerns are glued together into one object, Items are distinct from one another and better represent the basic unit of model context.

Additionally, Chat Completions can return multiple parallel generations as `choices`, using the `n` param. In Responses, we've removed this param, leaving only one generation.

Chat Completions API

```python
from openai import OpenAI
client = OpenAI()

completion = client.chat.completions.create(
  model="gpt-5",
  messages=[
      {
          "role": "user",
          "content": "Write a one-sentence bedtime story about a unicorn."
      }
  ]
)

print(completion.choices[0].message.content)
```

Responses API

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
  model="gpt-5",
  input="Write a one-sentence bedtime story about a unicorn."
)

print(response.output_text)
```

When you get a response back from the Responses API, the fields differ slightly. Instead of a `message`, you receive a typed `response` object with its own `id`. Responses are stored by default. Chat completions are stored by default for new accounts. To disable storage when using either API, set `store: false`.

The objects you recieve back from these APIs will differ slightly. In Chat Completions, you receive an array of `choices`, each containing a `message`. In Responses, you receive an array of Items labled `output`.

Chat Completions API

```json
{
  "id": "chatcmpl-C9EDpkjH60VPPIB86j2zIhiR8kWiC",
  "object": "chat.completion",
  "created": 1756315657,
  "model": "gpt-5-2025-08-07",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Under a blanket of starlight, a sleepy unicorn tiptoed through moonlit meadows, gathering dreams like dew to tuck beneath its silver mane until morning.",
        "refusal": null,
        "annotations": []
      },
      "finish_reason": "stop"
    }
  ],
  ...
}
```

Responses API

```json
{
  "id": "resp_68af4030592c81938ec0a5fbab4a3e9f05438e46b5f69a3b",
  "object": "response",
  "created_at": 1756315696,
  "model": "gpt-5-2025-08-07",
  "output": [
    {
      "id": "rs_68af4030baa48193b0b43b4c2a176a1a05438e46b5f69a3b",
      "type": "reasoning",
      "content": [],
      "summary": []
    },
    {
      "id": "msg_68af40337e58819392e935fb404414d005438e46b5f69a3b",
      "type": "message",
      "status": "completed",
      "content": [
        {
          "type": "output_text",
          "annotations": [],
          "logprobs": [],
          "text": "Under a quilt of moonlight, a drowsy unicorn wandered through quiet meadows, brushing blossoms with her glowing horn so they sighed soft lullabies that carried every dreamer gently to sleep."
        }
      ],
      "role": "assistant"
    }
  ],
  ...
}
```

### Additional differences

- Responses are stored by default. Chat completions are stored by default for new accounts. To disable storage in either API, set `store: false`.
- [Reasoning](/docs/guides/reasoning) models have a richer experience in the Responses API with [improved tool usage](/docs/guides/reasoning#keeping-reasoning-items-in-context).
- Structured Outputs API shape is different. Instead of `response_format`, use `text.format` in Responses. Learn more in the [Structured Outputs](/docs/guides/structured-outputs) guide.
- The function-calling API shape is different, both for the function config on the request, and function calls sent back in the response. See the full difference in the [function calling guide](/docs/guides/function-calling).
- The Responses SDK has an `output_text` helper, which the Chat Completions SDK does not have.
- In Chat Completions, conversation state must be managed manually. The Responses API has compatibility with the Conversations API for persistent conversations, or the ability to pass a `previous_response_id` to easily chain Responses together.

## Migrating from Chat Completions

### 1\. Update generation endpoints

Start by updating your generation endpoints from `post /v1/chat/completions` to `post /v1/responses`.

If you are not using functions or multimodal inputs, then you're done! Simple message inputs are compatible from one API to the other:

Web search tool

```bash
INPUT='[
  { "role": "system", "content": "You are a helpful assistant." },
  { "role": "user", "content": "Hello!" }
]'

curl -s https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d "{
    \"model\": \"gpt-5\",
    \"messages\": $INPUT
  }"

curl -s https://api.openai.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d "{
    \"model\": \"gpt-5\",
    \"input\": $INPUT
  }"
```

```javascript
const context = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello!' },
];

const completion = await client.chat.completions.create({
  model: 'gpt-5',
  messages: messages,
});

const response = await client.responses.create({
  model: 'gpt-5',
  input: context,
});
```

```python
context = [
  { "role": "system", "content": "You are a helpful assistant." },
  { "role": "user", "content": "Hello!" }
]

completion = client.chat.completions.create(
  model="gpt-5",
  messages=messages
)

response = client.responses.create(
  model="gpt-5",
  input=context
)
```

Chat Completions

With Chat Completions, you need to create an array of messages that specify different roles and content for each role.

Generate text from a model

```javascript
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const completion = await client.chat.completions.create({
  model: 'gpt-5',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
  ],
});
console.log(completion.choices[0].message.content);
```

```python
from openai import OpenAI
client = OpenAI()

completion = client.chat.completions.create(
    model="gpt-5",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"}
    ]
)
print(completion.choices[0].message.content)
```

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
      "model": "gpt-5",
      "messages": [
          {"role": "system", "content": "You are a helpful assistant."},
          {"role": "user", "content": "Hello!"}
      ]
  }'
```

Responses

With Responses, you can separate instructions and input at the top-level. The API shape is similar to Chat Completions but has cleaner semantics.

Generate text from a model

```javascript
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const response = await client.responses.create({
  model: 'gpt-5',
  instructions: 'You are a helpful assistant.',
  input: 'Hello!',
});

console.log(response.output_text);
```

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
    model="gpt-5",
    instructions="You are a helpful assistant.",
    input="Hello!"
)
print(response.output_text)
```

```bash
curl https://api.openai.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
      "model": "gpt-5",
      "instructions": "You are a helpful assistant.",
      "input": "Hello!"
  }'
```

### 2\. Update item definitions

Chat Completions

With Chat Completions, you need to create an array of messages that specify different roles and content for each role.

Generate text from a model

```javascript
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const completion = await client.chat.completions.create({
  model: 'gpt-5',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
  ],
});
console.log(completion.choices[0].message.content);
```

```python
from openai import OpenAI
client = OpenAI()

completion = client.chat.completions.create(
    model="gpt-5",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"}
    ]
)
print(completion.choices[0].message.content)
```

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
      "model": "gpt-5",
      "messages": [
          {"role": "system", "content": "You are a helpful assistant."},
          {"role": "user", "content": "Hello!"}
      ]
  }'
```

Responses

With Responses, you can separate instructions and input at the top-level. The API shape is similar to Chat Completions but has cleaner semantics.

Generate text from a model

```javascript
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const response = await client.responses.create({
  model: 'gpt-5',
  instructions: 'You are a helpful assistant.',
  input: 'Hello!',
});

console.log(response.output_text);
```

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
    model="gpt-5",
    instructions="You are a helpful assistant.",
    input="Hello!"
)
print(response.output_text)
```

```bash
curl https://api.openai.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
      "model": "gpt-5",
      "instructions": "You are a helpful assistant.",
      "input": "Hello!"
  }'
```

### 3\. Update multi-turn conversations

If you have multi-turn conversations in your application, update your context logic.

Chat Completions

In Chat Completions, you have to store and manage context yourself.

Multi-turn conversation

```javascript
let messages = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'What is the capital of France?' },
];
const res1 = await client.chat.completions.create({
  model: 'gpt-5',
  messages,
});

messages = messages.concat([res1.choices[0].message]);
messages.push({ role: 'user', content: 'And its population?' });

const res2 = await client.chat.completions.create({
  model: 'gpt-5',
  messages,
});
```

```python
messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is the capital of France?"}
]
res1 = client.chat.completions.create(model="gpt-5", messages=messages)

messages += [res1.choices[0].message]
messages += [{"role": "user", "content": "And its population?"}]

res2 = client.chat.completions.create(model="gpt-5", messages=messages)
```

Responses

With responses, the pattern is similar, you can pass outputs from one response to the input of another.

Multi-turn conversation

```python
context = [
    { "role": "role", "content": "What is the capital of France?" }
]
res1 = client.responses.create(
    model="gpt-5",
    input=context,
)

// Append the first response’s output to context
context += res1.output

// Add the next user message
context += [
    { "role": "role", "content": "And it's population?" }
]

res2 = client.responses.create(
    model="gpt-5",
    input=context,
)
```

```javascript
let context = [{ role: 'role', content: 'What is the capital of France?' }];

const res1 = await client.responses.create({
  model: 'gpt-5',
  input: context,
});

// Append the first response’s output to context
context = context.concat(res1.output);

// Add the next user message
context.push({ role: 'role', content: 'And its population?' });

const res2 = await client.responses.create({
  model: 'gpt-5',
  input: context,
});
```

As a simplification, we've also built a way to simply reference inputs and outputs from a previous response by passing its id. You can use \`previous_response_id\` to form chains of responses that build upon one other or create forks in a history.

Multi-turn conversation

```javascript
const res1 = await client.responses.create({
  model: 'gpt-5',
  input: 'What is the capital of France?',
  store: true,
});

const res2 = await client.responses.create({
  model: 'gpt-5',
  input: 'And its population?',
  previous_response_id: res1.id,
  store: true,
});
```

```python
res1 = client.responses.create(
    model="gpt-5",
    input="What is the capital of France?",
    store=True
)

res2 = client.responses.create(
    model="gpt-5",
    input="And its population?",
    previous_response_id=res1.id,
    store=True
)
```

### 4\. Decide when to use statefulness

Some organizations—such as those with Zero Data Retention (ZDR) requirements—cannot use the Responses API in a stateful way due to compliance or data retention policies. To support these cases, OpenAI offers encrypted reasoning items, allowing you to keep your workflow stateless while still benefiting from reasoning items.

To disable statefulness, but still take advantage of reasoning:

- set `store: false` in the [store field](/docs/api-reference/responses/create#responses_create-store)
- add `["reasoning.encrypted_content"]` to the [include field](/docs/api-reference/responses/create#responses_create-include)

The API will then return an encrypted version of the reasoning tokens, which you can pass back in future requests just like regular reasoning items. For ZDR organizations, OpenAI enforces store=false automatically. When a request includes encrypted_content, it is decrypted in-memory (never written to disk), used for generating the next response, and then securely discarded. Any new reasoning tokens are immediately encrypted and returned to you, ensuring no intermediate state is ever persisted.

### 5\. Update function definitions

There are two minor, but notable, differences in how functions are defined between Chat Completions and Responses.

1.  In Chat Completions, functions are defined using externally tagged polymorphism, whereas in Responses, they are internally-tagged.
2.  In Chat Completions, functions are non-strict by default, whereas in the Responses API, functions _are_ strict by default.

The Responses API function example on the right is functionally equivalent to the Chat Completions example on the left.

Chat Completions API

```javascript
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "Determine weather in my location",
    "strict": true,
    "parameters": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
        },
      },
      "additionalProperties": false,
      "required": [
        "location",
        "unit"
      ]
    }
  }
}
```

Responses API

```javascript
{
  "type": "function",
  "name": "get_weather",
  "description": "Determine weather in my location",
  "parameters": {
    "type": "object",
    "properties": {
      "location": {
        "type": "string",
      },
    },
    "additionalProperties": false,
    "required": [
      "location",
      "unit"
    ]
  }
}
```

#### Follow function-calling best practices

In Responses, tool calls and their outputs are two distinct types of Items that are correlated using a `call_id`. See the [tool calling docs](/docs/guides/function-calling#function-tool-example) for more detail on how function calling works in Responses.

### 6\. Update Structured Outputs definition

In the Responses API, defining structured outputs have moved from `response_format` to `text.format`:

Chat Completions

Structured Outputs

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
  "model": "gpt-5",
  "messages": [
    {
      "role": "user",
      "content": "Jane, 54 years old",
    }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "person",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          },
          "age": {
            "type": "number",
            "minimum": 0,
            "maximum": 130
          }
        },
        "required": [
          "name",
          "age"
        ],
        "additionalProperties": false
      }
    }
  },
  "verbosity": "medium",
  "reasoning_effort": "medium"
}'
```

```python
from openai import OpenAI
client = OpenAI()

response = client.chat.completions.create(
  model="gpt-5",
  messages=[
    {
      "role": "user",
      "content": "Jane, 54 years old",
    }
  ],
  response_format={
    "type": "json_schema",
    "json_schema": {
      "name": "person",
      "strict": True,
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          },
          "age": {
            "type": "number",
            "minimum": 0,
            "maximum": 130
          }
        },
        "required": [
          "name",
          "age"
        ],
        "additionalProperties": False
      }
    }
  },
  verbosity="medium",
  reasoning_effort="medium"
)
```

```javascript
const completion = await openai.chat.completions.create({
  model: 'gpt-5',
  messages: [
    {
      role: 'user',
      content: 'Jane, 54 years old',
    },
  ],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'person',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            minLength: 1,
          },
          age: {
            type: 'number',
            minimum: 0,
            maximum: 130,
          },
        },
        required: [name, age],
        additionalProperties: false,
      },
    },
  },
  verbosity: 'medium',
  reasoning_effort: 'medium',
});
```

Responses

Structured Outputs

```bash
curl https://api.openai.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
  "model": "gpt-5",
  "input": "Jane, 54 years old",
  "text": {
    "format": {
      "type": "json_schema",
      "name": "person",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          },
          "age": {
            "type": "number",
            "minimum": 0,
            "maximum": 130
          }
        },
        "required": [
          "name",
          "age"
        ],
        "additionalProperties": false
      }
    }
  }
}'
```

```python
response = client.responses.create(
  model="gpt-5",
  input="Jane, 54 years old",
  text={
    "format": {
      "type": "json_schema",
      "name": "person",
      "strict": True,
      "schema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          },
          "age": {
            "type": "number",
            "minimum": 0,
            "maximum": 130
          }
        },
        "required": [
          "name",
          "age"
        ],
        "additionalProperties": False
      }
    }
  }
)
```

```javascript
const response = await openai.responses.create({
  model: 'gpt-5',
  input: 'Jane, 54 years old',
  text: {
    format: {
      type: 'json_schema',
      name: 'person',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            minLength: 1,
          },
          age: {
            type: 'number',
            minimum: 0,
            maximum: 130,
          },
        },
        required: [name, age],
        additionalProperties: false,
      },
    },
  },
});
```

### 7\. Upgrade to native tools

If your application has use cases that would benefit from OpenAI's native [tools](/docs/guides/tools), you can update your tool calls to use OpenAI's tools out of the box.

Chat Completions

With Chat Completions, you cannot use OpenAI's tools natively and have to write your own.

Web search tool

```javascript
async function web_search(query) {
  const fetch = (await import('node-fetch')).default;
  const res = await fetch(`https://api.example.com/search?q=${query}`);
  const data = await res.json();
  return data.results;
}

const completion = await client.chat.completions.create({
  model: 'gpt-5',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Who is the current president of France?' },
  ],
  functions: [
    {
      name: 'web_search',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  ],
});
```

```python
import requests

def web_search(query):
    r = requests.get(f"https://api.example.com/search?q={query}")
    return r.json().get("results", [])

completion = client.chat.completions.create(
    model="gpt-5",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Who is the current president of France?"}
    ],
    functions=[
        {
            "name": "web_search",
            "description": "Search the web for information",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"]
            }
        }
    ]
)
```

```bash
curl https://api.example.com/search \
  -G \
  --data-urlencode "q=your+search+term" \
  --data-urlencode "key=$SEARCH_API_KEY"
```

Responses

With Responses, you can simply specify the tools that you are interested in.

Web search tool

```javascript
const answer = await client.responses.create({
  model: 'gpt-5',
  input: 'Who is the current president of France?',
  tools: [{ type: 'web_search' }],
});

console.log(answer.output_text);
```

```python
answer = client.responses.create(
    model="gpt-5",
    input="Who is the current president of France?",
    tools=[{"type": "web_search_preview"}]
)

print(answer.output_text)
```

```bash
curl https://api.openai.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-5",
    "input": "Who is the current president of France?",
    "tools": [{"type": "web_search"}]
  }'
```

## Incremental migration

The Responses API is a superset of the Chat Completions API. The Chat Completions API will also continue to be supported. As such, you can incrementally adopt the Responses API if desired. You can migrate user flows who would benefit from improved reasoning models to the Responses API while keeping other flows on the Chat Completions API until you're ready for a full migration.

As a best practice, we encourage all users to migrate to the Responses API to take advantage of the latest features and improvements from OpenAI.

## Assistants API

Based on developer feedback from the [Assistants API](/docs/api-reference/assistants) beta, we've incorporated key improvements into the Responses API to make it more flexible, faster, and easier to use. The Responses API represents the future direction for building agents on OpenAI.

We now have Assistant-like and Thread-like objects in the Responses API. Learn more in the [migration guide](/docs/guides/assistants/migration). As of August 26th, 2025, we're deprecating the Assistants API, with a sunset date of August 26, 2026.

Was this page useful?

# Developer quickstart

Take your first steps with the OpenAI API.

The OpenAI API provides a simple interface to state-of-the-art AI [models](/docs/models) for text generation, natural language processing, computer vision, and more. Get started by creating an API Key and running your first API call. Discover how to generate text, analyze images, build agents, and more.

## Create and export an API key

[Create an API Key](https://platform.openai.com/api-keys)

Before you begin, create an API key in the dashboard, which you'll use to securely [access the API](/docs/api-reference/authentication). Store the key in a safe location, like a [`.zshrc` file](https://www.freecodecamp.org/news/how-do-zsh-configuration-files-work/) or another text file on your computer. Once you've generated an API key, export it as an [environment variable](https://en.wikipedia.org/wiki/Environment_variable) in your terminal.

macOS / Linux

Export an environment variable on macOS or Linux systems

```bash
export OPENAI_API_KEY="your_api_key_here"
```

Windows

Export an environment variable in PowerShell

```bash
setx OPENAI_API_KEY "your_api_key_here"
```

OpenAI SDKs are configured to automatically read your API key from the system environment.

## Install the OpenAI SDK and Run an API Call

JavaScript

To use the OpenAI API in server-side JavaScript environments like Node.js, Deno, or Bun, you can use the official [OpenAI SDK for TypeScript and JavaScript](https://github.com/openai/openai-node). Get started by installing the SDK using [npm](https://www.npmjs.com/) or your preferred package manager:

Install the OpenAI SDK with npm

```bash
npm install openai
```

With the OpenAI SDK installed, create a file called `example.mjs` and copy the example code into it:

Test a basic API request

```javascript
import OpenAI from 'openai';
const client = new OpenAI();

const response = await client.responses.create({
  model: 'gpt-5',
  input: 'Write a one-sentence bedtime story about a unicorn.',
});

console.log(response.output_text);
```

Execute the code with `node example.mjs` (or the equivalent command for Deno or Bun). In a few moments, you should see the output of your API request.

[

Learn more on GitHub

Discover more SDK capabilities and options on the library's GitHub README.

](https://github.com/openai/openai-node)

Python

To use the OpenAI API in Python, you can use the official [OpenAI SDK for Python](https://github.com/openai/openai-python). Get started by installing the SDK using [pip](https://pypi.org/project/pip/):

Install the OpenAI SDK with pip

```bash
pip install openai
```

With the OpenAI SDK installed, create a file called `example.py` and copy the example code into it:

Test a basic API request

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
    model="gpt-5",
    input="Write a one-sentence bedtime story about a unicorn."
)

print(response.output_text)
```

Execute the code with `python example.py`. In a few moments, you should see the output of your API request.

[

Learn more on GitHub

Discover more SDK capabilities and options on the library's GitHub README.

](https://github.com/openai/openai-python)

.NET

In collaboration with Microsoft, OpenAI provides an officially supported API client for C#. You can install it with the .NET CLI from [NuGet](https://www.nuget.org/).

```text
dotnet add package OpenAI
```

A simple API request to the [Responses API](/docs/api-reference/responses) would look like this:

```csharp
using System;
using System.Threading.Tasks;
using OpenAI;

class Program
{
    static async Task Main()
    {
        var client = new OpenAIClient(
            Environment.GetEnvironmentVariable("OPENAI_API_KEY")
        );

        var response = await client.Responses.CreateAsync(new ResponseCreateRequest
        {
            Model = "gpt-5",
            Input = "Say 'this is a test.'"
        });

        Console.WriteLine($"[ASSISTANT]: {response.OutputText}");
    }
}
```

To learn more about using the OpenAI API in .NET, check out the GitHub repo linked below!

[

Learn more on GitHub

Discover more SDK capabilities and options on the library's GitHub README.

](https://github.com/openai/openai-dotnet)

Java

OpenAI provides an API helper for the Java programming language, currently in beta. You can include the Maven dependency using the following configuration:

```xml
<dependency>
  <groupId>com.openai</groupId>
  <artifactId>openai-java</artifactId>
  <version>4.0.0</version>
</dependency>
```

A simple API request to [Responses API](/docs/api-reference/responses) would look like this:

```java
import com.openai.client.OpenAIClient;
import com.openai.client.okhttp.OpenAIOkHttpClient;
import com.openai.models.responses.Response;
import com.openai.models.responses.ResponseCreateParams;

public class Main {
    public static void main(String[] args) {
        // Create client from environment variables
        OpenAIClient client = OpenAIOkHttpClient.fromEnv();

        ResponseCreateParams params = ResponseCreateParams.builder()
                .input("Say this is a test")
                .model("gpt-5")
                .build();

        Response response = client.responses().create(params);
        System.out.println(response.outputText());
    }
}
```

To learn more about using the OpenAI API in Java, check out the GitHub repo linked below!

[

Learn more on GitHub

Discover more SDK capabilities and options on the library's GitHub README.

](https://github.com/openai/openai-java)

Go

OpenAI provides an API helper for the Go programming language, currently in beta. You can import the library using the code below:

```golang
import (
  "github.com/openai/openai-go" // imported as openai
)
```

A simple API request to the [Responses API](/docs/api-reference/responses) would look like this:

```golang
package main

import (
	"context"
	"fmt"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

func main() {
	client := openai.NewClient(
		option.WithAPIKey("My API Key"), // or set OPENAI_API_KEY in your env
	)

	resp, err := client.Responses.New(context.TODO(), openai.ResponseNewParams{
		Model: openai.F("gpt-5"),
		Input: openai.F("Say this is a test"),
	})
	if err != nil {
		panic(err.Error())
	}

	fmt.Println(resp.OutputText)
}
```

To learn more about using the OpenAI API in Go, check out the GitHub repo linked below!

[

Learn more on GitHub

Discover more SDK capabilities and options on the library's GitHub README.

](https://github.com/openai/openai-go)

[

Responses starter app

Start building with the Responses API.

](https://github.com/openai/openai-responses-starter-app)[

Text generation and prompting

Learn more about prompting, message roles, and building conversational apps.

](/docs/guides/text)

## Analyze images and files

Send image URLs, uploaded files, or PDF documents directly to the model to extract text, classify content, or detect visual elements.

Image URL

Analyze the content of an image

```javascript
import OpenAI from 'openai';
const client = new OpenAI();

const response = await client.responses.create({
  model: 'gpt-5',
  input: [
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'What is in this image?',
        },
        {
          type: 'input_image',
          image_url: 'https://openai-documentation.vercel.app/images/cat_and_otter.png',
        },
      ],
    },
  ],
});

console.log(response.output_text);
```

```bash
curl "https://api.openai.com/v1/responses" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -d '{
        "model": "gpt-5",
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": "What is in this image?"
                    },
                    {
                        "type": "input_image",
                        "image_url": "https://openai-documentation.vercel.app/images/cat_and_otter.png"
                    }
                ]
            }
        ]
    }'
```

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
    model="gpt-5",
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "What teams are playing in this image?",
                },
                {
                    "type": "input_image",
                    "image_url": "https://upload.wikimedia.org/wikipedia/commons/3/3b/LeBron_James_Layup_%28Cleveland_vs_Brooklyn_2018%29.jpg"
                }
            ]
        }
    ]
)

print(response.output_text)
```

```csharp
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

OpenAIResponse response = (OpenAIResponse)client.CreateResponse([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputTextPart("What is in this image?"),
        ResponseContentPart.CreateInputImagePart(new Uri("https://openai-documentation.vercel.app/images/cat_and_otter.png")),
    ]),
]);

Console.WriteLine(response.GetOutputText());
```

File URL

Use a file URL as input

```bash
curl "https://api.openai.com/v1/responses" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -d '{
        "model": "gpt-5",
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": "Analyze the letter and provide a summary of the key points."
                    },
                    {
                        "type": "input_file",
                        "file_url": "https://www.berkshirehathaway.com/letters/2024ltr.pdf"
                    }
                ]
            }
        ]
    }'
```

```javascript
import OpenAI from 'openai';
const client = new OpenAI();

const response = await client.responses.create({
  model: 'gpt-5',
  input: [
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'Analyze the letter and provide a summary of the key points.',
        },
        {
          type: 'input_file',
          file_url: 'https://www.berkshirehathaway.com/letters/2024ltr.pdf',
        },
      ],
    },
  ],
});

console.log(response.output_text);
```

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
    model="gpt-5",
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "Analyze the letter and provide a summary of the key points.",
                },
                {
                    "type": "input_file",
                    "file_url": "https://www.berkshirehathaway.com/letters/2024ltr.pdf",
                },
            ],
        },
    ]
)

print(response.output_text)
```

```csharp
using OpenAI.Files;
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

using HttpClient http = new();
using Stream stream = await http.GetStreamAsync("https://www.berkshirehathaway.com/letters/2024ltr.pdf");
OpenAIFileClient files = new(key);
OpenAIFile file = files.UploadFile(stream, "2024ltr.pdf", FileUploadPurpose.UserData);

OpenAIResponse response = (OpenAIResponse)client.CreateResponse([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputTextPart("Analyze the letter and provide a summary of the key points."),
        ResponseContentPart.CreateInputFilePart(file.Id),
    ]),
]);

Console.WriteLine(response.GetOutputText());
```

Upload file

Upload a file and use it as input

```bash
curl https://api.openai.com/v1/files \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -F purpose="user_data" \
    -F file="@draconomicon.pdf"

curl "https://api.openai.com/v1/responses" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -d '{
        "model": "gpt-5",
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_file",
                        "file_id": "file-6F2ksmvXxt4VdoqmHRw6kL"
                    },
                    {
                        "type": "input_text",
                        "text": "What is the first dragon in the book?"
                    }
                ]
            }
        ]
    }'
```

```javascript
import fs from 'fs';
import OpenAI from 'openai';
const client = new OpenAI();

const file = await client.files.create({
  file: fs.createReadStream('draconomicon.pdf'),
  purpose: 'user_data',
});

const response = await client.responses.create({
  model: 'gpt-5',
  input: [
    {
      role: 'user',
      content: [
        {
          type: 'input_file',
          file_id: file.id,
        },
        {
          type: 'input_text',
          text: 'What is the first dragon in the book?',
        },
      ],
    },
  ],
});

console.log(response.output_text);
```

```python
from openai import OpenAI
client = OpenAI()

file = client.files.create(
    file=open("draconomicon.pdf", "rb"),
    purpose="user_data"
)

response = client.responses.create(
    model="gpt-5",
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_file",
                    "file_id": file.id,
                },
                {
                    "type": "input_text",
                    "text": "What is the first dragon in the book?",
                },
            ]
        }
    ]
)

print(response.output_text)
```

```csharp
using OpenAI.Files;
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

OpenAIFileClient files = new(key);
OpenAIFile file = files.UploadFile("draconomicon.pdf", FileUploadPurpose.UserData);

OpenAIResponse response = (OpenAIResponse)client.CreateResponse([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputFilePart(file.Id),
        ResponseContentPart.CreateInputTextPart("What is the first dragon in the book?"),
    ]),
]);

Console.WriteLine(response.GetOutputText());
```

[

Image inputs guide

Learn to use image inputs to the model and extract meaning from images.

](/docs/guides/images)[

File inputs guide

Learn to use file inputs to the model and extract meaning from documents.

](/docs/guides/pdf-files)

## Extend the model with tools

Give the model access to external data and functions by attaching [tools](/docs/guides/tools). Use built-in tools like web search or file search, or define your own for calling APIs, running code, or integrating with third-party systems.

Web search

Use web search in a response

```javascript
import OpenAI from 'openai';
const client = new OpenAI();

const response = await client.responses.create({
  model: 'gpt-5',
  tools: [{ type: 'web_search' }],
  input: 'What was a positive news story from today?',
});

console.log(response.output_text);
```

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
    model="gpt-5",
    tools=[{"type": "web_search"}],
    input="What was a positive news story from today?"
)

print(response.output_text)
```

```bash
curl "https://api.openai.com/v1/responses" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -d '{
        "model": "gpt-5",
        "tools": [{"type": "web_search"}],
        "input": "what was a positive news story from today?"
    }'
```

```csharp
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

ResponseCreationOptions options = new();
options.Tools.Add(ResponseTool.CreateWebSearchTool());

OpenAIResponse response = (OpenAIResponse)client.CreateResponse([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputTextPart("What was a positive news story from today?"),
    ]),
], options);

Console.WriteLine(response.GetOutputText());
```

File search

Search your files in a response

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
    model="gpt-4.1",
    input="What is deep research by OpenAI?",
    tools=[{
        "type": "file_search",
        "vector_store_ids": ["<vector_store_id>"]
    }]
)
print(response)
```

```javascript
import OpenAI from 'openai';
const openai = new OpenAI();

const response = await openai.responses.create({
  model: 'gpt-4.1',
  input: 'What is deep research by OpenAI?',
  tools: [
    {
      type: 'file_search',
      vector_store_ids: ['<vector_store_id>'],
    },
  ],
});
console.log(response);
```

```csharp
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

ResponseCreationOptions options = new();
options.Tools.Add(ResponseTool.CreateFileSearchTool(["<vector_store_id>"]));

OpenAIResponse response = (OpenAIResponse)client.CreateResponse([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputTextPart("What is deep research by OpenAI?"),
    ]),
], options);

Console.WriteLine(response.GetOutputText());
```

Function calling

Call your own function

```javascript
import OpenAI from 'openai';
const client = new OpenAI();

const tools = [
  {
    type: 'function',
    name: 'get_weather',
    description: 'Get current temperature for a given location.',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'City and country e.g. Bogotá, Colombia',
        },
      },
      required: ['location'],
      additionalProperties: false,
    },
    strict: true,
  },
];

const response = await client.responses.create({
  model: 'gpt-5',
  input: [{ role: 'user', content: 'What is the weather like in Paris today?' }],
  tools,
});

console.log(response.output[0].to_json());
```

```python
from openai import OpenAI

client = OpenAI()

tools = [
    {
        "type": "function",
        "name": "get_weather",
        "description": "Get current temperature for a given location.",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City and country e.g. Bogotá, Colombia",
                }
            },
            "required": ["location"],
            "additionalProperties": False,
        },
        "strict": True,
    },
]

response = client.responses.create(
    model="gpt-5",
    input=[
        {"role": "user", "content": "What is the weather like in Paris today?"},
    ],
    tools=tools,
)

print(response.output[0].to_json())
```

```csharp
using System.Text.Json;
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

ResponseCreationOptions options = new();
options.Tools.Add(ResponseTool.CreateFunctionTool(
        functionName: "get_weather",
        functionDescription: "Get current temperature for a given location.",
        functionParameters: BinaryData.FromObjectAsJson(new
        {
            type = "object",
            properties = new
            {
                location = new
                {
                    type = "string",
                    description = "City and country e.g. Bogotá, Colombia"
                }
            },
            required = new[] { "location" },
            additionalProperties = false
        }),
        strictModeEnabled: true
    )
);

OpenAIResponse response = (OpenAIResponse)client.CreateResponse([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputTextPart("What is the weather like in Paris today?")
    ])
], options);

Console.WriteLine(JsonSerializer.Serialize(response.OutputItems[0]));
```

```bash
curl -X POST https://api.openai.com/v1/responses \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5",
    "input": [
      {"role": "user", "content": "What is the weather like in Paris today?"}
    ],
    "tools": [
      {
        "type": "function",
        "name": "get_weather",
        "description": "Get current temperature for a given location.",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "City and country e.g. Bogotá, Colombia"
            }
          },
          "required": ["location"],
          "additionalProperties": false
        },
        "strict": true
      }
    ]
  }'
```

Remote MCP

Call a remote MCP server

```bash
curl https://api.openai.com/v1/responses \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $OPENAI_API_KEY" \
-d '{
  "model": "gpt-5",
    "tools": [
      {
        "type": "mcp",
        "server_label": "dmcp",
        "server_description": "A Dungeons and Dragons MCP server to assist with dice rolling.",
        "server_url": "https://dmcp-server.deno.dev/sse",
        "require_approval": "never"
      }
    ],
    "input": "Roll 2d4+1"
  }'
```

```javascript
import OpenAI from 'openai';
const client = new OpenAI();

const resp = await client.responses.create({
  model: 'gpt-5',
  tools: [
    {
      type: 'mcp',
      server_label: 'dmcp',
      server_description: 'A Dungeons and Dragons MCP server to assist with dice rolling.',
      server_url: 'https://dmcp-server.deno.dev/sse',
      require_approval: 'never',
    },
  ],
  input: 'Roll 2d4+1',
});

console.log(resp.output_text);
```

```python
from openai import OpenAI

client = OpenAI()

resp = client.responses.create(
    model="gpt-5",
    tools=[
        {
            "type": "mcp",
            "server_label": "dmcp",
            "server_description": "A Dungeons and Dragons MCP server to assist with dice rolling.",
            "server_url": "https://dmcp-server.deno.dev/sse",
            "require_approval": "never",
        },
    ],
    input="Roll 2d4+1",
)

print(resp.output_text)
```

```csharp
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

ResponseCreationOptions options = new();
options.Tools.Add(ResponseTool.CreateMcpTool(
    serverLabel: "dmcp",
    serverUri: new Uri("https://dmcp-server.deno.dev/sse"),
    toolCallApprovalPolicy: new McpToolCallApprovalPolicy(GlobalMcpToolCallApprovalPolicy.NeverRequireApproval)
));

OpenAIResponse response = (OpenAIResponse)client.CreateResponse([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputTextPart("Roll 2d4+1")
    ])
], options);

Console.WriteLine(response.GetOutputText());
```

[

Use built-in tools

Learn about powerful built-in tools like web search and file search.

](/docs/guides/tools)[

Function calling guide

Learn to enable the model to call your own custom code.

](/docs/guides/function-calling)

## Stream responses and build realtime apps

Use server‑sent [streaming events](/docs/guides/streaming-responses) to show results as they’re generated, or the [Realtime API](/docs/guides/realtime) for interactive voice and multimodal apps.

Stream server-sent events from the API

```javascript
import { OpenAI } from 'openai';
const client = new OpenAI();

const stream = await client.responses.create({
  model: 'gpt-5',
  input: [
    {
      role: 'user',
      content: "Say 'double bubble bath' ten times fast.",
    },
  ],
  stream: true,
});

for await (const event of stream) {
  console.log(event);
}
```

```python
from openai import OpenAI
client = OpenAI()

stream = client.responses.create(
    model="gpt-5",
    input=[
        {
            "role": "user",
            "content": "Say 'double bubble bath' ten times fast.",
        },
    ],
    stream=True,
)

for event in stream:
    print(event)
```

```csharp
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

var responses = client.CreateResponseStreamingAsync([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputTextPart("Say 'double bubble bath' ten times fast."),
    ]),
]);

await foreach (var response in responses)
{
    if (response is StreamingResponseOutputTextDeltaUpdate delta)
    {
        Console.Write(delta.Delta);
    }
}
```

[

Use streaming events

Use server-sent events to stream model responses to users fast.

](/docs/guides/streaming-responses)[

Get started with the Realtime API

Use WebRTC or WebSockets for super fast speech-to-speech AI apps.

](/docs/guides/realtime)

## Build agents

Use the OpenAI platform to build [agents](/docs/guides/agents) capable of taking action—like [controlling computers](/docs/guides/tools-computer-use)—on behalf of your users. Use the Agents SDK for [Python](https://openai.github.io/openai-agents-python) or [TypeScript](https://openai.github.io/openai-agents-js) to create orchestration logic on the backend.

Build a language triage agent

```javascript
import { Agent, run } from '@openai/agents';

const spanishAgent = new Agent({
  name: 'Spanish agent',
  instructions: 'You only speak Spanish.',
});

const englishAgent = new Agent({
  name: 'English agent',
  instructions: 'You only speak English',
});

const triageAgent = new Agent({
  name: 'Triage agent',
  instructions: 'Handoff to the appropriate agent based on the language of the request.',
  handoffs: [spanishAgent, englishAgent],
});

const result = await run(triageAgent, 'Hola, ¿cómo estás?');
console.log(result.finalOutput);
```

```python
from agents import Agent, Runner
import asyncio

spanish_agent = Agent(
    name="Spanish agent",
    instructions="You only speak Spanish.",
)

english_agent = Agent(
    name="English agent",
    instructions="You only speak English",
)

triage_agent = Agent(
    name="Triage agent",
    instructions="Handoff to the appropriate agent based on the language of the request.",
    handoffs=[spanish_agent, english_agent],
)

async def main():
    result = await Runner.run(triage_agent, input="Hola, ¿cómo estás?")
    print(result.final_output)

if __name__ == "__main__":
    asyncio.run(main())
```

[

Build agents that can take action

Learn how to use the OpenAI platform to build powerful, capable AI agents.

](/docs/guides/agents)

Was this page useful?

# Web search

Allow models to search the web for the latest information before generating a response.

Web search allows models to access up-to-date information from the internet and provide answers with sourced citations. To enable this, use the web search tool in the Responses API or, in some cases, Chat Completions.

There are three main types of web search available with OpenAI models:

1.  Non‑reasoning web search: The non-reasoning model sends the user’s query to the web search tool, which returns the response based on top results. There’s no internal planning and the model simply passes along the search tool’s responses. This method is fast and ideal for quick lookups.
2.  Agentic search with reasoning models is an approach where the model actively manages the search process. It can perform web searches as part of its chain of thought, analyze results, and decide whether to keep searching. This flexibility makes agentic search well suited to complex workflows, but it also means searches take longer than quick lookups. For example, you can adjust GPT-5’s reasoning level to change both the depth and latency of the search.
3.  Deep research is a specialized, agent-driven method for in-depth, extended investigations by reasoning models. The model conducts web searches as part of its chain of thought, often tapping into hundreds of sources. Deep research can run for several minutes and is best used with background mode. These tasks typically use models like `o3-deep-research`, `o4-mini-deep-research`, or `gpt-5` with reasoning level set to `high`.

Using the [Responses API](/docs/api-reference/responses), you can enable web search by configuring it in the `tools` array in an API request to generate content. Like any other tool, the model can choose to search the web or not based on the content of the input prompt.

Web search tool example

```javascript
import OpenAI from 'openai';
const client = new OpenAI();

const response = await client.responses.create({
  model: 'gpt-5',
  tools: [{ type: 'web_search' }],
  input: 'What was a positive news story from today?',
});

console.log(response.output_text);
```

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
    model="gpt-5",
    tools=[{"type": "web_search"}],
    input="What was a positive news story from today?"
)

print(response.output_text)
```

```bash
curl "https://api.openai.com/v1/responses" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -d '{
        "model": "gpt-5",
        "tools": [{"type": "web_search"}],
        "input": "what was a positive news story from today?"
    }'
```

```csharp
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

ResponseCreationOptions options = new();
options.Tools.Add(ResponseTool.CreateWebSearchTool());

OpenAIResponse response = (OpenAIResponse)client.CreateResponse([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputTextPart("What was a positive news story from today?"),
    ]),
], options);

Console.WriteLine(response.GetOutputText());
```

## Output and citations

Model responses that use the web search tool will include two parts:

- A `web_search_call` output item with the ID of the search call, along with the action taken in `web_search_call.action`. The action is one of:
  - `search`, which represents a web search. It will usually (but not always) includes the search `query` and `domains` which were searched. Search actions incur a tool call cost (see [pricing](/docs/pricing#built-in-tools)).
  - `open_page`, which represents a page being opened. Supported in reasoning models.
  - `find_in_page`, which represents searching within a page. Supported in reasoning models.
- A `message` output item containing:
  - The text result in `message.content[0].text`
  - Annotations `message.content[0].annotations` for the cited URLs

By default, the model's response will include inline citations for URLs found in the web search results. In addition to this, the `url_citation` annotation object will contain the URL, title and location of the cited source.

When displaying web results or information contained in web results to end users, inline citations must be made clearly visible and clickable in your user interface.

```json
[
  {
    "type": "web_search_call",
    "id": "ws_67c9fa0502748190b7dd390736892e100be649c1a5ff9609",
    "status": "completed"
  },
  {
    "id": "msg_67c9fa077e288190af08fdffda2e34f20be649c1a5ff9609",
    "type": "message",
    "status": "completed",
    "role": "assistant",
    "content": [
      {
        "type": "output_text",
        "text": "On March 6, 2025, several news...",
        "annotations": [
          {
            "type": "url_citation",
            "start_index": 2606,
            "end_index": 2758,
            "url": "https://...",
            "title": "Title..."
          }
        ]
      }
    ]
  }
]
```

## Domain filtering

Domain filtering in web search lets you limit results to a specific set of domains. With the `filters` parameter you can set an allow-list of up to 20 URLs. When formatting URLs, omit the HTTP or HTTPS prefix. For example, use [`openai.com`](http://openai.com) instead of [`https://openai.com/`](https://openai.com/). This approach also includes subdomains in the search. Note that domain filtering is only available in the Responses API with the `web_search` tool.

## Sources

To view all URLs retrieved during a web search, use the `sources` field. Unlike inline citations, which show only the most relevant references, sources returns the complete list of URLs the model consulted when forming its response. The number of sources is often greater than the number of citations. Real-time third-party feeds are also surfaced here and are labeled as `oai-sports`, `oai-weather`, or `oai-finance`. The sources field is available with both the `web_search` and `web_search_preview` tools.

List sources

```bash
curl "https://api.openai.com/v1/responses" \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $OPENAI_API_KEY" \
-d '{
  "model": "gpt-5",
  "reasoning": { "effort": "low" },
  "tools": [
    {
      "type": "web_search",
      "filters": {
        "allowed_domains": [
          "pubmed.ncbi.nlm.nih.gov",
          "clinicaltrials.gov",
          "www.who.int",
          "www.cdc.gov",
          "www.fda.gov"
        ]
      }
    }
  ],
  "tool_choice": "auto",
  "include": ["web_search_call.action.sources"],
  "input": "Please perform a web search on how semaglutide is used in the treatment of diabetes."
}'
```

```javascript
import OpenAI from 'openai';
const client = new OpenAI();

const response = await client.responses.create({
  model: 'gpt-5',
  reasoning: { effort: 'low' },
  tools: [
    {
      type: 'web_search',
      filters: {
        allowed_domains: [
          'pubmed.ncbi.nlm.nih.gov',
          'clinicaltrials.gov',
          'www.who.int',
          'www.cdc.gov',
          'www.fda.gov',
        ],
      },
    },
  ],
  tool_choice: 'auto',
  include: ['web_search_call.action.sources'],
  input: 'Please perform a web search on how semaglutide is used in the treatment of diabetes.',
});

console.log(response.output_text);
```

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
  model="gpt-5",
  reasoning={"effort": "low"},
  tools=[
      {
          "type": "web_search",
          "filters": {
              "allowed_domains": [
                  "pubmed.ncbi.nlm.nih.gov",
                  "clinicaltrials.gov",
                  "www.who.int",
                  "www.cdc.gov",
                  "www.fda.gov",
              ]
          },
      }
  ],
  tool_choice="auto",
  include=["web_search_call.action.sources"],
  input="Please perform a web search on how semaglutide is used in the treatment of diabetes.",
)

print(response.output_text)
```

## User location

To refine search results based on geography, you can specify an approximate user location using country, city, region, and/or timezone.

- The `city` and `region` fields are free text strings, like `Minneapolis` and `Minnesota` respectively.
- The `country` field is a two-letter [ISO country code](https://en.wikipedia.org/wiki/ISO_3166-1), like `US`.
- The `timezone` field is an [IANA timezone](https://timeapi.io/documentation/iana-timezones) like `America/Chicago`.

Note that user location is not supported for deep research models using web search.

Customizing user location

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
    model="o4-mini",
    tools=[{
        "type": "web_search",
        "user_location": {
            "type": "approximate",
            "country": "GB",
            "city": "London",
            "region": "London",
        }
    }],
    input="What are the best restaurants near me?",
)

print(response.output_text)
```

```csharp
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

ResponseCreationOptions options = new();
options.Tools.Add(ResponseTool.CreateWebSearchTool(
    userLocation: WebSearchToolLocation.CreateApproximateLocation(
        country: "GB",
        city: "London",
        region: "Granary Square"
    )
));

OpenAIResponse response = (OpenAIResponse)client.CreateResponse([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputTextPart(
            "What are the best restaurants near me?"
        )
    ])
], options);

Console.WriteLine(response.GetOutputText());
```

```javascript
import OpenAI from 'openai';
const openai = new OpenAI();

const response = await openai.responses.create({
  model: 'o4-mini',
  tools: [
    {
      type: 'web_search',
      user_location: {
        type: 'approximate',
        country: 'GB',
        city: 'London',
        region: 'London',
      },
    },
  ],
  input: 'What are the best restaurants near me?',
});
console.log(response.output_text);
```

```bash
curl "https://api.openai.com/v1/responses" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -d '{
        "model": "o4-mini",
        "tools": [{
            "type": "web_search",
            "user_location": {
                "type": "approximate",
                "country": "GB",
                "city": "London",
                "region": "London"
            }
        }],
        "input": "What are the best restaurants near me?"
    }'
```

## API compatibility

Web search is available in the Responses API as the generally available version of the tool, `web_search`, as well as the earlier tool version, `web_search_preview`. To use web search in the Chat Completions API, use the specialized web search models `gpt-5-search-api`, `gpt-4o-search-preview` and `gpt-4o-mini-search-preview`.

## Limitations

- Web search is currently not supported in [`gpt-5`](/docs/models/gpt-5) with `minimal` reasoning, and [`gpt-4.1-nano`](/docs/models/gpt-4.1-nano).
- When used as a tool in the [Responses API](/docs/api-reference/responses), web search has the same tiered rate limits as the models above.
- Web search is limited to a context window size of 128000 (even with [`gpt-4.1`](/docs/models/gpt-4.1) and [`gpt-4.1-mini`](/docs/models/gpt-4.1-mini) models).

## Usage notes

||
|ResponsesChat CompletionsAssistants|Same as tiered rate limits for underlying model used with the tool.|PricingZDR and data residency|

Was this page useful?
Using tools
===========

Use tools like remote MCP servers or web search to extend the model's capabilities.

When generating model responses, you can extend capabilities using built‑in tools and remote MCP servers. These enable the model to search the web, retrieve from your files, call your own functions, or access third‑party services.

Web search

Include web search results for the model response

```javascript
import OpenAI from 'openai';
const client = new OpenAI();

const response = await client.responses.create({
  model: 'gpt-5',
  tools: [{ type: 'web_search' }],
  input: 'What was a positive news story from today?',
});

console.log(response.output_text);
```

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
    model="gpt-5",
    tools=[{"type": "web_search"}],
    input="What was a positive news story from today?"
)

print(response.output_text)
```

```bash
curl "https://api.openai.com/v1/responses" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -d '{
        "model": "gpt-5",
        "tools": [{"type": "web_search"}],
        "input": "what was a positive news story from today?"
    }'
```

```csharp
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

ResponseCreationOptions options = new();
options.Tools.Add(ResponseTool.CreateWebSearchTool());

OpenAIResponse response = (OpenAIResponse)client.CreateResponse([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputTextPart("What was a positive news story from today?"),
    ]),
], options);

Console.WriteLine(response.GetOutputText());
```

File search

Search your files in a response

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
    model="gpt-4.1",
    input="What is deep research by OpenAI?",
    tools=[{
        "type": "file_search",
        "vector_store_ids": ["<vector_store_id>"]
    }]
)
print(response)
```

```javascript
import OpenAI from 'openai';
const openai = new OpenAI();

const response = await openai.responses.create({
  model: 'gpt-4.1',
  input: 'What is deep research by OpenAI?',
  tools: [
    {
      type: 'file_search',
      vector_store_ids: ['<vector_store_id>'],
    },
  ],
});
console.log(response);
```

```csharp
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

ResponseCreationOptions options = new();
options.Tools.Add(ResponseTool.CreateFileSearchTool(["<vector_store_id>"]));

OpenAIResponse response = (OpenAIResponse)client.CreateResponse([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputTextPart("What is deep research by OpenAI?"),
    ]),
], options);

Console.WriteLine(response.GetOutputText());
```

Function calling

Call your own function

```javascript
import OpenAI from 'openai';
const client = new OpenAI();

const tools = [
  {
    type: 'function',
    name: 'get_weather',
    description: 'Get current temperature for a given location.',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'City and country e.g. Bogotá, Colombia',
        },
      },
      required: ['location'],
      additionalProperties: false,
    },
    strict: true,
  },
];

const response = await client.responses.create({
  model: 'gpt-5',
  input: [{ role: 'user', content: 'What is the weather like in Paris today?' }],
  tools,
});

console.log(response.output[0].to_json());
```

```python
from openai import OpenAI

client = OpenAI()

tools = [
    {
        "type": "function",
        "name": "get_weather",
        "description": "Get current temperature for a given location.",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City and country e.g. Bogotá, Colombia",
                }
            },
            "required": ["location"],
            "additionalProperties": False,
        },
        "strict": True,
    },
]

response = client.responses.create(
    model="gpt-5",
    input=[
        {"role": "user", "content": "What is the weather like in Paris today?"},
    ],
    tools=tools,
)

print(response.output[0].to_json())
```

```csharp
using System.Text.Json;
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

ResponseCreationOptions options = new();
options.Tools.Add(ResponseTool.CreateFunctionTool(
        functionName: "get_weather",
        functionDescription: "Get current temperature for a given location.",
        functionParameters: BinaryData.FromObjectAsJson(new
        {
            type = "object",
            properties = new
            {
                location = new
                {
                    type = "string",
                    description = "City and country e.g. Bogotá, Colombia"
                }
            },
            required = new[] { "location" },
            additionalProperties = false
        }),
        strictModeEnabled: true
    )
);

OpenAIResponse response = (OpenAIResponse)client.CreateResponse([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputTextPart("What is the weather like in Paris today?")
    ])
], options);

Console.WriteLine(JsonSerializer.Serialize(response.OutputItems[0]));
```

```bash
curl -X POST https://api.openai.com/v1/responses \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5",
    "input": [
      {"role": "user", "content": "What is the weather like in Paris today?"}
    ],
    "tools": [
      {
        "type": "function",
        "name": "get_weather",
        "description": "Get current temperature for a given location.",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "City and country e.g. Bogotá, Colombia"
            }
          },
          "required": ["location"],
          "additionalProperties": false
        },
        "strict": true
      }
    ]
  }'
```

Remote MCP

Call a remote MCP server

```bash
curl https://api.openai.com/v1/responses \
-H "Content-Type: application/json" \
-H "Authorization: Bearer $OPENAI_API_KEY" \
-d '{
  "model": "gpt-5",
    "tools": [
      {
        "type": "mcp",
        "server_label": "dmcp",
        "server_description": "A Dungeons and Dragons MCP server to assist with dice rolling.",
        "server_url": "https://dmcp-server.deno.dev/sse",
        "require_approval": "never"
      }
    ],
    "input": "Roll 2d4+1"
  }'
```

```javascript
import OpenAI from 'openai';
const client = new OpenAI();

const resp = await client.responses.create({
  model: 'gpt-5',
  tools: [
    {
      type: 'mcp',
      server_label: 'dmcp',
      server_description: 'A Dungeons and Dragons MCP server to assist with dice rolling.',
      server_url: 'https://dmcp-server.deno.dev/sse',
      require_approval: 'never',
    },
  ],
  input: 'Roll 2d4+1',
});

console.log(resp.output_text);
```

```python
from openai import OpenAI

client = OpenAI()

resp = client.responses.create(
    model="gpt-5",
    tools=[
        {
            "type": "mcp",
            "server_label": "dmcp",
            "server_description": "A Dungeons and Dragons MCP server to assist with dice rolling.",
            "server_url": "https://dmcp-server.deno.dev/sse",
            "require_approval": "never",
        },
    ],
    input="Roll 2d4+1",
)

print(resp.output_text)
```

```csharp
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

ResponseCreationOptions options = new();
options.Tools.Add(ResponseTool.CreateMcpTool(
    serverLabel: "dmcp",
    serverUri: new Uri("https://dmcp-server.deno.dev/sse"),
    toolCallApprovalPolicy: new McpToolCallApprovalPolicy(GlobalMcpToolCallApprovalPolicy.NeverRequireApproval)
));

OpenAIResponse response = (OpenAIResponse)client.CreateResponse([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputTextPart("Roll 2d4+1")
    ])
], options);

Console.WriteLine(response.GetOutputText());
```

## Available tools

Here's an overview of the tools available in the OpenAI platform—select one of them for further guidance on usage.

[

Function calling

Call custom code to give the model access to additional data and capabilities.

](/docs/guides/function-calling)[

Web search

Include data from the Internet in model response generation.

](/docs/guides/tools-web-search)[

Remote MCP servers

Give the model access to new capabilities via Model Context Protocol (MCP) servers.

](/docs/guides/tools-remote-mcp)[

File search

Search the contents of uploaded files for context when generating a response.

](/docs/guides/tools-file-search)[

Image generation

Generate or edit images using GPT Image.

](/docs/guides/tools-image-generation)[

Code interpreter

Allow the model to execute code in a secure container.

](/docs/guides/tools-code-interpreter)[

Computer use

Create agentic workflows that enable a model to control a computer interface.

](/docs/guides/tools-computer-use)

## Usage in the API

When making a request to generate a [model response](/docs/api-reference/responses/create), you can enable tool access by specifying configurations in the `tools` parameter. Each tool has its own unique configuration requirements—see the [Available tools](/docs/guides/tools#available-tools) section for detailed instructions.

Based on the provided [prompt](/docs/guides/text), the model automatically decides whether to use a configured tool. For instance, if your prompt requests information beyond the model's training cutoff date and web search is enabled, the model will typically invoke the web search tool to retrieve relevant, up-to-date information.

You can explicitly control or guide this behavior by setting the `tool_choice` parameter [in the API request](/docs/api-reference/responses/create).

### Function calling

In addition to built-in tools, you can define custom functions using the `tools` array. These custom functions allow the model to call your application's code, enabling access to specific data or capabilities not directly available within the model.

Learn more in the [function calling guide](/docs/guides/function-calling).

Was this page useful?
File search
===========

Allow models to search your files for relevant information before generating a response.

File search is a tool available in the [Responses API](/docs/api-reference/responses). It enables models to retrieve information in a knowledge base of previously uploaded files through semantic and keyword search. By creating vector stores and uploading files to them, you can augment the models' inherent knowledge by giving them access to these knowledge bases or `vector_stores`.

To learn more about how vector stores and semantic search work, refer to our [retrieval guide](/docs/guides/retrieval).

This is a hosted tool managed by OpenAI, meaning you don't have to implement code on your end to handle its execution. When the model decides to use it, it will automatically call the tool, retrieve information from your files, and return an output.

## How to use

Prior to using file search with the Responses API, you need to have set up a knowledge base in a vector store and uploaded files to it.

Create a vector store and upload a file

Follow these steps to create a vector store and upload a file to it. You can use [this example file](https://cdn.openai.com/API/docs/deep_research_blog.pdf) or upload your own.

#### Upload the file to the File API

Upload a file

```python
import requests
from io import BytesIO
from openai import OpenAI

client = OpenAI()

def create_file(client, file_path):
    if file_path.startswith("http://") or file_path.startswith("https://"):
        # Download the file content from the URL
        response = requests.get(file_path)
        file_content = BytesIO(response.content)
        file_name = file_path.split("/")[-1]
        file_tuple = (file_name, file_content)
        result = client.files.create(
            file=file_tuple,
            purpose="assistants"
        )
    else:
        # Handle local file path
        with open(file_path, "rb") as file_content:
            result = client.files.create(
                file=file_content,
                purpose="assistants"
            )
    print(result.id)
    return result.id

# Replace with your own file path or URL
file_id = create_file(client, "https://cdn.openai.com/API/docs/deep_research_blog.pdf")
```

```javascript
import fs from 'fs';
import OpenAI from 'openai';
const openai = new OpenAI();

async function createFile(filePath) {
  let result;
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    // Download the file content from the URL
    const res = await fetch(filePath);
    const buffer = await res.arrayBuffer();
    const urlParts = filePath.split('/');
    const fileName = urlParts[urlParts.length - 1];
    const file = new File([buffer], fileName);
    result = await openai.files.create({
      file: file,
      purpose: 'assistants',
    });
  } else {
    // Handle local file path
    const fileContent = fs.createReadStream(filePath);
    result = await openai.files.create({
      file: fileContent,
      purpose: 'assistants',
    });
  }
  return result.id;
}

// Replace with your own file path or URL
const fileId = await createFile('https://cdn.openai.com/API/docs/deep_research_blog.pdf');

console.log(fileId);
```

#### Create a vector store

Create a vector store

```python
vector_store = client.vector_stores.create(
    name="knowledge_base"
)
print(vector_store.id)
```

```javascript
const vectorStore = await openai.vectorStores.create({
  name: 'knowledge_base',
});
console.log(vectorStore.id);
```

#### Add the file to the vector store

Add a file to a vector store

```python
result = client.vector_stores.files.create(
    vector_store_id=vector_store.id,
    file_id=file_id
)
print(result)
```

```javascript
await openai.vectorStores.files.create(
    vectorStore.id,
    {
        file_id: fileId,
    }
});
```

#### Check status

Run this code until the file is ready to be used (i.e., when the status is `completed`).

Check status

```python
result = client.vector_stores.files.list(
    vector_store_id=vector_store.id
)
print(result)
```

```javascript
const result = await openai.vectorStores.files.list({
  vector_store_id: vectorStore.id,
});
console.log(result);
```

Once your knowledge base is set up, you can include the `file_search` tool in the list of tools available to the model, along with the list of vector stores in which to search.

File search tool

```python
from openai import OpenAI
client = OpenAI()

response = client.responses.create(
    model="gpt-4.1",
    input="What is deep research by OpenAI?",
    tools=[{
        "type": "file_search",
        "vector_store_ids": ["<vector_store_id>"]
    }]
)
print(response)
```

```javascript
import OpenAI from 'openai';
const openai = new OpenAI();

const response = await openai.responses.create({
  model: 'gpt-4.1',
  input: 'What is deep research by OpenAI?',
  tools: [
    {
      type: 'file_search',
      vector_store_ids: ['<vector_store_id>'],
    },
  ],
});
console.log(response);
```

```csharp
using OpenAI.Responses;

string key = Environment.GetEnvironmentVariable("OPENAI_API_KEY")!;
OpenAIResponseClient client = new(model: "gpt-5", apiKey: key);

ResponseCreationOptions options = new();
options.Tools.Add(ResponseTool.CreateFileSearchTool(["<vector_store_id>"]));

OpenAIResponse response = (OpenAIResponse)client.CreateResponse([
    ResponseItem.CreateUserMessageItem([
        ResponseContentPart.CreateInputTextPart("What is deep research by OpenAI?"),
    ]),
], options);

Console.WriteLine(response.GetOutputText());
```

When this tool is called by the model, you will receive a response with multiple outputs:

1.  A `file_search_call` output item, which contains the id of the file search call.
2.  A `message` output item, which contains the response from the model, along with the file citations.

File search response

```json
{
  "output": [
    {
      "type": "file_search_call",
      "id": "fs_67c09ccea8c48191ade9367e3ba71515",
      "status": "completed",
      "queries": ["What is deep research?"],
      "search_results": null
    },
    {
      "id": "msg_67c09cd3091c819185af2be5d13d87de",
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Deep research is a sophisticated capability that allows for extensive inquiry and synthesis of information across various domains. It is designed to conduct multi-step research tasks, gather data from multiple online sources, and provide comprehensive reports similar to what a research analyst would produce. This functionality is particularly useful in fields requiring detailed and accurate information...",
          "annotations": [
            {
              "type": "file_citation",
              "index": 992,
              "file_id": "file-2dtbBZdjtDKS8eqWxqbgDi",
              "filename": "deep_research_blog.pdf"
            },
            {
              "type": "file_citation",
              "index": 992,
              "file_id": "file-2dtbBZdjtDKS8eqWxqbgDi",
              "filename": "deep_research_blog.pdf"
            },
            {
              "type": "file_citation",
              "index": 1176,
              "file_id": "file-2dtbBZdjtDKS8eqWxqbgDi",
              "filename": "deep_research_blog.pdf"
            },
            {
              "type": "file_citation",
              "index": 1176,
              "file_id": "file-2dtbBZdjtDKS8eqWxqbgDi",
              "filename": "deep_research_blog.pdf"
            }
          ]
        }
      ]
    }
  ]
}
```

## Retrieval customization

### Limiting the number of results

Using the file search tool with the Responses API, you can customize the number of results you want to retrieve from the vector stores. This can help reduce both token usage and latency, but may come at the cost of reduced answer quality.

Limit the number of results

```python
response = client.responses.create(
    model="gpt-4.1",
    input="What is deep research by OpenAI?",
    tools=[{
        "type": "file_search",
        "vector_store_ids": ["<vector_store_id>"],
        "max_num_results": 2
    }]
)
print(response)
```

```javascript
const response = await openai.responses.create({
  model: 'gpt-4.1',
  input: 'What is deep research by OpenAI?',
  tools: [
    {
      type: 'file_search',
      vector_store_ids: ['<vector_store_id>'],
      max_num_results: 2,
    },
  ],
});
console.log(response);
```

### Include search results in the response

While you can see annotations (references to files) in the output text, the file search call will not return search results by default.

To include search results in the response, you can use the `include` parameter when creating the response.

Include search results

```python
response = client.responses.create(
    model="gpt-4.1",
    input="What is deep research by OpenAI?",
    tools=[{
        "type": "file_search",
        "vector_store_ids": ["<vector_store_id>"]
    }],
    include=["file_search_call.results"]
)
print(response)
```

```javascript
const response = await openai.responses.create({
  model: 'gpt-4.1',
  input: 'What is deep research by OpenAI?',
  tools: [
    {
      type: 'file_search',
      vector_store_ids: ['<vector_store_id>'],
    },
  ],
  include: ['file_search_call.results'],
});
console.log(response);
```

### Metadata filtering

You can filter the search results based on the metadata of the files. For more details, refer to our [retrieval guide](/docs/guides/retrieval), which covers:

- How to [set attributes on vector store files](/docs/guides/retrieval#attributes)
- How to [define filters](/docs/guides/retrieval#attribute-filtering)

Metadata filtering

```python
response = client.responses.create(
    model="gpt-4.1",
    input="What is deep research by OpenAI?",
    tools=[{
        "type": "file_search",
        "vector_store_ids": ["<vector_store_id>"],
        "filters": {
            "type": "in",
            "key": "category",
            "value": ["blog", "announcement"]
        }
    }]
)
print(response)
```

```javascript
const response = await openai.responses.create({
  model: 'gpt-4.1',
  input: 'What is deep research by OpenAI?',
  tools: [
    {
      type: 'file_search',
      vector_store_ids: ['<vector_store_id>'],
      filters: {
        type: 'in',
        key: 'category',
        value: ['blog', 'announcement'],
      },
    },
  ],
});
console.log(response);
```

## Supported files

_For `text/` MIME types, the encoding must be one of `utf-8`, `utf-16`, or `ascii`._

| File format | MIME type                                                                 |
| ----------- | ------------------------------------------------------------------------- |
| .c          | text/x-c                                                                  |
| .cpp        | text/x-c++                                                                |
| .cs         | text/x-csharp                                                             |
| .css        | text/css                                                                  |
| .doc        | application/msword                                                        |
| .docx       | application/vnd.openxmlformats-officedocument.wordprocessingml.document   |
| .go         | text/x-golang                                                             |
| .html       | text/html                                                                 |
| .java       | text/x-java                                                               |
| .js         | text/javascript                                                           |
| .json       | application/json                                                          |
| .md         | text/markdown                                                             |
| .pdf        | application/pdf                                                           |
| .php        | text/x-php                                                                |
| .pptx       | application/vnd.openxmlformats-officedocument.presentationml.presentation |
| .py         | text/x-python                                                             |
| .py         | text/x-script.python                                                      |
| .rb         | text/x-ruby                                                               |
| .sh         | application/x-sh                                                          |
| .tex        | text/x-tex                                                                |
| .ts         | application/typescript                                                    |
| .txt        | text/plain                                                                |

## Usage notes

||
|ResponsesChat CompletionsAssistants|Tier 1100 RPMTier 2 and 3500 RPMTier 4 and 51000 RPM|PricingZDR and data residency|

Was this page useful?
