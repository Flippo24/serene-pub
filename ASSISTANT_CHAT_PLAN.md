# Assistant Chat Implementation Plan

## Overview
Create a new chat type that allows users to have conversations with a system assistant. Unlike roleplay chats that use personas and characters, assistant chats will feature the logged-in user directly communicating with an AI assistant that can:
- Answer questions about Serene Pub usage
- Suggest content ideas (characters, personas, lore, etc.)
- Create/edit database entries on the user's behalf
- Provide creative writing assistance

## Current Architecture Analysis

### Existing Chat System
- **Chat Types**: Currently only roleplay chats exist (`chats` table)
  - Has `isGroup` boolean for group vs 1:1
  - Links to characters via `chatCharacters` junction table
  - Links to personas via `chatPersonas` junction table
  - Messages have `role`, `characterId`, and `personaId`

### Key Components
1. **Database Schema** (`src/lib/server/db/schema.ts`)
   - `chats` table
   - `chatMessages` table
   - `chatCharacters` junction table
   - `chatPersonas` junction table

2. **Connection Adapters** (`src/lib/server/connectionAdapters/`)
   - `BaseConnectionAdapter.ts` - Base class
   - `OpenAIChatAdapter.ts` - OpenAI/compatible APIs
   - `OllamaAdapter.ts` - Ollama API
   - `LMStudioAdapter.ts` - LM Studio API
   - `LlamaCppAdapter.ts` - llama.cpp

3. **Prompt Building** (`src/lib/server/utils/promptBuilder/`)
   - `index.ts` - Main PromptBuilder class
   - `InterpolationEngine.ts` - Template processing
   - `ContentInfillEngine.ts` - Context management
   - Currently focused on roleplay scenarios

4. **Socket Handlers** (`src/lib/server/sockets/chats.ts`)
   - Chat CRUD operations
   - Message handling
   - Response generation via `generateResponse()`

5. **Frontend** (`src/routes/chats/[id]/+page.svelte`)
   - Message display
   - Character/persona management
   - Group chat features

## Implementation Plan

### Phase 1: Database Schema Changes

#### 1.1 Add Chat Type Enum
**File**: `src/lib/shared/constants/ChatTypes.ts` (NEW)
```typescript
export class ChatTypes {
    static readonly ROLEPLAY = "roleplay"
    static readonly ASSISTANT = "assistant"
    
    static readonly ALL = [
        ChatTypes.ROLEPLAY,
        ChatTypes.ASSISTANT
    ]
}
```

#### 1.2 Update Chat Schema
**File**: `src/lib/server/db/schema.ts`
- Add `chatType` field to `chats` table (default: "roleplay")
- Create migration script

```typescript
chatType: text("chat_type").notNull().default("roleplay") // "roleplay" | "assistant"
```

#### 1.3 Create Migration
**File**: `drizzle/XXXX_add_chat_type.sql` (NEW)
```sql
ALTER TABLE chats ADD COLUMN chat_type TEXT NOT NULL DEFAULT 'roleplay';
CREATE INDEX idx_chats_chat_type ON chats(chat_type);
```

### Phase 2: Assistant Chat Core Logic

#### 2.1 Assistant System Prompts
**File**: `src/lib/shared/constants/AssistantPrompts.ts` (NEW)
```typescript
export const ASSISTANT_SYSTEM_PROMPTS = {
    DEFAULT: `You are the Serene Pub Assistant, a helpful AI that assists users with:
    1. Understanding and using Serene Pub features
    2. Suggesting creative ideas for characters, personas, and storylines
    3. Creating and editing content when requested
    
    You have access to Serene Pub documentation and can reference it when needed.
    When you don't know something, admit it honestly.
    
    You can perform actions like creating characters or editing lore when the user asks.`,
    
    DOCUMENTATION_CONTEXT: `# Serene Pub Documentation Context
    [This will be populated with relevant docs from README.md, wiki, etc.]`
}
```

#### 2.2 Assistant Adapter Extension
**Option A**: Extend existing adapters to handle assistant mode
**Option B**: Create separate `AssistantAdapter` wrapper

**Recommended: Option A** - Add assistant mode to `BaseConnectionAdapter`

**File**: `src/lib/server/connectionAdapters/BaseConnectionAdapter.ts`
```typescript
// Add to constructor params
isAssistantMode?: boolean

// Add method
protected getSystemPrompt(): string {
    if (this.isAssistantMode) {
        return ASSISTANT_SYSTEM_PROMPTS.DEFAULT
    }
    return this.promptBuilder.contextBuildSystemPrompt()
}
```

