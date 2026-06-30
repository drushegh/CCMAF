# React — TypeScript Typing Notes

React engineering (performance, waterfalls, composition, RSC, data
fetching) lives in the **react-development** skill — load that for any
React behaviour, pattern, or performance question. Visual design and
Tailwind live in **frontend-development**. This file covers only the
TypeScript-specific typing of React code.

## Typing Components and Props

```tsx
interface ButtonProps {
  label: string;
  variant?: "primary" | "secondary";   // union literals, not string
  onClick: () => void;
  children?: React.ReactNode;
}

function Button({ label, variant = "primary", onClick }: ButtonProps) { /* ... */ }
```

- Plain functions with a typed props interface; defaults via
  destructuring. Avoid `React.FC` (legacy implicit-children semantics).
- Extend native element props:
  `interface InputProps extends React.InputHTMLAttributes<HTMLInputElement>`.
- React 19: `ref` is a normal prop —
  `{ ref?: React.Ref<HTMLInputElement> }`; no `forwardRef`. React 18
  repos: keep `forwardRef`.

## Typing Hooks

```tsx
const [user, setUser] = useState<User | null>(null);   // explicit when null-initialised
const inputRef = useRef<HTMLInputElement>(null);        // DOM refs: null-initialised
const idRef = useRef<number>(0);                        // mutable value refs

// Discriminated unions for async UI state — not independent booleans
type FetchState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: T };
```

## Typing Events and Context

```tsx
function onChange(e: React.ChangeEvent<HTMLInputElement>) {}
function onSubmit(e: React.FormEvent<HTMLFormElement>) {}
function onClick(e: React.MouseEvent<HTMLButtonElement>) {}

// Context: type the value, null-check at the consumption boundary
const AuthContext = createContext<AuthContextValue | null>(null);

function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);     // useContext on React 18
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

## Generic Components

```tsx
function List<T>({ items, renderItem }: {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
}) {
  return <>{items.map(renderItem)}</>;
}
```

Validate external data crossing into components with Zod (see
validation-and-apis.md) — props from your own code are typed, data from
the network is not.
