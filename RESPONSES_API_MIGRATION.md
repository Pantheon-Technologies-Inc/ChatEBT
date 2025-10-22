# Responses API Migration Guide

## Overview

This project has been migrated from OpenAI's Chat Completions API to the new **Responses API**. This migration provides several key benefits:

### Benefits

1. **Unified File Handling** - All file types (images, PDFs, documents) are sent inline with a single unified upload button
2. **Server-Side State** - OpenAI manages conversation state on the server for better caching and performance
3. **Better Performance** - 40-80% better cache utilization, lower latency, and lower costs
4. **Preserved Reasoning** - Reasoning state persists across conversation turns for better coherence
5. **Built-in Tools** - Native support for web search, file search, and computer use

### What Changed

#### Backend (API)
- **`api/app/clients/OpenAIClient.js`**:
  - Added `responseCompletion()` method to call the `/v1/responses` endpoint
  - Added `convertMessagesToResponsesInput()` to convert messages to new format
  - Added `convertFileToBase64ContentPart()` to encode files inline
  - Updated `sendCompletion()` to use Responses API by default

#### Frontend (Client)
- **`client/src/components/Chat/Input/Files/`**:
  - Unified `AttachFile.tsx` - now handles all file types with a single button
  - Updated `AttachFileChat.tsx` - removed specialized upload buttons
  - Simplified `useFileHandling.ts` - removed `tool_resource` logic

- **Removed complexity**:
  - No more separate buttons for images vs documents vs OCR
  - No more dropdown menus for file type selection
  - Responses API automatically detects file types

## How to Enable

### Environment Variables

Add to your `.env` file:

```bash
# Enable Responses API (enabled by default)
# Set to 'false' to use legacy Chat Completions API
USE_RESPONSES_API=true
```

The migration is **enabled by default** for OpenAI endpoints. To disable and use legacy Chat Completions:

```bash
USE_RESPONSES_API=false
```

### Requirements

1. **OpenAI SDK**: Ensure you're using a version that supports the Responses API
2. **OpenAI API Key**: Standard OpenAI API key with access to GPT-4 or GPT-3.5

## API Differences

### Old Format (Chat Completions)
```javascript
{
  model: "gpt-4",
  messages: [
    { role: "system", content: "You are a helpful assistant" },
    { role: "user", content: "Hello" }
  ],
  // Files sent separately via upload endpoint
}
```

### New Format (Responses API)
```javascript
{
  model: "gpt-4",
  instructions: "You are a helpful assistant",  // system message
  input: [
    {
      role: "user",
      content: [
        { type: "input_text", text: "Hello" },
        { type: "input_file", filename: "doc.pdf", file_data: "data:application/pdf;base64,..." }
      ]
    }
  ],
  conversation_id: "conv_123"  // optional, for stateful conversations
}
```

## File Handling

### Before (Chat Completions)
- Files uploaded via separate `/v1/files` endpoint
- Different buttons for different file types
- Vision models required special handling
- File IDs referenced in messages

### After (Responses API)
- Files sent inline as base64-encoded content parts
- Single upload button for all file types
- Automatic detection of file purpose (vision, search, etc.)
- No separate upload step required

### Supported File Types
The Responses API automatically handles:
- **Images**: JPEG, PNG, GIF, WebP, HEIC (auto-converted)
- **Documents**: PDF, DOCX, TXT, MD
- **Data**: CSV, JSON, XML
- **Code**: All programming language files

## Testing

### Test Cases

1. **Text-only conversation**:
   ```
   User: Hello
   Assistant: Hi! How can I help you today?
   ```

2. **Image upload**:
   ```
   User: [uploads image.jpg] What's in this image?
   Assistant: I can see...
   ```

3. **Document upload**:
   ```
   User: [uploads document.pdf] Summarize this
   Assistant: This document discusses...
   ```

4. **Multiple files**:
   ```
   User: [uploads image.jpg, doc.pdf] Compare these
   Assistant: Comparing the image and document...
   ```

5. **Conversation continuity**:
   ```
   User: Tell me about cats
   Assistant: Cats are...
   User: What about dogs?
   Assistant: [Should maintain context about previous cat discussion]
   ```

### Verification

Check browser console for:
```
[OpenAIClient] responseCompletion { baseURL: 'https://api.openai.com/v1/responses', ... }
```

If you see `chatCompletion` instead, the migration is not active.

## Troubleshooting

### Issue: Files not uploading
- Check that `USE_RESPONSES_API=true` in `.env`
- Verify file size is within limits
- Check browser console for errors

### Issue: "openai.responses is not a function"
- Your OpenAI SDK version may not support Responses API yet
- Check package version: `npm list openai`
- Update if needed: `npm update openai`

### Issue: Conversation context lost
- Ensure `conversationId` is being passed to `responseCompletion()`
- Check server logs for conversation state management

### Fallback to Chat Completions

The code automatically falls back to Chat Completions for:
- OpenRouter endpoints
- Ollama endpoints
- Azure OpenAI (until supported)
- When `USE_RESPONSES_API=false`

## Migration Checklist

- [x] Backend: Added `responseCompletion()` method
- [x] Backend: Added message conversion helpers
- [x] Backend: Updated `sendCompletion()` to use Responses API
- [x] Frontend: Unified file upload components
- [x] Frontend: Removed tool_resource logic
- [x] Frontend: Simplified upload UI
- [ ] Testing: Verify text conversations work
- [ ] Testing: Verify image uploads work
- [ ] Testing: Verify document uploads work
- [ ] Testing: Verify multi-file uploads work
- [ ] Testing: Verify conversation continuity
- [ ] Production: Monitor error rates
- [ ] Production: Monitor performance improvements

## Next Steps

1. **Test thoroughly** with various file types and conversation flows
2. **Monitor logs** for any Responses API errors
3. **Measure performance** - should see faster response times and lower costs
4. **Gradual rollout** - can use `USE_RESPONSES_API` flag to control deployment
5. **Deprecate old code** - after stable, remove Chat Completions fallback

## Resources

- [OpenAI Responses API Docs](https://platform.openai.com/docs/api-reference/responses)
- [Migration Guide](https://platform.openai.com/docs/guides/migrate-to-responses)
- [Responses vs Chat Completions](https://platform.openai.com/docs/guides/responses-vs-chat-completions)

## Support

For issues or questions:
1. Check server logs in `api/logs/`
2. Check browser console for client errors
3. Review this migration guide
4. Consult OpenAI documentation

---

**Last Updated**: 2025-10-21
**Migration Status**: ✅ Complete - Ready for Testing
