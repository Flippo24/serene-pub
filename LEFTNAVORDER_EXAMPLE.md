# Using a List of Strings to Order panelsCtx.leftNav Items

## How It Works

The navigation ordering system uses a helper function `getOrderedEntries` that takes two parameters:
1. A navigation object (e.g., `panelsCtx.leftNav`)
2. An array of strings representing the desired order

## Implementation

### 1. Define Your Order Array

In `Layout.svelte`, the order is defined as:

```javascript
const leftNavOrder = [
    "settings",
    "users",
    "connections",
    "sampling",
    "contexts", 
    "prompts",
    "ollama"
]
```

### 2. The Helper Function

```javascript
function getOrderedEntries(nav: Record<string, any>, order: string[]) {
    // First, get entries that are in the order array
    const orderedEntries = order
        .filter((key) => key in nav)
        .map((key) => [key, nav[key]] as const)
    
    // Then, append any entries not in the order array
    const remainingEntries = Object.entries(nav).filter(
        ([key]) => !order.includes(key)
    )
    
    return [...orderedEntries, ...remainingEntries]
}
```

### 3. Usage in Templates

In `Header.svelte`:
```svelte
{#each panelsCtx.getOrderedEntries(panelsCtx.leftNav, panelsCtx.leftNavOrder || []) as [key, item]}
    <!-- Navigation items rendered in your custom order -->
{/each}
```

## Key Features

1. **Flexible**: Items in the order array are rendered first, in the specified order
2. **Safe**: If an item in the order array doesn't exist in the nav object, it's simply skipped
3. **Complete**: Any items not in the order array are appended at the end
4. **Dynamic**: The navigation items can be added/removed dynamically, and the ordering will still work

## Customizing the Order

To change the order, simply modify the `leftNavOrder` array:

```javascript
// Example: Put ollama first, then users, then everything else
const leftNavOrder = [
    "ollama",
    "users", 
    "settings",
    "connections",
    "sampling",
    "contexts",
    "prompts"
]
```

## Alternative: User-Specific Ordering

You could also make the order user-specific by storing it in user settings:

```javascript
// In your component
let userNavOrder = $derived(userSettingsCtx.settings?.leftNavOrder || leftNavOrder)

// Then use it in the template
{#each panelsCtx.getOrderedEntries(panelsCtx.leftNav, userNavOrder) as [key, item]}
    <!-- Navigation items -->
{/each}
```

This way, each user could have their own preferred navigation order.