# Serene Pub - AI Assistant Reference

**Version**: 0.4.1  
**License**: AGPL-3.0  
**Author**: Jody Doolittle  
**Repository**: https://github.com/doolijb/serene-pub

## Project Overview

Serene Pub is a modern, customizable chat application designed for immersive roleplay and creative conversations with AI characters. It aims to be a more intuitive and streamlined roleplay client focusing on:

- Reduced UI complexity and visual clutter
- Server-side configuration management
- Real-time synchronization across devices via WebSockets
- Async server-side API calls for better reliability
- Clean, modern responsive UI

## Software Stack

### Frontend

- **SvelteKit** - Full-stack Svelte framework (using Svelte 5)
- **Tailwind CSS** - Utility-first CSS framework
- **Skeleton UI** - Component library built on Tailwind for theming and components
- **TypeScript** - Type-safe JavaScript
- **Socket.IO Client** - Real-time bidirectional communication via `sveltekit-io`

### Backend

- **Node.js** - JavaScript runtime
- **SvelteKit Server** - Server-side rendering and API routes
- **Socket.IO Server** - Real-time WebSocket communication via `sveltekit-io`
- **PostgreSQL** - Database via pglite
- **Drizzle ORM** - Type-safe SQL ORM with migrations
- **TypeScript** - Server-side type safety

### Development & Build Tools

- **Npm** - Package manager and runtime (preferred for development), bun may not be compatible with embedded postgres
- **Vite** - Build tool and dev server
- **Prettier** - Code formatting
- **Svelte Check** - TypeScript checking for Svelte files

### AI & Connection Adapters

- **BaseConnectionAdapter** - Base class for adding new LLM API's
- **OpenAI API** - ChatGPT and compatible APIs - chat completions only
- **Ollama** - Ollama's native API - chat and generation endpoints
- **LM Studio** - LM Studio's native API - completions only (no chat support yet)
- **LLaMA.cpp** - Direct llama.cpp integration
- Custom connection adapter system for extensibility
- **getConnectionAdapter** - Handler for grabbing the correct adapter, add new adapters here
- **ConnectionTypes** - Class used as enum for connection adapter options, add new adapters here

### Key Dependencies

- `@sveltejs/adapter-node` - Node.js deployment adapter
- `drizzle-orm` & `drizzle-kit` - Database ORM and migration tools
- `pglite` - Embedded PostgreSQL for portable deployment
- `pg` - PostgreSQL client library
- `openai` - OpenAI API client
- `ollama` - Ollama API client
- `@lmstudio/sdk` - LM Studio integration
- `handlebars` - Template engine for prompt building
- Various tokenizers for different model types

## Application Architecture

### Project Structure

```
src/
├── app.html                 # Base HTML template
├── app.css                 # Global styles
├── app.d.ts                # Global TypeScript definitions
├── hooks.server.ts         # Server-side hooks and middleware
├── hooks.client.ts         # Client-side hooks
├── hooks.ts                # Universal hooks
├── lib/
│   ├── client/             # Client-side components and utilities
│   │   └── components/     # Svelte components
│   ├── server/             # Server-side logic
│   │   ├── db/            # Database configuration and schema
│   │   ├── connectionAdapters/  # AI service integrations
│   │   ├── sockets/       # WebSocket event handlers
│   │   └── utils/         # Server utilities
│   └── shared/            # Shared utilities and types
└── routes/                # SvelteKit routes (pages and API endpoints)
    ├── +layout.server.ts  # Server-side layout data
    ├── +layout.svelte     # Root layout component
    ├── +page.svelte       # Home page
    ├── api/              # API routes
    ├── avatars/          # Avatar management routes
    ├── chats/            # Chat-specific routes
    └── images/           # Image handling routes
```

### Database Architecture

**Database**: PostgreSQL with Drizzle ORM

**Key Tables**:

- `users` - User accounts and preferences
- `connections` - AI service connection configurations
- `samplingConfigs` - AI generation parameters (temperature, top_k, etc.)
- `contextConfigs` - Context window and formatting settings
- `promptConfigs` - Prompt templates and structure
- `characters` - AI characters with personality, description, etc.
- `personas` - User personas/characters for roleplay
- `chats` - Chat conversations
- `chatMessages` - Individual messages in chats
- `lorebooks` - World building and lore storage
- `lorebookBindings` - Associations between lorebooks and characters/chats

**Migration System**: Uses Drizzle migrations in `/drizzle/` directory for version control and schema updates.

### Real-time Communication

**WebSocket Architecture**: Built on Socket.IO via `sveltekit-io`

**Socket Namespace Structure**:

- All events are typed in `app.d.ts` under the `Sockets` namespace
- Each entity type has CRUD operations (Create, Read, Update, Delete, List)
- Real-time synchronization across multiple browser tabs/devices

**Key Socket Events**:

- User management: `user`, `updateUser`
- Chat operations: `chatsList`, `chat`, `createChat`, `sendPersonaMessage`, `triggerGenerateMessage`
- Character management: `characterList`, `character`, `createCharacter`, `updateCharacter`
- Connection management: `connectionsList`, `testConnection`, `refreshModels`
- Configuration: `samplingConfigsList`, `contextConfigsList`, `promptConfigsList`