#### 2.3 Update PromptBuilder for Assistant Mode
**File**: `src/lib/server/utils/promptBuilder/index.ts`

Add assistant mode support:
```typescript
constructor(params) {
    // ... existing code
    this.isAssistantMode = params.isAssistantMode || false
}

async compilePrompt(args: {}): Promise<CompiledPrompt> {
    if (this.isAssistantMode) {
        return this.compileAssistantPrompt(args)
    }
    return this.compileRoleplayPrompt(args) // rename existing method
}

private async compileAssistantPrompt(args: {}): Promise<CompiledPrompt> {
    // Simple system + messages format
    // No character descriptions, personas, lorebooks, etc.
    // Just conversation history
}
```

### Phase 3: API/Socket Handlers

#### 3.1 Update Chat Creation
**File**: `src/lib/server/sockets/chats.ts`

Update `chatsCreateHandler`:
```typescript
// Add chatType to InsertChat
const chatData: InsertChat = {
    userId,
    isGroup: false,
    chatType: params.chatType || ChatTypes.ROLEPLAY,
    // ... rest
}
```

#### 3.2 Assistant Chat Validation
Add validation to prevent mixing chat types:
- Assistant chats cannot have characters
- Assistant chats cannot have personas (except maybe for context)
- Assistant chats have simpler structure

#### 3.3 Update Response Generation
**File**: `src/lib/server/utils/generateResponse.ts`

```typescript
// Detect assistant mode
const isAssistantMode = chat.chatType === ChatTypes.ASSISTANT

// Pass to adapter
const adapter = new Adapter({
    // ... existing params
    isAssistantMode,
    currentCharacterId: isAssistantMode ? null : generatingMessage.characterId
})
```

### Phase 4: Frontend Components

#### 4.1 Home Page Button
**File**: `src/routes/+page.svelte`

Add button to launch assistant chat (only if setup is complete):
```svelte
{#if isBasicSetup}
    <button onclick={openAssistantChat}>
        <Icons.BotMessageSquare />
        Chat with Assistant
    </button>
{/if}
```

