# Urgent Fix: File Upload with Responses API

## Issue
Files are uploading in the UI but not being sent to the AI model.

## Root Cause
The migration to Responses API needs the OpenAI SDK to support `client.responses.create()`, and files need to be properly converted to the Responses API format.

## Quick Fix Steps

### 1. Restart the Server

The code has been updated with:
- Base64 file encoding for inline submission
- Better error logging
- Proper file attachment in Responses API format

**Restart your API server:**
```bash
cd api
npm run dev
# or
pm2 restart api
```

### 2. Check the Logs

After restarting, send a message with a file. Check the logs for:

```
[OpenAIClient] Using Responses API for completion
[OpenAIClient] Converted to Responses API format: { inputLength: 2, hasInstructions: true, lastInputContent: [...] }
```

**If you see:**
```
[OpenAIClient] Using Chat Completions API
```

Then the Responses API is disabled. This could mean:
- OpenAI SDK doesn't support it yet
- `USE_RESPONSES_API=false` is set
- The endpoint is OpenRouter or Ollama

### 3. Check OpenAI SDK Version

```bash
cd api
npm list openai
```

You need a version that supports the Responses API (likely v5.0.0+). If you have an older version:

```bash
npm update openai
```

### 4. Enable Debug Logging

Add to your `.env`:
```bash
DEBUG_OPENAI=true
```

This will show more detailed logs about what's being sent to the API.

### 5. Test the Fix

Try uploading the PDF again and sending: "tell me about this investor deck"

Check for:
- ✅ "Using Responses API" log
- ✅ "Converted to Responses API format" log
- ✅ File appears in lastInputContent

If you see errors about "responses is not a function", see option 6 below.

### 6. Fallback to Chat Completions (If Needed)

If the OpenAI SDK doesn't support Responses API yet, temporarily disable it:

Add to `.env`:
```bash
USE_RESPONSES_API=false
```

This will use the old Chat Completions API which should still work with files.

**Note:** This means you won't get the benefits of the Responses API yet, but files will work.

## Expected Behavior

### With Responses API Enabled:
```
User uploads: ARES - Investor Deck.pdf
User types: "tell me about this investor deck"

Server log:
[OpenAIClient] Using Responses API for completion
[OpenAIClient] Converted to Responses API format: {
  inputLength: 1,
  lastInputContent: [
    { type: 'input_text', text: 'tell me about this investor deck' },
    { type: 'input_file', filename: 'ARES - Investor Deck.pdf', file_data: 'data:application/pdf;base64,...' }
  ]
}
[OpenAIClient] responseCompletion { baseURL: 'https://api.openai.com/v1/responses', ... }

AI Response: [Analysis of the PDF content]
```

### With Chat Completions (Fallback):
```
User uploads: ARES - Investor Deck.pdf
User types: "tell me about this investor deck"

Server log:
[OpenAIClient] Using Chat Completions API
[OpenAIClient] chatCompletion { baseURL: 'https://api.openai.com/v1/chat/completions', ... }

AI Response: [Analysis would work if the model supports files in Chat Completions]
```

## Troubleshooting

### Error: "openai.responses is not a function"
**Solution:** Your OpenAI SDK version doesn't support Responses API yet.
```bash
npm update openai
```
Or set `USE_RESPONSES_API=false` to use Chat Completions.

### Error: "File has no usable source"
**Solution:** Check that files are being uploaded correctly and have a `filepath` property.
Check server logs for file upload status.

### Files still not working
**Solution:**
1. Check browser console for upload errors
2. Check server logs in `api/logs/`
3. Verify files are in the file storage location (local/S3/Azure)
4. Check file permissions

### API returns empty response
**Solution:**
1. Check your OpenAI API key is valid
2. Check you have credits remaining
3. Check the model name is correct (should be gpt-4, gpt-5, etc.)
4. Check API logs for rate limit or quota errors

## Testing Checklist

- [ ] Server restarted
- [ ] OpenAI SDK version checked
- [ ] Logs show "Using Responses API"
- [ ] Upload PDF file
- [ ] Send message about file
- [ ] AI responds with file content
- [ ] Try with image file
- [ ] Try with text file

## Success Criteria

✅ Upload a PDF
✅ Ask a question about it
✅ AI responds with content from the PDF
✅ Logs show Responses API being used
✅ No errors in server logs

---

**Need Help?**
Check `RESPONSES_API_MIGRATION.md` for full details or check server logs in `api/logs/`