### AI Connection System

**Base Architecture**: Abstract `BaseConnectionAdapter` class with implementations for different AI services

**Connection Adapters**:

- `OpenAIChatAdapter` - OpenAI API and compatible services
- `OllamaAdapter` - Local Ollama installations
- `LMStudioAdapter` - LM Studio local server
- `LlamaCppAdapter` - Direct llama.cpp integration

**Key Features**:

- Async generation with abort capability
- Token counting and context management
- Model listing and testing
- Streaming response support

### Prompt Building System

**Core Component**: `PromptBuilder` class in `/src/lib/server/utils/promptBuilder.ts`

**Features**:

- Handlebars template engine for dynamic prompt construction
- Token counting and context window management
- Modular prompt sections (system, characters, personas, chat history)
- Context threshold management for long conversations
- Support for both string prompts and message arrays

**Template Structure**:

- System instructions
- Character definitions (JSON format)
- User personas (JSON format)
- Chat history with configurable limits
- Dynamic token management

### UI/UX Architecture

**Component Structure**:

- **Layouts**: Root layout with sidebar navigation
- **Pages**: Main chat interface, character/persona management
- **Sidebars**: Context-sensitive sidebars for configuration
- **Modals**: Character creation, settings, confirmations
- **Chat Components**: Message display, input handling, generation controls

**State Management**:

- Svelte 5 runes for reactive state
- Socket.IO for real-time data synchronization
- Context APIs for global state (user, active chat)

**Svelte 5 Syntax**

- Do not use svelte 4 `$:` or `on:` syntax
- Use svelte 5 `$effect(()=>{})`, `$state()`, `$derived()` || `$derived.by(()=>{})` syntax

**JS/TS Formatting**

- Do not use semi-colons unless required, i.e. inline
- Do not use single quotes unless required, i.e. compound/nested sentenced
- Use 4 space tabs

**Responsive Design**:

- Mobile-first responsive layout
- Skeleton UI components for consistent theming
- Dark/light theme support

## Key Configuration Files

### Development

- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `svelte.config.js` - Svelte/SvelteKit configuration
- `vite.config.ts` - Vite build configuration
- `tailwind.config.js` - Tailwind CSS configuration

### Database

- `src/lib/server/db/drizzle.config.ts` - Database connection and migration config
- `$lib/server/db/schema.ts` - Database schema definitions
- `drizzle/` - Migration files and metadata

### Deployment

- `dist-assets/` - Platform-specific deployment scripts
- `scripts/bundle-dist.js` - Build bundling script
- Platform launchers for Windows (`run.cmd`), Linux/macOS (`run.sh`)

## Deployment Architecture

### Portable Deployment

- Self-contained executable with embedded Node.js runtime
- Embedded PostgreSQL database for data persistence
- Platform-specific launchers handle privilege management
- No installation required - extract and run
- Includes pruned node_modules for each platform
- Distributed modules must have compatible licenses that permit redistribution

### Windows Considerations

- PostgreSQL requires non-admin privileges for security
- Automatic privilege dropping using PowerShell `Start-Process -Verb runAsUser`
- Alternative deployment via Docker/WSL2 for sandboxing

### Development Environment

1. Install Node.js, Bun, and optionally Ollama
2. Clone repository and run `bun install`
3. Run `bun run db:migrate` for database setup
4. Start development server with `bun run dev`
5. Access at `http://localhost:5173`

## Security Considerations

- AGPL-3.0 license requires source code disclosure for modifications
- PostgreSQL privilege separation on Windows
- API key management for external AI services
- No built-in authentication (single-user application)
- Local-first architecture for privacy

## Integration Points

### Character Card Compatibility

- Import/export compatibility with Silly Tavern character cards
- Support for PNG metadata and JSON formats
- Character image handling and avatar management

### AI Service Integration

- Modular adapter system for easy extension
- Support for multiple concurrent connections
- Model discovery and testing capabilities
- Token counting for various model types

### File Handling

- Character card imports
- Avatar image uploads
- Lorebook imports
- Chat exports (planned)

## Development Patterns

### Socket Event Handling

1. Define types in `app.d.ts` under `Sockets` namespace
2. Implement handlers in `/src/lib/server/sockets/`
3. Register in `/src/lib/server/sockets/index.ts`
4. Client-side listeners in Svelte components

### Database Operations

1. Define schema in `db/schema.ts`
2. Add new tables Select/Insert inference to `app.d.ts`
3. Generate migrations with `bun run db:generate`
4. Run migrations with `bun run db:migrate`
5. Use Drizzle ORM queries in socket handlers

### UI Component Development

1. Create Svelte components in `/src/lib/client/components/`
2. Use Skeleton UI primitives for consistency
3. Implement real-time updates via Socket.IO
4. Follow responsive design patterns

This reference provides a comprehensive overview of Serene Pub's architecture, stack, and development patterns for AI assistants working on the codebase.