#### 4.2 Assistant Chat Modal/Route
**Option A**: Modal overlay (quick access, doesn't leave current page)
**Option B**: Dedicated route `/assistant` (full experience)

**Recommended: Option B** - Dedicated route for better UX

**File**: `src/routes/assistant/+page.svelte` (NEW)
- Simplified chat interface
- No character/persona selectors
- Focus on conversation with assistant
- Action buttons for common tasks

#### 4.3 Chat Page Updates
**File**: `src/routes/chats/[id]/+page.svelte`

Detect chat type and adjust UI:
```svelte
let isAssistantChat = $derived(chat?.chatType === ChatTypes.ASSISTANT)

// Hide character/persona controls if assistant chat
{#if !isAssistantChat}
    <!-- Character selection, persona management, etc. -->
{/if}
```

### Phase 5: Assistant Actions/Tools

#### 5.1 Tool/Action System
**File**: `src/lib/server/utils/assistantTools.ts` (NEW)

Define tools the assistant can use:
```typescript
export const ASSISTANT_TOOLS = {
    CREATE_CHARACTER: {
        name: "create_character",
        description: "Create a new character",
        parameters: {
            name: "string",
            description: "string",
            // ...
        }
    },
    SEARCH_DOCS: {
        name: "search_docs",
        description: "Search Serene Pub documentation",
        parameters: {
            query: "string"
        }
    },
    // ... more tools
}
```

#### 5.2 Tool Execution Handler
Parse assistant responses for tool calls and execute them:
```typescript
async function executeAssistantTool(toolName: string, params: any, userId: number) {
    switch (toolName) {
        case "create_character":
            return await createCharacterFromAssistant(params, userId)
        case "search_docs":
            return await searchDocumentation(params.query)
        // ...
    }
}
```

#### 5.3 Function Calling Integration
- Use OpenAI-style function calling if available
- Fallback to prompt-based tool calling for other models

### Phase 6: Documentation Integration

#### 6.1 Documentation Embeddings (Future)
For now, include basic documentation in system prompt:
```typescript
const documentationContext = `
${README_CONTENT}
${KEY_WIKI_PAGES}
`
```

#### 6.2 RAG System (Future Phase)
- Vector embeddings of documentation
- Semantic search for relevant context
- Dynamic context injection

### Phase 7: Safety & Limitations

#### 7.1 Permission Checks
All assistant actions must validate:
- User owns the resource being modified
- User has appropriate permissions
- Action is within allowed scope

#### 7.2 Confirmation Flow
For destructive/important actions:
- Assistant suggests action
- User confirms
- Assistant executes

```typescript
// Message metadata
{
    suggestedAction: {
        type: "create_character",
        params: {...},
        requiresConfirmation: true,
        confirmed: false
    }
}
```

### Phase 8: Testing & Refinement

#### 8.1 Unit Tests
- Chat type differentiation
- Prompt building for assistant mode
- Tool execution

#### 8.2 Integration Tests
- Create assistant chat
- Send messages
- Execute actions

#### 8.3 User Testing
- Documentation Q&A accuracy
- Creative suggestion quality
- Action execution reliability

## Implementation Order

### Sprint 1: Foundation (Database & Core)
1. ✅ Create ChatTypes constant
2. ✅ Update database schema (add chat_type column)
3. ✅ Create migration
4. ✅ Update TypeScript types
5. ✅ Update chat creation handler

### Sprint 2: Basic Assistant Chat
1. ✅ Create assistant system prompts
2. ✅ Add assistant mode to PromptBuilder
3. ✅ Update adapters for assistant mode
4. ✅ Create basic assistant chat UI (route)
5. ✅ Add home page button

### Sprint 3: Enhanced Assistant
1. ✅ Add documentation context
2. ✅ Implement basic tools (search docs)
3. ✅ Add suggestion features
4. ✅ Improve assistant prompts

### Sprint 4: Advanced Actions
1. ✅ Implement create/edit actions
2. ✅ Add confirmation flow
3. ✅ Permission validation
4. ✅ Action feedback UI

### Sprint 5: Polish & Testing
1. ✅ Comprehensive testing
2. ✅ UI/UX improvements
3. ✅ Error handling
4. ✅ Documentation

## Files to Create

### New Files
- `src/lib/shared/constants/ChatTypes.ts`
- `src/lib/shared/constants/AssistantPrompts.ts`
- `src/lib/server/utils/assistantTools.ts`
- `src/routes/assistant/+page.svelte`
- `src/routes/assistant/+page.server.ts`
- `src/lib/client/components/AssistantChatMessage.svelte`
- `drizzle/XXXX_add_chat_type.sql`

### Files to Modify
- `src/lib/server/db/schema.ts`
- `src/lib/server/connectionAdapters/BaseConnectionAdapter.ts`
- `src/lib/server/utils/promptBuilder/index.ts`
- `src/lib/server/sockets/chats.ts`
- `src/lib/server/utils/generateResponse.ts`
- `src/routes/chats/[id]/+page.svelte`
- `src/routes/+page.svelte`
- `src/lib/shared/sockets/types.ts`

## Considerations

### Backward Compatibility
- Existing chats default to "roleplay" type
- No breaking changes to current functionality
- Migration is non-destructive

### Scalability
- Assistant mode is isolated from roleplay logic
- Tool system is extensible
- Can add new assistant capabilities without touching roleplay code

### Model Compatibility
- Assistant mode should work with all connection types
- Function calling is optional (graceful degradation)
- Simple prompt-based fallback for models without function calling

### User Experience
- Clear distinction between chat types
- Easy access to assistant from home page
- Contextual help based on current page/action

## Future Enhancements

1. **Multi-turn Planning**: Assistant can break complex tasks into steps
2. **Context Awareness**: Assistant knows what page user is on
3. **Proactive Suggestions**: "I noticed you haven't set up a lorebook..."
4. **Learning**: Assistant learns user preferences over time
5. **Voice Interface**: Voice chat with assistant
6. **Image Understanding**: Assistant can analyze character art
7. **Export/Import**: Assistant can help with bulk operations

## Success Criteria

- ✅ Users can create assistant chats from home page
- ✅ Assistant can answer documentation questions accurately
- ✅ Assistant can suggest character/persona ideas
- ✅ Assistant can create entries with user confirmation
- ✅ No breaking changes to existing roleplay functionality
- ✅ Works with all connection types (OpenAI, Ollama, etc.)
- ✅ Clear, helpful error messages
- ✅ Responsive UI on desktop and mobile

## Notes

- Keep assistant mode simple initially
- Focus on core use cases first
- Add advanced features iteratively
- Maintain separation from roleplay logic
- Prioritize user safety and data integrity
