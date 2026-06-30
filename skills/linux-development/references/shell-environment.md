# Shell environment

Most "works in one terminal but not another" problems live here. The shell
(bash/zsh) is your interface; its startup files and environment decide what's
available.

## Login vs interactive shells — what runs when

This trips everyone up. Bash reads different files depending on how it starts:

- **Login shell** (SSH session, console login, `bash -l`): reads `/etc/profile`
  then the first of `~/.bash_profile`, `~/.bash_login`, `~/.profile`.
- **Interactive non-login shell** (a new terminal tab/window in a GUI): reads
  `~/.bashrc`.
- **Non-interactive** (a script): reads neither — only `$BASH_ENV` if set.

Because of this split, the common pattern is to put everything in `~/.bashrc`
and have `~/.bash_profile` source it:

```bash
# ~/.bash_profile
[ -f ~/.bashrc ] && . ~/.bashrc
```

zsh uses `~/.zshenv` (always) → `~/.zprofile` (login) → `~/.zshrc`
(interactive) → `~/.zlogin`. WSL terminals are typically login shells; a GUI
terminal opens interactive non-login — know which you have when a PATH entry
"disappears".

## Environment variables and $PATH

`$PATH` is a colon-separated list searched left-to-right for commands; the first
match wins. Export variables to pass them to child processes:

```bash
export PATH="$HOME/.local/bin:$PATH"   # prepend, so it takes precedence
export EDITOR=vim
echo "$PATH" | tr ':' '\n'             # inspect, one entry per line
type -a python                          # which binary actually runs
```

- `set` shows shell variables; `env`/`printenv` show exported environment.
- A variable set without `export` is not visible to child processes.
- Prefer prepending `~/.local/bin` for user installs over editing system PATHs.

## Dotfiles — version-control them

Your shell config, aliases, functions, editor and tool settings are
`~/.bashrc`, `~/.config/...`, `~/.gitconfig`, etc. Keep them in a **tracked
dotfiles repo** (a bare repo or a tool like `chezmoi`/`stow`) so a new machine
(or WSL distro) is reproducible. Don't hand-edit and forget.

```bash
alias ll='ls -lah'
export HISTSIZE=10000 HISTCONTROL=ignoreboth   # bigger, de-duped history
```

## Practical shell use

- Tab-completion, history (`Ctrl-R` reverse search), `!!`/`!$` for last
  command/arg.
- Redirection: `>` (stdout), `2>` (stderr), `&>` (both), `|` (pipe),
  `<` (stdin); `tee` to split.
- Globs (`*`, `?`, `[...]`) are expanded by the shell *before* the command runs
  — quote to prevent it.
- For *writing* scripts (strict mode, quoting discipline, portability,
  testing) → `bash-development`. This reference is about using the interactive
  environment.
