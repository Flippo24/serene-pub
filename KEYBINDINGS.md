# Serene Pub - Keyboard Navigation & Accessibility

This document outlines all keyboard shortcuts and navigation patterns available in Serene Pub to ensure the application is accessible to all users, including those who rely on assistive technologies.

## Global Navigation

### Panel Focus

- **Alt + [** - Focus left sidebar panel (if open, otherwise announces no sidebar is open)
- **Alt + ]** - Focus right sidebar panel (if open, otherwise announces no sidebar is open)
- **Alt + /** - Focus main content area
- **Alt + ,** - Focus site navigation area

### General Navigation

- **Tab** - Navigate forward through interactive elements
- **Shift + Tab** - Navigate backward through interactive elements
- **Enter** - Activate buttons, links, and other interactive elements
- **Escape** - Close modals, popups, and cancel operations

## Chat Interface Navigation

### Message Navigation (In Chat Views)

- `Alt + J` - Navigate to next message
- `Alt + K` - Navigate to previous message
- `Alt + Home` - Navigate to first message
- `Alt + End` - Navigate to last message
- `Shift + G` - Navigate to latest (most recent) message
- `Arrow Up/Down` - Navigate between messages when focused
- `Enter` - Focus message action buttons when on a message

### Message Actions

- `Ctrl/Cmd + R` - Refresh (regenerate) last response
- `Ctrl/Cmd + Left Arrow` - Swipe current message left (previous variation)
- `Ctrl/Cmd + Right Arrow` - Swipe current message right (next variation or generate new)

### Message Actions (when message is focused)

- **E** - Edit message (if editable)
- **D** - Delete message (with confirmation)
- **H** - Hide/unhide message
- **R** - Reply to message
- **S** - Swipe message (if swipes available)

### Advanced Message Actions

- **Ctrl/Cmd + R** - Refresh (regenerate) last response
- **Ctrl/Cmd + Left** - Swipe current message left (previous variation)
- **Ctrl/Cmd + Right** - Swipe current message right (next variation or generate new)
- **Shift + G** - Go to latest (most recent) message with scroll

### Composer

- **Ctrl/Cmd + Enter** - Send message
- **Shift + Enter** - Add line break in message
- **Ctrl/Cmd + /** - Focus message composer

## Sidebar Navigation

### Character Management

- **Tab** - Navigate between character list items
- **Enter** - Select character
- **E** - Edit character (when character is focused)
- **D** - Delete character (when character is focused)
- **F** - Toggle favorite status
- **V** - Cycle visibility setting (visible → minimal → hidden)

### Chat Management

- **Tab** - Navigate between chat list items
- **Enter** - Open chat
- **E** - Edit chat settings
- **D** - Delete chat

### Persona Management

- **Tab** - Navigate between persona list items
- **Enter** - Select persona
- **E** - Edit persona
- **D** - Delete persona

## Form Navigation

### Character/Persona Forms

- **Ctrl/Cmd + S** - Save changes
- **Escape** - Cancel/close form
- **Tab** - Navigate form fields
- **Ctrl/Cmd + Z** - Undo changes (in rich text areas)
- **Ctrl/Cmd + Y** - Redo changes (in rich text areas)

### Modal Dialogs

- **Escape** - Close modal
- **Enter** - Confirm action (when confirm button is focused)
- **Tab** - Navigate between modal buttons

## Screen Reader Features

### Message Announcements

When navigating messages, screen readers will announce:

- Message number in conversation
- Speaker name (character or persona)
- Message content preview
- Available actions

Example: "Chat Message 5: Alice: Hello there! How are you doing today? Actions available: Edit, Delete, Hide"

### List Item Announcements

When navigating lists, screen readers will announce:

- Item type and name
- Position in list
- Additional context

Example: "Character List Item: Bob - A mysterious traveler with ancient knowledge"

### Panel Focus Announcements

When focusing panels, screen readers will announce:

- Panel name and purpose
- Number of items (if applicable)
- Current selection
- Status messages when panels are not open

Example: "Characters Sidebar - 12 characters available, Bob selected"
Example: "No left sidebar is currently open" when pressing Alt+[ with no open left panel

### Action Feedback Announcements

When using keyboard shortcuts, screen readers will announce:

- **Navigation**: "Navigated to first/last/latest message"
- **Regeneration**: "Regenerating last response" or "No response available to regenerate"
- **Swiping**: "Swiped message left/right" or "Cannot swipe - no variations available"
- **Focus changes**: When moving between messages or panels
- **Site navigation**: "Site navigation focused" when using Alt+,
- **Panel status**: "No left/right sidebar is currently open" when attempting to focus closed panels

Example: "Navigated to latest message" when pressing Shift + G
Example: "Site navigation focused" when pressing Alt + ,

## Form Field Guidance

### Required Fields

- Required fields are marked with asterisks (\*)
- Screen readers announce "required" for mandatory fields

### Field Descriptions

- Important fields include helpful descriptions
- Validation errors are announced immediately
- Field format requirements are provided upfront

### Rich Text Editing

- Rich text editors announce formatting options
- Current formatting state is conveyed to screen readers
- Keyboard shortcuts for formatting are available

## Search and Filtering

### Search Fields

- **/** - Focus search field in most contexts
- **Escape** - Clear search field
- **Enter** - Execute search
- **Arrow Down/Up** - Navigate search suggestions

### Filter Controls

- Screen readers announce current filter state
- Number of filtered results is announced
- Clear filter options are keyboard accessible

## Connection and Model Management

### Connection Testing

- Connection status is announced to screen readers
- Success/failure feedback is provided audibly
- Model availability is clearly communicated

## Accessibility Features

### High Contrast Support

- Application respects system high contrast settings
- Custom theme options maintain sufficient contrast ratios

### Reduced Motion

- Animations respect `prefers-reduced-motion` setting
- Essential motion is maintained for functionality

### Focus Management

- Focus is clearly visible with custom focus rings
- Focus is trapped in modals and dialogs
- Focus returns to triggering element when closing dialogs

### Error Handling

- Errors are announced to screen readers
- Error messages are associated with relevant form fields
- Recovery suggestions are provided when possible

## Mobile Accessibility

### Touch Navigation

- All interactive elements meet minimum touch target size (44px)
- Swipe gestures have keyboard alternatives
- Mobile navigation is fully keyboard accessible

### Voice Control

- All interactive elements have appropriate labels for voice control
- Action names are clear and unambiguous

## Tips for Screen Reader Users

1. **Landmark Navigation**: Use landmark navigation (headings, regions) to quickly move between sections
2. **Table Navigation**: Use table navigation commands in data-heavy sections
3. **Search Functionality**: Use in-page search to quickly locate specific content
4. **Settings Exploration**: Visit the Settings panel to customize accessibility preferences

## Reporting Accessibility Issues

If you encounter accessibility barriers while using Serene Pub:

1. Open the Settings panel (Alt + ] then navigate to Settings)
2. Find the "Report Issues" link
3. Include details about:
    - Your assistive technology (screen reader, voice control, etc.)
    - The specific issue encountered
    - Steps to reproduce the problem
    - Your operating system and browser

## Future Accessibility Improvements

Planned accessibility enhancements include:

- Custom keyboard shortcut configuration
- Voice command integration
- Enhanced mobile accessibility features
- Improved rich text editing accessibility
- Better support for low vision users

---

_This document is continuously updated as accessibility features are added and improved. Last updated: August 10, 2025_
