# Security

Shell scripts run with their caller's privileges and compose commands
from strings — the attack surface is the language itself. These patterns
are mandatory wherever input isn't fully trusted.

## Input Validation — every external input

```bash
validate_input() {
    local -r input="$1"
    local -r pattern="$2"
    local -r max_length="${3:-255}"

    [[ -n "$input" ]] || { echo "ERROR: input required" >&2; return 1; }
    [[ "$input" =~ $pattern ]] || { echo "ERROR: invalid format" >&2; return 1; }
    (( ${#input} <= max_length )) || { echo "ERROR: too long (max $max_length)" >&2; return 1; }
}

read -r user_input
validate_input "$user_input" '^[a-zA-Z0-9_-]+$' 50 || exit 1
```

Allowlist patterns (what's valid), never denylist (what's bad) —
attackers know more bad inputs than you do.

## Command Injection

```bash
# ❌ NEVER — eval on anything external, ever
eval "$user_input"

# ❌ Option injection: pattern "-e /etc/passwd" becomes a grep flag
grep "$user_pattern" file.txt

# ✅ -- terminates option parsing
grep -- "$user_pattern" file.txt
rm -- "$user_file"
cp -- "$src" "$dest"

# ✅ Build commands as arrays — arguments stay arguments
cmd=(rsync -az --delete)
[[ "$VERBOSE" == true ]] && cmd+=(-v)
cmd+=("$src/" "$dest/")
"${cmd[@]}"
```

Variables are data, never code. If you're tempted by `eval`, the answer
is an array, an associative-array dispatch table, or a redesign.

## Path Traversal

```bash
# Canonicalise both sides, then prefix-check
is_safe_path() {
    local -r file_path="$1"
    local -r base_dir="$2"
    local real_path real_base
    real_path=$(readlink -f -- "$file_path" 2>/dev/null) || return 1
    real_base=$(readlink -f -- "$base_dir" 2>/dev/null) || return 1
    [[ "$real_path" == "$real_base"/* ]]
}

if is_safe_path "/var/app/uploads/$user_file" "/var/app/uploads"; then
    cat -- "/var/app/uploads/$user_file"
else
    echo "ERROR: access denied" >&2; exit 1
fi
```

String-stripping `../` is insufficient on its own (encodings, symlinks) —
canonicalise-and-compare is the real check. (macOS: `readlink -f` needs
coreutils — see portability.md.)

## Temp Files — race conditions

```bash
# ❌ predictable names are symlink-attack targets
tmp="/tmp/myapp.tmp"          # attacker pre-creates as symlink to /etc/passwd
tmp="/tmp/myapp-$$.tmp"       # PIDs are guessable

# ✅
readonly TMP_FILE=$(mktemp)
readonly TMP_DIR=$(mktemp -d)
chmod 600 "$TMP_FILE"; chmod 700 "$TMP_DIR"
trap 'rm -rf -- "$TMP_FILE" "$TMP_DIR"' EXIT INT TERM
```

## Secrets

```bash
# ❌ hardcoded; ❌ in argv (visible in ps); ❌ exported wholesale
DB_PASSWORD="supersecret"
mytool --password "$DB_PASSWORD"

# ✅ secret files (container secrets, restricted perms)
DB_PASSWORD=$(< /run/secrets/db_password)

# ✅ secret managers
DB_PASSWORD=$(az keyvault secret show --vault-name "$VAULT" \
    --name db-password --query value -o tsv)

# ✅ pass via stdin or env-var-to-child where the tool supports it
printf '%s' "$DB_PASSWORD" | mytool --password-stdin
```

Never echo secrets in logs or `set -x` traces (`set +x` around sensitive
sections); never commit them; `.env` files are gitignored and chmod 600.

## Privilege

- Don't run as root unless the task requires it; check and fail loudly
  (`[[ $EUID -eq 0 ]] || { echo "needs root" >&2; exit 1; }`) rather than
  sprinkling sudo inside scripts.
- Drop privileges for sub-work where possible (`sudo -u app ...`).
- Scripts editable by non-privileged users must never run from root
  cron — that's a privilege-escalation gift.

## Review Checklist

- [ ] All external input validated (pattern, length, emptiness)
- [ ] No `eval`/dynamic code with external data; commands built as arrays
- [ ] `--` before user-supplied operands on every command that takes flags
- [ ] Paths canonicalised + confined where users influence them
- [ ] `mktemp` + trap cleanup; no predictable temp names
- [ ] No secrets in code, argv, logs, or `set -x` output
- [ ] Destructive ops guarded (`${VAR:?}`, dry-run, explicit confirmation)
