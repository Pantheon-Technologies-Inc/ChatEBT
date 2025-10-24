# Responses API Debugging Guide

## Overview
This guide helps troubleshoot file search and web search functionality using OpenAI's Responses API.

## Environment Variables for Debugging

### Essential Variables
```bash
# Enable/disable Responses API (default: true)
USE_RESPONSES_API=true

# Enable debug logging for OpenAI client
DEBUG_OPENAI=true

# Enable general debug logging
DEBUG_LOGGING=true

# OpenAI API Key (required)
OPENAI_API_KEY=your-api-key-here

# Optional: Specify model for file retrieval
OPENAI_RETRIEVAL_MODEL=gpt-4o
```

### Additional Debug Variables
```bash
# Enable console debug output
DEBUG_CONSOLE=true

# Disable local RAG to force hosted file search
RAG_API_URL=

# Debug plugins and tools
DEBUG_PLUGINS=true
```

## Key Changes Made

### 1. Enhanced Logging
- Added comprehensive logging throughout the OpenAIClient
- Logs attachment handling, tool configuration, and API responses
- Tracks file and web search execution

### 2. File Search Fixes
- **File Attachment Flow**: Files are now properly attached to messages in the Responses API format
- **Vector Store Creation**: Automatically creates and manages vector stores for file search
- **File Upload**: Handles file upload to OpenAI Files API before searching
- **Content Part Conversion**: Properly converts files to `input_file` parts with `file_id`, `file_url`, or base64 data

### 3. Web Search Fixes
- **Tool Configuration**: Properly configures `web_search` tool in the tools array
- **Parameter Handling**: Removes unsupported parameters when web search is enabled
- **Response Parsing**: Correctly parses web search results from the Responses API output

### 4. Responses API Integration
- **Endpoint Construction**: Properly constructs the `/responses` endpoint URL
- **Output Handling**: Correctly handles the `output` array structure instead of `choices`
- **Message Conversion**: Converts traditional messages to Responses API input format
- **Tool Results**: Extracts text from `output_text` content parts

## Testing the Implementation

### Run the Test Script
```bash
node test-responses-api.js
```

This will test both web search and file search functionality.

### Manual Testing

1. **Test Web Search**:
   - Enable web search in your request
   - Ask a question requiring current information
   - Check logs for `[OpenAIClient:ResponsesAPI] Enabled web_search tool`

2. **Test File Search**:
   - Upload a document through the UI
   - Ask a question about the document's content
   - Check logs for:
     - `[OpenAIClient:ResponsesAPI] File search check`
     - `[OpenAIClient] File search was called`
     - Vector store creation logs

## Common Issues and Solutions

### Issue: Files not visible to AI
**Solution**: Check that:
- Files are properly attached to messages
- `message_file_map` is populated
- Files are converted to proper content parts
- Look for: `[OpenAIClient:convertMessagesToResponsesInput] Processing user message files`

### Issue: Web search not working
**Solution**: Verify:
- `web_search` tool is in the tools array
- `tool_choice` is set to "auto"
- Model supports web search (e.g., gpt-4o)
- Check for: `[OpenAIClient:ResponsesAPI] Enabled web_search tool`

### Issue: File search returns no results
**Solution**: Ensure:
- Vector store is created successfully
- Files are uploaded to OpenAI Files API
- Vector store processing is complete
- Look for: `[OpenAIClient] Vector store files ready`

## Log Locations

Key log prefixes to monitor:
- `[OpenAIClient]` - General client operations
- `[OpenAIClient:ResponsesAPI]` - Responses API specific operations
- `[OpenAIClient:convertMessagesToResponsesInput]` - Message conversion
- `[Agents:file_search]` - Agent file search operations

## Implementation Details

### File Processing Flow
1. Files attached to messages → stored in `message_file_map`
2. Convert to Responses API format in `convertMessagesToResponsesInput`
3. Upload to OpenAI Files API if needed
4. Create/update vector store
5. Configure `file_search` tool with vector store IDs
6. Execute search via Responses API

### Web Search Flow
1. Check for `web_search` flag in model options
2. Add `web_search` tool to tools array
3. Set `tool_choice` to "auto"
4. Remove unsupported parameters
5. Execute search via Responses API
6. Parse results from output array

## Additional Resources

- [OpenAI Responses API Documentation](https://platform.openai.com/docs/api-reference/responses)
- [File Search Guide](https://platform.openai.com/docs/guides/tools-file-search)
- [Web Search Guide](https://platform.openai.com/docs/guides/tools-web-search)