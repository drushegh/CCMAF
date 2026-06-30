# Composition Patterns

Core principle: **lift state, compose internals, make state
dependency-injectable**. Components stay flexible as requirements grow;
agents and humans can both reason about explicit structure.

## Avoid Boolean Prop Proliferation (CRITICAL)

Each boolean prop doubles the state space and breeds nested conditionals:

```tsx
// ❌ What does this render? Impossible states representable.
const bad = (
  <Composer isThread isEditing={false} channelId="abc" showAttachments showFormatting={false} />
);

// ✅ Explicit variants — self-documenting, no hidden conditionals
const good = (
  <>
    <ThreadComposer channelId="abc" />
    <EditMessageComposer messageId="xyz" />
  </>
);
```

Each variant composes shared parts:

```tsx
function ThreadComposer({ channelId }: { channelId: string }) {
  return (
    <ThreadProvider channelId={channelId}>
      <Composer.Frame>
        <Composer.Input />
        <AlsoSendToChannelField channelId={channelId} />
        <Composer.Footer>
          <Composer.Formatting />
          <Composer.Submit />
        </Composer.Footer>
      </Composer.Frame>
    </ThreadProvider>
  );
}
```

## Compound Components with Shared Context

Subcomponents read shared state from context, not props; consumers compose
exactly the pieces they need:

```tsx
const ComposerContext = createContext<ComposerContextValue | null>(null);

function ComposerFrame({ children }: { children: React.ReactNode }) {
  return <form>{children}</form>;
}

function ComposerInput() {
  const { state, actions: { update }, meta: { inputRef } } = use(ComposerContext);
  return (
    <TextInput
      ref={inputRef}
      value={state.input}
      onChangeText={text => update(s => ({ ...s, input: text }))}
    />
  );
}

function ComposerSubmit() {
  const { actions: { submit } } = use(ComposerContext);
  return <Button onPress={submit}>Send</Button>;
}

const Composer = {
  Provider: ComposerProvider,
  Frame: ComposerFrame,
  Input: ComposerInput,
  Submit: ComposerSubmit,
  /* Header, Footer, Attachments, ... */
};
```

## Generic Context Interface — `{ state, actions, meta }`

Define the context as a contract any provider can implement. UI consumes
the interface; providers own the implementation:

```tsx
interface ComposerState { input: string; attachments: Attachment[]; isSubmitting: boolean }
interface ComposerActions {
  update: (updater: (s: ComposerState) => ComposerState) => void;
  submit: () => void;
}
interface ComposerMeta { inputRef: React.RefObject<TextInput> }
interface ComposerContextValue {
  state: ComposerState;
  actions: ComposerActions;
  meta: ComposerMeta;
}
```

Different providers, same UI:

```tsx
// Local state for an ephemeral dialog
function ForwardMessageProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(initialState);
  const submit = useForwardMessage();
  return (
    <ComposerContext value={{ state, actions: { update: setState, submit }, meta: { inputRef: useRef(null) } }}>
      {children}
    </ComposerContext>
  );
}

// Globally synced state for channels — same UI components work unchanged
function ChannelProvider({ channelId, children }: Props) {
  const { state, update, submit } = useGlobalChannel(channelId);
  /* ...same shape... */
}
```

## Lift State into Providers

The provider boundary — not visual nesting — decides who can access
state. Components outside the composed UI but inside the provider can
read state and call actions, with no prop drilling, no effect-based
state syncing upward, no reading from refs:

```tsx
function ForwardMessageDialog() {
  return (
    <ForwardMessageProvider>
      <Dialog>
        <Composer.Frame>
          <Composer.Input placeholder="Add a message, if you'd like." />
        </Composer.Frame>
        <MessagePreview />   {/* reads composer state — outside the Frame */}
        <DialogActions>
          <ForwardButton />  {/* calls submit — outside the Frame */}
        </DialogActions>
      </Dialog>
    </ForwardMessageProvider>
  );
}

function ForwardButton() {
  const { actions: { submit } } = use(ComposerContext);
  return <Button onPress={submit}>Forward</Button>;
}
```

Anti-patterns this replaces: `useEffect` syncing child state up via
`onInputChange` callbacks; `stateRef` plumbing; duplicated state.

## Children Over Render Props

```tsx
// ❌ awkward, inflexible
const renderProps = (
  <Composer renderHeader={() => <CustomHeader />} renderActions={() => <SubmitButton />} />
);

// ✅ natural composition
const composed = (
  <Composer.Frame>
    <CustomHeader />
    <Composer.Input />
    <Composer.Footer>
      <SubmitButton />
    </Composer.Footer>
  </Composer.Frame>
);
```

Render props remain right when the parent passes data back:
`<List renderItem={({ item }) => <Item item={item} />} />`.

## React 19 API Notes

- `ref` is a regular prop — no `forwardRef`:
  `function Input({ ref, ...props }: Props & { ref?: React.Ref<HTMLInputElement> })`
- `use(MyContext)` replaces `useContext(MyContext)` — and can be called
  conditionally.
- Context value can be rendered as `<MyContext value={...}>` (no
  `.Provider`).

On React 18 codebases, keep `forwardRef`/`useContext` — match the repo.
